/**
 * 标注避让的**规划器**（M15 补强 · Dry-Run 侧）
 *
 * 用户的要求：「文字避让，主体是动画，而不是说明」。
 *
 * 这里解决的是**最容易踩的那一半**：文字该往哪挪。
 * 另一半（画的时候按表挪 + 自动补引线）在模板页，见 README 的 C2 说明。
 *
 * ── 四条设计决定（每条都有代价，写清楚） ──────────────────────────
 *
 * ① **整段算一次，不是逐帧算。**
 *    逐帧算的话，物块一动、字就跟着跳，比原来更难看。所以：
 *    对每条注，**全程只选一个偏移量**，评分用"这条注在出现的所有帧里，
 *    挪了之后会不会压到东西"。这也是 `AutoView` 的做法（从整段包络算一次相机）。
 *
 * ② **只有"有体积的物体"算障碍**（`LABEL_BLOCKERS`）。
 *    笔画（线/箭头/曲线/弹簧）不算 —— 教科书的标注本来就贴着笔画写。
 *    实测教训：一开始 13 种图元全算，15 道题 47 条注**全部**被判压字，偏移纯粹是噪声。
 *
 * ③ **先筛后算：只有真压住的注才做候选搜索。**
 *    某道题一帧里有 **243** 条文字记录（坐标轴刻度、数据表），
 *    全量做候选搜索是 243×17×120×障碍 的量级 —— 又慢又没意义（刻度本来就该在那儿）。
 *    所以先做一遍 `(0,0)` 的廉价预检，只把"确实压住实体"的注送去规划，
 *    最多 `MAX_PLANNED` 条（按压住的面积从大到小），其余标 `deferred` **可见降级**。
 *
 * ④ **宁可不动，也不要动错。**
 *    候选第一位就是 `(0,0)`，同分时保留它；挪动上限 1.8 个行高；
 *    没有帧时返回空表并在 `skipped` 里说明原因。
 *    "看起来很用力但字跑偏了"比"没避让"更糟。
 *
 * ── 判据 ────────────────────────────────────────────────────
 *   `scoreAfter <= scoreBefore` 对每条注**恒成立**（门禁 ㉞ 在全语料上钉住）。
 *   也就是说：这个规划器**不可能把情况弄得更糟**。
 */

import { AutoView } from '../../sdk/runtime/animation-runtime.mjs';
import {
  DEFAULT_VIEWPORT,
  LABEL_AVOID_FORMAT,
  LABEL_AVOID_VERSION,
  LABEL_BLOCKERS,
  deriveLabelKeys,
  emptyLabelAvoid,
  labelBoxWorld,
  obstacleBoxWorld,
  overlapArea,
} from '../../sdk/runtime/label-avoid.mjs';

/** 参与评分的最大帧数（抽样到这么多；再多也不会让结论更稳） */
export const MAX_SAMPLE_FRAMES = 120;
/** 最多**规划**多少条注（只算真压住的；其余标 deferred） */
export const MAX_PLANNED = 40;
/** 最多挪几个行高 */
export const MAX_STEP_EM = 1.8;
/**
 * "容器"判据：实体面积 ≥ 注面积的这么多倍 ⇒ 那是图框/表格，字写在里面不算压字。
 *
 * 30 是**实测**出来的：真实物块约等于字的 6–10 倍面积（字必须挪），
 * 图框/数据表都在 30 倍以上（字写在里面是正常的）。
 * 试过 60：q06/q08 的判定没有变化，q15 反而少挪 1 条 —— 所以取 30。
 *
 * ⚠ 曾经还有一条"面积超过画面 25% 就不算障碍"的规则，已经删掉：
 *   它和 `hitArea()` 的容器判据重复，而且会在"画面本来就小"的场合误伤真实物块
 *   （合成用例红过两次）。**一条判据能说清楚的事，不要留两条。**
 */
export const CONTAINER_AREA_RATIO = 30;

/**
 * 擦边容忍：重叠面积不到注面积的这个比例 ⇒ 不算压字（肉眼看不出来）。
 * 不加这条，一条零宽度的线横穿画面就会把所有字判成压字。
 */
export const MIN_HIT_RATIO = 0.2;

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 均匀抽样（保留首末帧：首帧决定"第一眼"，末帧决定"停在画面上"） */
function sampleFrames(frames, max) {
  const list = Array.isArray(frames) ? frames : [];
  if (list.length <= max) return list.slice();
  const out = [];
  const step = (list.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) out.push(list[Math.round(i * step)]);
  return out;
}

