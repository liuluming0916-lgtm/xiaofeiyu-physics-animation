import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAsset } from '../../shared/asset.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAYER_SRC = readAsset('player.js');
const CLEAN_SRC = readAsset('text-clean.js');
const FRAME_RUNTIME = readAsset('frame-runtime.js');

const STYLE = `<style id="xfy-player-style">
html,body{margin:0;padding:0;background:#e9eef6;overflow:hidden;}
body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;-webkit-font-smoothing:antialiased;}
#xfy-app{position:absolute;left:50%;top:50%;display:flex;flex-direction:column;align-items:center;gap:10px;
     transform-origin:center center;transform:translate(-50%,-50%);}
#xfy-stage{position:relative;width:1280px;height:720px;overflow:hidden;background:#fff;
     border-radius:10px;box-shadow:0 8px 28px rgba(36,48,68,.13);transform:translateZ(0);}
#xfy-frame{display:block;width:1280px;height:720px;border:0;background:#fff;}
/* 模型常用 position:fixed / 100vw 让画面铺满窗口；这里把 fixed 的参照内缩到舞台，
   并把画布尺寸钉死在 1280×720（!important 压过内联样式），否则会盖住控制条或被裁切。 */
#xfy-stage canvas:not(#xfy-ink){display:block;position:static !important;width:100% !important;height:100% !important;
     object-fit:contain;background:#fff;}
#xfy-ink{
  position:absolute;left:0;top:0;width:100%;height:100%;z-index:5;
  /* 模型常写 canvas{background:...}，会连标注层一起刷成不透明，必须强制透明 */
  background:transparent !important;box-shadow:none !important;border:0 !important;border-radius:0 !important;
}
#xfy-ink-ghost{
  position:absolute;z-index:6;pointer-events:none;border-radius:5px;
  border:1.5px solid #6b7280;background:rgba(107,114,128,.14);
  box-shadow:0 0 0 2px rgba(255,255,255,.75) inset;
}
#xfy-bar{display:flex;flex-direction:column;gap:7px;width:1280px;padding:9px 16px;box-sizing:border-box;
     background:#fff;border-radius:10px;box-shadow:0 4px 16px rgba(36,48,68,.10);
     position:relative;z-index:10;}
#xfy-bar .xfy-row{display:flex;align-items:center;gap:10px;}
#xfy-bar .xfy-btn{border:1px solid #cdd8e8;background:#f7f9fd;color:#243044;font-size:15px;
     font-family:inherit;border-radius:8px;padding:6px 15px;cursor:pointer;line-height:1.2;transition:.15s;}
#xfy-bar .xfy-btn:hover{background:#eaf1fd;border-color:#9fbcf0;}
#xfy-bar .xfy-btn:disabled{opacity:.45;cursor:not-allowed;}
#xfy-bar .xfy-ghost{background:#fff;}
#xfy-bar .xfy-seek{flex:1;min-width:160px;height:6px;accent-color:#2f6feb;cursor:pointer;}
#xfy-bar .xfy-time{font-size:14px;color:#4c5c74;font-variant-numeric:tabular-nums;min-width:132px;text-align:center;}
#xfy-bar .xfy-phys{font-size:13px;color:#8593a8;min-width:118px;}
#xfy-bar .xfy-speeds{display:flex;gap:4px;}
#xfy-bar .xfy-speed{padding:4px 10px;font-size:13px;border-radius:7px;}
#xfy-bar .xfy-speed.is-on{background:#2f6feb;border-color:#2f6feb;color:#fff;}
#xfy-bar .xfy-speed.is-on:hover{background:#2a63d4;}
#xfy-bar .xfy-toggles{gap:16px;padding-top:1px;}
#xfy-bar .xfy-tg{display:flex;align-items:center;gap:6px;font-size:13px;color:#4c5c74;cursor:pointer;user-select:none;}
#xfy-bar .xfy-tg input{accent-color:#2f6feb;cursor:pointer;margin:0;}
#xfy-bar .xfy-tg i{width:10px;height:10px;border-radius:3px;display:inline-block;}
#xfy-bar .xfy-tip{margin-left:auto;font-size:12px;color:#9aa7ba;}
#xfy-bar .xfy-inkbar{gap:8px;padding-top:2px;border-top:1px dashed #e3e9f2;margin-top:2px;}
#xfy-bar .xfy-sw{display:inline-flex;align-items:center;gap:5px;}
#xfy-bar .xfy-dot{
  width:19px;height:19px;padding:0;border-radius:50%;cursor:pointer;
  border:2px solid transparent;box-shadow:inset 0 0 0 2px #fff, 0 0 0 1px #d3dcea;
}
#xfy-bar .xfy-dot.is-on{border-color:#2f6feb;box-shadow:inset 0 0 0 2px #fff, 0 0 0 1px #2f6feb;}
#xfy-bar .xfy-dot.xfy-w{background:#fff;display:inline-flex;align-items:center;justify-content:center;}
#xfy-bar .xfy-dot.xfy-w i{display:block;border-radius:50%;background:#334155;}
</style>`;

