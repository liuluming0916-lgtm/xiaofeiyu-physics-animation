#!/usr/bin/env node
/**
 * 编码门禁：把“PowerShell 读写把中文源码变成乱码”挡在提交之前。
 *
 * 背景（2026-10-24 真实事故）：
 *   · Windows PowerShell 5.1 的 Get-Content/Set-Content 默认按 ANSI（中文机器是 GBK）处理；
 *   · `>` / `>>` 重定向还可能写出 UTF-16LE；
 *   · `pipeline.mjs` 被这样读写一次后，UTF-8 中文变成 GBK 乱码，换行/大括号被吞，门禁全红。
 *
 * 本脚本只做三件事，不修文件：
 *   ① 非法 UTF-8（TextDecoder fatal）
 *   ② NUL 字节 / UTF-16 BOM / UTF-8 BOM
 *   ③ 代码文件里高密度的“UTF-8 被当 GBK 读”乱码片段
 *
 * 用法：
 *   node tools/check-encoding.mjs            # 扫描仓库默认范围
 *   node tools/check-encoding.mjs --staged   # 只扫 git 暂存区（正常环境）
 *   git diff --cached --name-only -z --diff-filter=ACMR \
 *     | node tools/check-encoding.mjs --stdin   # pre-commit 用：不 spawn git，避免沙箱/管道限制
 *
 * 注意：它**不替代**代码审查，也不猜着修复乱码；发现可疑就停下来找 git/编辑器历史。
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** 默认扫描的顶层范围（不扫生成物/依赖/发布物） */
const DEFAULT_ROOTS = [
  'core',
  'tools',
  'web/src',
  'tests',
  'contracts',
  'sdk',
  'electron',
  'template',
  'docs',
  'archive',
];

/** 根目录下的单文件也要扫 */
const ROOT_FILES = ['package.json', 'package-lock.json', 'README.md', 'AGENTS.md', '项目现状与路线.md'];

/** 不扫的目录（生成物、依赖、发布物、用户数据） */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'release',
  'exports',
  'data',
  '开源日志',
  'web/dist',
  'web/.build',
  'template/build',
  'template/vendor',
  'tests/reports',
  'DB.Browser',
]);

/** 扫的扩展名 */
const TEXT_EXTS = new Set([
  '.mjs',
  '.cjs',
  '.js',
  '.ts',
  '.tsx',
  '.json',
  '.md',
  '.html',
  '.css',
  '.bat',
  '.cmd',
  '.yml',
  '.yaml',
  '.txt',
]);

/** 代码文件才做“乱码片段”扫描；Markdown 里可能故意举例，不扫 */
const CODE_EXTS = new Set(['.mjs', '.cjs', '.js', '.ts', '.tsx', '.json']);

/**
 * UTF-8 中文被当 GBK 读之后的高频残留。
 * 只用于“高密度”判断（>=3 处），单个字不报，避免把正常中文误判。
 */
const MOJIBAKE_RE =
  /锟斤拷|鏂|鐨|鈥|锛|鍜|銆|瀹|妫|浣|鏄|涓|绋|璺|闂|鍒|鏃|鏈|鐢|鍥|鎬|澶|灏|寮|鏂囦|浠|瀹炵|鏁|鎴|鍔|鏋|鍏|鍦|浜|鐨勬|涓嶆|鏈夌|鐢ㄦ|鍥犱|鎬荤|澶у|灏忕|杩欎|浠栦|瀹冧|鏁版|鎴愬|鍔ㄧ|鏋勬|鍏崇|璺濈|闂ㄧ|鍒嗘|鏃犳|鏈夋|鐢熸|鍥剧|鎬濊|澶勭|灏嗙|寮鸿|浠ｇ|瀹夎|鏁欎|鍔犺|鏋愬|鍏虫|璺ㄥ/g;

/** 自己包含乱码样本，跳过“乱码片段”扫描，避免自指误报 */
const SELF_REL = 'tools/check-encoding.mjs';

const problems = [];
let scanned = 0;

function relOf(abs) {
  return relative(ROOT, abs).split('\\').join('/');
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

function report(file, message) {
  problems.push({ file: relOf(file), message });
}

function shouldSkipDir(name, rel) {
  if (name.startsWith('.tmp')) return true;
  if (SKIP_DIRS.has(rel)) return true;
  if (rel.startsWith('web/dist/') || rel.startsWith('web/.build/')) return true;
  return false;
}

function walkDir(absDir, out) {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = join(absDir, e.name);
    const rel = relOf(abs);
    if (e.isDirectory()) {
      if (shouldSkipDir(e.name, rel)) continue;
      walkDir(abs, out);
      continue;
    }
    if (!e.isFile()) continue;
    if (e.name.startsWith('.tmp')) continue;
    const ext = extname(e.name).toLowerCase();
    if (!TEXT_EXTS.has(ext)) continue;
    out.push(abs);
  }
}

