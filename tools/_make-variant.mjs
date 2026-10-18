/**
 * 一次性工具：给成品页做"对照变体"，用来**证明导出渲帧到底截到了什么**。
 *
 * 背景：当时导出渲帧产出的 PNG 里，画布（.stage-canvas）区域看起来是空白。
 * 为了把"画布没画"和"截图根本没截画布"区分开，这里做两个变体：
 *   · `empty-draw`  —— 把 drawFrame 换成 `return;`（画布必然空）；
 *   · `canvas-bg`   —— 给 canvas 元素加一个洋红→亮绿的 CSS 渐变背景（与 JS 无关）。
 * 两个变体分别导出后再与原图逐像素比较：
 *   · 若 `empty-draw` 与原图**完全一致** ⇒ 画布的绘制内容根本没进截图；
 *   · 若 `canvas-bg` 与原图**有明显差异** ⇒ 画布元素所在的区域确实被截到了（问题在绘制/时序）。
 *
 * 用法：node tools/_make-variant.mjs <题目 id> <empty-draw|canvas-bg>
 *
 * ⚠ 上游依赖（迁移后已变化）：本工具生成的变体页，当时是用 **Open Design 的
 * `od export --format image`** 截图的。第 1、2 期在 Open Design 里工作，故当时可用；
 * 现已在 DeepSeek Harness 下工作，**`od` 不在 PATH 上**，截图这一步暂时没有等价入口。
 * 本工具自身仍然有效（它只负责生成变体页），只是"生成 → 截图 → 逐像素比对"这条链
 * 现在只能走到第一段。详见 `清理台账-2026-10-16.md` 第三节。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const [, , id, kind] = process.argv;
if (!id || !kind) {
  console.error('用法：node tools/_make-variant.mjs <题目 id> <empty-draw|canvas-bg>');
  process.exit(1);
}

const src = join(ROOT, 'template', 'build', `${id}.html`);
let html = readFileSync(src, 'utf8');

if (kind === 'empty-draw') {
  const marker = 'PROGRAM_DATA = ';
  const start = html.indexOf(marker) + marker.length;
  const end = html.indexOf(';\n', start);
  const data = JSON.parse(html.slice(start, end));
  data.slots.drawFrame = 'return;';
  html = html.slice(0, start) + JSON.stringify(data) + html.slice(end);
} else if (kind === 'canvas-bg') {
  const before = html;
  html = html.replace(
    /class="stage-canvas"/,
    'class="stage-canvas" style="background:linear-gradient(90deg,#ff00ff,#00ff00)"',
  );
  if (html === before) throw new Error('没找到 class="stage-canvas"，模板结构变了');
} else if (kind === 'canvas-probe') {
  /* 在页面里塞一个 60×60 的"结果色块"：用 getImageData 读回画布像素，
     把结论编码成颜色 —— 这样即使我不能读图，也能从 PNG 里读出"画布到底画了没有"。
       洋红 = 画布有内容（>2000 个不透明非背景像素）· 黄 = 有少量内容 · 绿 = 画布空/未绘制
       蓝 = 找不到 canvas 元素 · 红 = getImageData 抛错
     ⚠ 必须**同时判 alpha**：没画过的 canvas 读回来是全透明 (0,0,0,0)，
       只按 RGB 判会把"一块透明"误判成"有内容"（本探针第一版就是这么骗过我的）。 */
  const probe = `<script>
(function(){
  var el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:0;top:0;width:60px;height:60px;z-index:9999;background:#0000ff';
  document.body.appendChild(el);
  function check(){
    try {
      var c = document.querySelector('.stage-canvas');
      if (!c || !c.getContext) { el.style.background = '#0000ff'; return; }
      var g = c.getContext('2d');
      var d = g.getImageData(0, 0, c.width, c.height).data;
      var ink = 0;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i+3] > 8 && (d[i] < 240 || d[i+1] < 240 || d[i+2] < 240)) ink += 1;
      }
      el.style.background = ink > 2000 ? '#ff00ff' : (ink > 0 ? '#ffff00' : '#00ff00');
    } catch (e) { el.style.background = '#ff0000'; }
  }
  var go = function(){ requestAnimationFrame(function(){ requestAnimationFrame(check); }); };
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
})();
</script>
</body>`;
  const before = html;
  html = html.replace('</body>', probe);
  if (html === before) throw new Error('没找到 </body>');
} else {
  throw new Error(`未知变体类型：${kind}`);
}

const out = join(ROOT, 'template', 'build', `_variant-${kind}.html`);
writeFileSync(out, html, 'utf8');
console.log(`✓ 变体已写出：template/build/_variant-${kind}.html（${kind}）`);
