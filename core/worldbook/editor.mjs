/**
 * 世界书的**可写入口**（第 6 期第 5 项的补齐 · §9.3 / §9.5 / §16）。
 *
 * 以前 `ai-rules/worldbook/` 只能通过导出包 + 手动放文件来写（README 里写着"需要一个本地服务"）。
 * 现在有了本机服务，这一层就是那个"服务端能写"的部分 —— 但它**只写用户目录**：
 *
 *   `core/worldbook/data/`   —— 内置词条，**只读**（升级会换掉）。要改某条 = 生成一份覆盖副本。
 *   `ai-rules/worldbook/`    —— 用户词条与覆盖副本，**这里才可写**。
 *
 * 三条口径：
 *   ① 一个文件 = 一个导出包（`{format:'od-worldbook', version:1, entries:[…]}`），与"导出词条"按钮产出的格式完全一致；
 *   ② 写入前先按 §9.1 校验每一条词条（`writeUserPack` 里做），**任何一条不合法就整批不写**；
 *   ③ 文件名只允许 `字母数字._-` 且必须以 `.json` 结尾 —— 挡掉路径穿越（`../x.json`）与隐藏文件。
 */

import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describeJsonError } from '../json-error.mjs';
import { backupFile } from '../rules/backup.mjs';
import { planRestoreDefault } from './governance.mjs';
import {
  PACK_FORMAT,
  PACK_VERSION,
  USER_DIR,
  canonicalizeEntry,
  listUserFiles,
  loadLibrary,
  parseEntryFile,
  removeUserFile,
  writeUserPack,
} from './store.mjs';

export const PACK_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;

const err = (code, path, message, hint) => ({ code, path, message, ...(hint ? { hint } : {}) });

/** 文件名合法性（挡路径穿越与隐藏文件） */
export function checkPackName(name) {
  const n = String(name ?? '');
  if (!PACK_NAME_RE.test(n) || n.includes('/') || n.includes('\\') || n.startsWith('.')) {
    return err(
      'worldbook.bad-name',
      'name',
      `文件名 "${n}" 不合法`,
      '只允许字母数字 . _ -，必须以 .json 结尾，不能带路径（例如 my-entries.json）',
    );
  }
  return null;
}

/**
 * 列出用户区的导出包（每条词条只给摘要，正文要单独读）。
 *
 * @param {{ dir?: string }} [opts]
 */
export function listWorldbookPacks({ dir = USER_DIR } = {}) {
  const packs = listUserFiles(dir).map(({ name, bytes, path }) => {
    const text = readFileSync(path, 'utf8');
    const parsed = parseEntryFile(text, name);
    return {
      name,
      bytes,
      count: parsed.entries.length,
      entries: parsed.entries.map((e) => ({ id: e?.id ?? '', title: e?.title ?? '', category: e?.category ?? '', origin: e?.origin ?? '' })),
      problems: parsed.problems,
    };
  });
  const problems = packs.flatMap((p) => p.problems);
  return { ok: problems.length === 0, dir, packs, problems };
}

/** 读某一份包的原文（编辑用） */
export function readWorldbookPack({ dir = USER_DIR, name } = {}) {
  const bad = checkPackName(name);
  if (bad) return { ok: false, issues: [bad] };

  const file = listUserFiles(dir).find((f) => f.name === name);
  if (!file) {
    return { ok: false, issues: [err('worldbook.not-found', name, `没有这个导出包：${name}`, '先点"新建"或"从内置复制一条"')] };
  }
  const text = readFileSync(file.path, 'utf8');
  const parsed = parseEntryFile(text, name);
  return { ok: true, name, text, bytes: file.bytes, entries: parsed.entries, problems: parsed.problems };
}

/**
 * 保存一份包（**整批生效或整批失败**）。
 *
 * @param {{ dir?: string, name: string, text: string }} opts
 */
