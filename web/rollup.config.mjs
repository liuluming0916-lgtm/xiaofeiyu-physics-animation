import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'

import { defineConfig } from 'rollup'
import nodeResolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import { readFileSync } from 'node:fs'

import replace from '@rollup/plugin-replace'
import postcss from 'rollup-plugin-postcss'

// ⚠ 读**根** package.json（产品版本在那儿）。./package.json 是前端子包（0.1.0），取错了会显示成 0.1.0
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/**
 * 前端打包配置（Rollup）。
 *
 * ⚠ 为什么是 Rollup 而不是 Vite —— 本沙箱的硬约束，别改回去（详见 README 第十三节）：
 *   本沙箱禁止**管道捕获子进程输出**（任何 exe 都 EPERM），而 Vite 5 有两处必须 spawn：
 *     ① 加载配置时用 esbuild 打包配置（esbuild 的 Node API 靠管道与服务进程通信）；
 *     ② Windows 上的 `optimizeSafeRealPathSync` 用 `execFile` 取真实路径。
 *   两处都会 `spawn EPERM`。已用 7 组实验确认（含 `configFile:false` 的内联配置调用、
 *   `ESBUILD_BINARY_PATH` 指向原生二进制），**Vite 在本沙箱结构性不可用**。
 *   Rollup 是纯 JS、全程进程内运行，不 spawn 任何子进程 ⇒ 可用。
 *
 * 构建分两段（"转译"与"打包"各由一件工具负责，便于排错）：
 *   ① `tsc -p tsconfig.build.json`：src/**.ts(x) → .build/**.js（JSX 已转成 JS）
 *   ② 本配置：把 .build/ 的模块打成 dist/assets/app.js，并处理 CSS
 *
 * 输出固定文件名（不带哈希）：门禁可断言产物存在，离线双击也能直接用。
 */

/**
 * 小插件：`.build/` 里解析不到的相对引用要回到 `src/` 去找。
 *
 * 两类：
 *   ① **非 JS 资源**（`./styles.css` 等）：`tsc` 只转译代码，不会复制 CSS；
 *   ② **构建期生成、但 `tsc` 不会转译的 `.js`**（第 5 期的 `knowledgecard-engine.js`
 *      —— 它是 `core/knowledgecard/engine.mjs` 的逐字节副本，故意不是 `.ts`，
 *      这样"预览器与编排跑同一份字节"才是结构性的，而不是"两份写得一样"）。
 *
 * 实现按路径段替换 `.../.build/...` → `.../src/...`，**不做字符串正则**，
 * 避免 `resolve()` 把 `/` 归一成 `\` 之后匹配不上（Windows 上必踩）。
 *
 * ⚠ ② 只在"`.build/` 里确实没有那个 `.js`"时才改道 —— 否则会把 `tsc` 真生成出来的
 *   模块偷偷换成源文件，构建结果与 `tsc` 的产物就不再是同一个东西了。
 */
function redirectAssetsToSrc() {
  const ASSET_RE = /\.(css|svg|png|jpg|jpeg|webp|gif)$/
  return {
    name: 'od-redirect-assets-to-src',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return null
      const dir = dirname(importer).split(sep)
      const idx = dir.lastIndexOf('.build')
      if (idx === -1) return null
      // ⚠ 必须用**完整相对路径**去解析（`resolve`），不能只取 `basename`：
      //   第 5 期的 `../lib/knowledgecard-engine.js` 一带上目录就解析不到了 ——
      //   而报错是 Rollup 的 "Could not resolve"，完全指不到"这里少拼了一段路径"。
      const srcDir = [...dir.slice(0, idx), 'src', ...dir.slice(idx + 1)].join(sep)
      const fromSrc = resolve(srcDir, source)
      if (!existsSync(fromSrc)) return null
      if (ASSET_RE.test(source)) return fromSrc
      if (source.endsWith('.js') && !existsSync(resolve(dirname(importer), source))) return fromSrc
      return null
    },
  }
}

/**
 * 小插件：把 `index.html` 与**空壳模板页**拷进 `dist/`。
 *
 * 为什么需要它：本配置只负责"打 JS + CSS"，而 Vite 当年会顺手处理 HTML。
 * 少了第一步，`dist/` 里就没有入口页（构建"成功"但产物打不开）——
 * 这正是 `tools/web-build.mjs` 的产物体检要拦的东西。
 *
 * 第二步（模板页）是为了让动画页的 iframe 有**可解析的落点**：
 * 宿主 iframe 装载的是空壳模板（协议 §3 的路径 B），
 * 它必须和宿主一起分发，否则 `src` 会 404、动画页永远空白。
 * 同时把源模板放到 `/template/` 下，宿主与模板不同源也仍可 postMessage（协议只关心 window 引用）。
 */
