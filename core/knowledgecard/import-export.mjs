/**
 * 世界书**导入 / 导出**（§9.5 / §9.3 ③）。
 *
 * 包格式 = `contracts/knowledgecard-pack.schema.json`：`{ format:"od-knowledgecard", version:1, entries:[…] }`。
 *
 * ── 旧名归一化只发生在**导入**路径（§9.1 冻结口径）
 *
 *   `scene_spec` → `scene_code`；v2 的字符串写法 `"both"` → `["solve","scene_code"]`。
 *   **导出与内部一律只写新名**。归一化必须**逐条记下来**（`converted`），
 *   因为 UI 必须提示"已转换 N 条旧槽位名"——静默改名会让用户以为文件本来就是这么写的。
 *
 * 本文件是**纯函数**（无 IO）：浏览器侧的导入预览与 Node 侧的落盘共用同一实现。
 */

import { KNOWLEDGECARD_IMPORT_ALIASES, KNOWLEDGECARD_INSERTION_SLOTS } from '../../contracts/spec/frozen-keys.mjs';
import {
  canonicalizeEntry,
  ENTRY_FIELD_ORDER,
  PACK_FORMAT,
  PACK_FORMAT_LEGACY,
  PACK_FORMATS,
  PACK_VERSION,
  validateEntry,
} from './store.mjs';

/** 归一化一条导入词条的 `insertion_slot`（返回转换记录） */
function normalizeSlotField(entry) {
  const converted = [];
  const raw = entry?.insertion_slot;
  if (raw === undefined) return { value: undefined, converted };

  // ① v2 的字符串写法（含 "both"）
  if (typeof raw === 'string') {
    if (raw === KNOWLEDGECARD_IMPORT_ALIASES.slotLiteralBoth) {
      converted.push({ kind: 'slot-both', from: raw, to: [...KNOWLEDGECARD_INSERTION_SLOTS] });
      return { value: [...KNOWLEDGECARD_INSERTION_SLOTS], converted };
    }
    const mapped = KNOWLEDGECARD_IMPORT_ALIASES.slotName[raw] ?? raw;
    if (mapped !== raw) converted.push({ kind: 'slot-name', from: raw, to: mapped });
    return { value: [mapped], converted };
  }

  if (!Array.isArray(raw)) return { value: raw, converted };

  // ② 数组里出现旧名 / "both"
  const out = [];
  for (const s of raw) {
    if (s === KNOWLEDGECARD_IMPORT_ALIASES.slotLiteralBoth) {
      converted.push({ kind: 'slot-both', from: s, to: [...KNOWLEDGECARD_INSERTION_SLOTS] });
      for (const slot of KNOWLEDGECARD_INSERTION_SLOTS) if (!out.includes(slot)) out.push(slot);
      continue;
    }
    const mapped = KNOWLEDGECARD_IMPORT_ALIASES.slotName[s] ?? s;
    if (mapped !== s) converted.push({ kind: 'slot-name', from: s, to: mapped });
    if (!out.includes(mapped)) out.push(mapped);
  }
  return { value: out, converted };
}

/**
 * 解析并归一化一个导入包。
 *
 * @param {unknown} raw 已 `JSON.parse` 的内容（或未解析的字符串）
 * @returns {{
 *   ok: boolean,
 *   pack: { format: string, version: number, entries: object[] } | null,
 *   entries: object[],
 *   converted: Array<{ entryId: string|null, kind: string, from: string, to: string[]|string }>,
 *   problems: string[],
 *   notice: string|null,
 * }}
 */
export function normalizeImportedPack(raw) {
  const problems = [];
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch (err) {
      return { ok: false, pack: null, entries: [], converted: [], problems: [`不是合法 JSON：${err?.message ?? err}`], notice: null };
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, pack: null, entries: [], converted: [], problems: ['导入内容不是对象'], notice: null };
  }

  if (!PACK_FORMATS.includes(obj.format)) {
    problems.push(`format 必须是 "${PACK_FORMAT}" 或兼容的 "${PACK_FORMAT_LEGACY}"（实际：${JSON.stringify(obj.format)}）`);
  }
  if (obj.version !== PACK_VERSION) {
    problems.push(`version ${JSON.stringify(obj.version)} 不受支持（不支持版本明确拒绝；本版只支持 ${PACK_VERSION}）`);
  }
  if (!Array.isArray(obj.entries)) problems.push('entries 必须是数组');
  for (const key of Object.keys(obj)) {
    if (!['format', 'version', 'entries'].includes(key)) problems.push(`包内出现未知字段 "${key}"（契约 additionalProperties 为 false）`);
  }
  if (problems.length) {
    return { ok: false, pack: null, entries: [], converted: [], problems, notice: null };
  }

  const entries = [];
  const converted = [];
  obj.entries.forEach((rawEntry, i) => {
    const entryId = typeof rawEntry?.id === 'string' ? rawEntry.id : null;
    // 先归一化槽位名，再校验（否则旧名会被校验判成非法槽位）
    const entry = { ...rawEntry };
    const slotNorm = normalizeSlotField(entry);
    if (slotNorm.value !== undefined) entry.insertion_slot = slotNorm.value;
    for (const c of slotNorm.converted) converted.push({ entryId, ...c });

    const canon = canonicalizeEntry(entry);
    const p = validateEntry(canon, `entries[${i}]`);
    if (p.length) {
      problems.push(...p);
      return;
    }
    // **导入一律落成 user 覆盖副本**：导入别人的词条不该被当成"内置"
    entries.push({ ...canon, origin: 'user' });
  });

  if (problems.length) {
    return { ok: false, pack: null, entries: [], converted, problems, notice: null };
  }

  const notices = [];
  if (converted.length) notices.push(`已转换 ${converted.length} 条旧槽位名`);
  if (obj.format === PACK_FORMAT_LEGACY) notices.push(`已兼容旧包格式 ${PACK_FORMAT_LEGACY}（下次导出写成 ${PACK_FORMAT}）`);
  const notice = notices.length ? notices.join('；') : null;
  return {
    ok: true,
    pack: { format: PACK_FORMAT, version: PACK_VERSION, entries },
    entries,
    converted,
    problems: [],
    notice,
  };
}

/** 组装一个导出包（字段顺序固定 ⇒ 跨机器可复现，W11） */
export function buildExportPack({ entries = [] } = {}) {
  const list = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    entries: list.map((e) => {
      const canon = canonicalizeEntry(e);
      const out = {};
      for (const key of ENTRY_FIELD_ORDER) out[key] = canon[key];
      return out;
    }),
  };
}

/** 导出为文本（缩进 2 空格 + 结尾换行；与 `writeUserPack` 写出的一模一样） */
export function packToText(pack) {
  return `${JSON.stringify(pack, null, 2)}\n`;
}