/** 整段并集包围盒（用于 `AutoView.fit`；口径与运行时包络一致） */
function unionBox(sampled) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x, y) => {
    if (!isFiniteNum(x) || !isFiniteNum(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const f of sampled) {
    for (const r of f?.records ?? []) {
      const box = obstacleBoxWorld(r);
      if (box) {
        add(box.minX, box.minY);
        add(box.maxX, box.maxY);
        continue;
      }
      if (r?.op === 'text' || r?.op === 'latex') {
        add(r.x, r.y);
        if (isFiniteNum(r.leaderTo?.[0])) add(r.leaderTo[0], r.leaderTo[1]);
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * 一条注与一个"实体"的重叠面积 —— 带两条**降噪**判据。
 *
 * ① **容器不算障碍**：实体面积 ≥ 注的 30 倍 ⇒ 那是图框/表格/大面积背景，
 *    字写在里面（或擦到它的边）是正常的，不算压字。
 *    必须按"面积比"判、而不是按"是否完全落在里面"判：
 *    刻度常常**骑在图框边上**（不完全在内），只判包含关系会漏掉一大片。
 *
 * ② **擦边不算压字**：重叠面积 < 注面积的 20% ⇒ 只是贴了一下边，肉眼看不出来。
 *    不加这条，一条零宽度的"传送带线"横穿半个画面就会把所有字都判成压字。
 *
 * 两条合起来的效果（2026-10-17 实测）：判为压字的注从 1092/1396 降到个位数，
 * 剩下的正是用户抱怨的那种"字压在物块上"。
 *
 * @param {{minX:number,minY:number,maxX:number,maxY:number,w:number,h:number}} labelBox
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} blockerBox
 * @returns {number} 应当计入的重叠面积（不该计入时为 0）
 */
function hitArea(labelBox, blockerBox) {
  const a = overlapArea(labelBox, blockerBox);
  if (a <= 0) return 0;

  const labelArea = Math.max(1e-12, labelBox.w * labelBox.h);
  const blockerArea = Math.max(0, blockerBox.maxX - blockerBox.minX) * Math.max(0, blockerBox.maxY - blockerBox.minY);

  if (blockerArea > labelArea * CONTAINER_AREA_RATIO) return 0; // ① 容器
  if (a < labelArea * MIN_HIT_RATIO) return 0; // ② 擦边
  return a;
}

/** 一帧里的"挡字实体"盒子（只认 `LABEL_BLOCKERS`；容器由 `hitArea()` 判定） */
function blockersOf(records) {
  const boxes = [];
  for (const r of records ?? []) {
    if (!LABEL_BLOCKERS.includes(r?.op)) continue;
    const box = obstacleBoxWorld(r);
    if (box) boxes.push(box);
  }
  return boxes;
}

/** 候选偏移：`(0,0)` 打头，然后一圈方位，再一圈更远的。同分保留靠前的 ⇒ **不挪**优先。 */
function buildCandidates(stepWorld) {
  const out = [{ dx: 0, dy: 0, emDist: 0 }];
  const dirs = [
    [0, 1],
    [1, 0],
    [-1, 0],
    [0, -1],
    [0.7071, 0.7071],
    [-0.7071, 0.7071],
    [0.7071, -0.7071],
    [-0.7071, -0.7071],
  ];
  for (const k of [0.9, MAX_STEP_EM]) {
    for (const [ux, uy] of dirs) {
      out.push({ dx: ux * k * stepWorld, dy: uy * k * stepWorld, emDist: k });
    }
  }
  return out;
}

/**
 * 规划标注偏移。
 *
 * @param {object[]} frames `run.frames`（每帧带 `records`）
 * @param {{ viewport?: {width:number,height:number}, scale?: number, maxPlanned?: number, maxSamples?: number }} [opts]
 * @returns {object} 避让表（格式见 `LABEL_AVOID_FORMAT`）
 */
export function planLabelLayout(frames, opts = {}) {
  const totalFrames = Array.isArray(frames) ? frames.length : 0;
  if (!totalFrames) return emptyLabelAvoid('no-frames');

  const viewport = opts.viewport ?? DEFAULT_VIEWPORT;
  const sampled = sampleFrames(frames, opts.maxSamples ?? MAX_SAMPLE_FRAMES);
  const maxPlanned = opts.maxPlanned ?? MAX_PLANNED;

  /* ── 相机尺度：优先用调用方给的，否则自己算 ── */
  const sceneBox = unionBox(sampled);

  let scale = opts.scale;
  if (!isFiniteNum(scale) || scale <= 0) {
    scale = sceneBox ? AutoView.fit(sceneBox, { width: viewport.width, height: viewport.height }).scale : 1;
  }
  if (!isFiniteNum(scale) || scale <= 0) scale = 1;

  /* ── 逐帧：取出挡字实体盒 + 收集所有注 ── */
  const blockers = new Array(sampled.length);
  /** @type {Map<string, {key:string, op:string, text:string, size:number, occurrences:{frame:number, record:object, base:object}[]}>} */
  const slots = new Map();

  for (let i = 0; i < sampled.length; i += 1) {
    const records = sampled[i]?.records ?? [];
    blockers[i] = blockersOf(records);

    for (const { key, record } of deriveLabelKeys(records)) {
      const base = labelBoxWorld(record, scale);
      if (!base) continue;
      let slot = slots.get(key);
      if (!slot) {
        slot = {
          key,
          op: record.op,
          text: record.text ?? record.tex ?? '',
          size: isFiniteNum(record.size) ? record.size : 14,
          occurrences: [],
        };
        slots.set(key, slot);
      }
      slot.occurrences.push({ frame: i, record, base });
    }
  }

  const keys = [...slots.keys()].sort();
  if (!keys.length) {
    const empty = emptyLabelAvoid(null);
    empty.scale = scale;
    empty.sampledFrames = sampled.length;
    empty.totalFrames = totalFrames;
    return empty;
  }

  /* ── 预检：`(0,0)` 下谁真的压住了实体（廉价，只比一次） ── */
  const cost0 = (slot) => {
    let hitFrames = 0;
    let areaSum = 0;
    for (const occ of slot.occurrences) {
      const box = occ.base;
      let hit = 0;
      for (const ob of blockers[occ.frame]) hit += hitArea(box, ob);
      if (hit > 0) hitFrames += 1;
      areaSum += hit / (box.w * box.h);
    }
    return { hitFrames, areaSum };
  };

  const pre = new Map();
  for (const key of keys) pre.set(key, cost0(slots.get(key)));

  const blocking = keys.filter((k) => pre.get(k).hitFrames > 0);
  // 压得越狠的越先规划（名额有限时，先把最影响观感的修掉）
  blocking.sort((a, b) => {
    const pa = pre.get(a);
    const pb = pre.get(b);
    if (pb.areaSum !== pa.areaSum) return pb.areaSum - pa.areaSum;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const planned = new Set(blocking.slice(0, maxPlanned));
  const deferred = blocking.length > planned.size ? blocking.slice(maxPlanned) : [];

  /* ── 逐条规划（贪心；已经挪过的注会被后面的当成障碍） ── */
  /** @type {Map<number, object[]>} */
  const placed = new Map();
  const labels = [];

  for (const key of planned) {
    const slot = slots.get(key);
    const stepWorld = (slot.size * 1.25) / scale; // 一个行高 ≈ 多少世界单位
    const candidates = buildCandidates(stepWorld);

    /**
     * 评价一个候选位置。**字典序**比较，不是加权求和：
     *   ① 先比"压住实体"的程度（这是用户真正在意的）；
     *   ② 再比"压住别的注"的程度（次要）；
     *   ③ 最后比"挪得多远"（同分时选近的）。
     *
     * 为什么不加权求和：加权就有"为了躲另一条注而撞上物块"的可能，
     * 而 `scoreAfter <= scoreBefore` 这条不变式（"不会更糟"）会因此被破坏。
     * 字典序保证：在"压实体"这一维上，(0,0) 永远是候选之一 ⇒ 结果不可能更差。
     */
    const evalCand = (cand) => {
      let bHit = 0;
      let bArea = 0;
      let lHit = 0;
      for (const occ of slot.occurrences) {
        const box = labelBoxWorld(occ.record, scale, cand);
        if (!box) continue;

        let hit = 0;
        for (const ob of blockers[occ.frame]) hit += hitArea(box, ob);
        if (hit > 0) bHit += 1;
        bArea += hit / (box.w * box.h);

        let lHitFrame = 0;
        for (const other of placed.get(occ.frame) ?? []) lHitFrame += overlapArea(box, other);
        if (lHitFrame > 0) lHit += 1;
      }
      return { bHit, bArea, lHit, emDist: cand.emDist ?? 0, blockersScore: bHit * 1000 + bArea * 100 };
    };

    const better = (a, b) => {
      if (!b) return true;
      if (a.blockersScore !== b.blockersScore) return a.blockersScore < b.blockersScore;
      if (a.lHit !== b.lHit) return a.lHit < b.lHit;
      if (a.emDist !== b.emDist) return a.emDist < b.emDist;
      return false;
    };

    let best = null;
    for (const cand of candidates) {
      const s = evalCand(cand);
      if (better(s, best?.s ?? null)) best = { cand, s };
      // `(0,0)` 既不压实体、也不压别的注 ⇒ 没什么可改的，直接收工
      if (cand.dx === 0 && cand.dy === 0 && s.bHit === 0) break;
    }

    const before = { hitFrames: pre.get(key).hitFrames, areaSum: pre.get(key).areaSum };
    const beforeScore = before.hitFrames * 1000 + before.areaSum * 100;

    /**
     * **改善不明显就别挪。**
     *
     * 1.8 个行高的位移本来就救不了"压在很大的斜面上"这种情况。
     * 如果挪完还压着、只是面积小了一点，读者看到的是"这条说明莫名其妙挪了位、
     * 还压在东西上"，比不动更糟 —— 而且白画一条引线。
     *
     * 所以两条出路，满足其一才动：
     *   ① 彻底清掉（`bHit === 0`）；
     *   ② 覆盖面积至少少 25%。
     * 否则保留 `(0,0)`，并如实记 `stillBlocked: true`（压着，但没辙）。
     */
    const worthIt = best.s.bHit === 0 || best.s.blockersScore < beforeScore * 0.75;
    const chosen = worthIt ? best.cand : { dx: 0, dy: 0, emDist: 0 };
    const afterHit = worthIt ? best.s.bHit : before.hitFrames;
    const afterScore = worthIt ? best.s.blockersScore : beforeScore;
    const afterLabels = worthIt ? best.s.lHit : 0;
    const moved = chosen.dx !== 0 || chosen.dy !== 0;

    // 只把**挪过的**登记成障碍：刻度那类不动的注互相之间不该互相推
    if (moved) {
      for (const occ of slot.occurrences) {
        const box = labelBoxWorld(occ.record, scale, chosen);
        if (!box) continue;
        const arr = placed.get(occ.frame) ?? [];
        arr.push(box);
        placed.set(occ.frame, arr);
      }
    }

    labels.push({
      key,
      op: slot.op,
      text: slot.text,
      size: slot.size,
      anchor: { x: slot.occurrences[0].record.x, y: slot.occurrences[0].record.y },
      offset: { dx: chosen.dx, dy: chosen.dy },
      stepWorld,
      emDist: chosen.emDist ?? 0,
      moved,
      leader: moved,
      frames: slot.occurrences.length,
      overlapFramesBefore: before.hitFrames,
      overlapFramesAfter: afterHit,
      // ⚠ 分数只反映**压住实体**的程度（不含"挪得远"与"压别的注"）。
      //   这两边必须用同一个口径量，否则 `scoreAfter <= scoreBefore` 就成了自证。
      scoreBefore: beforeScore,
      scoreAfter: afterScore,
      overlapLabelsAfter: afterLabels,
      /** 压着东西但"挪也没用"（没找到明显更好的位置）—— 不是漏做 */
      stillBlocked: !moved && before.hitFrames > 0,
    });
  }

  /* ── 剩下不压东西的注：显式给一条"不动"的记录（消费方可以无脑查表） ── */
  for (const key of keys) {
    if (planned.has(key)) continue;
    const slot = slots.get(key);
    const isDeferred = deferred.includes(key);
    const p = pre.get(key);
    labels.push({
      key,
      op: slot.op,
      text: slot.text,
      size: slot.size,
      anchor: { x: slot.occurrences[0].record.x, y: slot.occurrences[0].record.y },
      offset: { dx: 0, dy: 0 },
      stepWorld: (slot.size * 1.25) / scale,
      emDist: 0,
      moved: false,
      leader: false,
      frames: slot.occurrences.length,
      overlapFramesBefore: p.hitFrames,
      overlapFramesAfter: p.hitFrames,
      scoreBefore: p.hitFrames * 1000 + p.areaSum * 100,
      scoreAfter: p.hitFrames * 1000 + p.areaSum * 100,
      deferred: isDeferred,
    });
  }

  labels.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return {
    format: LABEL_AVOID_FORMAT,
    version: LABEL_AVOID_VERSION,
    skipped: null,
    scale,
    viewport: { width: viewport.width, height: viewport.height },
    sampledFrames: sampled.length,
    totalFrames,
    blockers: [...LABEL_BLOCKERS],
    labels,
    summary: {
      total: labels.length,
      // `planned` = **真的做过候选搜索**的条数（不是"没被 deferred 的条数"：
      // 大部分注根本不压东西，它们压根不需要搜 —— 那是常态，不是降级）
      planned: planned.size,
      moved: labels.filter((l) => l.moved).length,
      deferred: labels.filter((l) => l.deferred).length,
      overlappingBefore: labels.filter((l) => l.overlapFramesBefore > 0).length,
      overlappingAfter: labels.filter((l) => l.overlapFramesAfter > 0).length,
    },
  };
}

/**
 * 把避让表套到一帧的命令上 —— **实现已移到 SDK**，这里只做转发。
 *
 * 为什么搬走：模板页要把这份实现当经典脚本内联（`window.ODLabelAvoid`），
 * 而模板只内联 `sdk/runtime/` 下的文件。留在 core 里的话，
 * 模板注入后拿到的是 `undefined`，避让会**静默失效**（字不挪、且不报错）。
 * 这类"注入成功但功能没接上"的故障最难查，所以宁可让两份实现变成一份。
 */
export { applyLabelAvoid } from '../../sdk/runtime/label-avoid.mjs';
