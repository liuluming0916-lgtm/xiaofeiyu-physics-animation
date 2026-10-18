/**
 * 公式与"混排"文本的切分（第 8 期 · 用户 2026-10-18 裁决）。
 *
 * ── 为什么单独一个文件（而不是写在 `markdown.tsx` 里）──
 *
 * 用户的要求是"解释 + 公式 + 解释 + 公式 要能自动分行"。这件事**只看得见、测不到**，
 * 所以门禁（`tools/web-build.mjs` 的 ②-bis）要把它**从编译产物里 import 出来真跑一遍**。
 * 而 `markdown.tsx` 编译后会 `import './demo-questions'`（没有扩展名），Node 的 ESM 解析不了；
 * 这个文件**不 import 任何东西**，因此它是唯一能被门禁直接加载的模块。
 *
 * ⚠ 因此本文件必须保持**零依赖**（纯字符串处理）。加 import 就等于把门禁弄坏。
 */
/** 汉字（含扩展 A 与常用标点）：数学模式里出现它们，基本可以断定是"把句子塞进了 `$`" */
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
/** 中文句读：正常公式里不会出现 */
const PROSE_PUNCT_RE = /[，。；：？！、]/;
/**
 * 判断一段"被 `$…$` 包住的内容"到底是不是公式。
 *
 * ── 为什么需要这条守卫（用户真题实测）──
 *
 * 用户看到的是一整段中文被**竖排**排出来，中间还跳出一句英文
 * `Extra close brace or missing open brace`。根因不是排版，是：
 *   模型写成了「木板向左滑动，摩擦力 $f=\mu mg$ 方向向左。」这种**整句**，
 *   而 `$…$` 的配对又错位，于是**整段中文被当成了数学公式**送入 MathJax ——
 *   MathJax 把每个汉字当成一个数学符号（于是"一字一行"），
 *   再碰上不配对的 `}` 就吐出那句英文错误。
 *
 * 所以：`$` 里只要"像句子而不像公式"，就**当文字处理、把 `$` 去掉**。
 * 判据刻意宽（宁可不渲染，也不要把中文排成一竖列）：
 *   · 含汉字（但 `\text{…}` 里的汉字是合法的，先排除）；
 *   · 含中文句读；
 *   · 又长（>120）又没有任何 LaTeX 命令 —— 那是句子，不是公式。
 */
export function looksLikeProse(body) {
    const s = String(body ?? '').trim();
    if (!s)
        return false;
    // `\text{示意}` / `\mathrm{…}` 里的汉字是合法的：先把这些组整段挖掉再判
    const withoutTextGroups = s.replace(/\\[a-zA-Z]+\s*\{[^{}]*\}/g, '');
    if (CJK_RE.test(withoutTextGroups))
        return true;
    if (PROSE_PUNCT_RE.test(withoutTextGroups))
        return true;
    if (s.length > 120 && !/\\[a-zA-Z]/.test(s))
        return true;
    return false;
}
/**
 * 把一段"公式或混排"文本切成 **文字段 / 公式段**。
 *
 * 规则：
 *   ① 先把 `$$…$$` 归一成 `$…$`（模型两种都写过；`$$` 常出现在被误用的"整句公式"里）；
 *   ② 含有 `$…$` ⇒ 混排：按 `$` 切，公式与文字交替；
 *   ③ 没有 `$` ⇒ **整段就是一条公式**（`STEPS.tex` 的历史写法，不能因此退化成文字）；
 *   ④ **`$` 里是句子不是公式 ⇒ 还原成文字**（见 `looksLikeProse`），并把相邻文字合并，
 *      这样浏览器才能把它们当一段话自动折行。
 *
 * @param tex 原始文本（可能带 `$` 定界符，也可能是一整条裸 LaTeX）
 * @returns 分段数组；空输入返回空数组
 */
export function splitTexMix(tex) {
    const raw = String(tex ?? '').trim();
    if (!raw)
        return [];
    const normalized = raw.replace(/\$\$/g, '$');
    const parts = [];
    const re = /\$([^$\n]+)\$/g;
    let last = 0;
    let m;
    while ((m = re.exec(normalized)) !== null) {
        if (m.index > last)
            parts.push({ type: 'text', value: normalized.slice(last, m.index) });
        const body = (m[1] ?? '').trim();
        // ④ 句子被塞进 `$` ⇒ 当文字（去掉定界符），不送 MathJax
        parts.push(looksLikeProse(body) ? { type: 'text', value: body } : { type: 'math', value: body });
        last = m.index + m[0].length;
    }
    // 没有定界符 ⇒ 整段当一条公式（否则裸 LaTeX 会被当成普通文字，公式掉格式）
    if (!parts.length)
        return [{ type: 'math', value: normalized }];
    if (last < normalized.length)
        parts.push({ type: 'text', value: normalized.slice(last) });
    return mergeAdjacentText(parts);
}
/** 把相邻的文字段并成一段（否则每个 `$…$` 前后都会断行，读起来是碎的） */
export function mergeAdjacentText(parts) {
    const out = [];
    for (const p of parts) {
        const prev = out[out.length - 1];
        if (p.type === 'text' && prev && prev.type === 'text')
            prev.value += p.value;
        else
            out.push({ ...p });
    }
    return out;
}
