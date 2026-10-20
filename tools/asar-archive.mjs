#!/usr/bin/env node
/**
 * 极简 ASAR 读写（打包链路自用）。
 *
 * ── 为什么自己写，而不是装 `@electron/asar` ──
 *
 * 本项目的发布环境是**离线**的：`node_modules` 里没有 `@electron/asar`，
 * npm registry 也不保证可达。而我们要的只是"把一棵目录树写成一个 app.asar"，
 * ASAR 的格式本身很小（见下），自己写 200 行比引一棵依赖树（glob / minimatch / commander）
 * 更可控，也少一个"换机器就装不上"的失败点。
 *
 * ── 格式（与 @electron/asar 3.4.1 的 disk.js / pickle.js 逐字节一致）──
 *
 * ```
 * [UInt32LE = 4]                  ← size pickle 的 payload 长度（写死 4）
 * [UInt32LE = headerBuf.length]   ← header pickle 的总长
 * [UInt32LE = headerBuf 去掉前 4 字节后的长度]
 * [UInt32LE = JSON 字节数]
 * [JSON 头，补齐到 4 字节]
 * [文件 1 原始字节][文件 2 原始字节]…
 * ```
 *
 * 文件在头里的 `offset` 是**相对数据区起点**的十进制字符串；
 * 数据区起点 = `8 + headerBuf.length`。
 *
 * 关键细节（都是实测过的，改之前先读）：
 *   · 字符串写入按 4 字节对齐，JSON 尾部要补 0（`@electron/asar` 的 Pickle 就是这么做的）；
 *   · `unpacked` 文件不进 asar，放在 `<asar>.unpacked/` 下，头里只留 `{size, unpacked:true}`；
 *   · 头里可以没有 `integrity`（Electron 默认不校验；加了反而要自己算 SHA256 分块）。
 *
 * 用法（被 `tools/pack-payload.mjs` 调用，一般不用手跑）：
 *   node tools/asar-archive.mjs pack <目录> <app.asar> [--unpack <正则>]
 *   node tools/asar-archive.mjs list <app.asar>
 *   node tools/asar-archive.mjs extract <app.asar> <输出目录>
 */

import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** JS 数字能精确表示的边界；单个文件不可能超过 4 GB（ASAR 格式本身也不允许） */
const UINT32_MAX = 2 ** 32 - 1;

/** 4 字节对齐（ASAR 的 Pickle 每条写入都按 UInt32 对齐） */
function align4(n) {
  return n + ((4 - (n % 4)) % 4);
}

/** 目录树遍历：返回 `{ files, dirs }`，路径统一用 `/` */
function walkTree(root) {
  const files = [];
  const dirs = [];
  const visit = (abs, rel) => {
    const entries = readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const childAbs = join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        dirs.push(childRel);
        visit(childAbs, childRel);
      } else if (entry.isFile()) {
        const st = statSync(childAbs);
        if (st.size > UINT32_MAX) throw new Error(`文件超过 4 GB，ASAR 装不下：${childAbs}`);
        files.push({ rel: childRel, abs: childAbs, size: st.size });
      } else if (entry.isSymbolicLink()) {
        /* 载荷里不应有符号链接；真有就按目标文件处理（Windows 上通常是目录联接） */
        const st = statSync(childAbs);
        if (st.isDirectory()) {
          dirs.push(childRel);
          visit(childAbs, childRel);
        } else {
          files.push({ rel: childRel, abs: childAbs, size: st.size });
        }
      }
    }
  };
  visit(root, '');
  return { files, dirs };
}

/** 在头的树里找到（必要时创建）某个相对路径的父目录节点 */
function ensureDirNode(rootNode, relDir) {
  let node = rootNode;
  if (!relDir) return node;
  for (const part of relDir.split('/')) {
    if (!node.files) node.files = Object.create(null);
    if (!node.files[part]) node.files[part] = { files: Object.create(null) };
    node = node.files[part];
    if (!node.files) node.files = Object.create(null);
  }
  return node;
}

/**
 * 把目录写成 ASAR。
 *
 * @param {string} srcDir 待打包目录（会递归包含全部文件）
 * @param {string} destFile 目标 `app.asar`
 * @param {{ unpack?: RegExp|((rel:string)=>boolean), log?: (msg:string)=>void }} [opts]
 *        `unpack`：命中的相对路径（`/` 分隔）不写入 asar，改放 `<destFile>.unpacked/`
 * @returns {{ files:number, packed:number, unpacked:number, bytes:number, headerSize:number }}
 */
