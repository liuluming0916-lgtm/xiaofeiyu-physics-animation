#!/usr/bin/env node
/**
 * Prompt 系统取证（v6 · 新链路）。
 *
 * 旧 8 槽位 / answers / scene_code 骨架的断言已随契约作废；
 * 这里只钉新链路真正依赖的东西：
 *   · 目录：analysis / scene_code / solve / breakdown（旧 answers 不再展示）；
 *   · analysis 只输出 MOTIONS；
 *   · scene_code / repair 只写 drawFrame，不再带 8 槽位骨架；
 *   · promptHash 覆盖新前缀且稳定。
 *
 * 用法：node tests/prompts-selftest.mjs
 */

import {
  buildStagePrefix,
  getPrompt,
  listPrompts,
  promptHashValue,
} from '../core/prompts/index.mjs';

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('Prompt 系统取证（v6）\n');

const ids = listPrompts().map((p) => p.id);
check('目录含 analysis', ids.includes('analysis'), ids.join(','));
check('目录含 scene_code', ids.includes('scene_code'), ids.join(','));
check('目录不再展示 answers', !ids.includes('answers'), ids.join(','));
check('目录不再展示 scene_code_legacy', !ids.includes('scene_code_legacy'), ids.join(','));

const analysis = getPrompt('analysis');
check('analysis 的 system 有 MOTIONS 区块', analysis.system.includes('=== 元件运动表 (MOTIONS) ==='));
check('analysis 不写 EVENTS', !analysis.system.includes('EVENTS'));
check('analysis 不写 ANSWERS', !analysis.system.includes('ANSWERS'));
check('analysis 有 6 个初态字段', analysis.system.includes('x0 / y0 / vx0 / vy0 / ax / ay'));
check('analysis user 不含分步讲解', !analysis.buildUser({ problem: 'p', solution: 's' }).includes('分步讲解'));

const scene = getPrompt('scene_code');
check('scene_code 只写 drawFrame', scene.system.includes('只输出 drawFrame 的函数体'));
check('scene_code 不再要求 8 槽位标记', !scene.system.includes('@slot:'));
check('scene_code 不写字', scene.system.includes('不写任何文字'));
check('scene_code 不画 v/a', scene.system.includes('不要画 v/a'));
check('scene_code 轨迹强制', scene.system.includes('每个有位移的运动元件都要用 `Draw.trace`'));
check('scene_code 不画 force', !scene.system.includes('force'));
const sceneUser = scene.buildUser({
  problem: 'p',
  analysisText: '=== 元件运动表 (MOTIONS) ===',
  branchTimes: [3.82645],
  stateMap: [{ id: 'block_A', key: 'block_A' }],
});
check('scene_code user 带分析表', sceneUser.includes('物理分析'));
check('scene_code user 带 state 映射', sceneUser.includes('block_A = block_A'));
check('scene_code user 带分支时刻', sceneUser.includes('3.82645'));

const repair = getPrompt('repair');
check('repair 只修 drawFrame', repair.system.includes('新的 drawFrame 函数体') || repair.system.includes('只修 drawFrame 的函数体'));
check('repair 禁止改 stateAt/VIEW/readouts', repair.system.includes('stateAt、VIEW、readouts'));
check('repair 去掉 cx/cy 负向提示', !repair.system.includes('cx/cy'));
check('repair 带分支规则', repair.system.includes('分支时刻') && repair.system.includes('Draw.trace'));
const repairUser = repair.buildUser({
  problem: 'p',
  analysisText: 'A',
  branchTimes: [3.82645],
  stateMap: [{ id: 'block_A', key: 'block_A' }],
  failures: ['C1：语法'],
  previousDrawFrame: 'Draw.ground(0, 1, 0);',
});
check('repair user 带失败检查', repairUser.includes('C1：语法'));
check('repair user 带上一轮 drawFrame', repairUser.includes('上一轮 drawFrame'));
check('repair user 带分支时刻', repairUser.includes('3.82645'));

const couple = getPrompt('couple');
check('couple 只输出 step/sub/t0/t1', couple.system.includes('step / sub / t0 / t1') || couple.system.includes('step: 1'));
check('couple 有“连续过程保持完整”的正面引导', couple.system.includes('同一个连续过程要保持完整'));
const coupleUser = couple.buildUser({
  problem: 'p',
  analysisText: '=== 元件运动表 (MOTIONS) ===',
  readProblem: '【小问切分】1\n组1：覆盖小问 1；初始条件：不变；',
  branchTimes: [3.82645],
  steps: [{ title: '第 1 步', tex: '加速' }],
  tPhys: 3,
});
check('couple user 带分析表', coupleUser.includes('物理分析表'));
check('couple user 带步骤', coupleUser.includes('第 1 步'));
check('couple user 带 T_phys', coupleUser.includes('3'));
check('couple user 带小问切分', coupleUser.includes('覆盖小问 1'));
check('couple user 带分支时刻', coupleUser.includes('3.82645'));

const preAnalysis = buildStagePrefix('analysis');
const preScene = buildStagePrefix('scene_code');
const preRepair = buildStagePrefix('repair');
const preCouple = buildStagePrefix('couple');
check('analysis 前缀无骨架/无 SDK', !preAnalysis.parts.skeleton && !preAnalysis.parts.sdk);
check('scene_code 前缀有 SDK、无骨架', Boolean(preScene.parts.sdk) && !preScene.parts.skeleton);
check('repair 前缀有 SDK、无骨架', Boolean(preRepair.parts.sdk) && !preRepair.parts.skeleton);
check('couple 前缀无骨架/无 SDK', !preCouple.parts.skeleton && !preCouple.parts.sdk);

const hash = promptHashValue();
check('promptHash 是 64 位十六进制', /^[0-9a-f]{64}$/.test(hash), hash);

console.log(`\n通过 ${passed}，失败 ${failures.length}`);
if (failures.length) process.exit(1);
