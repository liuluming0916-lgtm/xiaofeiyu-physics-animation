/**
 * 全仓统一的路径基准。避免每个脚本各自用 `import.meta.url` 反推目录。
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const paths = {
  root: PROJECT_ROOT,
  contracts: join(PROJECT_ROOT, 'contracts'),
  contractsSpec: join(PROJECT_ROOT, 'contracts', 'spec'),
  sdk: join(PROJECT_ROOT, 'sdk'),
  sdkRuntime: join(PROJECT_ROOT, 'sdk', 'runtime'),
  template: join(PROJECT_ROOT, 'template'),
  templateBuild: join(PROJECT_ROOT, 'template', 'build'),
  templateVendor: join(PROJECT_ROOT, 'template', 'vendor'),
  core: join(PROJECT_ROOT, 'core'),
  questions: join(PROJECT_ROOT, 'tests', 'regression-15'),
  reports: join(PROJECT_ROOT, 'tests', 'reports'),
  nodeModules: join(PROJECT_ROOT, 'node_modules'),
};

/** 「直接执行」判定：被 import 时不触发 CLI 主流程 */
export function isCliEntry(importMetaUrl) {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return importMetaUrl === new URL(`file://${argv1.replace(/\\/g, '/')}`).href;
}