export function createAsar(srcDir, destFile, opts = {}) {
  const root = resolve(srcDir);
  const dest = resolve(destFile);
  const shouldUnpack = (rel) => {
    if (!opts.unpack) return false;
    return typeof opts.unpack === 'function' ? opts.unpack(rel) : opts.unpack.test(rel);
  };
  const log = opts.log ?? (() => {});

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`ASAR 源目录不存在：${root}`);
  }

  mkdirSync(dirname(dest), { recursive: true });
  /* 先清掉上一次的 unpacked，避免删掉文件后残留旧副本 */
  rmSync(`${dest}.unpacked`, { recursive: true, force: true });
  rmSync(`${dest}.tmp`, { force: true });

  const { files, dirs } = walkTree(root);
  const header = { files: Object.create(null) };
  for (const d of dirs) {
    const parent = ensureDirNode(header, posix.dirname(d) === '.' ? '' : posix.dirname(d));
    const name = posix.basename(d);
    if (!parent.files[name]) parent.files[name] = { files: Object.create(null) };
    if (!parent.files[name].files) parent.files[name].files = Object.create(null);
  }

  const packed = [];
  let unpacked = 0;
  let offset = 0;
  for (const f of files) {
    const parent = ensureDirNode(header, posix.dirname(f.rel) === '.' ? '' : posix.dirname(f.rel));
    const name = posix.basename(f.rel);
    if (shouldUnpack(f.rel)) {
      const target = join(`${dest}.unpacked`, ...f.rel.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(f.abs, target);
      parent.files[name] = { size: f.size, unpacked: true };
      unpacked += 1;
    } else {
      parent.files[name] = { size: f.size, offset: String(offset) };
      packed.push(f);
      offset += f.size;
    }
  }

  /* ── 头（Pickle）：JSON → 按 4 字节补齐 → 前面加长度 ── */
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const paddedJson = Buffer.alloc(align4(json.length));
  json.copy(paddedJson);
  const headerBuf = Buffer.alloc(8 + paddedJson.length);
  headerBuf.writeUInt32LE(4 + paddedJson.length, 0); // payload 长度 = 字符串长度字段 + JSON
  headerBuf.writeUInt32LE(json.length, 4); // 字符串长度（不含补齐）
  paddedJson.copy(headerBuf, 8);

  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeUInt32LE(4, 0);
  sizeBuf.writeUInt32LE(headerBuf.length, 4);

  const fd = openSync(`${dest}.tmp`, 'w');
  try {
    writeSync(fd, sizeBuf, 0, sizeBuf.length, 0);
    writeSync(fd, headerBuf, 0, headerBuf.length, 8);
    let pos = 8 + headerBuf.length;
    for (const f of packed) {
      const buf = readFileSync(f.abs);
      if (buf.length !== f.size) throw new Error(`读取期间文件大小变了：${f.abs}`);
      writeSync(fd, buf, 0, buf.length, pos);
      pos += buf.length;
    }
  } finally {
    closeSync(fd);
  }
  renameSync(`${dest}.tmp`, dest);

  const bytes = statSync(dest).size;
  log(
    `  ✓ asar 写入 ${dest.replace(/\\/g, '/')}：${files.length} 个文件（打包 ${packed.length} · 解包 ${unpacked}）` +
      ` · ${(bytes / 1024 / 1024).toFixed(1)} MB · 头 ${headerBuf.length} B`,
  );
  return { files: files.length, packed: packed.length, unpacked, bytes, headerSize: headerBuf.length };
}

/** 读 ASAR 头。返回 `{ header, headerSize, dataOffset }` */
export function readAsarHeader(asarPath) {
  const fd = openSync(asarPath, 'r');
  let headerSize;
  let headerBuf;
  try {
    const sizeBuf = Buffer.alloc(8);
    if (readSync(fd, sizeBuf, 0, 8, 0) !== 8) throw new Error('读不到 ASAR 头长度');
    headerSize = sizeBuf.readUInt32LE(4);
    headerBuf = Buffer.alloc(headerSize);
    if (readSync(fd, headerBuf, 0, headerSize, 8) !== headerSize) throw new Error('读不到 ASAR 头');
  } finally {
    closeSync(fd);
  }
  const jsonLength = headerBuf.readUInt32LE(4);
  const json = headerBuf.toString('utf8', 8, 8 + jsonLength);
  return { header: JSON.parse(json), headerSize, dataOffset: 8 + headerSize };
}

