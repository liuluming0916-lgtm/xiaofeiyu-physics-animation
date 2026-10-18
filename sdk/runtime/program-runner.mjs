/**
 * 程序执行器 —— **转发薄壳**（Dry-Run 的导入路径保持不变）。
 *
 * 实现已经**搬进** `animation-runtime.mjs`：运行时会被 `template/build-template.mjs`
 * 转成**经典脚本**直接内联进单文件 HTML，而经典脚本里不允许出现 `import`。
 * 之前这里是反向被 `animation-runtime.mjs` import 回来的，于是 16 个成品页在浏览器里
 * 直接语法报错（"Cannot use import statement outside a module"）⇒ `RT` 未定义
 * ⇒ 页面白屏 + 只有一句"运行时未注入"。
 *
 * 所以"共用同一份采样实现"这件事没变（代码还在同一处），只是把它安家在运行时文件里，
 * 依赖方向变成单向：`program-runner → animation-runtime`。
 */

export {
  runnerBundle,
  instantiate,
  sampleFrame,
  fullEnvelope,
  computeFullEnvelope,
  scanAll,
} from './animation-runtime.mjs';
