/**
 * 规则工作区里**每个文件是什么、内容合不合法**（§16 / §10.3 / §12）。
 *
 * 第 6 期第 1 项只做"文件层"：把 `ai-rules/` 当**数据**读写，判据分两层——
 *   · 本文件：**类型 + 内容**层面的校验（这个文件是什么？内容是不是该类型该有的样子？）
 *   · `workspace.mjs`：**工作区**层面的校验（哈希、体积、未登记、冲突、整批失败）
 *
 * ── 第 1 项管理的两类文件（用户裁决，2026-10）
 *
 *   `ai-rules/prompts/<id>.md`   —— §10.1 的 Prompt 正文（纯文本，**只读数据、永不执行**）
 *   `ai-rules/cleaning.json`     —— §12 的**用户附加**正则规则表
 *
 * 词条（`ai-rules/worldbook/`）与端点（`ai-rules/endpoints.json`）**不在这里判业务规则**：
 * 它们各自已经有权威判据（`core/worldbook/store.mjs` 的整批失败、`contracts/validate.mjs` 的 §11.2 九条）。
 * 同一个东西被两套判据各判一次，一旦两边口径有出入，就会出现"一边说合法、一边说非法"的死结。
 *
 * ── 为什么"缺文件 = 用内置"，而不是"初始化时把内置文本抄一份"
 *
 * 抄一份等于**冻结**：以后内置 Prompt 修好了、词表注入规则变了，用户目录里那份旧文本会一直覆盖它，
 * 而用户根本不知道自己在用一份过期的默稿。缺文件 = 走内置，只有用户真的动手改过某一条时，
 * 那一条才变成覆盖副本 —— 这与世界书的"覆盖副本"治理（§9.3）是同一个套路，用户已经在用。
 *
 * ── 关于"未知 Prompt id"这条检查为什么**不在**这里
 *
 * 合法 id 的**单源真相**是 `core/prompts/templates.mjs` 的 `PROMPTS` / `EXTENSION_PROMPTS`。
 * 如果本文件 import 它，等第 2 项让 templates 反过来用本模块做覆盖层时就成了循环依赖。
 * 因此"id 对不对"归 Prompt 层（第 2 项）判；底座只认**路径形状**（`prompts/<小写 id>.md`），
 * 挡住 `prompts/solve.MD`、`prompts/a/b.md`、`prompts/solve.md.bak` 这类会让覆盖层静默失效的名字。
 */

import { validateCleaningRuleSet } from '../../contracts/validate.mjs';
import { BUILTIN_RULES } from '../cleaner/regex-rules.mjs';
import { validateUserCleaningRules } from '../cleaner/policy.mjs';
import { describeJsonError } from '../json-error.mjs';

/**
 * 第 6 期第 4 项：`describeJsonError` 搬到 `core/json-error.mjs` 了（端点配置也要用）。
 * 这里**继续转出**，老的 import 路径不断。
 */
export { describeJsonError };

/** 清洗规则表的文件名（§16：`ai-rules/cleaning.json`） */
export const CLEANING_FILE = 'cleaning.json';
/** Prompt 正文的目录名（§16：`ai-rules/prompts/`） */
export const PROMPTS_DIR = 'prompts';

export const KIND_PROMPT = 'prompt';
export const KIND_CLEANING = 'cleaning';

/**
 * 能被工作区管理的相对路径（POSIX 分隔符）。
 *
 * 认这两种，其余一律**不认**（`classifyRelPath` 返回 null ⇒ 工作区会把它报成"未登记"并拒绝载入，
 * 这是用户选的口径：宁可红，也不要"界面显示旧的、实际跑新的"）。
 *
 * @param {string} rel
 * @returns {{ kind: string, id?: string } | null}
 */
export function classifyRelPath(rel) {
  if (typeof rel !== 'string' || rel.length === 0) return null;

  if (rel === CLEANING_FILE) return { kind: KIND_CLEANING };

  const m = new RegExp(`^${PROMPTS_DIR}/([a-z][a-z0-9_-]*)\\.md$`).exec(rel);
  if (m) return { kind: KIND_PROMPT, id: m[1] };

  return null;
}