/** 把头摊平成 `[{ path, size, unpacked, offset }]` */
export function listAsar(asarPath) {
  const { header } = readAsarHeader(asarPath);
  const out = [];
  const visit = (node, prefix) => {
    if (!node || !node.files) return;
    for (const [name, child] of Object.entries(node.files)) {
      const p = prefix ? `${prefix}/${name}` : name;
      if (child.files) visit(child, p);
      else out.push({ path: p, size: child.size ?? 0, unpacked: Boolean(child.unpacked), offset: child.offset ?? null });
    }
  };
  visit(header, '');
  return out;
}

/** 在 ASAR 里读一个文件的文本（用于校验 package.json / 产物标记） */
export function readAsarText(asarPath, relPath) {
  const { header, dataOffset } = readAsarHeader(asarPath);
  const parts = String(relPath).split('/').filter(Boolean);
  let node = header;
  for (let i = 0; i < parts.length; i += 1) {
    node = node?.files?.[parts[i]];
    if (!node) throw new Error(`ASAR 里没有：${relPath}`);
  }
  if (node.files) throw new Error(`ASAR 目标是目录，不是文件：${relPath}`);
  if (node.unpacked) {
    return readFileSync(join(`${asarPath}.unpacked`, ...parts), 'utf8');
  }
  const buf = Buffer.alloc(node.size);
  const fd = openSync(asarPath, 'r');
  try {
    readSync(fd, buf, 0, node.size, dataOffset + parseInt(node.offset, 10));
  } finally {
    closeSync(fd);
  }
  return buf.toString('utf8');
}

/** 把整个 ASAR 解到目录（排查 / 体检用，不参与打包） */
export function extractAsar(asarPath, outDir) {
  const { header, dataOffset } = readAsarHeader(asarPath);
  rmSync(outDir, { recursive: true, force: true });
  const fd = openSync(asarPath, 'r');
  try {
    const visit = (node, prefix) => {
      for (const [name, child] of Object.entries(node.files)) {
        const rel = prefix ? `${prefix}/${name}` : name;
        if (child.files) {
          mkdirSync(join(outDir, ...rel.split('/')), { recursive: true });
          visit(child, rel);
          continue;
        }
        const target = join(outDir, ...rel.split('/'));
        mkdirSync(dirname(target), { recursive: true });
        if (child.unpacked) {
          copyFileSync(join(`${asarPath}.unpacked`, ...rel.split('/')), target);
          continue;
        }
        const buf = Buffer.alloc(child.size);
        readSync(fd, buf, 0, child.size, dataOffset + parseInt(child.offset, 10));
        writeFileSyncRaw(target, buf);
      }
    };
    visit(header, '');
  } finally {
    closeSync(fd);
  }
}

function writeFileSyncRaw(path, buf) {
  const fd = openSync(path, 'w');
  try {
    writeSync(fd, buf, 0, buf.length, 0);
  } finally {
    closeSync(fd);
  }
}

/* ── 命令行（只给排查用；打包走 pack-payload） ── */
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === 'pack') {
      const unpackArg = rest[2] ?? null;
      createAsar(rest[0], rest[1], {
        unpack: unpackArg ? new RegExp(unpackArg) : undefined,
        log: console.log,
      });
    } else if (cmd === 'list') {
      for (const f of listAsar(rest[0])) {
        console.log(`${f.unpacked ? 'U' : ' '} ${String(f.size).padStart(9)}  ${f.path}`);
      }
    } else if (cmd === 'extract') {
      extractAsar(rest[0], rest[1]);
      console.log(`✓ 已解到 ${relative(process.cwd(), rest[1]) || rest[1]}`);
    } else {
      console.error('用法：node tools/asar-archive.mjs pack <目录> <app.asar> [--unpack 正则]');
      console.error('      node tools/asar-archive.mjs list <app.asar>');
      console.error('      node tools/asar-archive.mjs extract <app.asar> <输出目录>');
      process.exitCode = 2;
    }
  } catch (err) {
    console.error(`✗ asar 失败：${err?.message ?? err}`);
    process.exitCode = 1;
  }
}
