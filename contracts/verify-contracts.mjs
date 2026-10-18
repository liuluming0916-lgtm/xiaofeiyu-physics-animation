#!/usr/bin/env node
/**
 * contracts:verify —— 校验"已落盘的契约产物"与"当前 spec 重新生成的结果"逐字节一致。
 *
 * 这是 §21.1 第 1 条（Schema 与类型必须同源生成）的守门人：
 * 只要有人手改了 `contracts/*.schema.json` 或 `contracts/types/*.d.ts`，
 * 或者改了 spec 却没重新生成，本脚本就会失败并指出具体文件。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROJECT_ROOT, buildContractArtifacts, sha256 } from './generate-contracts.mjs';

export function main() {
  let expected;
  try {
    expected = buildContractArtifacts();
  } catch (err) {
    console.error(`✗ 契约不变量断言失败：${err.message}`);
    process.exit(1);
  }

  const mismatches = [];
  const missing = [];
  for (const [rel, text] of Object.entries(expected)) {
    let actual;
    try {
      actual = readFileSync(join(PROJECT_ROOT, rel), 'utf8');
    } catch {
      missing.push(rel);
      continue;
    }
    if (sha256(actual) !== sha256(text)) mismatches.push(rel);
  }

  if (missing.length || mismatches.length) {
    if (missing.length) console.error(`✗ 缺少产物（请跑 contracts:gen）：\n  - ${missing.join('\n  - ')}`);
    if (mismatches.length) {
      console.error(`✗ 产物与 spec 不一致（被人手改过，或 spec 改了没重新生成）：\n  - ${mismatches.join('\n  - ')}`);
    }
    process.exit(1);
  }

  const manifest = JSON.parse(expected['contracts/manifest.json']);
  console.log(`✓ 契约产物与 spec 一致：${Object.keys(expected).length} 份产物，contractHash = ${manifest.contractHash}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  Promise.resolve(main()).catch((err) => {
    console.error(`✗ ${err?.stack ?? err}`);
    process.exit(1);
  });
}
