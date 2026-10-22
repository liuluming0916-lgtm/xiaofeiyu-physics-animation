/**
 * 预加载脚本（第 8 期 · M24；第 9 期增补）
 *
 * 页面所有**业务能力**都走本机 HTTP（`/api/*`），这里不暴露任何 Node 能力。
 *
 * ── 第 9 期增补：三个"打开文件"的调用 ──
 *
 * 起因（用户反馈）：导出成功界面上原来给的是一个 `http://127.0.0.1:<端口>/exports/xx.html` 链接，
 * 而那个端口**每次启动都变**、链接离开当次运行就失效；更糟的是它同源，`will-navigate` 会放行 ——
 * 主窗口可能被导航离开单页应用（看起来像"应用没了"）。
 *
 * 现在改成走壳子的 `shell.openPath`：打开的是**本地文件本身**，不依赖端口，也不会导航窗口。
 *
 * ⚠ 安全口径（这一条比功能重要）：
 *   暴露给页面的**不是** `openPath(任意路径)`，而是三个**语义固定**的调用
 *   （打开导出目录 / 打开某一份导出物 / 问导出目录在哪），
 *   而且主进程那边还会再校验一次"路径必须落在导出目录内"——两层都挡住"网页拿到文件系统把手"。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'OD_SHELL',
  Object.freeze({
    packaged: process.env.OD_BUILTIN_BUNDLE === '1',
    platform: process.platform,
    version: '1.1.17',
    /** 导出目录的绝对路径（不存在时主进程会创建） */
    exportDir: () => ipcRenderer.invoke('od:export-dir'),
    /** 打开导出目录（资源管理器） */
    openExportDir: () => ipcRenderer.invoke('od:open-export-dir'),
    /** 打开某一份导出物（只接受导出目录内的路径） */
    openExportFile: (filePath) => ipcRenderer.invoke('od:open-path', filePath),
  }),
);
