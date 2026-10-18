/**
 * 公式预渲染的**共用实现**（MathJax Node API → SVG + 按需字形）。
 *
 * 为什么抽成独立模块：现在有**两处**需要构建期渲染公式 ——
 *   ① 成品页（`tools/build-tex-svg.mjs`）：渲染 15 道题的 `$…$` 与 STEPS 的 `tex:`；
 *   ② 演示数据（`tools/build-demo-questions.mjs`）：前端演示界面同样需要**真 MathJax**，
 *      否则只能显示 LaTeX 原文（第 3 期交付后就出了这个事故，详见 README 13.12）。
 * 两处必须走**同一套渲染口径**，否则"成品页的公式"与"演示界面的公式"会长得不一样。
 * 复制一份实现是最容易发生的漂移来源，所以这里只留一份。
 *
 * 产出形状（与 `template/vendor/tex-svg/<id>.json` 一致，前端/模板两处都认）：
 *   { renderer, glyphs: '<path id=… d=…/>…', formulas: { '<tex>': '<mjx-container…>…</mjx-container>' } }
 *
 * ⚠ `formulas` 的键是 **LaTeX 原文**（含反斜杠），值含 `<mjx-container>` 外壳 ——
 *   模板的 `preRenderedSvg()` 会剥掉外壳并把基线对齐接到自己的 span 上，前端同理。
 */

/** 从任意文本里抽出 `$...$` 行内公式（`$$...$$` 也按内层取值） */
export function extractInlineTex(text) {
  const out = [];
  const re = /\$([^$\n]+)\$/g;
  let m;
  while ((m = re.exec(String(text ?? '')))) out.push(m[1].trim());
  return out;
}

/** 从行式表文本里抽出所有 `tex:` 字段（STEPS 的写法约定） */
export function extractRowTableTex(text) {
  const out = [];
  const re = /^tex:\s*(.+)$/gm;
  let m;
  while ((m = re.exec(String(text ?? '')))) out.push(m[1].trim());
  return out;
}

/** 拆出 MathJax 输出里的 `<defs>` 与主体 */
function splitDefs(markup) {
  const defsMatch = /<defs>([\s\S]*?)<\/defs>/.exec(markup);
  return { defs: defsMatch ? defsMatch[1] : '', body: markup.replace(/<defs>[\s\S]*?<\/defs>/, '') };
}

/** 从 defs 抓出每个字形 path（id → d），用于全局去重 */
function extractGlyphPaths(defs) {
  const map = new Map();
  const re = /<path\s+id="([^"]+)"\s+d="([^"]+)"\s*\/?>/g;
  let m;
  while ((m = re.exec(defs))) map.set(m[1], m[2]);
  return map;
}

/**
 * 起一个公式渲染器。**调用方负责用完即可**（MathJax 初始化较慢，一组任务只起一次）。
 * @returns {Promise<{ render: (tex: string) => string, renderAll: (texList: Iterable<string>) => {renderer:string, glyphs:string, formulas:Record<string,string>, bytes:number, glyphCount:number} }>}
 */
export async function createTexRenderer() {
  const { init } = await import('mathjax-full/es5/node-main.js');
  const MathJax = await init({ loader: { load: ['input/tex', 'output/svg'] } });
  const adaptor = MathJax.startup.adaptor;

  const render = (tex) => adaptor.outerHTML(MathJax.tex2svg(tex, { display: false }));

  /**
   * 批量渲染一组 LaTeX，返回与成品页**同形状**的产物。
   * 字形按"本批实际用到的"内联（不背全量字形表）。
   */
  const renderAll = (texList) => {
    const formulas = {};
    const usedGlyphs = new Map();
    let bytes = 0;
    for (const tex of texList) {
      if (!tex || formulas[tex]) continue;
      const markup = render(tex);
      const { defs } = splitDefs(markup);
      for (const [id, d] of extractGlyphPaths(defs)) usedGlyphs.set(id, d);
      formulas[tex] = markup;
      bytes += markup.length;
    }
    const glyphs = [...usedGlyphs.entries()].map(([id, d]) => `<path id="${id}" d="${d}"/>`).join('');
    return {
      renderer: 'mathjax-full@3.2.2 (tex2svg)',
      glyphs,
      formulas,
      bytes,
      glyphCount: usedGlyphs.size,
    };
  };

  return { render, renderAll };
}
