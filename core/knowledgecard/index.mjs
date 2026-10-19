/**
 * 世界书模块入口（§9 的落地：§9.1 字段 / §9.2 六步 / §9.3 治理 / §9.5 导入导出）。
 *
 * 分层（改代码前先看这一张）：
 *
 *   engine.mjs         纯逻辑：触发六步 + 分槽组装 + 来源标记 + 冲突提示
 *                      ⚠ **浏览器侧用的就是它**（逐字节副本，见 tools/build-knowledgecard-web.mjs）
 *   store.mjs          仓库读写：内置只读 + ai-rules 用户区 + 校验 + 规范化 + 稳定哈希 + 原子写
 *   governance.mjs     纯决定：覆盖副本 / 升级只替换未被覆盖 / 恢复默认只影响内置 / 导出默认只导 user
 *   import-export.mjs  纯逻辑：od-knowledgecard v1 的归一化（旧名只在此处转换）与打包
 *   coverage.mjs       纯逻辑：内置词条的「生成后自检」+ code_examples 覆盖率
 *   data/*.json        内置最小集（第 5.5 期扩到全题型的作业书已随 `_retired-knowledgecard/` 删除）
 */

export * from './engine.mjs';
export * from './store.mjs';
export * from './governance.mjs';
export * from './import-export.mjs';
export * from './coverage.mjs';
/**
 * 第 6 期第 5 项补齐：**可写入口**（只写用户目录 `ai-rules/knowledgecard/`）。
 * `store.mjs` 早就有 `writeUserPack` / `removeUserFile`，缺的是"给界面用的一层"：
 * 列包、读包、存包（整批失败）、新建、删除、把内置词条复制成覆盖副本。
 */
export * from './editor.mjs';

import { loadLibrary, knowledgecardHashOf } from './store.mjs';
import { triggerKnowledgecard } from './engine.mjs';

/** 载入失败时抛这个（**不静默返回半载入的库**，见 store.mjs 顶部说明） */
export class KnowledgecardLoadError extends Error {
  constructor(problems) {
    super(`世界书载入失败（整批失败，共 ${problems.length} 条问题）：\n- ${problems.join('\n- ')}`);
    this.name = 'KnowledgecardLoadError';
    this.problems = problems;
  }
}

/** 载入库；不合法就抛（生产路径用这个，避免拿着半载入的库去解题） */
export function loadKnowledgecardOrThrow(opts) {
  const lib = loadLibrary(opts);
  if (!lib.ok) throw new KnowledgecardLoadError(lib.problems);
  return lib;
}

/** 命中等价于更强的那一档（截断排序与溯源展示都用它） */
const VIA_ORDER = ['key', 'secondary', 'constant', 'recursive'];

/**
 * 把"逐阶段各自触发"的结果合并成一份给 UI 与溯源用的汇总。
 *
 * ⚠ 为什么逐阶段触发、而不是一次触发再切两个槽：
 *   §9.2 的输入是"题面文本 T（**+ 上一步解题文本，用于第二遍扫描**）"；
 *   `solve` 阶段还没有解题文本，`scene_code` 阶段有。用同一份文本跑一次再切槽，
 *   会让"只在解题文本里出现"的词条也注进 `solve` 槽 —— 那正是 §9.6 说的"规则互相干扰"。
 *
 * @param {{ solveRes: object|null, sceneRes: object|null, entries: object[] }} input
 */
export function mergeKnowledgecardStages({ solveRes = null, sceneRes = null, entries = [] } = {}) {
  const merged = new Map();
  const absorb = (list, stage) => {
    for (const p of list ?? []) {
      const cur = merged.get(p.entry_id);
      if (!cur) {
        merged.set(p.entry_id, { ...p, stages: [stage] });
        continue;
      }
      const stronger = VIA_ORDER.indexOf(p.via) < VIA_ORDER.indexOf(cur.via) ? p : cur;
      merged.set(p.entry_id, {
        ...cur,
        via: stronger.via,
        from: stronger.from ?? cur.from,
        depth: Math.min(cur.depth, p.depth),
        key: stronger.key ?? cur.key,
        injectedSlots: [...new Set([...cur.injectedSlots, ...p.injectedSlots])].sort(),
        charsBySlot: { ...cur.charsBySlot, ...p.charsBySlot },
        truncated: cur.truncated || p.truncated,
        stages: [...new Set([...cur.stages, stage])].sort(),
      });
    }
  };
  absorb(solveRes?.provenance, 'solve');
  absorb(sceneRes?.provenance, 'scene_code');

  const emptySlots = [
    ...(solveRes?.emptySlots.includes('solve') ? ['solve'] : []),
    ...(sceneRes?.emptySlots.includes('scene_code') ? ['scene_code'] : []),
  ];
  const truncatedSlots = [
    ...(solveRes?.truncatedSlots.filter((t) => t.slot === 'solve') ?? []),
    ...(sceneRes?.truncatedSlots.filter((t) => t.slot === 'scene_code') ?? []),
  ];

  return {
    /** ⚠ 空槽与截断是两个字段（16.3 ③）：UI 不许自己判断 */
    emptySlots,
    truncatedSlots,
    provenance: [...merged.values()].sort((a, b) => a.order - b.order || (a.entry_id < b.entry_id ? -1 : 1)),
    warnings: [...(solveRes?.warnings ?? []), ...(sceneRes?.warnings ?? [])],
    charsBySlot: {
      solve: solveRes?.stats?.charsBySlot?.solve ?? 0,
      scene_code: sceneRes?.stats?.charsBySlot?.scene_code ?? 0,
    },
    injectedBySlot: {
      solve: solveRes?.stats?.injectedBySlot?.solve ?? 0,
      scene_code: sceneRes?.stats?.injectedBySlot?.scene_code ?? 0,
    },
    matched: merged.size,
    hash: knowledgecardHashOf(entries),
    entries: entries.length,
  };
}

/**
 * 一次算完两个槽位（供预览器、离线审计、以及"不逐阶段跑"的调用方使用）。
 *
 * @param {{ problemText?: string, solutionText?: string, entries?: object[], budget?: object }} input
 */
export function prepareKnowledgecard({ problemText = '', solutionText = '', entries = [], budget } = {}) {
  const solveRes = triggerKnowledgecard({ entries, text: problemText, ...(budget ? { budget } : {}) });
  const secondText = [problemText, solutionText].filter((s) => typeof s === 'string' && s.trim()).join('\n');
  const sceneRes = secondText === problemText ? solveRes : triggerKnowledgecard({ entries, text: secondText, ...(budget ? { budget } : {}) });
  const merged = mergeKnowledgecardStages({ solveRes, sceneRes, entries });

  return {
    ...merged,
    /** 每个槽位**已渲染好**的拼接内容（含来源标记；空槽为 `''`） */
    text: { solve: solveRes.text.solve ?? '', scene_code: sceneRes.text.scene_code ?? '' },
    slots: { solve: solveRes.slots.solve, scene_code: sceneRes.slots.scene_code },
    /** 逐阶段的原始结果（排查用；UI 只读上面的汇总口径） */
    perStage: { solve: solveRes, scene_code: sceneRes },
  };
}
