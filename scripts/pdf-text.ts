/** 把 PDF 的正文抽出来（pdfjs-dist，跑在 Node 里） */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
const out = process.argv[3] ?? '开源日志/_check/pdf.txt';
if (!src) {
  console.error('用法：node scripts/pdf-text.ts <pdf> [输出txt]');
  process.exit(2);
}

const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
const data = new Uint8Array(readFileSync(src));
const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;

const pages: string[] = [];
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const content = await page.getTextContent();
  let lastY: number | null = null;
  let line = '';
  const lines: string[] = [];
  for (const item of content.items as any[]) {
    if (typeof item.str !== 'string') continue;
    const y = Math.round(item.transform?.[5] ?? 0);
    if (lastY !== null && Math.abs(y - lastY) > 6) {
      lines.push(line.trimEnd());
      line = '';
    }
    line += item.str;
    lastY = y;
  }
  if (line.trim()) lines.push(line.trimEnd());
  pages.push(`===== 第 ${i} 页 =====\n${lines.join('\n')}`);
}

const text = pages.join('\n\n');
writeFileSync(out, text, 'utf8');
console.log(`页数 ${doc.numPages}，字符 ${text.length}，已写入 ${path.resolve(out)}`);
