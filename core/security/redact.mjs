/**
 * 安全与脱敏（M21 · 方案 §16「安全」/ §19.4 / §21.2 第 6 条）
 *
 * 一句话：**凡是会离开内存的东西**（日志、运行记录、失败复现包、导出包、诊断文本）
 * 都先过这里，Key 与绝对路径一律抹掉。
 *
 * 三条设计口径（都是被第 6 期验收逼出来的）：
 *
 *   ① **结构性脱敏 > 记得删**。字段名叫 `apiKey` / `token` / `authorization` 的，
 *      不管内容长什么样，一律替换成掩码；`keys` 这个**对象**直接清空。
 *      ——与第 6 期 `endpoints.json` 恒为 `keys: {}` 是同一个思路：
 *      "凭记忆去删"迟早漏一次，而漏一次就等于没有。
 *
 *   ② **两层形态兜底**。除了已知 Key 的原值，还要拦"看起来像 Key 的东西"
 *      （`sk-…`、`Bearer …`、URL 里 `?key=…`）。因为
 *      Key 可能以我们没见过的方式出现：模型回复里、报错堆栈里、用户贴的题面里。
 *
 *   ③ **判据独立于被检验的对象**。`assertRedacted()` 只负责"查"，
 *      不参与"抹"；`findSecrets()` 可以被测试单独拿去当负对照
 *      （先证明它**确实能搜到**未脱敏的样本，再证明脱敏后的搜不到）。
 *      ——与清理台账里那条"核对不能和操作共用同一套判断"同源。
 *
 * ⚠ 本模块**从不回显**任何 Key：错误里只出现"前 4 位…"或干脆只有位置。
 */

import { loadKeys } from '../gateway/endpoint-store.mjs';
import { PROJECT_ROOT } from '../../tools/paths.mjs';

/** Key 的替换标记（不含原值的任何片段） */
export const KEY_MASK = '«key»';
/** 通用掩码 */
export const MASK = '«已脱敏»';
/** 工程根目录的替换标记 */
export const PROJECT_MASK = '<project>';

/**
 * 字段名命中这些 ⇒ 无论内容是什么都按密钥处理。
 *
 * 注意只匹配**完整字段名**（`^…$`），否则 `keys: [...]`（世界书触发词）
 * 会被误伤——那是要保留的业务数据，不是密钥。
 */
const SECRET_FIELD = /^(?:key|api[-_]?key|token|access[-_]?token|refresh[-_]?token|secret|client[-_]?secret|password|passwd|authorization|cookie)$/i;

