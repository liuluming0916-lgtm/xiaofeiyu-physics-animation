#!/usr/bin/env node
/**
 * _wb-measure —— 量"一道题到底会被塞多少字"（第 9 期施工期的取证工具）。
 *
 * 为什么单独量这个：用户最初的三条抱怨里，"世界书注入过于臃肿"是**唯一没有判据兜住**的一条
 * （世界书不进 C1–C9，见 16.4 第 1 条）。所以它只能靠**实测数字**说话：
 * 拿几道典型题走真引擎（`buildSlotPreview`），把每个槽位最终会进 system 消息的字数打出来。
 *
 * ⚠ 第 5.7 期起词条是**两侧分发**：专用卡几乎都挂在 `concepts` / `elements` 上，
 *   而不是 `keys`。所以这里把"读题判定"的产物当作输入一并传进去 ——
 *   不传 concepts 时量到的是"兜底路径"（只有常驻卡 + 通用卡），那会低估真实注入量。
 *
 * 用法：node tools/_wb-measure.mjs
 */

import { loadLibrary } from '../core/worldbook/store.mjs';
import { buildSlotPreview } from '../core/worldbook/engine.mjs';

const lib = loadLibrary();

const PROBLEMS = [
  {
    name: '传送带（力学 · 阶段切分）',
    text: '水平传送带以恒定速率运行，物块无初速轻放在传送带左端，物块与传送带之间的动摩擦因数 0.2，求物块与传送带共速所需的时间与位移，以及因摩擦产生的热量。',
    concepts: ['conveyor_belt'],
    elements: ['belt', 'block'],
  },
  {
    name: '带电粒子在磁场中（电磁学 · 圆周）',
    text: '带电粒子垂直射入匀强磁场，只受洛伦兹力，做匀速圆周运动，求轨道半径与周期，并判断粒子在磁场中的偏转方向。',
    concepts: ['lorentz_particle'],
    elements: ['plates', 'field_region', 'ball'],
  },
  {
    name: '板块 + 斜面（力学 · 双槽重灾区）',
    text: '木板放在粗糙水平面上，物块放在木板上，两者之间有摩擦，用水平恒力拉木板，求物块与木板共速的时刻与相对位移，以及摩擦生热。',
    concepts: ['block_board'],
    elements: ['block', 'board', 'incline'],
  },
];

const fmt = (n) => String(n).padStart(6);

for (const p of PROBLEMS) {
  console.log(`\n──────── ${p.name} ────────`);
  let total = 0;
  for (const slot of ['solve', 'scene_code']) {
    const { worldbookText, result } = buildSlotPreview({
      entries: lib.entries,
      slot,
      text: p.text,
      concepts: p.concepts,
      elements: p.elements,
    });
    // ⚠ 只数**真的进了这个槽位**的词条：`provenance` 是全局命中表，
    //   只挂在 solve 的规范卡也会出现在里面（早期版本就因为这个把命中数报大过）。
    const hits = (result.provenance ?? [])
      .filter((x) => (x.injectedSlots ?? []).includes(slot))
      .map((x) => x.entry_id);
    const chars = worldbookText.length;
    total += chars;
    console.log(
      `  ${slot.padEnd(11)} ${fmt(chars)} 字 · 命中 ${String(hits.length).padStart(2)} 条 · ${hits.join(', ') || '（无）'}`,
    );
  }
  console.log(`  ${'两槽合计'.padEnd(10)} ${fmt(total)} 字`);
}

/**
 * ── 第 9 期追问：**这批真题里，10 张公式规范卡各命中几张？** ──
 *
 * 规范卡从"常驻"改成"按关键词触发"之后，最需要回答的问题是：
 *   「哪些题的解题槽位会一张规范都拿不到？」
 * 这份表就是答案（用户要用它决定哪几条改回常驻）。
 */
const { readdirSync } = await import('node:fs');
const { pathToFileURL } = await import('node:url');
const { join } = await import('node:path');

const QDIR = join(import.meta.dirname ?? new URL('..', import.meta.url).pathname, '..', 'tests', 'regression-15');
const files = readdirSync(QDIR).filter((f) => f.endsWith('.mjs')).sort();

console.log('\n──────── 15 道真题：解题槽位命中的规范卡（0 张 = 这题一条规范都没有）────────');
const tally = new Map();
let zero = 0;
for (const f of files) {
  const mod = await import(pathToFileURL(join(QDIR, f)).href);
  const text = String(mod.default?.slots?.PROBLEM ?? '');
  const { worldbookText, result } = buildSlotPreview({ entries: lib.entries, slot: 'solve', text });
  const hits = (result.provenance ?? [])
    .filter((x) => (x.injectedSlots ?? []).includes('solve'))
    .map((x) => x.entry_id);
  if (!hits.length) zero += 1;
  for (const id of hits) tally.set(id, (tally.get(id) ?? 0) + 1);
  console.log(`  ${f.replace('.mjs', '').padEnd(34)} ${String(hits.length).padStart(2)} 张 · ${String(worldbookText.length).padStart(5)} 字 · ${hits.join(', ') || '（无）'}`);
}
console.log(`\n  一张都没命中的题：${zero} / ${files.length}`);
console.log('  各规范卡命中题数（低到高，用来判断哪几条该改回常驻）：');
for (const [id, n] of [...tally.entries()].sort((a, b) => a[1] - b[1])) console.log(`    ${String(n).padStart(2)} 题  ${id}`);

