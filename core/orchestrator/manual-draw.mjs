/**
 * 手动“只重画 drawFrame”（v1.1.18）。
 *
 * 与主链的区别：
 *   · 不重跑 read_problem / solve / breakdown / analysis / scene_code；
 *   · 用上一版 8 槽位 + analysis 原文，只把 drawFrame 交给 repair 提示词重画；
 *   · 每轮重跑 C1–C9，pass 即停；上限 3 轮；仍不过带告警交付。
 *
 * 为什么单独一个模块：主链 `runPipeline` 是“从题目生成”的完整状态机；
 * 手动重画是“给定程序改一个槽位”，把它硬塞进主链会让两条路径互相污染。
 * 这里只复用纯函数（Prompt / 清洗 / Dry-Run / 交付形态），不复制判定。
 */

import { streamChatCompletion } from '../gateway/index.mjs';
import { getPrompt, assemblePrompt } from '../prompts/index.mjs';
import { parseAnalysisTable, formatAnalysis, stateKeyMap } from '../analysis/index.mjs';
import { buildProgramFromText, ProgramBuildError, formatSplitDiagnostics } from '../cleaner/index.mjs';
import { dryRun } from '../dryrun/dry-run.mjs';
import { classifyRepair, deliveryShape, buildBanner } from '../repair/index.mjs';
import { PHASE5_STAGES, makeEvent } from './events.mjs';
import { SLOT_KEY_NAMES } from '../../contracts/spec/frozen-keys.mjs';

const MAX_ROUNDS = 3;

function slotsText(slots) {
  return SLOT_KEY_NAMES.map((k) => `/* @slot:${k} */\n${slots[k] ?? ''}\n/* @end */`).join('\n\n');
}

function boundariesOf(analysis) {
  return [
    ...new Set(
      (analysis?.elements ?? []).flatMap((el) =>
        (el.segments ?? []).flatMap((s) => [s.t0, s.t1]),
      ),
    ),
  ].sort((a, b) => a - b);
}

/**
 * @param {{
 *   problem: {text?: string},
 *   readProblem?: string|null,
 *   analysisText: string,
 *   slots: Record<string,string>,
 *   config: object,
 *   signal?: AbortSignal,
 *   streamImpl?: Function,
 *   dryRunImpl?: Function,
 * }} input
 */
