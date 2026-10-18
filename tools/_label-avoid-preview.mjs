#!/usr/bin/env node
/**
 * 标注避让「对比页」生成器（**一次性取证工具**，不是门禁）
 *
 * 为什么需要它：避让的规划（C1）只产出一张**表**，画面上什么都没变；
 * 真正的"按表挪"要等 C2。可"我看不见的东西就不算做完"——
 * 所以这个工具把表**画出来**：同一帧，左边"不避让"、右边"避让后"，
 * 让你一眼看清每条例注原来在哪、挪到哪、谁挡的它。
 *
 * ⚠ 它是**几何示意图**，不是真动画：
 *   · 矩形/圆/线是按命令缓冲里的记录画的，颜色是示意色，不是产品配色；
 *   · 文字只有外框与内容，没有真实排版（字距/字重与浏览器渲染有出入）；
 *   · 真动画的观感请等 C2 之后再双击演示页看。
 *
 * 用法：
 *   node tools/_label-avoid-preview.mjs            # 15 道题全画
 *   node tools/_label-avoid-preview.mjs q01 q04    # 只画这几道
 * 产物：`_preview-label-avoid/index.html`（双击打开，无外链、无脚本依赖）
 *
 * 文件名以 `_` 开头 ⇒ 按仓库口径属于"一次性取证工具"，不进 ⓪ 覆盖自检
 * （见 `tools/verify-coverage.mjs` 的 `e.name.startsWith('_')`）。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT } from './paths.mjs';
import { dryRun } from '../core/dryrun/dry-run.mjs';
import { loadQuestions } from '../core/dryrun/run-suite.mjs';
import { deriveLabelKeys, labelBoxWorld, obstacleBoxWorld, overlapArea } from '../sdk/runtime/label-avoid.mjs';
import { LABEL_BLOCKERS } from '../sdk/runtime/label-avoid.mjs';

const OUT_DIR = join(PROJECT_ROOT, '_preview-label-avoid');
const W = 960;
const H = 540;

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 取这一帧里"画得出来"的图元（只有这些——其余对判断避让没帮助） */
function contextShape(r) {
  const box = obstacleBoxWorld(r);
  if (!box) return null;
  return { op: r.op, box, record: r };
}

/** 让视图框住这一帧（含挪动后的位置），留 8% 边 */
function viewOf(boxes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (!b) continue;
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  if (!Number.isFinite(minX)) return { cx: 0, cy: 0, scale: 100 };
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const scale = Math.min((W * 0.84) / spanX, (H * 0.84) / spanY);
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale };
}

/**
 * 画一帧。
 * @param {object[]} records 这一帧的命令缓冲
 * @param {Map<string, object>} byKey 避让表（key → 条目）
 * @param {{ apply: boolean, scale: number, view: object }} opts
 */
