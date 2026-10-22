/** 一次性：骨架不做之后，修正 pilot.json 里“留给骨架”的措辞。 */
import { readFileSync, writeFileSync } from 'node:fs';

const f = 'tests/real-exam/pilot.json';
const p = JSON.parse(readFileSync(f, 'utf8'));

const q6 = p.items.find((x) => x.id === 'q06');
q6.knownGaps = [
  '画面是扁条（约 1.6 / 6 格）—— 骨架已决定不做，扁条是预期结果',
  '开关没有闭合/断开的状态切换 —— 现版本不需要',
  '电阻仍是矩形块（电容/开关已并联）—— 电路符号留到下一期补卡',
];

const q9 = p.items.find((x) => x.id === 'q09');
q9.knownGaps = [
  '卡销位置与活塞行程对不齐（词表里没有“卡销”这个元件）—— 留到下一期补卡',
  '汽缸比例偏细 —— 骨架已决定不做，属预期',
  '外力箭头是用 line + polygon 手画的，不是 Draw.arrow',
];

writeFileSync(f, `${JSON.stringify(p, null, 2)}\n`, 'utf8');
console.log('knownGaps updated');