function copyStaticAssets() {
  return {
    name: 'od-copy-static-assets',
    writeBundle() {
      const cwd = process.cwd()
      const from = join(cwd, 'index.html')
      const to = join(cwd, 'dist', 'index.html')
      if (!existsSync(from)) throw new Error('web/index.html 不存在：无入口页可拷')
      copyFileSync(from, to)
      console.log('  ✓ 已拷贝入口页 → dist/index.html')

      // 模板页来自仓库的构建产物（由 `template/build-template.mjs` 生成）
      const shell = join(cwd, '..', 'template', 'build', 'animation-template.html')
      if (!existsSync(shell)) {
        throw new Error(
          `找不到空壳模板页：${shell}\n` +
            '  → 请先跑 `node template/build-template.mjs`（门禁的顺序已保证这一点）',
        )
      }
      const destDir = join(cwd, 'dist', 'template')
      mkdirSync(destDir, { recursive: true })
      copyFileSync(shell, join(destDir, 'animation-template.html'))
      console.log('  ✓ 已拷贝空壳模板 → dist/template/animation-template.html')
    },
  }
}

export default defineConfig({
  input: '.build/main.js',
  output: {
    file: 'dist/assets/app.js',
    format: 'iife', // 单文件、无模块加载器依赖，双击即可离线打开
    sourcemap: false,
  },
  plugins: [
    redirectAssetsToSrc(),
    copyStaticAssets(),
    /**
     * ★★ 必须有：把 `process.env.NODE_ENV` 换成 `"production"`。
     *
     * React / scheduler / zustand 的**开发构建**里到处是 `if (process.env.NODE_ENV !== "production")`。
     * 浏览器里**没有 `process` 这个全局** ⇒ 顶层求值就抛 `ReferenceError`
     * ⇒ **整个 bundle 一行都不执行 ⇒ 页面一片空白**。
     *
     * 这个坑真实发生过：第 3 期第 9 步交付时页面就是白屏，根因就是缺这一步
     * （详见 README 13.11）。它同时还有两个副作用，都是好事：
     *   · 顺带把 React 的开发期告警与大量死代码摇掉，产物从约 1.4 MB 降到约 200 KB；
     *   · `process.env.NODE_ENV` 被替换后，"产物里不得出现裸 `process`"才成为**可机检的判据**
     *     （已加进 `tools/web-build.mjs` 的产物体检）。
     */
    replace({
      preventAssignment: true,
      values: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        /**
         * ── 第 8 期：**发布构建开关**（`__OD_RELEASE__`）──
         *
         * `OD_RELEASE=1` 时构建 ⇒ 这个常量被替换成 `true`，
         * `App.tsx` 里 `if (!__OD_RELEASE__)` 那一段就成了**死代码**，
         * Rollup 会把「设置」「规则」两页的**组件与 import 一起摇掉** ——
         * 于是发布产物里**根本没有这两页**（不是隐藏、不是禁用）。
         *
         * 为什么用编译期常量而不是运行时开关：
         *   运行时开关只能"藏起来"，F12 一改 DOM 就回来了；
         *   编译期常量让**代码本身不存在**，这才是"发布版没有这两个页面"。
         *
         * 默认（不设 `OD_RELEASE`）= 开发构建 ⇒ 两页都在，方便我们调。
         */
        /**
         * ── 第 9 期：**产品版本号也从 package.json 注入**（`__OD_APP_VERSION__`）──
         *
         * 起因：界面左上角原来把 `v1.0.0` **写死**在 `App.tsx` 里 —— 发版时改了 package.json、
         * 关于框、preload 与页面标题，**唯独导航栏那一行没改**，装出来的软件还自称 v1.0.0。
         * 写死的版本号一定会漂；现在只有 `package.json` 一处是真源。
         */
        __OD_APP_VERSION__: JSON.stringify(pkg.version),
        __OD_RELEASE__: JSON.stringify(process.env.OD_RELEASE === '1'),
      },
    }),
    nodeResolve({ browser: true, extensions: ['.js', '.mjs', '.json'] }),
    // React 18 的主入口是 CommonJS，而 zustand 按 ESM 消费它（`import ReactExports from 'react'`）。
    // 没有这一步 Rollup 会报 `"default" is not exported by react/index.js`。
    commonjs({ include: /node_modules/ }),
    postcss({
      // Tailwind 仍按方案 §2.2 使用：postcss.config.js 里挂了 tailwindcss + autoprefixer，
      // 全程在进程内跑（不 spawn）。
      extract: 'app.css',
      minimize: false,
      config: { path: './postcss.config.js' },
    }),
  ],
  onwarn(warning, warn) {
    // `"use client"` 之类的无害提示不刷屏；真正的警告照常抛出
    if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
    warn(warning)
  },
})