export function saveWorldbookPack({ dir = USER_DIR, name, text } = {}) {
  const bad = checkPackName(name);
  if (bad) return { ok: false, issues: [bad] };

  const src = String(text ?? '');
  let raw;
  try {
    raw = JSON.parse(src);
  } catch (e) {
    const d = describeJsonError(src, e);
    return { ok: false, issues: [err('worldbook.bad-json', name, d.message, d.hint)] };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, issues: [err('worldbook.not-object', name, '导出包必须是一个对象：{format, version, entries}')] };
  }
  if (raw.format !== PACK_FORMAT) {
    return { ok: false, issues: [err('worldbook.bad-format', `${name}:format`, `format 必须是 "${PACK_FORMAT}"，当前 ${JSON.stringify(raw.format)}`)] };
  }
  if (raw.version !== PACK_VERSION) {
    return { ok: false, issues: [err('worldbook.bad-version', `${name}:version`, `不支持的版本 ${JSON.stringify(raw.version)}`, `本版只支持 version = ${PACK_VERSION}`)] };
  }
  if (!Array.isArray(raw.entries)) {
    return { ok: false, issues: [err('worldbook.entries.not-array', `${name}:entries`, 'entries 必须是数组')] };
  }

  try {
    // 第 6 期第 3 件：写之前留一份（滚动 5 份，放在 `<dir>/.backup/`）
    backupFile({ dir, rel: name });
    // writeUserPack 会逐条校验（validateEntry）并**原子写**；不合法就抛，抛了就什么都没写
    writeUserPack(dir, name, raw.entries);
  } catch (e) {
    const raw = Array.isArray(e?.problems) ? e.problems : [String(e?.message ?? e)];
    // `writeUserPack` 的报错位置写作 `user[0]`（面向代码）。这里是给人看的，换成"第 1 条词条"。
    const problems = raw.map((p) => String(p).replace(/user\[(\d+)\]/g, (_, i) => `第 ${Number(i) + 1} 条词条`));
    return {
      ok: false,
      issues: problems.map((p) => err('worldbook.entry-invalid', name, p, '这一条不会被写入；请按 §9.1 的字段与枚举改')),
    };
  }
  return { ok: true, name, count: raw.entries.length };
}

/** 新建一份空包（entries: []） */
export function createWorldbookPack({ dir = USER_DIR, name } = {}) {
  const bad = checkPackName(name);
  if (bad) return { ok: false, issues: [bad] };
  if (listUserFiles(dir).some((f) => f.name === name)) {
    return { ok: false, issues: [err('worldbook.exists', name, `已经有 ${name} 了`, '换个文件名，或直接打开它编辑')] };
  }
  const r = saveWorldbookPack({ dir, name, text: `${JSON.stringify({ format: PACK_FORMAT, version: PACK_VERSION, entries: [] }, null, 2)}\n` });
  if (!r.ok) return r;
  return { ok: true, name, count: 0 };
}

/** 删除一份包（"恢复默认"= 删掉覆盖副本，内置原样生效） */
export function deleteWorldbookPack({ dir = USER_DIR, name } = {}) {
  const bad = checkPackName(name);
  if (bad) return { ok: false, issues: [bad] };
  const r = removeUserFile(dir, name);
  if (!r.removed) return { ok: false, issues: [err('worldbook.not-found', name, `没有这个导出包：${name}`)] };
  return { ok: true, name };
}

/**
 * 一键恢复**本版本内置词条**（设置页的「恢复内置」按钮）。
 *
 * 语义（与 §9.3 ④ / `planRestoreDefault` 完全一致）：
 *   · 只删「用户区里 id 与内置相同」的**覆盖副本** ⇒ 删掉后内置原样生效；
 *   · **绝不删用户自己新建的卡**（不是任何内置 id）；
 *   · 每个被改动的文件写之前先滚动备份（`.backup/<name>.bak.1…5`），所以恢复本身可撤销；
 *   · 整包都是覆盖副本 ⇒ 备份后删掉整个文件（否则会留下一个空包）。
 *
 * 为什么这就是"该版本发布时的内置"：内置层在发行产物里读的是**编译进代码的常量**
 * （`builtin-bundle.generated.mjs`，构建期从 `core/worldbook/data/` 生成）。
 * 所以每个版本装出来的程序，按这个按钮恢复到的就是**它自己那一版**的内置，不会串版。
 *
 * @param {{ dir?: string }} [opts]
 */
