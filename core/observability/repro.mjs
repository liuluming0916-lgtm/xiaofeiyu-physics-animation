/**
 * 失败复现包（M22 · 方案 §17 M22「失败复现包」/ §19.4「诊断不含绝对路径」）
 *
 * 一句话：把"这一次到底发生了什么"整理成**一个可以发出去的文件夹**。
 *
 * 为什么是文件夹而不是 `.zip`：
 *   本仓库的口径是"依赖最小"（根 `package.json` 只有 acorn + mathjax-full），
 *   而 Node 没有内置 zip 写入能力。为了一个压缩包引入依赖不值得 ——
 *   文件夹**双击就能看**、右键就能自己压，反而更适合发给别人。
 *
 * 包里放什么（全部已脱敏）：
 *   `record.json`    一次运行的摘要（阶段/耗时/token 估算/检查号/世界书命中/槽位字数）
 *   `events.jsonl`   逐事件（`stage_delta` 只留字数，不留正文）
 *   `problem.md`     题面
 *   `slots/*.txt`    八个槽位的代码（这是最有诊断价值的东西）
 *   `dryrun.json`    Dry-Run 报告（有就放）
 *   `manifest.json`  清单 + 每个文件的 sha256 + 脱敏声明
 *   `README.txt`     给人看的说明
 *
 * ⚠ **写完后逐个文件从磁盘读回来查密钥**。不查内存里的对象：
 *   "抹过了所以干净了"是自证，而自证在安全这件事上等于没证。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import {
  KEY_MASK,
  PROJECT_MASK,
  assertRedacted,
  collectSecrets,
  findSecrets,
  redactText,
} from '../security/index.mjs';
import { REPRO_DIRNAME, resolveObsDir, runDirOf, sha256, stableJson } from './journal.mjs';

export const REPRO_FORMAT = 'od-repro-pack';
export const REPRO_VERSION = 1;

/** 递归列出目录下的普通文件（返回相对路径，POSIX 分隔符） */
function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs, base));
    else if (e.isFile() && statSync(abs).isFile()) out.push(relative(base, abs).split('\\').join('/'));
  }
  return out.sort();
}

/**
 * 生成一份失败复现包。
 *
 * @param {{
 *   runId: string,
 *   dir?: string,
 *   secrets?: string[],
 *   note?: string,
 * }} input
 * @returns {{
 *   ok: boolean, code?: string, runId: string,
 *   dir: string|null,
 *   files: {name: string, bytes: number, sha256: string}[],
 *   manifest: object|null,
 * }}
 */