function drawFrame(records, byKey, { apply, scale, view }) {
  const sx = (x) => W / 2 + (x - view.cx) * view.scale;
  const sy = (y) => H / 2 - (y - view.cy) * view.scale;
  const out = [];

  /* ── 底层：场景图元（浅灰，只做参照） ── */
  for (const r of records) {
    const shape = contextShape(r);
    if (!shape) continue;
    const { op, box, record } = shape;
    const solid = ['polygon', 'circle', 'pulley', 'belt'].includes(op);
    const stroke = solid ? '#9ca3af' : '#d1d5db';
    const fill = solid ? '#e5e7eb' : 'none';
    const sw = solid ? 1.4 : 1;

    if (op === 'polygon' || op === 'curve') {
      const pts = (record.points ?? []).map(([x, y]) => `${sx(x).toFixed(2)},${sy(y).toFixed(2)}`).join(' ');
      const tag = op === 'polygon' ? 'polygon' : 'polyline';
      out.push(`<${tag} points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
      continue;
    }
    if (op === 'circle' || op === 'pulley') {
      const c = op === 'circle' ? [record.cx, record.cy] : record.c;
      out.push(
        `<circle cx="${sx(c[0]).toFixed(2)}" cy="${sy(c[1]).toFixed(2)}" r="${(record.r * view.scale).toFixed(2)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`,
      );
      continue;
    }
    if (op === 'line' || op === 'dimension' || op === 'arc' || op === 'ray' || op === 'lens') {
      out.push(
        `<line x1="${sx(record.x1).toFixed(2)}" y1="${sy(record.y1).toFixed(2)}" x2="${sx(record.x2).toFixed(2)}" y2="${sy(record.y2).toFixed(2)}" stroke="${stroke}" stroke-width="${sw}"/>`,
      );
      continue;
    }
    if (op === 'arrow') {
      const x2 = record.from[0] + record.vec[0] * (record.scale ?? 1);
      const y2 = record.from[1] + record.vec[1] * (record.scale ?? 1);
      out.push(
        `<line x1="${sx(record.from[0]).toFixed(2)}" y1="${sy(record.from[1]).toFixed(2)}" x2="${sx(x2).toFixed(2)}" y2="${sy(y2).toFixed(2)}" stroke="${stroke}" stroke-width="${sw + 0.4}"/>`,
      );
      continue;
    }
    if (op === 'belt' || op === 'spring') {
      out.push(
        `<line x1="${sx(record.a[0]).toFixed(2)}" y1="${sy(record.a[1]).toFixed(2)}" x2="${sx(record.b[0]).toFixed(2)}" y2="${sy(record.b[1]).toFixed(2)}" stroke="${stroke}" stroke-width="${solid ? 4 : 1.2}"/>`,
      );
      continue;
    }
    if (op === 'fieldDots') {
      out.push(
        `<rect x="${sx(box.minX).toFixed(2)}" y="${sy(box.maxY).toFixed(2)}" width="${((box.maxX - box.minX) * view.scale).toFixed(2)}" height="${((box.maxY - box.minY) * view.scale).toFixed(2)}" fill="#f3f4f6" stroke="${stroke}" stroke-width="0.8" stroke-dasharray="3 3"/>`,
      );
    }
  }

  /* ── 上层：文字 ── */
  for (const { key, record } of deriveLabelKeys(records)) {
    const item = byKey.get(key);
    const moved = Boolean(apply && item?.moved);
    const offset = moved ? item.offset : { dx: 0, dy: 0 };

    const box = labelBoxWorld(record, scale, offset);
    if (!box) continue;

    const color = moved ? '#1d4ed8' : '#b91c1c';
    const fill = moved ? '#dbeafe' : '#fee2e2';

    // 挪过的：先把"原来在哪"用红色虚线画出来，再从新位置拉一条引线
    if (moved) {
      const before = labelBoxWorld(record, scale, { dx: 0, dy: 0 });
      out.push(
        `<rect x="${sx(before.minX).toFixed(2)}" y="${sy(before.maxY).toFixed(2)}" width="${(before.w * view.scale).toFixed(2)}" height="${(before.h * view.scale).toFixed(2)}" fill="none" stroke="#b91c1c" stroke-width="1" stroke-dasharray="4 3"/>`,
      );
      out.push(
        `<line x1="${sx(box.cx).toFixed(2)}" y1="${sy(box.cy).toFixed(2)}" x2="${sx(record.x).toFixed(2)}" y2="${sy(record.y).toFixed(2)}" stroke="#1d4ed8" stroke-width="0.9" stroke-dasharray="2 2"/>`,
      );
      out.push(`<circle cx="${sx(record.x).toFixed(2)}" cy="${sy(record.y).toFixed(2)}" r="2.2" fill="#b91c1c"/>`);
    }

    out.push(
      `<rect x="${sx(box.minX).toFixed(2)}" y="${sy(box.maxY).toFixed(2)}" width="${(box.w * view.scale).toFixed(2)}" height="${(box.h * view.scale).toFixed(2)}" fill="${fill}" fill-opacity="0.85" stroke="${color}" stroke-width="1"/>`,
    );
    const label = record.op === 'latex' ? record.tex : record.text;
    out.push(
      `<text x="${sx(box.cx).toFixed(2)}" y="${sy(box.cy).toFixed(2)}" font-size="11" font-family="Consolas, 'Courier New', monospace" fill="${color}" text-anchor="middle" dominant-baseline="middle">${esc(label)}</text>`,
    );
  }

  return out.join('\n');
}

