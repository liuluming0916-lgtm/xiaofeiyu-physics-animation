import { readFileSync, writeFileSync } from 'node:fs';

const q = JSON.parse(readFileSync('tests/real-exam/pilot.json', 'utf8')).items.find((x) => x.id === 'q06');

const slots = {
  PROBLEM: q.problem,
  STEPS: `title: 开关闭合：金属棒加速到最大速度
tex: $S$ 闭合时，金属棒切割磁感线产生感应电动势 $E=BLv$，感应电流 $I=E/R$，安培力 $F_A=BIL=B^2L^2v/R$，方向向左。外力恒定向右，当 $F=F_A$ 时速度达到最大值 $v_0$。外力功率 $P_F=Fv$，定值电阻功率 $P_R=I^2R$。令 $P_F=2P_R$，代入 $F=B^2L^2v_0/R$，得 $v=v_0/2$。
t0: 0
t1: 2

title: 断开开关：电容充电
tex: 在速度为 $v$ 时断开 $S$，金属棒、电阻 $R$ 与电容 $C$ 串联。金属棒匀速运动时，感应电动势 $E=BLv$ 不变，电容两端电压趋于 $U=BLv$。当外力功率为定值电阻功率两倍时，由 $P_F=2P_R$ 得 $U=BLv_0/4$。
t0: 2
t1: 3

title: 从断开到此刻外力做的功
tex: 电容储能增加，同时电阻消耗能量；由能量守恒可得外力做功 $W=CB^2L^2v_0^2/8$。
t0: 3
t1: 4`,
  ANSWERS: `symbol: v_ratio
value: 0.5
unit: v0
tol: 0.01
at_t: 2
step: 1

symbol: U_ratio
value: 0.25
unit: BLv0
tol: 0.01
at_t: 3
step: 2

symbol: W_ratio
value: 0.125
unit: CB^2L^2v0^2
tol: 0.01
at_t: 3.8
step: 3`,
  VIEW: `SIM = {
  duration: 4,
  bodies: [
    { id: "rod", at: function (s) { const b = s.rod; return [b.cx ?? b.x, b.cy ?? b.y]; } }
  ],
  phases: [{ t0: 0, t1: 2 }, { t0: 2, t1: 4 }],
};`,
  setup: `const V0 = 1;
const TAU = 0.65;
const T_OPEN = 2;
const X0 = 3.8;
const X_OPEN = X0 + V0 * (T_OPEN + TAU * (Math.exp(-T_OPEN / TAU) - 1));`,
  stateAt: `const state = {};
const tt = Math.max(0, Math.min(t, 4));
let x, v, sw, I, Uc;
if (tt < T_OPEN) {
  v = V0 * (1 - Math.exp(-tt / TAU));
  x = X0 + V0 * (tt + TAU * (Math.exp(-tt / TAU) - 1));
  sw = 1;
  I = v;
  Uc = 0;
} else {
  const dt = tt - T_OPEN;
  v = V0 / 2;
  x = X_OPEN + v * dt;
  sw = 0;
  I = 0.5 * Math.exp(-dt / 0.35);
  Uc = 0.5 * V0 * (1 - Math.exp(-dt / 0.35));
}
state.rod = { x: x, y: 1.7, type: 'conductor_rod', cx: x, cy: 1.7, w: 0.18, h: 1.0 };
state.v = v;
state.S = sw;
state.I = I;
state.Uc = Uc;
return state;`,
  drawFrame: `const rod = state.rod;
const top = 2.2;
const bot = 1.2;
const left = 0.8;

// 导轨与左侧电路
Draw.line([left, top], [9.0, top]);
Draw.line([left, bot], [9.0, bot]);
Draw.line([left, bot], [left, top]);

// 定值电阻 R
Draw.box([2.0, top], 0.8, 0.16);

// 开关 S（在左侧竖线上）
const sy = 1.72;
if (state.S) {
  Draw.line([left, bot], [left, top]);
} else {
  Draw.line([left, bot], [left, sy - 0.12]);
  Draw.line([left, sy + 0.12], [left, top]);
  Draw.line([left, sy - 0.12], [left + 0.18, sy + 0.18]);
}

// 电容 C 支路
Draw.line([left, top], [1.25, top]);
Draw.line([left, bot], [1.25, bot]);
Draw.line([1.25, top], [1.25, 1.62]);
Draw.line([1.25, bot], [1.25, 1.50]);
Draw.line([1.06, 1.62], [1.44, 1.62]);
Draw.line([1.06, 1.50], [1.44, 1.50]);

// 磁场区（叉号）
Draw.fieldDots([3.2, 1.3], { w: 5.4, h: 0.8, nx: 9, ny: 4, symbol: 'cross' });

// 金属棒
Draw.box([rod.cx, rod.cy], rod.w, rod.h);

// 外力（向右）
Draw.arrow([rod.cx, rod.cy], [0.7, 0], { category: 'force' });`,
  readouts: `return [
  { key: 'v', label: '金属棒速度', value: state.v, unit: 'v0' },
  { key: 'x', label: '金属棒位置', value: state.rod.x, unit: 'm' },
  { key: 'I', label: '感应电流', value: state.I, unit: 'I0' },
  { key: 'Uc', label: '电容电压', value: state.Uc, unit: 'BLv0' },
];`,
};

const program = { id: 'q06', index: 6, title: q.title, examPoint: '电磁感应与电容', mode: 'NUMERIC', slots };
writeFileSync('tests/real-exam/q06.program.json', JSON.stringify(program, null, 2));
writeFileSync('tests/real-exam/q06.mjs', `import data from './q06.program.json' with { type: 'json' };\n\nexport default data;\n`);
console.log('wrote q06 program');