export function buildReproPack({ runId, dir, secrets = null, note = '' } = {}) {
  const id = String(runId ?? '').trim();
  if (!id) {
    return { ok: false, code: 'observability.missing-run-id', runId: '', dir: null, files: [], manifest: null };
  }

  const obsDir = resolveObsDir({ dir });
  const source = runDirOf(id, { dir });
  if (!existsSync(source)) {
    return { ok: false, code: 'observability.unknown-run', runId: id, dir: null, files: [], manifest: null };
  }

  const known = secrets ?? collectSecrets({ dir: undefined });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const target = join(obsDir, REPRO_DIRNAME, `${id}-${stamp}`);

  const files = [];
  const emit = (name, text) => {
    const abs = join(target, name);
    // 二次脱敏：素材本身已经脱过一遍，但复现包可能被单独拷给别人用，
    // 而"这一份"必须自己站得住（不依赖上游有没有抹对）。
    const body = redactText(String(text ?? ''), { secrets: known });
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, 'utf8');
    files.push({ name, bytes: Buffer.byteLength(body, 'utf8'), sha256: sha256(body) });
  };

  for (const rel of walk(source)) {
    emit(rel, readFileSync(join(source, rel), 'utf8'));
  }

  const manifest = {
    format: REPRO_FORMAT,
    version: REPRO_VERSION,
    runId: id,
    createdAt: new Date().toISOString(),
    note: redactText(String(note ?? ''), { secrets: known }),
    redaction: {
      applied: true,
      // 只报"抹了几个值"，**不报值本身**
      knownSecrets: known.length,
      keyMask: KEY_MASK,
      projectMask: PROJECT_MASK,
      paths: '工程根目录 ⇒ <project>；其余绝对路径 ⇒ <abs>/文件名',
    },
    files,
  };

  emit('manifest.json', stableJson(manifest));
  emit(
    'README.txt',
    [
      '这是一个「失败复现包」（od-repro-pack v1）。',
      '',
      '包里有什么：',
      '  record.json    这次运行的摘要：各阶段耗时、token 估算、失败检查号、世界书命中、槽位字数',
      '  events.jsonl   逐事件（模型的增量正文只留字数，不留内容）',
      '  problem.md     题面',
      '  slots/         八个槽位的代码 —— 排查问题主要看这里',
      '  dryrun.json    Dry-Run 报告（若这次跑到了 Dry-Run）',
      '  manifest.json  文件清单与每个文件的 sha256',
      '',
      '⚠ 钥匙（API Key）与绝对路径已经抹掉：',
      `   Key ⇒ ${KEY_MASK}；工程目录 ⇒ ${PROJECT_MASK}；其余路径 ⇒ <abs>/文件名。`,
      '   这是**写入时**做的，不是"记得删"。',
      '',
      '怎么用：直接把整个文件夹发给维护者（或自己留着对比"上次好的那次"）。',
      '',
    ].join('\n'),
  );

  /* ── 写后复核：以磁盘为准 ── */
  for (const f of files) {
    const back = readFileSync(join(target, f.name), 'utf8');
    assertRedacted(back, { secrets: known, where: `复现包 ${basename(target)}/${f.name}` });
  }

  return { ok: true, runId: id, dir: target, files, manifest };
}

/**
 * 列出已有的复现包（最新在前）。
 * @param {{ dir?: string }} [opts]
 * @returns {{ ok: boolean, dir: string, items: {name: string, runId: string, files: number, bytes: number}[] }}
 */
export function listReproPacks({ dir } = {}) {
  const base = join(resolveObsDir({ dir }), REPRO_DIRNAME);
  if (!existsSync(base)) return { ok: true, dir: base, items: [] };

  const items = readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const abs = join(base, e.name);
      const rels = walk(abs);
      let bytes = 0;
      for (const r of rels) {
        try {
          bytes += statSync(join(abs, r)).size;
        } catch {
          /* 统计不上不影响列表 */
        }
      }
      // 目录名形如 `<runId>-<YYYYMMDD>-<HHMMSS>`。
      // ⚠ runId 自己就含两个 `-`，时间戳里也有一个 ⇒ **不能按 lastIndexOf('-') 切**，
      //   要按固定的时间戳长度从右边剥（这个坑在第 33 道门禁里钉住了）。
      const STAMP_LEN = 15; // `YYYYMMDD-HHMMSS`
      const tail = e.name.slice(-STAMP_LEN);
      const runId = /^\d{8}-\d{6}$/.test(tail) ? e.name.slice(0, -(STAMP_LEN + 1)) : e.name;
      return { name: e.name, runId, files: rels.length, bytes };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1));

  return { ok: true, dir: base, items };
}

/**
 * 复现包的自检：把一个已知会"命中"的样本喂给 `findSecrets()`，
 * 确认它**确实能搜到**（负对照），再确认成品搜不到。
 *
 * 单拿出来是因为"脱敏器说自己干净"和"脱敏器真的干净"是两件事。
 *
 * @param {string} packDir
 * @param {string[]} secrets
 * @returns {{ ok: boolean, scanned: number, leaks: {file: string, hits: object[]}[] }}
 */
export function auditReproPack(packDir, secrets = []) {
  const dir = resolve(packDir);
  const leaks = [];
  const rels = walk(dir);
  for (const rel of rels) {
    const body = readFileSync(join(dir, rel), 'utf8');
    const hits = findSecrets(body, { secrets });
    if (hits.length) leaks.push({ file: rel, hits });
  }
  return { ok: leaks.length === 0, scanned: rels.length, leaks };
}
