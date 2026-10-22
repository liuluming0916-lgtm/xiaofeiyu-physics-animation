#!/usr/bin/env node
/**
 * 真实高考题题库自检（试点三道）。
 * 用法：node tools/check-real-exam.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const DIR = join(ROOT, 'tests', 'real-exam');
const data = JSON.parse(readFileSync(join(DIR, 'pilot.json'), 'utf8'));
let pass = 0;
const fail = [];
const check = (name, ok, detail = '') => {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? `（${detail}）` : ''}`);
  }
};

console.log('real-exam 题库自检 · 试点三道');
check('题库格式正确', data.format === 'od-real-exam' && data.version === 1);
check('试点正好三道', data.items.length === 3, String(data.items.length));
check('题号唯一', new Set(data.items.map((x) => x.id)).size === data.items.length);
for (const q of data.items) {
  check(`${q.id} 有题面`, typeof q.problem === 'string' && q.problem.length > 100, `${q.problem?.length ?? 0} 字`);
  check(`${q.id} 有答案`, Array.isArray(q.answer) && q.answer.length > 0);
  check(`${q.id} 有知识点`, Array.isArray(q.knowledge) && q.knowledge.length > 0);
  check(`${q.id} 有原卷页码`, Number.isInteger(q.pdfPage) && q.pdfPage > 0);
  check(`${q.id} 有题图`, existsSync(join(DIR, q.image)), q.image);
  check(`${q.id} 状态合法`, ['pilot', 'candidate', 'accepted', 'rejected'].includes(q.status));
  /* 已通过的题必须留痕：谁产的、什么时候、程序在不在 */
  if (q.status === 'accepted') {
    check(`${q.id} accepted 有 source`, q.source === 'model' || q.source === 'handwritten', String(q.source ?? '缺'));
    check(`${q.id} accepted 有 acceptedAt`, /^\d{4}-\d{2}-\d{2}$/.test(String(q.acceptedAt ?? '')), String(q.acceptedAt ?? '缺'));
    check(`${q.id} accepted 程序存在`, q.program && existsSync(join(DIR, q.program)), String(q.program ?? '缺'));
    check(`${q.id} accepted 预览存在`, q.preview && existsSync(join(DIR, q.preview)), String(q.preview ?? '缺'));
  }
}

console.log(`\n${fail.length ? '✗' : '✓'} 通过 ${pass}，失败 ${fail.length}`);
if (fail.length) {
  for (const f of fail) console.log(`  ✗ ${f.name}\n      ${f.detail}`);
  process.exit(1);
}
