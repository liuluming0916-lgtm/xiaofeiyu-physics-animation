/**
 * 纯 JS 的 PNG 裁剪（零依赖）。
 *
 * 为什么自己写：这个项目刻意不加图像库（离线打包、体积敏感），
 * 而"把题目图里的示意图裁出来"需要**服务端**裁剪 —— 浏览器里裁了也带不回流水线。
 *
 * 支持范围（覆盖老师截图的主流格式）：
 *   · 8 位色深、非隔行；
 *   · 颜色类型 0（灰度）/ 2（RGB）/ 4（灰度+Alpha）/ 6（RGBA）。
 * 其余情况（JPEG、16 位、调色板、隔行）一律返回 `null`，由调用方退回"整图"。
 *
 * 坐标口径：`rect` 是**归一化**的 `{ x0, y0, x1, y1 }`（0–1，左上角原点），
 * 与读题阶段让模型输出的【示意图范围】一致。
 */

import zlib from 'node:zlib';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** 反滤波：把 PNG 的扫描线还原成像素字节 */
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? out[rowStart + x - bpp] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[prevStart + x - bpp] : 0;
      const v = line[x];
      let val;
      switch (filter) {
        case 0: val = v; break;
        case 1: val = v + left; break;
        case 2: val = v + up; break;
        case 3: val = v + ((left + up) >> 1); break;
        case 4: val = v + paeth(left, up, upLeft); break;
        default: return null; // 非法滤波类型：整张图不可信
      }
      out[rowStart + x] = val & 0xff;
    }
  }
  return out;
}

const BPP = new Map([
  [0, 1],
  [2, 3],
  [4, 2],
  [6, 4],
]);

/** 读 PNG 头与像素；不支持的格式返回 null */
export function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIG)) return null;
  let pos = 8;
  let ihdr = null;
  const idat = [];
  while (pos + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(pos);
    const type = buffer.toString('latin1', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr || ihdr.bitDepth !== 8 || ihdr.interlace !== 0 || ihdr.compression !== 0) return null;
  const bpp = BPP.get(ihdr.colorType);
  if (!bpp || !idat.length) return null;

  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const pixels = unfilter(raw, ihdr.width, ihdr.height, bpp);
  if (!pixels) return null;
  return { width: ihdr.width, height: ihdr.height, colorType: ihdr.colorType, bpp, pixels };
}

/** 编码：统一用 filter 0（简单、无损、体积可接受） */
export function encodePng({ width, height, colorType, pixels }) {
  const bpp = BPP.get(colorType);
  if (!bpp) return null;
  const stride = width * bpp;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 按归一化矩形裁剪。返回 `{ buffer, width, height }`；不支持的格式返回 null。
 * 矩形会被夹到图内，且至少保留 8×8 像素（防"框歪了裁出一个点"）。
 */
export function cropPngNormalized(buffer, rect) {
  const img = decodePng(buffer);
  if (!img) return null;
  if (!rect || ![rect.x0, rect.y0, rect.x1, rect.y1].every((v) => Number.isFinite(v))) return null;

  const w = img.width;
  const h = img.height;
  let x0 = Math.round(Math.min(rect.x0, rect.x1) * w);
  let y0 = Math.round(Math.min(rect.y0, rect.y1) * h);
  let x1 = Math.round(Math.max(rect.x0, rect.x1) * w);
  let y1 = Math.round(Math.max(rect.y0, rect.y1) * h);
  x0 = Math.max(0, Math.min(w - 8, x0));
  y0 = Math.max(0, Math.min(h - 8, y0));
  x1 = Math.max(x0 + 8, Math.min(w, x1));
  y1 = Math.max(y0 + 8, Math.min(h, y1));

  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw <= 0 || ch <= 0) return null;

  const bpp = img.bpp;
  const stride = img.width * bpp;
  const out = Buffer.alloc(cw * ch * bpp);
  for (let y = 0; y < ch; y += 1) {
    const srcStart = (y0 + y) * stride + x0 * bpp;
    img.pixels.copy(out, y * cw * bpp, srcStart, srcStart + cw * bpp);
  }
  const encoded = encodePng({ width: cw, height: ch, colorType: img.colorType, pixels: out });
  if (!encoded) return null;
  return { buffer: encoded, width: cw, height: ch };
}

/**
 * 从读题文本里解析【示意图范围】。
 * 接受 `x0,y0,x1,y1`（0–1 的小数），也接受 `(x0, y0)-(x1, y1)` 这种括号写法。
 */
export function parseDiagramBox(text) {
  if (typeof text !== 'string') return null;
  const m = /【示意图范围】\s*[:：]?\s*([\s\S]{0,80})/.exec(text);
  if (!m) return null;
  const nums = (m[1].match(/\d+(?:\.\d+)?/g) ?? []).map(Number).slice(0, 4);
  if (nums.length !== 4) return null;
  let [x0, y0, x1, y1] = nums;
  // 允许模型写百分比（如 10,20,90,80）
  if ([x0, y0, x1, y1].some((v) => v > 1)) {
    x0 /= 100; y0 /= 100; x1 /= 100; y1 /= 100;
  }
  const ok = [x0, y0, x1, y1].every((v) => Number.isFinite(v) && v >= -0.01 && v <= 1.01);
  if (!ok) return null;
  const rw = Math.abs(x1 - x0);
  const rh = Math.abs(y1 - y0);
  // 太小（<8%）或太大（>99%）都当没框住：裁出来没意义
  if (rw < 0.08 || rh < 0.08 || rw > 0.99 || rh > 0.99) return null;
  return { x0, y0, x1, y1 };
}
