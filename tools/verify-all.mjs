#!/usr/bin/env node
/**
 * verify —— 一条命令跑完全部门禁（交付前自检 / CI 用）。
 *
 *   ① 契约同源校验   契约产物与 spec 一致（§21.1 第 1 条）
 *   ② SDK 签名摘要   签名摘要与 SDK 导出面一致（§4.5）
 *   ③ Dry-Run        §7.2 C1–C9 全量（第 2 期起跑在 Worker 沙箱里）
 *   ④ 负向注入验收   §18 期 2 的验收面：NaN / 瞬移 / 时间断裂 / 死循环 / require
 *   ⑤ 埋点自检       行号级诊断的地基：埋点不许挪行、装配后必须可编译
 *   ⑥ C1 判据取证    25 条 + ANSWERS 结构 6 条
 *   ⑦ 渲染路径自检   命令缓冲 → 屏幕像素这条链路
 *   ⑧ 公式预渲染     构建期 MathJax
 *   ⑨ 成品页打包     单文件 HTML + 题目列表
 *   ⑩ 成品页静态体检 自包含 / 三栏 / 焦点环 / 无内部滚动 / 可当经典脚本执行
 *   ⑪ 长度上限与观测 §6.2 / §20
 *   ⑫ 总览页生成     判定取自真实报告
 *   ⑬ 前端类型检查   第 3 期：web/ 的 TypeScript（tsc --noEmit，等价 web:typecheck）
 *   ⑭ 前端打包       第 3 期：web/ 的 Rollup 打包 + Tailwind + 产物体检（等价 web:build）
 *   ⑮ 契约跨字段校验 第 3 期：§11.2 九条 + §12 清洗规则，逐条正反例取证
 *   ⑯ 模型网关       第 3 期：SSE 流式 / 跨 chunk 缓冲 / 错误分类 / 超时与取消 / 图片多模态 / 视觉门控
 *                    （打**本地假端点**，结论确定性；详见 tests/fake-endpoint/server.mjs）
 *   ⑰ 标记切分清洗   第 3 期：§3.5 零猜测切分 / 四类硬失败区分 / **行号保真** / §12 兜底与灾难性形态拒绝
 *   ⑱ Prompt 系统    第 3 期：§10.2 三段结构 / **promptHash 语义**（换题换图都不变、改 Prompt 必变）
 *   ⑲ 编排           第 3 期：事件流与阶段链 / 每题配置快照 / **取消无残留** / 不静默交付 /
 *                    端到端（拿真题 q01 的槽位当"模型输出"跑完整链路，**真 Dry-Run 判一次**）
 *   ⑳ 宿主协议       第 3 期：§13.2 定稿 / **program 运行时注入** / source 方向判据 /
 *                    成品页拒绝覆盖（§13.1 导出保真）/ 协议文档与契约同源
 *   ㉑ 自愈与 C7 强化 第 4 期：M30 自愈循环（B1 收敛 / B2 上限 3 轮 / B3 槽位级重生成 /
 *                    B4 告警横幅交付 / B6 事件可见 / 修复途中取消）+ C7 强化四条
 *                    + **15 题 C7 判定与第 3 期逐题一致**（§14.4 的硬约束）
 *   ㉒ 知识卡         第 5 期：§9.2 触发六步（主键/次级/常驻/递归/三重预算/分槽组装/溯源）
 *                    + §9.3 origin 治理 + §9.5 导入导出 + 覆盖率（§19.3）
 *                    + **预览器与实际请求逐字节一致**（W10）+ 接线（每题快照 / knowledgecard_done / provenance）
 *   ㉓ 规则工作区     第 6 期：§16 的 `ai-rules/` 工作区底座 —— 每文件 SHA256、整批生效或整批失败、
 *                    未登记/哈希不符/体积超限一律拒绝并**点名到文件**、保存冲突拒绝、
 *                    写盘中途失败回滚、**热重载 = 下一题生效而跑着的题保持原快照**
 *   ㉔ Prompt 编辑器  第 6 期：§10.1 的 8 份正文按"会不会跑"分组（没接上主链路的必须明说）、
 *                    `read_problem` 删掉【考点】/【动画元件】**保存那一刻就红**（否则世界书静默退化）、
 *                    内置变更提醒 + 行级差异 + 换基线、**覆盖正文真的进了发给模型的 system 消息**
 *                    且**不改变 promptHash**
 *   ㉕ 清洗规则策略  第 6 期：§12 的内置最小集**锁定**（清单在代码里，有版本号、有理由、与实现不漂移）、
 *                    文件层/运行时/编辑器三条入口都绕不过、用户规则真的洗到槽位、
 *                    且锁定规则**关不掉**（`enabled:false` 会被判成策略破损而不是被忽略）
 *   ㉖ 端点配置      第 6 期：Key 单独存（`keys.json`）· 导出**结构性**不含 Key · 导入三种拒绝 ·
 *                    删除级联 · 孤儿 Key 降级报警 · 测试连接真发请求且出口脱敏
 *   ㉗ 总装验收      第 6 期：§18 第 6 行的验收原文，**一口气**跑完 —— 四类改动"下一题生效"且
 *                    跑着的题不受影响 · 导出不含任何 Key · 规则文件改坏时被拒并指出位置
 *                    （另含一次整机链路：Prompt 覆盖 + 清洗规则 + 端点同时生效）
 *   ㉘ 规则工作室服务 第 6 期：设置页背后的本机 HTTP 通道（真实起服务、真实发请求）
 *
 * 另有 **⓪ 覆盖自检**（在 ① 之前跑）：断言"仓内所有独立的检查脚本都已被本门禁挂载"。
 * 它防的是**新增检查忘了接进门禁** —— 那种情况下门禁全绿，而那个检查从未跑过；
 * **"绿着但没跑"比"红"更危险**。
 *
 * ⚠ 第 3 期起前端在 web/，**不是 Vite 而是 Rollup**（本沙箱禁止管道捕获子进程，
 *   Vite 5 有两处必须 spawn ⇒ EPERM，结构性不可用）。详见 web/rollup.config.mjs 顶部说明。
 *
 * 执行方式：默认**优先子进程**（隔离、可直接复用各脚本的 CLI 入口）；
 * 若运行环境禁止子进程管道（本沙箱会返回 EPERM），自动退化为**同进程导入**。
 * 两种方式跑的是同一份代码，结论一致。
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveNodeBin, nodeEnv } from './node-bin.mjs';
import { reportCoverage, readStepsFromVerifyAll } from './verify-coverage.mjs';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** 用真 Node（`OD_NODE_BIN` 可能指向 Electron 壳；解析与过滤见 tools/node-bin.mjs） */
const RUNTIME = resolveNodeBin().bin;

