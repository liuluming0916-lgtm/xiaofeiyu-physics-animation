/**
 * 规则工作区（§16）的对外出口。
 *
 * 第 6 期第 1 项只到"文件层"：读写、哈希、整批失败、热重载。
 * Prompt 编辑器 / 清洗规则编辑器 / 端点校验是第 2–4 项，它们**只通过这里**碰磁盘，
 * 这样"什么算合法的工作区"只有一处实现。
 */

export {
  RULES_ROOT,
  WORKSPACE_FILE,
  WORKSPACE_FORMAT,
  WORKSPACE_VERSION,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  MAX_BASED_ON_TEXT,
  DEFAULT_LIMITS,
  toPosixRel,
  sha256Hex,
  writeFileAtomic,
  readRulesIndex,
  listDiskFiles,
  loadRulesWorkspace,
  commitRulesChange,
  initRulesWorkspace,
  adoptRulesFiles,
  setRulesFileMetadata,
  createRulesRuntime,
} from './workspace.mjs';

export {
  CLEANING_FILE,
  PROMPTS_DIR,
  KIND_PROMPT,
  KIND_CLEANING,
  classifyRelPath,
  describeJsonError,
  validateRuleFileContent,
} from './kinds.mjs';

/**
 * 第 6 期第 3 件：保存前的自动备份与恢复（滚动 5 份，用户裁决）。
 * `backup.mjs` **不 import** `workspace.mjs`（那边反过来要用它），所以这里单独转出。
 */
export {
  BACKUP_DIR_NAME,
  BACKUP_KEEP,
  NEVER_BACKUP,
  safeRelPath,
  backupFile,
  listBackups,
  listAllBackups,
  restoreBackup,
  backupSummary,
  backupDirOf,
} from './backup.mjs';