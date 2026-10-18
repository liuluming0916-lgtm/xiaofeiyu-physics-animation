/**
 * GIF 导出（第 7 期 M17）
 *
 * 定案（§14）：默认 **25 fps / 960×540**，时长跟随 `duration`；帧率/尺寸可调。
 * 编码用 `gifenc`（用户 2026-10-17 批准引入；纯 JS、无原生模块、无 CDN）。
 *
 * 为什么这一层单独成文件（`.mjs` 而不是 `.ts`）：
 *   门禁 ㉛ 要在 **Node 里**验证"帧数 = round(duration×fps)（±1）、帧间隔 = 1/fps"，
 *   而 Node 不能直接跑 TypeScript。把它写成纯 ESM，浏览器（rollup）与 node 共用同一份实现 ——
 *   否则又会变成"测试跑一套、线上跑另一套"。
 *
 * ⚠ GIF 的帧间隔只精确到 **1/100 秒**，所以只有 fps ∈ {100, 50, 25, 20, 10…} 能整除。
 *   默认 25 fps ⇒ 40 ms ⇒ 正好 4 cs，不会累积误差。取别的帧率时会有 ≤1cs 的量化误差，
 *   这是格式限制，不是实现问题。
 */

/* ⚠ `gifenc` 是个"三副面孔"的包：main/browser 指向 CJS，module 指向 ESM。
     于是同一个 `import` 在两种环境下拿到的东西**不一样**：
       · Node 走 CJS ⇒ 具名导入直接报 "Named export 'GIFEncoder' not found"；
       · rollup 走 ESM（或经 commonjs 插件转过的 CJS）⇒ 有时没有 default，有时有。
     写死其中一种形态必然在另一边崩（用户第一次点"导出 GIF"报的就是
     "GIFEncoder is not a function"）。所以这里用**命名空间 + 两路兜底**，
     两条路都能拿到同一组函数，拿不到就抛一条能看懂的错。 */
import * as gifencNs from 'gifenc'

function pickFromGifenc(name) {
  const viaDefault = gifencNs && gifencNs.default ? gifencNs.default[name] : undefined
  const viaNamed = gifencNs ? gifencNs[name] : undefined
  const fn = typeof viaNamed === 'function' ? viaNamed : viaDefault
  return typeof fn === 'function' ? fn : null
}

const GIFEncoder = pickFromGifenc('GIFEncoder')
const quantize = pickFromGifenc('quantize')
const applyPalette = pickFromGifenc('applyPalette')

if (!GIFEncoder || !quantize || !applyPalette) {
  throw new Error('gifenc 装载失败：拿不到 GIFEncoder/quantize/applyPalette（CJS/ESM 互操作问题）')
}

export const DEFAULT_GIF_FPS = 25
export const DEFAULT_GIF_WIDTH = 960
export const DEFAULT_GIF_HEIGHT = 540

/** 允许的帧率（与 §13.3 的倍速档位同源，避免出现 0.7× 这种怪值） */
export const GIF_FPS_CHOICES = [10, 12.5, 20, 25, 50]

/**
 * 逐帧时刻：`t_i = i / fps`，`i = 0 … round(duration×fps)`。
 *
 * ⚠ 末帧**必须是 t = duration**：验收要求"首末帧与 t=0 / t=duration 的画面一致"。
 *   若只取到 `(n-1)/fps`，末帧会差一格（= duration − 1/fps），比对的就不是结尾。
 *   所以这里返回 n+1 个时刻，最后一个被 clamp 到 duration。
 */
export function frameTimes(durationSec, fps = DEFAULT_GIF_FPS) {
  const dur = Number(durationSec)
  if (!(dur > 0) || !(fps > 0)) return []
  const n = Math.round(dur * fps)
  const out = []
  for (let i = 0; i <= n; i += 1) out.push(Math.min(dur, i / fps))
  return out
}

/** 帧数（含末帧）—— 门禁按它断言 */
export function gifFrameCount(durationSec, fps = DEFAULT_GIF_FPS) {
  return frameTimes(durationSec, fps).length
}

/**
 * 编码一组 RGBA 帧。
 * @param {Array<Uint8ClampedArray|Uint8Array>} frames 每帧 width×height×4
 * @param {{ width: number, height: number, fps?: number }} opts
 * @returns {Uint8Array} GIF89a 字节
 */
export function encodeGif(frames, opts = {}) {
  const width = Number(opts.width) || DEFAULT_GIF_WIDTH
  const height = Number(opts.height) || DEFAULT_GIF_HEIGHT
  const fps = Number(opts.fps) || DEFAULT_GIF_FPS
  if (!Array.isArray(frames) || frames.length === 0) throw new Error('encodeGif：没有帧');

  const expect = width * height * 4
  for (let i = 0; i < frames.length; i += 1) {
    if (!frames[i] || frames[i].length !== expect) {
      throw new Error(`encodeGif：第 ${i} 帧长度 ${frames[i]?.length ?? 0} ≠ ${expect}（${width}×${height}×4）`)
    }
  }

  const delay = Math.round(1000 / fps)
  const encoder = GIFEncoder()
  for (let i = 0; i < frames.length; i += 1) {
    const rgba = frames[i]
    /* 每帧自适应调色板：物理动画里大片同色（白底、网格、轨迹），
       全局调色板反而会把唯一的曲线色挤掉。 */
    const palette = quantize(rgba, 256)
    const indexed = applyPalette(rgba, palette)
    encoder.writeFrame(indexed, width, height, { palette, delay })
  }
  encoder.finish()
  return encoder.bytes()
}

/**
 * 把画布上的一块区域缩放到目标尺寸并取出 RGBA。
 * 单独抽出来是因为"源画布可能是 960×540×dpr"，缩放口径必须统一。
 * @param {HTMLCanvasElement} source
 * @param {number} width
 * @param {number} height
 * @returns {Uint8ClampedArray}
 */
export function readScaled(source, width, height) {
  const target = document.createElement('canvas')
  target.width = width
  target.height = height
  const ctx = target.getContext('2d')
  if (!ctx) throw new Error('readScaled：拿不到 2D 上下文')
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(source, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height).data
}
