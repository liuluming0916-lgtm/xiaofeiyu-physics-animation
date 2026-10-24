# 真题回归集（2 道 accepted + 5 道待跑）

来源：`C:\Users\Liu LuMing\Desktop\测试用题目\测试题目.pdf`（13 页；题面 + 答案 + 详解混排）。
抽取与逐题判读见 [`docs/plans/B8-真题清单.md`](../../docs/plans/B8-真题清单.md)；
目录/加载器/验收口径见 [`docs/plans/B8-真题回归方案.md`](../../docs/plans/B8-真题回归方案.md)。

**清单唯一来源是 `index.json`**（v2）。原 `pilot.json` 已退役。

> **2026-10-24 重启**：上个版本链路跑出来的三道产物（`q04`/`q06`/`q09` 的程序、预览、候选笔记）已全部删除，
> 按当前口径（语义 key + 物理尺寸 + 带参考答案）重跑。旧笔记留在 git 历史：
> `git show 30fab7c^:tests/real-exam/pilot.json`。
> 重建期间 `index.json` 带 `restart: true` + `restartNote`，门禁允许"可跑 < 3 道"，但会打警告；
> q04/q05 已跑通并 accepted，等 q06/q09 回来后再去掉 `restart`。

| id | 原卷页 | 题 | 状态 | 说明 |
|---|---|---:|---|---|
| `q01` | 1 | 斜面弹簧连接体的两次共速（多选 AD） | todo | 题面已抽 |
| `q02` | 2 | 蹦床 F–t 图像与变力冲量（多选 BD） | placeholder | 词表没有"蹦床/可形变面" |
| `q03` | 3 | U 形管双气瓶的等容升温（填空·热学） | placeholder | 热学本轮不做 |
| `q04` | 4 | 传送带—绳—滑轮多过程（3 问） | accepted | 方案二重跑；用户验收通过 |
| `q05` | 6 | 救护车的加速—匀速与鸣笛追及（2 问，无图） | accepted | 模型 1 轮画图修复；用户验收：方块示意/尺度/声波追及未画均可接受；声波弧方向不修 |
| `q06` | 6 | 导轨—电容—开关的电磁感应（2 问） | todo | 待重跑 |
| `q07` | 8 | 方波电场与方波磁场中的带电粒子（3 问） | todo | 题面已抽 |
| `q08` | 10 | 直流电路 + 平行板类平抛 + 磁场圆周（3 问） | todo | 原定试点，现排到 q04 之后 |
| `q09` | 11 | 卡销汽缸的等温压缩与等容升温（2 问） | todo | 待重跑 |
| `q10` | 12 | 四分之一圆玻璃柱的全反射临界（光学） | placeholder | 光学本轮不做 |

状态含义（`index.json` 的 `status`）：

- `placeholder`：只占位，本轮不做（必须有 `placeholderReason`）；
- `todo`：题面/答案/裁图已抽，程序还没产出；
- `candidate`：模型产出、待人工验收；
- `accepted`：人工验收通过（`acceptedAt` + `acceptNote`）。

`todo`/`placeholder` 不许带 `program`；`candidate`/`accepted` **必须**带 `program` + `preview` + `frozen`。
体检在门禁 ③ 里跑（`core/dryrun/question-sources.mjs`），带 5 份坏清单做负对照。

## 文件

```text
index.json            清单（唯一来源）
pages/qNN.png         原题裁图（不含【答案】；q04/q05/q06/q09 已有，q01/q07/q08 待裁）
qNN.program.json      冻结程序（8 个槽位，模型产出后归一）
qNN.html              冻结单文件预览
```

## 常用命令

```bash
# 真跑一道题（带参考答案；本机规则服务在跑：node tools/rules-service.mjs --port 8123）
node tools/_run-question.mjs q05

# 单题 Dry-Run（v6 口径，T_phys/边界从 setup 与 VIEW 反推）
node tools/_check-real.mjs q04

# 清单体检（+ 负对照）
node tools/_check-real-exam.mjs

# 门禁里的两站（合成 15 + 真题 N）
node core/dryrun/run-suite.mjs --suite all
node tools/render-check.mjs --suite all

# 冻结：先出公式 SVG，再打单文件页
node tools/_tex-for.mjs tests/real-exam/q04.program.json --id q04
node tools/_build-page.mjs tests/real-exam/q04.program.json --id q04 --out tests/real-exam/q04.html
```

## 验收口径

金标准 = **模型产出 + 人工验收**（手写不算），详见
[`docs/plans/金标准候选验收单-v1.md`](../../docs/plans/金标准候选验收单-v1.md)。
机检在门禁 ③⑦：C1–C9、关键帧体检、渲染路径不变量、程序形态（语义 key / 物理尺寸 / 无 `cx/cy` / `bodies` 自洽）。

## 为什么不删 Q01–Q15

`tests/regression-15/q01..q15` 是**可执行动画程序**（手写夹具），是门禁的确定性基线；
真题是模型产出，两者测的东西不一样。**至少 6 道真题稳定前不动旧集**。