/**
 * 把模型的整页 HTML 塞进一个 iframe（2.1 起）。
 *
 * 为什么改 iframe：
 *   以前模型页面和我们的控制条同处一个文档，模型一句 `canvas{background:...}`、
 *   一个 `document.body.innerHTML = ''` 就能把控制条或标注层搞坏。
 *   现在模型在自己的文档里，我们的界面在外面，CSS 和 JS 都碰不到彼此。
 *
 * 做法：模型的 HTML 原样（只多注两个脚本）变成 srcdoc，交给 iframe。
 */
function injectIntoModel(html: string): string {
  const headTag = html.match(/<head[^>]*>/i);
  const cleanTag = `<script id="xfy-text-clean">${CLEAN_SRC}</script>`;
  let out = html;
  if (headTag && headTag.index != null) {
    const at = headTag.index + headTag[0].length;
    out = out.slice(0, at) + cleanTag + out.slice(at);
  } else {
    const htmlTag = out.match(/<html[^>]*>/i);
    if (htmlTag && htmlTag.index != null) {
      const at = htmlTag.index + htmlTag[0].length;
      out = out.slice(0, at) + cleanTag + out.slice(at);
    } else {
      out = cleanTag + out;
    }
  }
  const runtime = `<script id="xfy-frame-runtime">${FRAME_RUNTIME}</script>`;
  const bodyClose = out.toLowerCase().lastIndexOf('</body>');
  return bodyClose >= 0 ? out.slice(0, bodyClose) + runtime + out.slice(bodyClose) : out + runtime;
}

/**
 * 把一个"只有舞台"的动画网页，包成"舞台(iframe) + 宿主播放器"。
 *
 * 模型的产物不需要（也不应该）自己画控制条；控制条由这里统一注入，
 * 好处是每个动画的交互一致，而且画布不会被按钮占掉一块。
 */
export function wrapWithPlayer(html: string): string {
  const inner = injectIntoModel(html);
  // 放进 JS 字符串：先 JSON 化，再把 </script 转义，避免提前闭合外层标签
  const payload = JSON.stringify(inner).replace(/<\/script/gi, '<\\/script');
  return (
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>小肥鱼物理解题动画</title>` +
    STYLE +
    `</head><body>` +
    `<div id="xfy-app"><div id="xfy-stage">` +
    `<iframe id="xfy-frame" allowfullscreen scrolling="no" title="动画画面"></iframe>` +
    `</div></div>` +
    `<script id="xfy-model">window.__XFY_MODEL_HTML=${payload};</script>` +
    `<script id="xfy-player">${PLAYER_SRC}</script>` +
    `</body></html>`
  );
}

/** 检查产物是否符合"舞台契约" */
export function inspectContract(html: string): { hasRender: boolean; hasActs: boolean; hasSample: boolean; problems: string[] } {
  const problems: string[] = [];
  const hasXfy = /window\.XFY\s*=/.test(html);
  const hasActs = /acts\s*:/.test(html);
  const hasRender = /render\s*[:(=]/.test(html);
  const hasSample = /sample\s*[:(=]/.test(html);
  if (!hasXfy) problems.push('没有 window.XFY 对象');
  else if (!hasActs && !hasRender) problems.push('既没有 acts 也没有 render(t)：播放器无法控制画面');
  if (hasXfy && !hasSample) problems.push('没有 sample(t)：数值对账与断层检测会失效');
  return { hasRender, hasActs, hasSample, problems };
}
