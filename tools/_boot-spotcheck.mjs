/** 一次性：抽查所有成品页的"能启动"关键点（与 layout-lint 独立复算一遍） */
import { readdirSync, readFileSync } from 'node:fs';

const files = readdirSync('template/build').filter((f) => f.endsWith('.html'));
let bad = 0;
for (const f of files) {
  const s = readFileSync(`template/build/${f}`, 'utf8');
  const runtimeCopies = (s.match(/window\.ODRuntime = Runtime/g) || []).length;
  const scripts = [...s.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const runtimeScript = scripts.find((c) => c.includes('window.ODRuntime = Runtime')) || '';
  const hasImport = /^\s*import\s/m.test(runtimeScript);
  const needs = ['data-od-id="stage-canvas"', 'data-od-id="problem-body"', 'data-od-id="steps-list"', 'data-od-id="readouts-grid"'];
  const missing = needs.filter((n) => !s.includes(n));
  const ok = runtimeCopies === 1 && !hasImport && !missing.length;
  if (!ok) {
    bad += 1;
    console.log(`✗ ${f}  运行时段数=${runtimeCopies} 含 import=${hasImport} 缺骨架=${missing.join(',') || '无'}`);
  }
}
console.log(bad ? `✗ ${bad}/${files.length} 个页面异常` : `✓ ${files.length} 个页面：运行时恰好一份、运行时无 import、三栏骨架齐全`);
