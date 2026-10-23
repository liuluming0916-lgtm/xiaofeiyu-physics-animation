# 真题回归集（8 道可跑 + 3 道占位）

来源：`C:\Users\Liu LuMing\Desktop\测试用题目\测试题目.pdf`（13 页；题面 + 答案 + 详解混排）。
本卷共 10 题，抽取与逐题判读见 [`docs/plans/B8-真题清单.md`](../../docs/plans/B8-真题清单.md)；
目录/加载器/验收口径见 [`docs/plans/B8-真题回归方案.md`](../../docs/plans/B8-真题回归方案.md)。

**清单唯一来源是 `index.json`**（v2）。原 `pilot.json` 已退役，内容并入 `index.json`。

| id | 原卷页 | 题 | 状态 | 说明 |
|---|---|---:|---|---|
| `q01` | 1 | 斜面弹簧连接体的两次共速（多选） | todo | 题面已抽，等模型产出 |
| `q02` | 2 | 蹦床 F–t 图像与变力冲量（多选） | placeholder | 词表没有"蹦床/可形变面" |
| `q03` | 3 | U 形管双气瓶的等容升温（填空·热学） | placeholder | 热学本轮不做 |
| `q04` | 4 | 传送带—绳—滑轮多过程（3 问） | candidate | 模型产出后人工修补过；旧形态（`state.e0`），待迁语义 key |
| `q05` | 6 | 救护车的加速—匀速与鸣笛追及（2 问，无图） | todo | 题面已抽，等模型产出 |
| `q06` | 6 | 导轨—电容—开关的电磁感应（2 问） | accepted | 333 帧 / 4 步 / 显示 8 s |
| `q07` | 8 | 方波电场与方波磁场中的带电粒子（3 问） | todo | 题面已抽，等模型产出 |
| `q08` | 10 | 直流电路 + 平行板类平抛 + 磁场圆周（3 问） | todo | **B8 端到端试点** |
| `q09` | 11 | 卡销汽缸的等温压缩与等容升温（2 问） | accepted | 481 帧 / 5 步 / 显示 8 s |
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
pages/qNN.png         原题裁图（144 dpi 渲图后裁题面区，不含【答案】）
qNN.program.json      冻结程序（8 个槽位）
qNN.html              冻结单文件预览
q04.mjs / q06.mjs     历史 JSON 再导出包装（老检查脚本用，保留）
q06.handwritten.*     手写反例，保留作对照
```

## 常用命令

```bash
# 单题 Dry-Run（v6 口径，T_phys/边界从 setup 与 VIEW 反推）
node tools/_check-real.mjs q08

# 清单体检（+ 负对照）
node tools/_check-real-exam.mjs

# 门禁里的两站（合成 15 + 真题 8）
node core/dryrun/run-suite.mjs --suite all
node tools/render-check.mjs --suite all

# 真跑一道题（本机规则服务在跑：node tools/rules-service.mjs --port 8123）
node tools/_run-question.mjs q08

# 冻结：先出公式 SVG，再打单文件页
node tools/_tex-for.mjs tests/real-exam/q08.program.json --id q08
node tools/_build-page.mjs tests/real-exam/q08.program.json --id q08 --out tests/real-exam/q08.html
```

## 验收口径

金标准 = **模型产出 + 人工验收**（手写不算），详见
[`docs/plans/金标准候选验收单-v1.md`](../../docs/plans/金标准候选验收单-v1.md)。
机检在门禁 ③⑦：C1–C9、关键帧体检、渲染路径不变量、程序形态（语义 key / 物理尺寸 / 无 `cx/cy` / `bodies` 自洽）。

## 为什么不删 Q01–Q15

`tests/regression-15/q01..q15` 是**可执行动画程序**（手写夹具），是门禁的确定性基线；
真题是模型产出，两者测的东西不一样。**至少 6 道真题稳定前不动旧集**（现在还要留它当对照）。

## 已知不足

- `q04`：模型产出后人工修补；仍是旧形态（`state.e0` + `cx/cy` + 纸面尺寸），迁移排在 B8 第 4 步。
- `q06`：S 与 C 画在同一左支路（串联）、开关符号无开合切换 —— 场景卡内容不足，判为可过。
- `q09`：卡销位置与活塞行程对不齐（词表没有"卡销"）、汽缸比例偏细、外力箭头手画。
- 真题不实现"轨迹开关"（`Draw.trace`）：提示词里没有这条要求，门禁因此只要求"用了就必须生效"。