/**
 * 选"最值得看"的那一帧。
 *
 * 优先级：
 *   ① 这一帧里**挪过的说明确实压着实体**（否则左右对比没有说服力：
 *      字明明没压东西，却看到它被挪走了 —— 读者只会觉得"它乱动"）；
 *   ② 其次才是"挪动的说明最多"。
 *
 * ⚠ 一开始写的是"挪动条数最多"，结果 q01 画在第 0 帧（t=0），
 *   那一帧物块还在起点、字也没压上 —— 对比页看不出任何理由。
 */
function pickFrame(frames, byKey, scale) {
  let best = { index: 0, score: -1, overlappingMoved: 0, moved: 0 };
  for (let i = 0; i < frames.length; i += 1) {
    const records = frames[i]?.records ?? [];
    const blocks = records
      .filter((r) => LABEL_BLOCKERS.includes(r.op))
      .map((r) => obstacleBoxWorld(r))
      .filter(Boolean);

    let moved = 0;
    let overlappingMoved = 0;
    for (const { key, record } of deriveLabelKeys(records)) {
      const item = byKey.get(key);
      if (!item?.moved) continue;
      moved += 1;
      const box = labelBoxWorld(record, scale, { dx: 0, dy: 0 });
      if (box && blocks.some((ob) => overlapArea(box, ob) > 0.2 * box.w * box.h)) overlappingMoved += 1;
    }

    const score = overlappingMoved * 1000 + moved;
    if (score > best.score) best = { index: i, score, overlappingMoved, moved };
  }
  return best;
}

