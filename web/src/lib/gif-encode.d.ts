/**
 * gif-encode.js 的类型声明（实现见同名 .js，浏览器与 node 共用同一份）。
 * 形状刻意写得窄：只声明导出面，避免把实现细节带进类型层。
 */

export declare const DEFAULT_GIF_FPS: number
export declare const DEFAULT_GIF_WIDTH: number
export declare const DEFAULT_GIF_HEIGHT: number
export declare const GIF_FPS_CHOICES: number[]

/** 逐帧时刻：t_i = i / fps，i = 0 … round(duration×fps)，末帧 clamp 到 duration */
export declare function frameTimes(durationSec: number, fps?: number): number[]

/** 帧数（含末帧） */
export declare function gifFrameCount(durationSec: number, fps?: number): number

/** 把 RGBA 帧编码成 GIF89a 字节 */
export declare function encodeGif(
  frames: Array<Uint8ClampedArray | Uint8Array>,
  opts?: { width?: number; height?: number; fps?: number },
): Uint8Array

/** 把源画布缩放到目标尺寸并取出 RGBA（浏览器专用） */
export declare function readScaled(source: HTMLCanvasElement, width: number, height: number): Uint8ClampedArray
