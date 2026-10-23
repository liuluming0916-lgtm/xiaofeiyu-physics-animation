# v1 知识卡 / 读题提示词（已退役）

这个目录是 v1 的**只读归档**，保留在 git 里供追溯，不再进入运行时。

- `cards/`：v1 内置卡数据（原来的 `core/knowledgecard/data/*.json`）。
- `cards-source/`：v1 卡源文件（原来的 `core/knowledgecard/source/`）。
- `builtin-bundle.generated.mjs`：v1 的“封死内置卡”编译常量。
- `read_problem.md`：v1 的 `read_problem` 提示词正文。

v1.1.18 起：

- 运行时只走 v2 知识卡（`core/knowledgecard/data-v2/*.json`）；
- 读题只走 `read_problem_v2`；
- 知识卡不再“封死”进代码；只有 system prompt 的固定前缀是封死的；
- 本目录不会被打包进应用，也不会被 `/api/run` 读取。