/** 典型 Key 形态 */
const KEY_SHAPE = /\bsk-[A-Za-z0-9_-]{8,}/g;
const AUTH_HEADER = /\b(Bearer|Basic)\s+[A-Za-z0-9._\-+/=]{8,}/gi;
const URL_SECRET = /([?&](?:key|api[-_]?key|token|access[-_]?token|secret)=)([^&#\s"']+)/gi;

/** Windows 绝对路径（含盘符） */
const WIN_PATH = /\b[A-Za-z]:[\\/](?:[^\s"'<>|:*?]+[\\/])*[^\s"'<>|:*?\\/]*/g;
/** 常见 POSIX 绝对路径（只认这些前缀，避免把 URL 路径当成本地路径） */
const POSIX_PATH = /(?<![\w.<>/])\/(?:home|Users|tmp|var|private|opt|root|mnt)(?:\/[^\s"'<>|:,]+)+/g;

/**
 * 收集"已知密钥"清单，供精确匹配用。
 *
 * 只收长度 ≥ 8 的：太短的值（例如 `test`）做全量替换会把正常正文打成筛子，
 * 而且会造成"脱敏器把自己搞坏了"这种没人查得出来的故障。
 *
 * @param {{ dir?: string, extra?: string[] }} [opts] `dir` = `ai-rules/` 目录（含 keys.json）
 * @returns {string[]} 密钥**原值**（函数内部用完即弃，不写任何日志）
 */
export function collectSecrets({ dir, extra = [] } = {}) {
  const set = new Set();
  for (const v of extra) {
    if (typeof v === 'string' && v.length >= 8) set.add(v);
  }
  try {
    const loaded = loadKeys(dir ? { dir } : {});
    for (const v of Object.values(loaded?.keys ?? {})) {
      if (typeof v === 'string' && v.length >= 8) set.add(v);
    }
  } catch {
    /* 读不到 Key 文件不是错误：形态规则（sk- / Bearer / URL）仍然生效。
       但如果这里抛错就整个日志链路挂掉，代价远大于收益。 */
  }
  return [...set];
}

/**
 * 把文本里的绝对路径换成可读但无信息量的形式。
 *
 * 规则：工程根目录 ⇒ `<project>`（后续路径保留，便于自己排查）；
 * 其外的绝对路径 ⇒ `<abs>/文件名`（**只留末段**，中间目录全部丢弃）。
 *
 * @param {string} text
 * @param {{ projectRoot?: string }} [opts]
 * @returns {string}
 */
export function maskPaths(text, { projectRoot = PROJECT_ROOT } = {}) {
  let s = String(text ?? '');

  if (projectRoot) {
    // 两种分隔符都要replace，否则同一台机器上 / 与 \ 混用时只盖住一半
    for (const root of [projectRoot, projectRoot.replace(/\\/g, '/')]) {
      if (root) s = s.split(root).join(PROJECT_MASK);
    }
  }

  s = s.replace(WIN_PATH, (m) => {
    const base = m.split(/[\\/]/).filter(Boolean).pop() ?? '';
    return base ? `<abs>/${base}` : '<abs>';
  });

  s = s.replace(POSIX_PATH, (m) => {
    const base = m.split('/').filter(Boolean).pop() ?? '';
    return base ? `<abs>/${base}` : '<abs>';
  });

  return s;
}

/**
 * 脱敏一段文本。
 *
 * 顺序有讲究：**长的原值先替换**。否则已知密钥 `sk-abcdefgh12345678` 会先被
 * 形态规则 `sk-…` 吃掉前半段，剩下 `12345678` 反而留在正文里。
 *
 * @param {string} text
 * @param {{ secrets?: string[], projectRoot?: string }} [opts]
 * @returns {string}
 */
export function redactText(text, { secrets = [], projectRoot = PROJECT_ROOT } = {}) {
  let s = typeof text === 'string' ? text : text == null ? '' : String(text);

  // ① 已知原值（长 → 短）
  for (const k of [...secrets].sort((a, b) => b.length - a.length)) {
    if (typeof k === 'string' && k.length >= 8) s = s.split(k).join(KEY_MASK);
  }

  // ② 形态兜底
  s = s.replace(KEY_SHAPE, `sk-${KEY_MASK}`);
  s = s.replace(AUTH_HEADER, (_m, scheme) => `${scheme} ${KEY_MASK}`);
  s = s.replace(URL_SECRET, (_m, prefix) => `${prefix}${KEY_MASK}`);

  // ③ 路径
  return maskPaths(s, { projectRoot });
}

/**
 * 深拷贝 + 递归脱敏（对象 / 数组 / 字符串 / 标量）。
 *
 * @param {*} value
 * @param {{ secrets?: string[], projectRoot?: string }} [opts]
 * @returns {*}
 */
export function redactValue(value, opts = {}) {
  if (typeof value === 'string') return redactText(value, opts);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, opts));

  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // 结构性规则：`keys` 是**对象**时一律清空（端点 Key 表的形状）；
      // 是**数组**时保留（世界书词条 `keys: ["传送带"]` 是触发词，属于业务数据）。
      if (k === 'keys' && v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = {};
        continue;
      }
      if (SECRET_FIELD.test(k)) {
        out[k] = v == null ? v : MASK;
        continue;
      }
      out[k] = redactValue(v, opts);
    }
    return out;
  }

  return value;
}

/**
 * 查残留（**只查不改**，可以单独当负对照用）。
 *
 * @param {string} text
 * @param {{ secrets?: string[] }} [opts]
 * @returns {{ kind: 'exact'|'shape', sample: string }[]}
 */
export function findSecrets(text, { secrets = [] } = {}) {
  const body = String(text ?? '');
  const hits = [];

  for (const k of secrets) {
    if (typeof k === 'string' && k.length >= 8 && body.includes(k)) {
      hits.push({ kind: 'exact', sample: `${k.slice(0, 4)}…(${k.length} 字符)` });
    }
  }

  const shape = /\bsk-[A-Za-z0-9_-]{8,}/.exec(body);
  if (shape) hits.push({ kind: 'shape', sample: `${shape[0].slice(0, 3)}…` });

  return hits;
}

/**
 * 断言"这段文本里没有任何密钥"。脱敏链路自己的最后一道闸。
 *
 * @param {string} text
 * @param {{ secrets?: string[], where?: string }} [opts]
 * @returns {true}
 * @throws {Error} `security.leak`
 */
export function assertRedacted(text, { secrets = [], where = '' } = {}) {
  const hits = findSecrets(text, { secrets });
  if (!hits.length) return true;

  const e = new Error(
    `${where ? `${where}：` : ''}发现未脱敏的密钥（${hits.map((h) => `${h.kind} ${h.sample}`).join(' / ')}）——这是不能发生的`,
  );
  e.code = 'security.leak';
  e.hits = hits;
  throw e;
}
