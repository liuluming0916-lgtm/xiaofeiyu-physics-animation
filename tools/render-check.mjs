#!/usr/bin/env node
/**
 * render-check —— 用 mock canvas 跑全部回归题的**模板页播放路径**。
 *
 * 与 Dry-Run 的分工：
 *   Dry-Run      证明"物理与契约正确"（C1–C10，不渲染）
 *   render-check 证明"命令缓冲能变成屏幕像素"（AutoView 变换 + 画笔调用）
 *
 * 除连通性外，这里还强制一条**相机不变量**（§4.6）：全时段 `transform` 必须逐帧完全一致。
 * 相机若随物体移动而变化，就说明又退回成了"逐帧取景"，固定不动的地面/斜面会跟着晃。
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderQuestion } from '../tests/harness/canvas-harness.mjs';
import { loadSuite, parseSuiteArgs } from '../core/dryrun/question-sources.mjs';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function main() {
  const { suite, filters } = parseSuiteArgs(process.argv.slice(2));
  const { items, audit } = await loadSuite(suite, filters);
  let failures = 0;
  if (audit?.errors?.length) {
    console.error(`✗ 真题清单体检未过（${audit.errors.length} 条）：`);
    for (const e of audit.errors) console.error(`    · [${e.code}] ${e.detail}`);
    process.exitCode = 1;
    failures += 1;
  }
  console.log(`render-check · mock canvas 播放路径 + 相机不变量（套件 ${suite} · ${items.length} 题）`);
  for (const { program, suite: s } of items) {
    try {
      const { frames, paintCalls, player, canvas } = renderQuestion(program);
      const empty = frames.filter((f) => f.commands === 0);
      const noReadouts = frames.filter((f) => f.readouts === 0);
      const bad = frames.filter((f) => !Number.isFinite(f.transform) || f.transform <= 0);

      // 相机不变量：缩放与中心在全时段必须完全一致
      const first = frames[0];
      const cameraDrift = frames.filter(
        (f) =>
          Math.abs(f.transform - first.transform) > 1e-9 ||
          Math.abs(f.camera.x - first.camera.x) > 1e-9 ||
          Math.abs(f.camera.y - first.camera.y) > 1e-9,
      );

      // "轨迹"开关必须真的改变画面（用户反馈"大部分题轨迹未实装"）：
      // 同一时刻只切 mask.trace，比较真正回放（painted）的命令数。
      //
      // ⚠ 判据按**套件**分档（v1.1.18 B8）：
      //   · 合成 15 道是手写夹具，用户明确要求"轨迹开关要有效" ⇒ **必须**有差。
      //   · 真题是模型产出，`scene_code` 提示词里没有"画轨迹"这条要求 ⇒ 只要求
      //     **"用了 Draw.trace 就必须生效"**；没用就记"无轨迹（不适用）"，不算失败。
      //     把"必须有轨迹"加给真题，等于改提示词，那是 1.1.19 的事。
      const paintWith = (traceOn) => {
        player.state.mask.trace = traceOn;
        player.state.t = player.duration * 0.6;
        return player.render().painted;
      };
      const traceOn = paintWith(true);
      const traceOff = paintWith(false);
      const traceDelta = traceOn - traceOff;
      const usesTrace = /Draw\.trace\b/.test(String(program.slots?.drawFrame ?? ''));
      const traceOk = s !== 'real-exam' || usesTrace ? traceDelta >= 1 : true;

      // 画布文字与读数显示串里不得出现长小数（用户反馈"画面上直接摆十几位小数"）。
      // 注意：readouts 的 **原始值** 保持全精度（C7 要按容差比对），这里查的是**显示串**。
      // 长小数扫描：必须查**真正画到画布上的字符串**（`fillText` / `strokeText` 的实参）。
      // 只查命令记录会漏掉渲染器内部拼出来的文字 —— 箭头标签 `label = mag unit` 就是这么漏掉的
      // （q04/q07/q13 一度在画布上印出 `v = 3.385926899562456 m/s`）。
      // 判据按**有效数字**算而不是按小数位数：`0.00347` 是 3 位有效数字的正确输出。
      const longText = [];
      const hasLongNumber = (s) => {
        const nums = String(s).match(/\d+\.\d+/g);
        return !!nums && nums.some((n) => n.replace('.', '').replace(/^0+/, '').length > 4);
      };
      const painted = canvas.__calls.length;
      for (let k = 0; k <= 6; k += 1) {
        player.state.t = (player.duration * k) / 6;
        const fr = player.render();
        for (const rec of fr.records) {
          const s = rec.op === 'text' ? rec.text : rec.op === 'latex' ? rec.tex : rec.op === 'dimension' ? rec.text : null;
          if (typeof s === 'string' && hasLongNumber(s)) longText.push(s);
        }
        for (const r of fr.readouts) {
          const shown = `${r.label || r.key} ${player.runtime.format(r.value, r.unit || '', 3)}`;
          if (hasLongNumber(shown)) longText.push(shown);
        }
      }
      for (const call of canvas.__calls.slice(painted)) {
        if (call.op !== 'fillText' && call.op !== 'strokeText') continue;
        for (const s of call.texts || []) if (hasLongNumber(s)) longText.push(s);
      }

      // §18 期 3 的验收条件之一：「纯符号题能播且**标注全为符号**」。
      // 判据取"可机检的那一半"：SYMBOLIC 题的**画布矢量箭头必须都带 `latex`**
      //（画布可绘制的符号文本）。理由：`latex` 一旦给了，渲染器就**只画符号、不缀数值**
      //（见 `sdk/runtime/animation-runtime.mjs` 的 drawArrow），因此"箭头全带 latex"
      // 就等价于"箭头标注全为符号"。
      //
      // 刻意**不去正则扫画布文字里的数字** —— 那会误伤几何标注（`θ=30°`、坐标刻度、`2d`）。
      // 判据要么可机检、要么不做，不做"看起来在检查"的检查。
      const symbolicArrows = [];
      if (program.mode === 'SYMBOLIC') {
        for (let k = 0; k <= 6; k += 1) {
          player.state.t = (player.duration * k) / 6;
          const fr = player.render();
          for (const rec of fr.records) {
            if (rec.op !== 'arrow') continue;
            if (!rec.label) continue; // 没有标签的箭头不必给符号文本
            if (!(typeof rec.latex === 'string' && rec.latex.length)) symbolicArrows.push({ t: fr.t, label: rec.label });
          }
        }
      }

      const ok =
        !empty.length &&
        !noReadouts.length &&
        !bad.length &&
        !cameraDrift.length &&
        traceOk &&
        !longText.length &&
        !symbolicArrows.length;
      if (!ok) failures += 1;
      const traceText = s === 'real-exam' && !usesTrace ? '无轨迹（真题，不适用）' : `±${traceDelta} 条`;
      console.log(
        `  ${ok ? '✓' : '✗'} [${s === 'real-exam' ? '真题' : '合成'}] ${String(program.index).padStart(2, '0')} ${program.title.padEnd(16, '　')} ` +
          `时长 ${player.duration.toFixed(2)}s · 采样 ${frames.length} 帧 · 命令 ${frames[0].commands}–${Math.max(...frames.map((f) => f.commands))} · ` +
          `画笔调用 ${paintCalls} · 相机 ${frames[0].transform.toFixed(1)} px/m 锁定 · 轨迹开关 ${traceText} · 长小数 ${longText.length} 处` +
          (program.mode === 'SYMBOLIC' ? ` · 符号标注缺口 ${symbolicArrows.length} 处` : '') +
          (ok
            ? ''
            : ` · 异常：空帧 ${empty.length} / 无读数 ${noReadouts.length} / 非法缩放 ${bad.length} / ` +
              `相机漂移 ${cameraDrift.length} 帧 / ${traceOk ? '轨迹开关正常' : `轨迹开关无效（差 ${traceDelta}）`}` +
              (longText.length ? ` / 长小数示例 ${JSON.stringify(longText[0].slice(0, 48))}` : '') +
              (symbolicArrows.length
                ? ` / SYMBOLIC 箭头缺 latex 示例 t=${symbolicArrows[0].t.toFixed(2)} label=${JSON.stringify(symbolicArrows[0].label)}`
                : '')),
      );
      if (cameraDrift.length) {
        const d = cameraDrift[0];
        console.log(`      相机漂移示例：t=${d.t.toFixed(2)} scale=${d.transform.toFixed(3)}，首帧=${first.transform.toFixed(3)}`);
      }
    } catch (err) {
      failures += 1;
      console.log(`  ✗ [${s === 'real-exam' ? '真题' : '合成'}] ${String(program.index).padStart(2, '0')} ${program.title} — ${err.message}`);
    }
  }
  console.log(
    failures
      ? `\n✗ ${failures} 道题渲染路径异常`
      : `\n✓ ${items.length} 道题渲染路径全部正常（套件 ${suite}），相机全时段锁定（§4.6）；` +
          `合成题"轨迹"开关均能改变画面，真题若用了 Draw.trace 也必生效`,
  );
  if (failures) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  Promise.resolve(main()).catch((err) => {
    console.error(`✗ ${err?.stack ?? err}`);
    process.exit(1);
  });
}
