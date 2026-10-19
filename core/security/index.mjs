/**
 * 安全与脱敏（M21）· 对外出口
 *
 * 只做转发，不在这一层定义任何东西（与 `core/knowledgecard/index.mjs` 同一个写法）。
 */

export {
  KEY_MASK,
  MASK,
  PROJECT_MASK,
  assertRedacted,
  collectSecrets,
  findSecrets,
  maskPaths,
  redactText,
  redactValue,
} from './redact.mjs';