const STEPS = [
  ['① 契约同源校验', 'contracts/verify-contracts.mjs'],
  ['② SDK 签名摘要', 'sdk/generate-signature-summary.mjs'],
  ['③ Dry-Run C1–C9（合成 15 + 真题 8）', 'core/dryrun/run-suite.mjs --suite all'],
  ['④ 负向注入验收（§18 期 2）', 'tests/negative-injection/run-injection.mjs'],
  ['⑤ 埋点与行号映射自检', 'tests/instrument-selftest.mjs'],
  ['⑥ C1 判据取证', 'tests/lint-selftest.mjs'],
  ['⑦ 渲染路径自检（两套题）', 'tools/render-check.mjs --suite all'],
  ['⑧ 公式预渲染（MathJax）', 'tools/build-tex-svg.mjs'],
  ['⑨ 成品页打包', 'template/build-template.mjs'],
  ['⑩ 成品页静态体检', 'tools/layout-lint.mjs'],
  ['⑪ 长度上限与观测', 'tools/budget-check.mjs'],
  ['⑫ 总览页生成', 'tools/build-overview.mjs'],
  ['⑬ 前端类型检查（第 3 期）', 'tools/web-build.mjs --check'],
  ['⑭ 前端打包（第 3 期）', 'tools/web-build.mjs'],
  ['⑮ 契约跨字段校验取证（第 3 期 §11.2/§12）', 'tests/contract-validator-selftest.mjs'],
  ['⑯ 模型网关取证（第 3 期：流式/错误分类/图片多模态）', 'tests/gateway-selftest.mjs'],
  ['⑰ 标记切分清洗取证（第 3 期 §3.5/§12 + 行号保真）', 'tests/cleaner-selftest.mjs'],
  ['⑰-1 v6 analysis 表解析与表达式白名单', 'tests/analysis-selftest.mjs'],
  ['⑰-2 v6 analysis 生成程序槽位', 'tests/analysis-generate-selftest.mjs'],
  ['⑰-3 v6 analysis 接进主链路', 'tests/analysis-pipeline-selftest.mjs'],
  ['⑰-3b v6 视觉几何与中心点', 'tests/analysis-geometry-selftest.mjs'],
  ['⑰-3c 刚体朝向 angleDeg', 'tests/body-angle-selftest.mjs'],
  ['⑰-4 v6 drawFrame-only 自愈', 'tests/analysis-repair-selftest.mjs'],
  ['⑰-5 v6 步骤耦合解析', 'tests/couple-selftest.mjs'],
  ['⑰-6 v6 修复分类（画图 vs 物理）', 'tests/repair-classify-selftest.mjs'],
  ['⑰-7 v6 物理错误修复（重跑链路）', 'tests/analysis-physical-repair-selftest.mjs'],
  ['⑰-8 v6 读题标题', 'tests/read-problem-title-selftest.mjs'],
  ['⑰-9 视觉尺寸一致性（舞台 10×6；量级不同也不同大小）', 'tests/visual-size-selftest.mjs'],
  ['⑱ Prompt 系统取证（第 3 期 §10 + promptHash 语义）', 'tests/prompts-selftest.mjs'],
  ['⑲ 编排取证（第 3 期 §2.3：事件流/配置快照/取消无残留）', 'tests/orchestrator-selftest.mjs'],
  ['⑳ 宿主协议取证（第 3 期 §13.2 定稿 + program 注入）', 'tests/host-protocol-selftest.mjs'],
  [
    '㉑ v6 自愈循环取证（§8/§14.2 B1–B6：只重画 drawFrame · 上限 · 未收敛横幅）',
    'tests/repair-selftest.mjs',
  ],
  [
    '㉓ 规则工作区取证（第 6 期 §16：SHA256 / 整批失败 / 冲突拒绝 / 写盘回滚 / 热重载快照）',
    'tests/rules-selftest.mjs',
  ],
  [
    '㉔ Prompt 编辑器取证（第 6 期 §10.1/§10.3：分组不骗人 / 硬门禁不落盘 / 内置变更提醒 / 覆盖真的进了 system）',
    'tests/prompt-overrides-selftest.mjs',
  ],
  [
    '㉕ 清洗规则策略取证（第 6 期 §12：锁定集是数据且绕不过 / 三条入口全拒 / 用户规则真的洗到槽位）',
    'tests/cleaning-policy-selftest.mjs',
  ],
  [
    '㉖ 端点配置取证（第 6 期 §11/§16：Key 单独存 / 导出永不含 Key / 导入三种拒绝 / 测试连接脱敏）',
    'tests/endpoint-store-selftest.mjs',
  ],
  [
    '㉗ 第 6 期总装验收（§18 原文三条：四类改动下一题生效 / 导出无 Key / 改坏被拒并指出位置）',
    'tests/phase6-acceptance-selftest.mjs',
  ],
  [
    '㉘ 规则工作室服务取证（第 6 期第 5 项：真实 HTTP —— 能改 / 改坏被拒 / Key 不出门 / 跨源被拦）',
    'tests/rules-service-selftest.mjs',
  ],
  [
    '㉙ 备份与恢复取证（第 6 期第 3 件：滚动 5 份 / 恢复可撤销 / Key 永不备份 / 备份目录不被扫描）',
    'tests/backup-selftest.mjs',
  ],
  [
    '㉚ 联动图表与导读栏取证（第 7 期 §13.4/M15：游标读数==readouts(t) / 可切量 / 可隐藏 / 两栏显隐 / 选项卡跟随 / 画布 16:9）',
    'tests/chart-selftest.mjs',
  ],
  [
    '㉛ 导出取证（第 7 期 §14/M17：单文件网页自包含+Provenance 烧录 / GIF 帧数·末帧·延时·尺寸 / 落盘只走本机同端口）',
    'tests/export-selftest.mjs',
  ],
  [
    '㉝ 安全脱敏与观测取证（第 8 期 M21/M22：Key 与绝对路径脱敏 / 运行记录指标 / 失败复现包 / HTTP 真打）',
    'tests/observability-selftest.mjs',
  ],
  [
    '㉟ 历史与审计取证（第 8 期 M23：表结构与写入接口位 / Key 按字节不入库 / 审计留痕 / 驱动缺失要吵 / 界面无入口）',
    'tests/history-selftest.mjs',
  ],
  [
    '㊱ C2 接线与字体取证（第 8 期：注入面 / 引线形状 / 载荷链路 / 导出烧录 / 宋体+Times 含画布）',
    'tests/c2-wiring-selftest.mjs',
  ],
  [
    '㊲ 方案 A 取证（第 8 期：画布不再写文字 —— 数画布上印了什么字 / 轴名唯一例外 / 绿蓝红配色与画布外图例）',
    'tests/plan-a-textless-selftest.mjs',
  ],
  [
    '㊳ 发布构建开关取证（第 8 期：`OD_RELEASE=1` 时规则页/蒸馏页在产物里不存在、设置页在；含开发构建负对照与发布产物真跑）',
    'tests/release-switch-selftest.mjs',
  ],
  [
    '㊵ 矢量按类归一取证（第 8 期：同类长度比 == 量级比 / 跨类不混 / 力>速度>加速度 / 极小画点 / 包络同口径）',
    'tests/vector-normalize-selftest.mjs',
  ],
  [
    '㊶ 箭头参数口径取证（第 8 期 C1 判据 8：`mag` 必填 / 禁 `scale` / 禁 `color` / 三参必须是对象字面量）',
    'tests/arrow-contract-selftest.mjs',
  ],
  [
    '㊷ 桌面壳取证（第 8 期 M24：安全口径 / 先起服务再开 http / 打包配置 / 服务真跑）',
    'tests/electron-shell-selftest.mjs',
  ],
  [
    '㊸ 真跑链路取证（第 8 期补第 9 步：`/api/run` 前置报错 / SSE 事件流 / Key 不外泄 / 前端不再写死演示源）',
    'tests/run-endpoint-selftest.mjs',
  ],
  [
    '㊹ 长题归一与判据放宽（第 8 期用户裁决：150 行上限取消 / C2 4s→10s / 采样封顶 2400 帧且不改时长）',
    'tests/long-topic-selftest.mjs',
  ],
  [
    '㊺ C1 白名单与 C4 位移口径回归（第 8 期用户 AEB 真题：`isFinite` 一族放行 / 建议有边界 / 标注增减不算位移）',
    'tests/c4-annotation-selftest.mjs',
  ],
  [
    '㊻ 虚线参数口径取证（第 9 期：dash:true=虚线 / false=实线 / 数组=自定义；非法类型 C1 拦截）',
    'tests/dash-selftest.mjs',
  ],
  [
    '㊼ 开源日志取证（v1.1.7：门禁哪条拦住 / 对话原文 / 动画代码 / 解题过程；每次跑都落一对 html+json，且不含 Key）',
    'tests/open-log-selftest.mjs',
  ],
  [
    '㊽ 本地运动学矢量取证（v1.1.9：bodies 求导 / 边界集含 phases / 碰后取值 / 跳变画点 / 模型 v/a 过滤 / 两条渲染路径同口径 / v1.1.16 屏幕方向翻 y）',
    'tests/kinematic-vectors-selftest.mjs',
  ],
  [
    '㊾ 知识卡 v2 契约自检（Phase 1：词表合并 / 元件·场景·规范三类卡 / v1→v2 迁移 / 旧字段拒绝）',
    'tests/knowledgecard-v2-contract-selftest.mjs',
  ],
];

