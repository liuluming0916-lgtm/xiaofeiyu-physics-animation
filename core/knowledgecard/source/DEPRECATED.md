# ⚠ 本目录已弃用（v1 卡源，2026-10-23）

这里是 **v1 卡的源稿**（30 张，`kind` 全为 `element`，`keys` 字面量触发）。
生成出来的 `../data/` 也一并弃用；**当前在跑的是 `../data-v2/`**。

弃用理由（一条）：v1 卡教模型写 `stateAt`，而 v6 之后 `stateAt` 由 `core/analysis/generate.mjs`
本地生成、模型只写 `drawFrame`。按 v1 的口径产出的卡会把模型引到"自己写运动"的旧路上。

- 改卡请改 `core/knowledgecard/data-v2/93-elements.json`；
- 本目录保留只为对照，不再参与生成；
- 若确实要从 v1 重新生成一份对照，可跑 `node tools/_build-knowledgecard-v2-data.mjs --force`（会覆盖 data-v2，慎用）。

对照见 [卡v1-v2对照.md](../../../docs/history/2026-10-23-卡v1-v2对照.md)。