const err = (code, path, message, hint) => ({ code, path, message, ...(hint ? { hint } : {}) });

/** §16 / §21.2：Key 绝不能进规则目录。这里做字面量扫描，只认最典型的形态，宁可少报也不误报。 */
const SECRET_PATTERN = /\bsk-[A-Za-z0-9_-]{8,}/;

/**
 * 校验一个规则文件的**内容**（不看哈希、不看体积 —— 那两件在 `workspace.mjs`）。
 *
 * @param {string} rel   POSIX 相对路径
 * @param {string} text  文件全文（已按 UTF-8 解码）
 * @returns {Array<{code: string, path: string, message: string, hint?: string}>}
 */
export function validateRuleFileContent(rel, text) {
  const issues = [];
  const kind = classifyRelPath(rel);

  if (!kind) {
    issues.push(
      err(
        'rules.unmanaged-path',
        rel,
        '这个路径不属于规则工作区管理的两类文件（prompts/<id>.md 或 cleaning.json）',
        '要么改个名字，要么删掉它；工作区不会替你猜它是什么',
      ),
    );
    return issues;
  }

  if (typeof text !== 'string') {
    issues.push(err('rules.content.not-string', rel, '文件内容必须是文本'));
    return issues;
  }

  // 二进制混入：NUL 字节。JSON.parse 对它会报"意外字符"，但 Prompt 是纯文本，没有这一道就会静默带进模型
  if (text.includes('\u0000')) {
    issues.push(err('rules.content.binary', rel, '文件里出现了 NUL 字节，这不是文本文件', '请用纯文本编辑器另存为 UTF-8'));
  }

  const secret = SECRET_PATTERN.exec(text);
  if (secret) {
    issues.push(
      err(
        'rules.secret-in-rules',
        rel,
        `文件里出现了一个像 API Key 的字符串（${secret[0].slice(0, 4)}…）`,
        '§16：Key 明文只存本机配置，**绝不写进规则目录**。请删掉它',
      ),
    );
  }

  if (kind.kind === KIND_PROMPT) {
    if (text.trim().length === 0) {
      issues.push(
        err('rules.prompt.empty', rel, 'Prompt 正文是空的', '空 Prompt 会让该阶段丢失全部指令；想恢复默认请删掉这个文件'),
      );
    }
    return issues;
  }

  // ── cleaning.json ──
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const d = describeJsonError(text, e);
    issues.push(err('rules.cleaning.bad-json', rel, d.message, `${d.hint ?? ''}这一份不会被保存，磁盘上的旧版本保持不变。`.trim()));
    return issues;
  }

  const { ok, issues: ruleIssues } = validateCleaningRuleSet(parsed);
  if (!ok) {
    // 把契约层给的路径前缀上文件名：契约层只知道 `rules[3].pattern`，
    // 而用户需要知道的是"哪个文件里的第 4 条规则的第 pattern 字段"。
    for (const it of ruleIssues) issues.push({ ...it, path: `${rel}:${it.path}` });
  }

  /**
   * 第 6 期第 3 项：**策略层**判据（用户绕不过去的地方）。
   *
   * 契约层（上面）判的是"这个字段合不合法"；这里判的是"这条规则**允不允许存在**"：
   *   · 撞上锁定内置规则的 id（想用同名规则顶掉它）；
   *   · 试图改动 `@slot` / `@end` 标记（§3.5 零猜测）；
   *   · 灾难性回溯形态（存得进、跑题才炸的那种）。
   * 三道都放在**写盘之前**，因此无论从哪条路径写 `cleaning.json`（保存/登记/初始化）都拦得住。
   */
  const policyIssues = validateUserCleaningRules(parsed.rules, { builtinRules: BUILTIN_RULES });
  for (const it of policyIssues) issues.push({ ...it, path: `${rel}:${it.path}` });

  return issues;
}