function canSpawn() {
  // 本沙箱禁止"管道捕获子进程输出"（任何 exe 都 EPERM），因此用 inherit 探测
  const probe = spawnSync(RUNTIME, ['-e', 'process.exit(0)'], { stdio: 'ignore', env: nodeEnv() });
  return !probe.error;
}

/**
 * 所有门禁脚本都导出可 await 的 `main`，这里按顺序调用（结论与子进程方式一致）。
 * 注意：步骤里的 script 可能带 CLI 参数（如 `tools/web-build.mjs --check`），
 * 因此先剥掉参数再比较，否则同进程回退模式下会误判为"未导出 main"。
 */
const AWAITABLE = new Set(STEPS.map(([, script]) => script.split(/\s+/)[0]));

/** 把 `path/to/script.mjs --flag` 拆成路径与参数 */
function splitStep(script) {
  const [rel, ...args] = script.split(/\s+/);
  return { rel, args };
}

async function main() {
  const useChild = canSpawn();
  console.log(`执行方式：${useChild ? '子进程' : '同进程导入（本环境禁止子进程管道）'}`);
  console.log(`运行时：${RUNTIME}`);

  let failed = 0;

  /**
   * ⓪ 覆盖自检（在 ① 之前）。
   *
   * ⚠ 子进程模式下**不能让 `verify-coverage.mjs` 去读 `verify-all.mjs` 的源文本来取 STEPS** ——
   *   那是可行的（CLI 就是这么做的），但这里更直接：**门禁自己知道 STEPS**，
   *   用同一份内存里的清单来比对，避免"读源文本"与"实际执行"两套解析各自漂移。
   */
  console.log('\n──────── ⓪ 覆盖自检（门禁是否漏挂检查脚本）────────');
  {
    const { ok, missing } = reportCoverage({ projectRoot: PROJECT_ROOT, steps: STEPS });
    if (!ok) {
      console.log(`✗ 覆盖自检未过：${missing.length} 个检查脚本没被挂载`);
      failed += 1;
    }

    /**
     * ⚠ 同时校验**另一种读法**：CLI 模式（`node tools/verify-coverage.mjs`）是从本文件的
     *   **源文本**里解析 STEPS 的，而这里用的是内存里的 `STEPS`。两条路径若不一致，
     *   就会出现"门禁全绿、而 CLI 报告一堆假阳性"（第 5 期真实发生过：多行 + 尾随逗号
     *   的 STEPS 条目解析不到，`㉑` 从第 4 期起一直是漏解析的）。
     *   **一个判据有两条实现路径时，两条都要被钉住。**
     */
    const norm = (list) => list.map(([label, script]) => `${String(label).trim()}|${String(script).trim().split(/\s+/)[0]}`).join(' ; ');
    const parsed = readStepsFromVerifyAll(PROJECT_ROOT);
    if (norm(parsed) !== norm(STEPS)) {
      console.log('✗ 覆盖自检：CLI 从源文本解析出的 STEPS 与内存里的 STEPS 不一致');
      console.log(`    内存 ${STEPS.length} 条 / 源文本解析 ${parsed.length} 条`);
      failed += 1;
    } else {
      console.log(`  ✓ 源文本解析的 STEPS 与内存一致（${STEPS.length} 条，两种读法都被钉住）`);
    }
  }

  for (const [label, script] of STEPS) {
    console.log(`\n──────── ${label}（${script}）────────`);
    const { rel, args } = splitStep(script);
    if (useChild) {
      const result = spawnSync(RUNTIME, [join(PROJECT_ROOT, rel), ...args], {
        stdio: 'inherit',
        cwd: PROJECT_ROOT,
        env: nodeEnv(),
      });
      if (result.error) {
        console.log(`✗ 无法启动：${result.error.code ?? result.error.message}`);
        failed += 1;
      } else if (result.status !== 0) {
        console.log(`✗ 失败（exit ${result.status}）`);
        failed += 1;
      }
      continue;
    }
    try {
      if (!AWAITABLE.has(rel)) throw new Error('该脚本未导出 main()，无法在同进程模式下调用');
      const mod = await import(pathToFileURL(join(PROJECT_ROOT, rel)).href);
      if (typeof mod.main === 'function') await mod.main({ checkOnly: args.includes('--check') });
      else throw new Error('该脚本未导出 main()，无法在同进程模式下调用');
    } catch (err) {
      console.log(`✗ ${err?.message ?? err}`);
      failed += 1;
    }
  }

  console.log(failed ? `\n✗ 门禁未全通过：${failed} 步失败` : '\n✓ 全部门禁通过');
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`✗ ${err?.stack ?? err}`);
  process.exit(1);
});
