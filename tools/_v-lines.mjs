import { readFileSync } from 'node:fs';
const t = readFileSync('tests/regression-15/q02-incline-arc-projectile.mjs', 'utf8');
const count = (key) => {
  const i = t.indexOf('    ' + key + ': String.raw`');
  const j = t.indexOf('`,\n', i);
  return { lines: t.slice(i, j).split('\n').length };
};
const sa = count('stateAt').lines;
const df = count('drawFrame').lines;
const su = count('setup').lines;
console.log('stateAt', sa, '| drawFrame', df, '| setup', su, '| stateAt+drawFrame =', sa + df, '/ 150');