function listDefaultFiles() {
  const out = [];
  for (const r of DEFAULT_ROOTS) {
    const abs = join(ROOT, r);
    try {
      if (statSync(abs).isDirectory()) walkDir(abs, out);
      else if (TEXT_EXTS.has(extname(abs).toLowerCase())) out.push(abs);
    } catch {
      /* 目录可能还没建（archive/ 等） */
    }
  }
  for (const name of ROOT_FILES) {
    const abs = join(ROOT, name);
    try {
      if (statSync(abs).isFile()) out.push(abs);
    } catch {
      /* 可选文件 */
    }
  }
  return [...new Set(out)].sort();
}

function listStagedFiles() {
  let raw;
  try {
    raw = execFileSync('git', ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], {
      cwd: ROOT,
      encoding: 'buffer',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    if (e?.code === 'EPERM' || /EPERM/.test(String(e?.message ?? ''))) {
      console.error('✗ 当前环境禁止 Node 启动 git 子进程（EPERM）。');
      console.error('  请改用 stdin 形式：git diff --cached --name-only -z --diff-filter=ACMR | node tools/check-encoding.mjs --stdin');
    } else {
      console.error(`✗ 无法读取 git 暂存区：${e?.message ?? e}`);
    }
    process.exit(2);
  }
  return pathsFromList(raw.toString('utf8'));
}

/**
 * pre-commit 的路径来源：**父进程通过 stdin 传文件名**，本脚本不 spawn git。
 * 这样即使环境禁止子进程管道（例如 DSH 沙箱的 EPERM），钩子也能跑。
 */
function listStdinFiles() {
  const raw = readFileSync(0, 'utf8');
  return pathsFromList(raw);
}

/** 把 NUL / 换行分隔的相对路径转成实际存在的文件列表 */
function pathsFromList(raw) {
  return String(raw ?? '')
    .split(/[\0\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((rel) => !rel.startsWith('.tmp'))
    .filter((rel) => TEXT_EXTS.has(extname(rel).toLowerCase()))
    .map((rel) => join(ROOT, rel))
    .filter((abs) => {
      try {
        return statSync(abs).isFile();
      } catch {
        return false; // 删除的文件不扫
      }
    });
}

function checkOne(abs) {
  scanned += 1;
  const buf = readFileSync(abs);
  const rel = relOf(abs);
  const ext = extname(abs).toLowerCase();

  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) {
    report(abs, '是 UTF-16（含 BOM）；源码必须是 UTF-8');
    return;
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    report(abs, '带 UTF-8 BOM；源码不要带 BOM（shebang/逐字节断言会受影响）');
    return;
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    report(abs, '不是合法 UTF-8（很可能是 GBK/ANSI 被直接写回）');
    return;
  }

  if (text.includes('\u0000')) {
    report(abs, '包含 NUL 字节（常见于 PowerShell `>` 写出的 UTF-16LE）');
    return;
  }
  const replacement = text.indexOf('\uFFFD');
  if (replacement >= 0) {
    report(abs, `含替换字符 U+FFFD（第 ${lineOf(text, replacement)} 行；中文已被破坏）`);
    return;
  }

  if (CODE_EXTS.has(ext) && rel !== SELF_REL) {
    const hits = text.match(MOJIBAKE_RE) ?? [];
    if (hits.length >= 3) {
      const first = text.search(MOJIBAKE_RE);
      const sample = hits.slice(0, 6).join(' / ');
      report(abs, `疑似 GBK 乱码 ${hits.length} 处（第 ${lineOf(text, Math.max(0, first))} 行起；样本：${sample}）`);
    }
  }
}

function main() {
  const stdin = process.argv.includes('--stdin');
  const staged = process.argv.includes('--staged');
  const files = stdin ? listStdinFiles() : staged ? listStagedFiles() : listDefaultFiles();
  const label = stdin ? 'stdin 清单' : staged ? '暂存区' : '仓库';
  console.log(`编码检查：${label} · ${files.length} 个文本文件`);

  if (files.length === 0) {
    console.log('  · 没有要检查的文件（清单为空）');
    return 0;
  }

  for (const f of files) {
    try {
      checkOne(f);
    } catch (e) {
      report(f, `读取失败：${e?.message ?? e}`);
    }
  }

  if (problems.length === 0) {
    console.log('  ✓ 未发现非法编码/高密度乱码');
    return 0;
  }

  console.log(`  ✗ ${problems.length} 个文件有问题：`);
  for (const p of problems) console.log(`      · ${p.file}：${p.message}`);
  console.log('\n  → 不要用 iconv 猜着逆转；先找 git（HEAD/暂存区/fsck）或编辑器本地历史。');
  console.log('  → 修复后跑：node tools/check-encoding.mjs');
  return 1;
}

process.exitCode = main();
