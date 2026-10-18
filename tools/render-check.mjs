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

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { renderQuestion } from '../tests/harness/canvas-harness.mjs';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUESTION_DIR = join(PROJECT_ROOT, 'tests', 'regression-15');

export async function main() {
  const files = readdirSync(QUESTION_DIR).filter((f) => f.endsWith('.mjs')).sort();
  let failures = 0;
  console.log('render-check · mock canvas 播放路径 + 相机不变量');
  for (const file of files) {
    const program = (await import(pathToFileURL(join(QUESTION_DIR, file)).href)).default;
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
      // 同一时刻只切 mask.trace，比较真正回放（painted）的命令数
      const paintWith = (traceOn) => {
        player.state.mask.trace = traceOn;
        player.state.t = player.duration * 0.6;
        return player.render().painted;
      };
      const traceOn = paintWith(true);
      const traceOff = paintWith(false);
      const traceDelta = traceOn - traceOff;

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
        traceDelta >= 1 &&
        !longText.length &&
        !symbolicArrows.length;
      if (!ok) failures += 1;
      console.log(
        `  ${ok ? '✓' : '✗'} ${String(program.index).padStart(2, '0')} ${program.title.padEnd(16, '　')} ` +
          `时长 ${player.duration.toFixed(2)}s · 采样 ${frames.length} 帧 · 命令 ${frames[0].commands}–${Math.max(...frames.map((f) => f.commands))} · ` +
          `画笔调用 ${paintCalls} · 相机 ${frames[0].transform.toFixed(1)} px/m 锁定 · 轨迹开关 ±${traceDelta} 条 · 长小数 ${longText.length} 处` +
          (program.mode === 'SYMBOLIC' ? ` · 符号标注缺口 ${symbolicArrows.length} 处` : '') +
          (ok
            ? ''
            : ` · 异常：空帧 ${empty.length} / 无读数 ${noReadouts.length} / 非法缩放 ${bad.length} / ` +
              `相机漂移 ${cameraDrift.length} 帧 / 轨迹开关无效（差 ${traceDelta}）` +
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
      console.log(`  ✗ ${String(program.index).padStart(2, '0')} ${program.title} — ${err.message}`);
    }
  }
  console.log(
    failures
      ? `\n✗ ${failures} 道题渲染路径异常`
      : `\n✓ ${files.length} 道题渲染路径全部正常，相机全时段锁定（§4.6），"轨迹"开关均能改变画面`,
  );
  if (failures) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  Promise.resolve(main()).catch((err) => {
    console.error(`✗ ${err?.stack ?? err}`);
    process.exit(1);
  });
}
