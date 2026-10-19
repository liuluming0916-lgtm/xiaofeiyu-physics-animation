/**
 * 观测与运维（M22）· 对外出口
 */

export {
  OBS_DIRNAME,
  REPRO_DIRNAME,
  RUNS_INDEX,
  commitRun,
  estimateTokens,
  listRunDirs,
  makeRunId,
  readRun,
  readRuns,
  resolveObsDir,
  runDirOf,
  sha256,
  shortDir,
  stableJson,
  summarize,
  trimEvent,
  watchRun,
} from './journal.mjs';

export { REPRO_FORMAT, REPRO_VERSION, auditReproPack, buildReproPack, listReproPacks } from './repro.mjs';

/**
 * v1.1.7「开源日志」：公测版每次跑题都自动导出的那份"病历"（HTML + JSON）。
 * 与 `journal.mjs` 的运维观测**用途不同**（那份是给自己看的，那份的 `stage_delta` 不留正文）。
 */
export {
  CHECK_NAMES,
  OPEN_LOG_DIRNAME,
  OPEN_LOG_FORMAT,
  OPEN_LOG_VERSION,
  appVersion,
  createRunLog,
  fingerprint,
  listOpenLogs,
  renderHtml,
  resolveOpenLogDir,
  writeOpenLog,
} from './open-log.mjs';
