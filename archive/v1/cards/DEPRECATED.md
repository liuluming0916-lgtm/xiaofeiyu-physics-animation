# ⚠ 本目录已弃用（v1 卡，2026-10-23）

**这里的东西不再被运行时读取，只作历史对照。**

- 当前在跑的库是 **`core/knowledgecard/data-v2/`**（31 张 = 11 元件 + 18 场景 + 2 规范），由 `loadV2Library` 读。
- 本目录（`data/`）与 `../source/` 是同一套 **30 张 v1 卡**：`kind` 全是 `element`，命中靠 `keys` 字面量，
  而且**教模型写 `stateAt`** —— v6 之后 `stateAt` 由 `core/analysis/generate.mjs` 本地生成，模型只写 `drawFrame`，
  所以这些卡里的写法现在是**错的**。
- 不要再往这里加卡、改卡；要改卡改 `data-v2/`。
- 唯一还可能读它的人：`tools/_build-knowledgecard-v2-data.mjs`（迁移转换器，**默认拒绝执行**，要 `--force` 才跑）。

对照见 [卡v1-v2对照.md](../../../docs/history/2026-10-23-卡v1-v2对照.md)。
