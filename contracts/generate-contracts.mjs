#!/usr/bin/env node
/**
 * contracts:gen —— 生成冻结契约产物。
 *
 * 输入：contracts/spec/*.mjs（唯一事实来源）
 * 输出：contracts/*.schema.json（JSON Schema 2020-12）
 *       contracts/types/*.d.ts（TypeScript 类型）
 *       contracts/manifest.json（每份产物的 SHA256 + 合并契约哈希，供 Provenance 烧录）
 *
 * 生成前先跑编译期不变量断言：破坏 §3.2 / §9.1 / §12 口径的改动会让本脚本失败。
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTRACT_SPECS } from './spec/contract-fields.mjs';
import { assertContractInvariants, compileJsonSchema, compileTypeScript } from './_compile.mjs';
import {
  SLOT_KEY_NAMES,
  TEMPLATE_VERSION,
  SDK_VERSION,
  KNOWLEDGECARD_ENUMS,
} from './spec/frozen-keys.mjs';
import { EVIDENCE_PRECISIONS, PRECISION_LABELS, PRECISION_GUIDANCE } from './spec/diagnostic.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = join(HERE, '..');

function writeJson(absPath, value) {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(absPath, text) {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, text, 'utf8');
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 纯函数：返回 { 相对路径: 文件内容 }，便于 verify 脚本在内存里比对 */
export function buildContractArtifacts() {
  const problems = assertContractInvariants(CONTRACT_SPECS);
  if (problems.length) {
    const err = new Error(`契约不变量断言失败（${problems.length} 条）：\n- ${problems.join('\n- ')}`);
    err.problems = problems;
    throw err;
  }

  const files = {};
  const contracts = [];

  for (const spec of CONTRACT_SPECS) {
    const schemaRel = `contracts/${spec.id}.schema.json`;
    const typesRel = `contracts/types/${spec.id}.d.ts`;
    const schemaText = `${JSON.stringify(compileJsonSchema(spec), null, 2)}\n`;
    const typesText = compileTypeScript(spec);
    files[schemaRel] = schemaText;
    files[typesRel] = typesText;
    contracts.push({
      id: spec.id,
      root: spec.root,
      schema: schemaRel,
      types: typesRel,
      schemaSha256: sha256(schemaText),
      typesSha256: sha256(typesText),
    });
  }

  // 八键名清单单独落一份 JSON，供模板/预检/前端在不解析 Schema 的情况下复用
  const slotKeysRel = 'contracts/slot-keys.json';
  files[slotKeysRel] = `${JSON.stringify(
    {
      frozen: true,
      note: '§3.2 冻结键序（8 个，大小写敏感）。顺序不可调换。',
      conceptSlotCount: 7,
      keys: [...SLOT_KEY_NAMES],
      marker: { prefix: '/* @slot:', end: '/* @end */' },
    },
    null,
    2,
  )}\n`;

  // 世界书槽位名 = 目标阶段名（§9.1），同样单独落一份便于跨端复用
  const slotNamesRel = 'contracts/knowledgecard-slot-names.json';
  files[slotNamesRel] = `${JSON.stringify(
    {
      frozen: true,
      note: '§9.1 世界书槽位名 = 目标阶段名；scene_spec 是 v2 旧名，不得进入枚举。',
      insertionSlots: ['solve', 'scene_code'],
      importAliases: { scene_spec: 'scene_code', both: ['solve', 'scene_code'] },
      enums: {
        origin: [...KNOWLEDGECARD_ENUMS.origin],
        category: [...KNOWLEDGECARD_ENUMS.category],
        secondaryLogic: [...KNOWLEDGECARD_ENUMS.secondaryLogic],
        priority: [...KNOWLEDGECARD_ENUMS.priority],
      },
    },
    null,
    2,
  )}\n`;

  // 三档证据强度单独落一份 JSON（第 4 期）：诊断的 `precision` 是**跨端共用**的枚举，
  // 自愈回灌（core/repair）、报告渲染（前端）与总览页都要用它，不该各自抄一遍字符串。
  const evidenceRel = 'contracts/diagnostic-evidence.json';
  files[evidenceRel] = `${JSON.stringify(
    {
      frozen: true,
      note:
        '三档证据强度（第 4 期写入契约）。顺序即"可信度从高到低"，不得重排；' +
        '回灌给模型时必须带上 guidance，否则模型会照着"候选行"改代码（§14.5 风险 3）。',
      sourceOfTruth: 'contracts/spec/diagnostic.mjs',
      contract: 'contracts/diagnostic-record.schema.json',
      precisions: EVIDENCE_PRECISIONS.map((id) => ({
        id,
        label: PRECISION_LABELS[id],
        guidance: PRECISION_GUIDANCE[id],
      })),
    },
    null,
    2,
  )}\n`;

  const manifest = {
    format: 'od-contracts-manifest',
    version: 1,
    generator: 'contracts/generate-contracts.mjs',
    sourceOfTruth: 'contracts/spec/',
    templateVersion: TEMPLATE_VERSION,
    sdkVersion: SDK_VERSION,
    frozenBy: '物理解题动画软件 v1.0 自研方案 §3.2 / §3.3 / §9.1 / §11.1 / §12',
    contracts,
    slotKeys: slotKeysRel,
    knowledgecardSlotNames: slotNamesRel,
    diagnosticEvidence: evidenceRel,
  };
  // contractHash：对"不含 contractHash 字段"的清单做 SHA256，可复现、与时间无关
  const hashBase = { ...manifest };
  const contractHash = sha256(JSON.stringify(hashBase));
  const manifestText = `${JSON.stringify({ ...hashBase, contractHash }, null, 2)}\n`;
  files['contracts/manifest.json'] = manifestText;

  return files;
}

function main() {
  let files;
  try {
    files = buildContractArtifacts();
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
  const written = [];
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(PROJECT_ROOT, rel);
    if (rel.endsWith('.json')) writeJson(abs, JSON.parse(text));
    else writeText(abs, text);
    written.push(relative(PROJECT_ROOT, abs).replace(/\\/g, '/'));
  }
  const manifest = JSON.parse(files['contracts/manifest.json']);
  console.log(`✓ 契约生成完成，共 ${written.length} 份产物`);
  console.log(`  契约哈希 contractHash = ${manifest.contractHash}`);
  for (const c of manifest.contracts) console.log(`  · ${c.id} → ${c.schema} + ${c.types}`);
  console.log(`  · 冻结键序（8）：${SLOT_KEY_NAMES.join(' · ')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
