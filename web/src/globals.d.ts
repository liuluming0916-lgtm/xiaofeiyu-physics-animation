/**
 * 构建期注入的全局常量（由 `web/rollup.config.mjs` 的 `replace` 插件替换）。
 *
 * `OD_RELEASE=1` 构建时 → `true`：**「设置」「规则」两页在产物里根本不存在**
 * （不是隐藏、不是禁用；Rollup 会把这两个页面组件与 import 一起摇掉）。
 * 不设 → `false`：本地开发构建，两页都在，方便调试。
 *
 * ⚠ 这是**编译期**常量，所以只能用在"决定要不要打进产物"的地方；
 *   不要拿它做运行期逻辑分支（那样 Rollup 摇不掉，等于白写）。
 */
declare const __OD_RELEASE__: boolean

/**
 * 产品版本号（第 9 期）：**构建期从 package.json 注入**，界面只读这一个来源。
 * 原来 App.tsx 把 1.0.0 写死了 —— 发版时它一定漂，装出来的软件会自称旧版本。
 */
declare const __OD_APP_VERSION__: string

/**
 * 第 9 期：壳子暴露给页面的三个调用（`electron/preload.cjs`）。
 *
 * ⚠ 只有**语义固定**的三个，不是通用的 `openPath(任意路径)`：
 *   主进程还会再校验一次"路径必须落在导出目录内"。
 *   浏览器里（开发/演示源）没有 `window.OD_SHELL`，所以调用点都要先判空。
 */
interface ODShellBridge {
  packaged?: boolean
  platform?: string
  version?: string
  exportDir?: () => Promise<string>
  openExportDir?: () => Promise<{ ok: boolean; dir?: string; reason?: string | null }>
  openExportFile?: (filePath: string) => Promise<{ ok: boolean; reason?: string | null }>
}

interface Window {
  OD_SHELL?: ODShellBridge
}