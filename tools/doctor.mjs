#!/usr/bin/env node
/**
 * 执行环境自检：确认运行时是否可用的**真 Node**、依赖是否就位。
 * 交付与排障时先跑它。
 *
 * ⚠ 2026-10 迁移到 DeepSeek Harness 后：`OD_NODE_BIN` 不再被注入，
 * 因此本文件不再把它当成"本机固有配置"，而是当成一条**可能存在的宿主提示**如实显示。
 * 运行时解析的唯一入口是 `tools/node-bin.mjs`（详见该文件头的说明）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT } from './paths.mjs';
import { resolveNodeBin, resolveNpmCli, isRealNode } from './node-bin.mjs';

export function main() {
  const lines = [];
  const { bin, source } = resolveNodeBin();
  lines.push(`运行时：${bin}`);
  lines.push(`  来源：${source}　本进程版本：${process.version}`);
  if (source === 'PATH') {
    lines.push('  ⚠ 只能回退到 PATH 上的 node；若脚本报"管道捕获 EPERM"或网络异常，请设 OD_REAL_NODE 指向真正的 node.exe');
  }
  const odNode = process.env.OD_NODE_BIN;
  lines.push(
    `  OD_NODE_BIN（宿主注入的运行时提示）：${
      odNode
        ? `${odNode}${isRealNode(odNode) ? '（是真 Node）' : '（非 Node，已绕过）'}`
        : '未设置（迁移到 DeepSeek Harness 后的正常情况，解析走 execPath / toolchain / PATH）'
    }`,
  );

  const npmCli = resolveNpmCli();
  lines.push(`npm CLI：${npmCli ?? '未找到'}`);

  const deps = ['acorn'];
  lines.push('依赖：');
  for (const name of deps) {
    const dir = join(PROJECT_ROOT, 'node_modules', name);
    if (!existsSync(dir)) {
      lines.push(`  ✗ ${name} 未安装`);
      continue;
    }
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      lines.push(`  ✓ ${name}@${pkg.version}`);
    } catch {
      lines.push(`  ✓ ${name}（版本不可读）`);
    }
  }

  const vendorDir = join(PROJECT_ROOT, 'template', 'vendor', 'tex-svg');
  const vendorManifest = join(vendorDir, 'manifest.json');
  if (existsSync(vendorManifest)) {
    try {
      const m = JSON.parse(readFileSync(vendorManifest, 'utf8'));
      const total = (m.questions ?? []).reduce((n, q) => n + q.formulas, 0);
      lines.push(`MathJax：已预渲染 ${m.questions?.length ?? 0} 题 / ${total} 条公式（${m.renderer}）`);
    } catch {
      lines.push('MathJax：预渲染清单存在但无法解析');
    }
  } else {
    lines.push('MathJax：尚未预渲染（跑 node tools/build-tex-svg.mjs）');
  }

  console.log(lines.join('\n'));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main();
}