async function main() {
  const filters = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const questions = await loadQuestions(filters);
  console.log(`标注避让对比页：${questions.length} 道题`);

  const sections = [];
  const rows = [];
  const checks = [];

  for (const { file, program } of questions) {
    const { report, run } = await dryRun({
      slots: program.slots,
      entry: program.id,
      meta: { mode: program.mode ?? 'NUMERIC', index: program.index, title: program.title, sourceFile: file },
    });

    const table = report.labelAvoid;
    const byKey = new Map((table?.labels ?? []).map((l) => [l.key, l]));
    const summary = table?.summary ?? { total: 0, planned: 0, moved: 0, deferred: 0, overlappingBefore: 0, overlappingAfter: 0 };
    const frames = run?.frames ?? [];
    const picked = pickFrame(frames, byKey, table.scale);
    const frame = frames[picked.index];
    const records = frame?.records ?? [];

    rows.push({
      name: file.replace(/\.mjs$/, ''),
      title: program.title ?? '',
      ...summary,
      frame: picked.index,
      t: frame?.t ?? null,
    });

    // 视图：把这一帧的所有盒子（原位置 + 新位置）都框进来
    const boxes = [];
    for (const r of records) boxes.push(obstacleBoxWorld(r));
    for (const { key, record } of deriveLabelKeys(records)) {
      const item = byKey.get(key);
      boxes.push(labelBoxWorld(record, table.scale, { dx: 0, dy: 0 }));
      if (item?.moved) boxes.push(labelBoxWorld(record, table.scale, item.offset));
    }
    const view = viewOf(boxes);

    const left = drawFrame(records, byKey, { apply: false, scale: table.scale, view });
    const right = drawFrame(records, byKey, { apply: true, scale: table.scale, view });

    const movedList = deriveLabelKeys(records)
      .map(({ key }) => byKey.get(key))
      .filter((x) => x?.moved);

    /* ── 页内自检：**画出来的那一帧**到底改没改善 ──
       不引用规划器的中间结果，直接拿"要画的那两组盒子"重新数一遍。
       这样"页面看起来对了"就不只是我说对了。 */
    const blockBoxes = records
      .filter((r) => LABEL_BLOCKERS.includes(r.op))
      .map((r) => obstacleBoxWorld(r))
      .filter(Boolean);
    const countHits = (apply) =>
      deriveLabelKeys(records).filter(({ key, record }) => {
        const item = byKey.get(key);
        const off = apply && item?.moved ? item.offset : { dx: 0, dy: 0 };
        const b = labelBoxWorld(record, table.scale, off);
        if (!b) return false;
        // 与规划器同一条"擦边不算"的容忍线（20%）
        return blockBoxes.some((ob) => overlapArea(b, ob) > 0.2 * b.w * b.h);
      }).length;
    checks.push({ name: file.replace(/\.mjs$/, ''), before: countHits(false), after: countHits(true) });

    sections.push(`
<section class="q" id="${esc(file.replace(/\.mjs$/, ''))}">
  <h2>${esc(program.title || program.id)} <span class="badge">${esc(file.replace(/\.mjs$/, ''))}</span></h2>
  <p class="stats">说明 <b>${summary.total}</b> 条 · 真做过搜索 <b>${summary.planned}</b> 条 ·
     挪了 <b class="blue">${summary.moved}</b> 条 · 名额外降级 <b>${summary.deferred}</b> 条 ·
     压字 <b class="red">${summary.overlappingBefore}</b> → <b class="green">${summary.overlappingAfter}</b>
     <span class="dim">（本页画第 ${picked.index} 帧，t=${(frame?.t ?? 0).toFixed(3)} s）</span></p>
  ${
    summary.moved === 0
      ? '<p class="none">本题没有需要挪的说明 —— 这是正常情况（说明本来就没压在物体上）。</p>'
      : `<p class="none">本帧挪动清单：${movedList
          .map((m) => `<code>${esc(m.text || m.key)}</code> 偏 (${m.offset.dx.toFixed(3)}, ${m.offset.dy.toFixed(3)})`)
          .join(' · ')}</p>`
  }
  <div class="panels">
    <figure><figcaption>① 不避让（现在线上就是这样）</figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="不避让">${left}</svg></figure>
    <figure><figcaption>② 避让后（C2 上线后动画会变成这样）</figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="避让后">${right}</svg></figure>
  </div>
</section>`);
  }

  const tableRows = rows
    .filter((r) => r.total > 0)
    .map(
      (r) =>
        `<tr><td><a href="#${esc(r.name)}">${esc(r.name)}</a></td><td>${esc(r.title)}</td><td>${r.total}</td>` +
        `<td>${r.planned}</td><td class="${r.moved ? 'blue' : 'dim'}">${r.moved}</td><td>${r.deferred}</td>` +
        `<td class="red">${r.overlappingBefore}</td><td class="green">${r.overlappingAfter}</td></tr>`,
    )
    .join('\n');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>标注避让对比页（第 8 期 C1）</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px 28px 60px; background: #f8fafc; color: #0f172a;
         font-family: "Microsoft YaHei", "Segoe UI", system-ui, sans-serif; line-height: 1.65; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  h2 { font-size: 16px; margin: 0 0 6px; }
  .lead { color: #475569; max-width: 68em; margin: 0 0 18px; }
  .lead code, .stats code { background: #eef2ff; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
  .legend { display: flex; gap: 22px; flex-wrap: wrap; margin: 0 0 22px; font-size: 13px; }
  .legend i { display: inline-block; width: 14px; height: 14px; border-radius: 2px; vertical-align: -2px; margin-right: 6px; }
  table { border-collapse: collapse; font-size: 13px; margin: 0 0 26px; background: #fff; }
  th, td { border: 1px solid #e2e8f0; padding: 5px 10px; text-align: right; }
  th { background: #f1f5f9; font-weight: 600; }
  td:nth-child(1), td:nth-child(2), th:nth-child(1), th:nth-child(2) { text-align: left; }
  section.q { margin: 0 0 30px; padding: 16px 18px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; }
  .badge { font-size: 11px; font-weight: 400; color: #64748b; background: #f1f5f9; padding: 2px 7px; border-radius: 999px; }
  .stats { font-size: 13px; color: #334155; margin: 0 0 6px; }
  .none { font-size: 12.5px; color: #475569; margin: 0 0 12px; }
  .dim { color: #94a3b8; }
  .blue { color: #1d4ed8; } .red { color: #b91c1c; } .green { color: #15803d; }
  .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  figure { margin: 0; }
  figcaption { font-size: 12px; color: #64748b; margin: 0 0 4px; }
  svg { width: 100%; height: auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; }
  @media (max-width: 900px) { .panels { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<h1>标注避让对比页（第 8 期 · C1 规划，尚未接到画面上）</h1>
<p class="lead">
  这张页只做一件事：把「避让规划」算出来的表<b>画给你看</b>。左边是<b>现在</b>的样子，
  右边是<b>规划之后</b>的样子（阶段 5 的 C2 上线后，动画就是这个效果）。<br>
  判定标准只有三条：<b>①</b> 右边的字不再压在灰色实体上；<b>②</b> 挪走的字有一条蓝色虚线指回红点（原位）；
  <b>③</b> 没压住的字（红框）在两边位置<b>完全相同</b> —— 说明它没有乱挪。<br>
  <span class="dim">⚠ 这是几何示意图：盒子按命令缓冲的真实坐标算，颜色是示意色，字号与真浏览器有出入。真观感请等 C2 后双击演示页。</span>
</p>
<div class="legend">
  <span><i style="background:#e5e7eb;border:1px solid #9ca3af"></i>灰色实体（会挡字：物块/球/滑轮/传送带）</span>
  <span><i style="background:#fee2e2;border:1px solid #b91c1c"></i>红框 = 没压住，两图同位置</span>
  <span><i style="background:#dbeafe;border:1px solid #1d4ed8"></i>蓝框 = 挪到了这里</span>
  <span><i style="border:1px dashed #b91c1c"></i>红虚线 = 它原来压在哪</span>
</div>
<table>
  <thead><tr><th>题号</th><th>题目</th><th>说明数</th><th>做过搜索</th><th>挪了</th><th>降级</th><th>压字前</th><th>压字后</th></tr></thead>
  <tbody>
${tableRows}
  </tbody>
</table>
${sections.join('\n')}
</body>
</html>`;

  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, 'index.html');
  writeFileSync(file, html, 'utf8');
  console.log(`✓ 已生成：${file}`);
  console.log(`  双击打开即可（无外链、无脚本依赖）。共 ${sections.length} 道题。`);

  /* ── 自检汇总（页面里那一帧的"压字"条数） ── */
  const worse = checks.filter((c) => c.after > c.before);
  const improved = checks.filter((c) => c.after < c.before);
  console.log(`\n页内自检（就画出来的那一帧）：改善 ${improved.length} 道 · 不变 ${checks.length - improved.length - worse.length} 道 · 变差 ${worse.length} 道`);
  for (const c of checks) {
    if (c.before === c.after && c.before === 0) continue;
    console.log(`  ${c.after < c.before ? '✓' : c.after === c.before ? '·' : '✗'} ${c.name}: 压字 ${c.before} → ${c.after}`);
  }
  if (worse.length) {
    console.log('\n⚠ 有题变差了 —— 这是缺陷，必须先修，不能交付。');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('生成失败：', e?.message ?? e);
  process.exitCode = 1;
});
