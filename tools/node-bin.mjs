/**
 * 运行时可执行文件定位。
 *
 * 背景（历史，2026-10 更正过归因）：第 1 期在 Open Design 里工作时，
 * 会话环境会注入 `OD_NODE_BIN`，其值可能是 `E:\Work\Open Design\Open Design.exe`
 * ——那是 **Electron 壳**，不是 Node 运行时。用它跑脚本会出现：
 *   · `fetch` 拿不到网络（因为那个 exe 根本没在执行 Node 代码）；
 *   · `spawnSync` 一律 EPERM（真因是**宿主沙箱禁止管道捕获子进程输出**，真 Node 下同样如此）。
 *
 * ⚠ 2026-10 迁移到 DeepSeek Harness 后：`OD_NODE_BIN` **不再被设置**（进程级与注册表级实测皆无），
 * 通常直接解析到宿主 toolchain 的 `node.exe`，**无需手动设任何环境变量**。
 * 本模块保留全部兜底逻辑，以便旧环境与新环境都能跑通。
 *
 * 解析优先级：
 *   ① 显式覆盖 `OD_REAL_NODE`
 *   ② `process.execPath`（**排除 Electron**：它同样带 `process.versions.node`）
 *   ③ `OD_NODE_BIN`（仅当它真的是 Node 可执行文件）
 *   ④ 宿主 toolchain 下的 `node.exe`（从已知安装位置探测）
 *   ⑤ PATH 上的 `node`
 * 解析结果会缓存；`isRealNode()` 负责把 Electron 壳挡在外面。
 */

import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached = null;

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');

/**
 * 判断一个可执行文件是不是真 Node。
 *
 * ⚠ 本沙箱**禁止管道捕获子进程输出**（任何 exe 都会 EPERM，`stdio:'inherit'` 才放行），
 * 所以这里**不能**用 `spawnSync(..., {encoding:'utf8'})` 去读版本号。
 * 改用两条不依赖管道的判据：
 *   ① 文件是否存在；
 *   ② 路径形态：文件名以 `node` 开头、且不是 Electron 壳（`Open Design.exe` / `electron.exe`）。
 * 另外：`process.execPath` 在被信任的候选之列——能跑起这段代码，说明它本身就是 Node。
 */
export function isRealNode(exe) {
  if (!exe || !existsSync(exe)) return false;
  const base = exe.replace(/\\/g, '/').split('/').pop().toLowerCase();
  if (!base.startsWith('node')) return false;
  if (/open design|electron|open-design/.test(exe.toLowerCase())) return false;
  return true;
}

/**
 * 当前进程自身就是在 Node 里跑的，所以 execPath 可信。
 *
 * ⚠ **但 Electron 不是这种情况**（2026-10 修正）：
 * Electron 主进程同样带 `process.versions.node`（它内嵌 Node 运行时），
 * 只凭这一点会把 `Open Design.exe` 这类壳当成真 Node 放行——而 `isRealNode()` 那道
 * 可靠的过滤排在它**后面**，根本没机会执行。
 * 于是 `resolveNodeBin()` 会返回壳，脚本随即出现"fetch 拿不到网络 / spawnSync 一律 EPERM"
 * 这两个症状（真因是那个 exe 不是 Node 运行时，而沙箱又禁止管道捕获子进程输出）。
 * 判据：`process.versions.electron` 存在 ⇒ 我们正跑在 Electron 里 ⇒ execPath 不可信。
 */
function isSelfNode(exe) {
  if (process.versions?.electron) return false;
  return Boolean(exe) && exe === process.execPath && Boolean(process.versions?.node);
}

function dshRoots() {
  const roots = [];
  const bases = [process.env.LOCALAPPDATA, process.env.APPDATA, process.env.USERPROFILE, 'C:\\Users'].filter(Boolean);
  for (const base of bases) {
    roots.push(join(base, 'OpenDesign', 'toolchains', 'dsh'));
    roots.push(join(base, 'Open Design', 'toolchains', 'dsh'));
  }
  // 从 `OD_NODE_BIN`（可能是 <某盘>:\Work\Open Design\Open Design.exe）反推
  const odNode = process.env.OD_NODE_BIN;
  if (odNode) {
    const exeDir = dirname(odNode);
    roots.push(join(exeDir, 'toolchains', 'dsh'));
    roots.push(join(exeDir, '..', 'toolchains', 'dsh'));
  }
  // 从项目目录向上找（data\projects\<id> → namespaces\<ns> → data → <OpenDesignData>）
  let cursor = PROJECT_ROOT;
  for (let i = 0; i < 6; i += 1) {
    cursor = resolve(cursor, '..');
    roots.push(join(cursor, 'OpenDesign', 'toolchains', 'dsh'));
    roots.push(join(cursor, 'Open Design', 'toolchains', 'dsh'));
  }
  return [...new Set(roots)];
}

function toolchainCandidates() {
  const out = [];
  for (const root of dshRoots()) {
    if (!existsSync(root)) continue;
    let entries = [];
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      out.push(join(root, entry.name, 'node.exe'));
      out.push(join(root, entry.name, 'bin', 'node'));
    }
  }
  return out;
}

export function resolveNodeBin() {
  if (cached) return cached;

  const candidates = [
    ['OD_REAL_NODE', process.env.OD_REAL_NODE],
    ['process.execPath', process.execPath],
    ['OD_NODE_BIN', process.env.OD_NODE_BIN],
    ...toolchainCandidates().map((p) => ['toolchain', p]),
    ['PATH', 'node'],
  ].filter(([, exe]) => Boolean(exe));

  for (const [source, exe] of candidates) {
    if (isSelfNode(exe) || isRealNode(exe)) {
      cached = { bin: exe, source };
      return cached;
    }
  }
  throw new Error(
    '找不到真正的 Node 运行时。请设置 OD_REAL_NODE 指向 node.exe。' +
      `（OD_NODE_BIN=${process.env.OD_NODE_BIN ?? '(未设置)'} 是 Electron 壳，不能直接用于脚本）`,
  );
}

/** npm CLI 入口（不依赖 npm 是否在 PATH 上） */
export function resolveNpmCli() {
  const { bin } = resolveNodeBin();
  const npmCli = join(bin, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return existsSync(npmCli) ? npmCli : null;
}

/** 生成子进程环境：把 OD_NODE_BIN 也指向真 Node，子脚本递归解析时不会走错 */
export function nodeEnv(extra = {}) {
  const { bin } = resolveNodeBin();
  return { ...process.env, OD_NODE_BIN: bin, OD_REAL_NODE: bin, ...extra };
}