export async function* runManualDraw({
  problem = {},
  readProblem = null,
  analysisText,
  slots,
  config = {},
  signal,
  streamImpl = streamChatCompletion,
  dryRunImpl = dryRun,
} = {}) {
  let seq = 0;
  const emit = (type, payload) => makeEvent(type, payload, (seq += 1));
  const started = Date.now();
  const entry = String(problem?.text ?? '').slice(0, 40).replace(/\s+/g, ' ') || '手动重画';
  const cancelled = () => Boolean(signal?.aborted);
  const maxRounds = Math.max(0, Math.min(Number(config.maxRepairRounds ?? MAX_ROUNDS) || MAX_ROUNDS, MAX_ROUNDS));
  /** 与主链同一份清洗规则：规则快照里的 cleaningRules 优先 */
  const regexRules = Array.isArray(config.rulesSnapshot?.cleaningRules)
    ? config.rulesSnapshot.cleaningRules
    : (config.regexRules ?? []);

  /* B2：与主链同一套 type 校验（词表缺省时不校验，避免把“没配置”误判成“模型写错”） */
  const allowedTypes = Array.isArray(config?.knowledgecardVocab?.elements)
    ? config.knowledgecardVocab.elements
        .filter((e) => typeof e === 'string' || e?.enabled !== false)
        .map((e) => (typeof e === 'string' ? e : e?.id))
        .filter(Boolean)
    : null;
  const analysis = parseAnalysisTable(String(analysisText ?? ''), { allowedTypes });
  if (!analysis.ok) {
    yield emit('stage_error', {
      stage: 'repair',
      error: {
        kind: 'analysis.invalid',
        message: `手动重画需要上一版 analysis 原文，但解析失败：${analysis.problems.map((p) => p.message).join('；')}`,
        hint: '请用“从解题重跑”；只重画只能在已有物理分析时使用。',
      },
    });
    yield emit('run_done', { verdict: 'error', ms: Date.now() - started, stage: 'repair' });
    return;
  }

  let program;
  try {
    program = buildProgramFromText(slotsText(slots), { regexRules, provenance: {} }).program;
  } catch (err) {
    const message = err instanceof ProgramBuildError ? formatSplitDiagnostics(err.diagnostics) : String(err?.message ?? err);
    yield emit('stage_error', {
      stage: 'repair',
      error: { kind: 'build', message: `上一版程序无法重新组装：${message}` },
    });
    yield emit('run_done', { verdict: 'error', ms: Date.now() - started, stage: 'repair' });
    return;
  }

  const meta = { mode: 'BOTH', tPhys: analysis.tPhys, boundaries: boundariesOf(analysis) };
  const first = await dryRunImpl({ slots: program.slots, entry, meta });
  let report = first.report;
  yield emit('dryrun_done', {
    verdict: report?.verdict ?? 'fail',
    cancelled: Boolean(report?.cancelled),
    checks: report?.checks ?? [],
    extensions: report?.extensions ?? [],
    diagnostics: report?.diagnostics ?? [],
    program: { ...program, mode: 'BOTH' },
    labelAvoid: report?.labelAvoid ?? null,
  });

  if (report?.verdict === 'pass') {
    yield emit('run_done', {
      verdict: 'pass',
      ms: Date.now() - started,
      delivery: deliveryShape(program.slots),
      banner: null,
      rounds: 0,
      readProblemText: readProblem,
      analysisText: formatAnalysis(analysis),
    });
    return;
  }

  const cls = classifyRepair(report);
  if (cls.mode !== 'draw') {
    yield emit('stage_error', {
      stage: 'repair',
      error: {
        kind: 'manual/not-draw',
        message: `这一版不是画图类错误（${cls.physical.join(' / ') || '无法归类'}），只重画 drawFrame 修不了。`,
        hint: '请用“从解题重跑”。',
      },
    });
    yield emit('run_done', {
      verdict: report?.verdict ?? 'fail',
      ms: Date.now() - started,
      delivery: deliveryShape(program.slots),
      banner: buildBanner({
        verdict: report?.verdict ?? 'fail',
        rounds: 0,
        report,
        slots: program.slots,
        reason: '只重画 drawFrame 不适用于物理类错误',
      }),
      rounds: 0,
      readProblemText: readProblem,
      analysisText: formatAnalysis(analysis),
    });
    return;
  }

  const repairPrompt = getPrompt('repair', config.rulesSnapshot ?? null);
  const repairIndex = PHASE5_STAGES.indexOf('repair');
  const repairTotal = PHASE5_STAGES.length;
  const roundsLog = [];
  let stoppedReason = null;

  for (let round = 1; round <= maxRounds; round += 1) {
    if (cancelled()) {
      yield emit('cancelled', { stage: 'repair' });
      yield emit('run_done', { verdict: 'cancelled', ms: Date.now() - started, cancelled: true });
      return;
    }
    const failures = (report?.checks ?? [])
      .filter((c) => c.blocking && c.status === 'fail')
      .map((c) => `${c.id}：${c.detail ?? c.message ?? ''}`);
    const triggeringChecks = (report?.checks ?? [])
      .filter((c) => c.blocking && c.status === 'fail')
      .map((c) => c.id);

    yield emit('stage_start', {
      stage: 'repair',
      index: repairIndex,
      total: repairTotal,
      round,
      maxRounds,
      slots: ['drawFrame'],
      mode: 'draw',
      manual: true,
    });
    const stageStarted = Date.now();
    const assembled = assemblePrompt({
      problem: {
        text: repairPrompt.buildUser({
          problem: String(problem?.text ?? ''),
          analysisText: formatAnalysis(analysis),
          readProblem,
          ...(problem?.description ? { description: String(problem.description) } : {}),
          ...(problem?.knownConditions ? { knownConditions: String(problem.knownConditions) } : {}),
          stateMap: stateKeyMap(analysis),
          failures,
          previousDrawFrame: program.slots.drawFrame,
        }),
      },
      instructions: repairPrompt.system,
      instructionLabel: repairPrompt.label,
      stageSlot: 'scene_code',
      knowledgecardSegment: '',
      stage: 'repair',
    });

    let newDraw = '';
    try {
      const result = await streamImpl({
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        stage: 'scene_code',
        round,
        messages: assembled.messages,
        signal,
        vision: false,
        onDelta: () => {},
      });
      newDraw = result?.text ?? '';
    } catch (err) {
      yield emit('stage_error', {
        stage: 'repair',
        round,
        error: { kind: err?.kind ?? 'model', message: String(err?.message ?? err) },
      });
      stoppedReason = '手动重画时模型调用失败';
      break;
    }

    let nextProgram;
    try {
      nextProgram = buildProgramFromText(
        slotsText({ ...program.slots, drawFrame: newDraw }),
        { regexRules, provenance: program.provenance ?? {} },
      ).program;
    } catch (err) {
      const message = err instanceof ProgramBuildError ? formatSplitDiagnostics(err.diagnostics) : String(err?.message ?? err);
      yield emit('stage_error', {
        stage: 'repair',
        round,
        error: { kind: 'build', message: `只重画的输出无法拼成程序：${message}` },
      });
      const record = {
        round,
        mode: 'draw',
        requested: ['drawFrame'],
        updated: [],
        kept: SLOT_KEY_NAMES.filter((k) => k !== 'drawFrame'),
        unchanged: [],
        triggeringChecks,
        diagnostics: [],
        verdict: 'build-error',
        ms: Date.now() - stageStarted,
        manual: true,
      };
      roundsLog.push(record);
      yield emit('repair_round', record);
      stoppedReason = '只重画的输出无法拼成程序';
      break;
    }

    const next = await dryRunImpl({ slots: nextProgram.slots, entry, meta });
    report = next.report;
    program = nextProgram;
    const record = {
      round,
      mode: 'draw',
      requested: ['drawFrame'],
      updated: ['drawFrame'],
      kept: SLOT_KEY_NAMES.filter((k) => k !== 'drawFrame'),
      unchanged: [],
      triggeringChecks,
      diagnostics: [],
      verdict: report?.verdict ?? 'fail',
      ms: Date.now() - stageStarted,
      manual: true,
    };
    roundsLog.push(record);
    yield emit('stage_done', {
      stage: 'repair',
      round,
      chars: newDraw.length,
      ms: record.ms,
      chunks: 0,
      merged: false,
      manual: true,
    });
    yield emit('repair_round', record);
    yield emit('dryrun_done', {
      verdict: report?.verdict ?? 'fail',
      cancelled: Boolean(report?.cancelled),
      checks: report?.checks ?? [],
      extensions: report?.extensions ?? [],
      diagnostics: report?.diagnostics ?? [],
      program: { ...program, mode: 'BOTH' },
      labelAvoid: report?.labelAvoid ?? null,
      round,
    });
    if (report?.verdict === 'pass') {
      stoppedReason = null;
      break;
    }
    if (round === maxRounds) stoppedReason = `达到只重画上限 ${maxRounds} 轮`;
  }

  const rounds = roundsLog.length;
  const banner = buildBanner({
    verdict: report?.verdict ?? 'fail',
    rounds,
    report,
    slots: program.slots,
    reason: stoppedReason,
  });
  if (rounds) {
    yield emit('repair_done', {
      rounds,
      verdict: report?.verdict ?? 'fail',
      converged: report?.verdict === 'pass',
      banner,
      stoppedReason,
      updates: roundsLog.map((r) => ({ round: r.round, updated: r.updated, verdict: r.verdict })),
    });
  }
  yield emit('run_done', {
    verdict: report?.verdict ?? 'fail',
    ms: Date.now() - started,
    delivery: deliveryShape(program.slots),
    banner,
    rounds,
    readProblemText: readProblem,
    analysisText: formatAnalysis(analysis),
    manual: true,
  });
}