export function restoreBuiltinWorldbook({ dir = USER_DIR } = {}) {
  const builtin = listBuiltinEntries();
  const builtinIds = builtin.entries.map((e) => e.id);

  const problems = [];
  const packs = [];
  for (const f of listUserFiles(dir)) {
    const text = readFileSync(f.path, 'utf8');
    const parsed = parseEntryFile(text, f.name);
    if (parsed.problems.length) {
      // 坏包不猜、不改：如实报出来，让人先修
      problems.push(...parsed.problems.map((p) => `${f.name}: ${p}`));
      continue;
    }
    packs.push({ name: f.name, entries: parsed.entries.map((e) => ({ ...e, origin: 'user' })) });
  }

  const plan = planRestoreDefault({
    entries: packs.flatMap((p) => p.entries),
    builtinIds,
    all: true,
  });
  const targets = new Set(plan.toRemove);
  const result = {
    ok: problems.length === 0,
    builtinCount: builtin.entries.length,
    overriddenIds: plan.toRemove,
    confirmList: plan.confirmList,
    removed: 0,
    packsTouched: 0,
    packsDeleted: 0,
    backupDir: join(dir, '.backup'),
    problems,
  };
  if (targets.size === 0) return result;

  for (const p of packs) {
    const keep = p.entries.filter((e) => !targets.has(e.id));
    const drop = p.entries.length - keep.length;
    if (drop === 0) continue;

    // 口径：恢复之前先备份（备份失败就不改，宁可让人看到错误）
    const bak = backupFile({ dir, rel: p.name });
    if (!bak.ok) {
      result.ok = false;
      result.problems.push(...(bak.issues ?? [{ message: `备份失败：${p.name}` }]).map((x) => `${p.name}: ${x.message ?? x}`));
      continue;
    }

    if (keep.length === 0) {
      const r = removeUserFile(dir, p.name);
      if (r.removed) result.packsDeleted += 1;
      else {
        result.ok = false;
        result.problems.push(`${p.name}: 删除失败（文件可能被占用）`);
        continue;
      }
    } else {
      try {
        writeUserPack(dir, p.name, keep);
        result.packsTouched += 1;
      } catch (e) {
        result.ok = false;
        result.problems.push(`${p.name}: ${e?.message ?? e}`);
        continue;
      }
    }
    result.removed += drop;
  }

  return result;
}

/* ────────────────────────────── 内置（只读，用于"复制成覆盖副本"） ────────────────────────────── */

/** 内置词条清单（只给摘要：全给全文会太大） */
export function listBuiltinEntries() {
  const lib = loadLibrary({ userDir: join(tmpdir(), 'od-no-such-userdir') });
  return {
    ok: lib.ok,
    count: lib.builtin.length,
    entries: lib.builtin.map((e) => ({ id: e.id, title: e.title, category: e.category })),
    problems: lib.problems,
  };
}

/** 取一条内置词条的全文（规范化后：字段顺序稳定、缺省值填实） */
export function readBuiltinEntry(id) {
  const lib = loadLibrary({ userDir: join(tmpdir(), 'od-no-such-userdir') });
  const e = lib.builtin.find((x) => x.id === id);
  if (!e) return { ok: false, issues: [err('worldbook.builtin-not-found', 'id', `内置库里没有词条 "${id}"`)] };
  return { ok: true, entry: canonicalizeEntry(e) };
}

/**
 * 把一条内置词条复制成用户覆盖副本（单条一份文件，文件名 = `<id>.json`）。
 *
 * 为什么单条一份：覆盖副本的语义是"同 id 覆盖内置"，一条一个文件最容易看出"我到底覆盖了哪几条"，
 * 删掉它就恢复内置。
 */
export function copyBuiltinEntry({ dir = USER_DIR, id, name } = {}) {
  const r = readBuiltinEntry(id);
  if (!r.ok) return r;
  const fileName = name ?? `${String(id).replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
  const saved = saveWorldbookPack({
    dir,
    name: fileName,
    text: `${JSON.stringify({ format: PACK_FORMAT, version: PACK_VERSION, entries: [r.entry] }, null, 2)}\n`,
  });
  if (!saved.ok) return saved;
  return { ok: true, name: fileName, count: 1 };
}
