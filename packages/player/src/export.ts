import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAsset } from '../../shared/asset.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAYER_SRC = readAsset('player.js');
const CLEAN_SRC = readAsset('text-clean.js');

const STYLE = `<style id="xfy-player-style">
html,body{margin:0;padding:0;background:#e9eef6;overflow:hidden;}
body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;-webkit-font-smoothing:antialiased;}
#xfy-app{position:absolute;left:50%;top:50%;display:flex;flex-direction:column;align-items:center;gap:10px;
     transform-origin:center center;transform:translate(-50%,-50%);}
#xfy-stage{position:relative;width:1280px;height:720px;overflow:hidden;background:#fff;
     border-radius:10px;box-shadow:0 8px 28px rgba(36,48,68,.13);}
#xfy-stage > canvas{display:block;width:100% !important;height:100% !important;object-fit:contain;background:#fff;}
#xfy-bar{display:flex;flex-direction:column;gap:7px;width:1280px;padding:9px 16px;box-sizing:border-box;
     background:#fff;border-radius:10px;box-shadow:0 4px 16px rgba(36,48,68,.10);}
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
</style>`;

/**
 * 把一个"只有舞台"的动画网页，包成"舞台 + 宿主播放器"。
 *
 * 模型的产物不需要（也不应该）自己画控制条；控制条由这里统一注入，
 * 好处是每个动画的交互一致，而且画布不会被按钮占掉一块。
 */
export function wrapWithPlayer(html: string): string {
  const marker = '<div id="xfy-app"><div id="xfy-stage">';
  let out = html;

  if (!out.includes(marker)) {
    const m = out.match(/<body([^>]*)>/i);
    if (m && m.index != null) {
      const at = m.index + m[0].length;
      out = out.slice(0, at) + marker + out.slice(at);
    } else {
      out = marker + out;
    }
    const close = out.toLowerCase().lastIndexOf('</body>');
    out = close >= 0 ? out.slice(0, close) + '</div></div>' + out.slice(close) : out + '</div></div>';
  }

  const tail =
    STYLE +
    `<script id="xfy-text-clean">${CLEAN_SRC}</script>` +
    `<script id="xfy-player">${PLAYER_SRC}</script>`;
  const bodyClose = out.toLowerCase().lastIndexOf('</body>');
  return bodyClose >= 0 ? out.slice(0, bodyClose) + tail + out.slice(bodyClose) : out + tail;
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
