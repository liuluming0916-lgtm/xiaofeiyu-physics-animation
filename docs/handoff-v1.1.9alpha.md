# 交接书 · v1.1.9alpha（知识卡更名 + UI 重做）

> 目标版本：**v1.1.9alpha**（规划标签，尚未发版）
> 起点：`master` · v1.1.9 已发布；规划决议见 [`项目现状与路线.md`](../项目现状与路线.md) §2.1
> 适用读者：**新开会话的 Agent**。第一件事读本文，第二件事读 [`项目现状与路线.md`](../项目现状与路线.md) §2.1。

---

## 0. 一句话

把“规则页 + 蒸馏页”合并进**设置**，把 `worldbook` 全面改名为 **知识卡 KnowledgeCard**，
把 4 张约定卡合并为 **3 张常驻动画规范卡**，并让注入顺序变成
**该阶段提示词卡 → 动画规范卡 → 元件卡 → 场景卡**。

**当前没有开工。** 1.1.9 的发布包、代码、数据都未被本规划修改。

---

## 1. 先读什么

| 顺序 | 文件 | 看什么 |
|---|---|---|
| 1 | 本文 | 范围、顺序、坑 |
| 2 | [`项目现状与路线.md`](../项目现状与路线.md) §2.1 | 唯一权威决议 |
| 3 | [`docs/门禁都盯什么.md`](门禁都盯什么.md) | 改什么要跑什么 |
| 4 | [`docs/改词条与导入导出.md`](改词条与导入导出.md) | 现有存卡/恢复语义 |
| 5 | `core/worldbook/`、`core/prompts/`、`web/src/pages/SettingsPage.tsx`、`RulesPage.tsx` | 要动的代码 |

不要再把 `docs/history/` 里的旧 README / 旧 ROADMAP 当口径；它们只是历史。

---

## 2. 已锁定的产品决议（不要重新讨论）

### 2.1 知识卡 5 类

| 类型 | 代码名（拟） | 是否注入 | 说明 |
|---|---|---|---|
| 提示词卡 | `prompt` | ✅ 只在**自己那个阶段** | 底层仍是 `core/prompts` + `ai-rules/prompts`，不是 worldbook 词条 |
| 动画规范卡 | `anim_rule` | ✅ 常驻 `scene_code` | 3 张；**不叫“流程规范卡”**，它不涉及整段流程 |
| 元件卡 | `element` | ✅ 按元件命中 | 30 张 |
| 场景卡 | `scene` | ✅ 按题型命中 | 0 张 |
| 本地规则卡 | `local_rule` | ❌ 不注入 | 清洗规则，模型输出后处理 |

- `worldbook` 是知识卡的**旧称**；UI 先叫“知识卡”，代码机械改名另排。
- 提示词卡与本地规则卡算知识卡，但**不是 worldbook 条目**。

### 2.2 页面

- **删除**规则页、蒸馏页（作为独立页面/导航）。
- 只保留导航：**解题 / 动画 / 设置 / 导出**。
- 设置页统一承载：提示词卡、本地规则卡、知识卡（含世界书编辑器）、AI 帮写。
- 端点与 Key：删页签，统一用右上角 ⚙。
- 工作区状态：删 UI；`node core/rules/cli.mjs check` 保留给开发排障。
- 设置页保留：新建卡、保存到本机、删除、导入并保存、恢复本版内置。
- 设置页加显眼的 **「AI 帮写」**：生成草稿 → 立即编辑 → 导入/导出；不自动保存、不自动发布。
- 教辅蒸馏功能**不再保留**；`core/distill` / `DistillPage` / `/api/distill` / 门禁 ㉜ 在实现阶段删除。

### 2.3 三张动画规范卡

| 新 id | 标题（拟） | 来源 | 触发 |
|---|---|---|---|
| `wb_anim_conventions` | 动画规范·坐标/单位/颜色/读数 | `wb_visual_conventions` + 原 `wb_anim_conventions` 合并（保留后者 id） | 常驻 |
| `wb_anim_stages` | 动画规范·阶段表与状态组织 | `wb_scene_stages` 改名 | 常驻 |
| `wb_anim_elements_overview` | 动画规范·元件总览 | 原名不变 | 常驻 |

- 全部 `kind: anim_rule`、`constant: true`、`insertion_slot: scene_code`、`order` 1/2/3。
- 合并时修内容：
  - 删掉 `Draw.text` 那条（方案 A 后画布无文字）；
  - `readouts` 改 `{ key, label, value, unit }`；
  - 删“画面上显示数值用 `Phys.format`”；
  - visual/anim 重复段落只留一份。
- 合计正文约 5.4–5.8k 字/题（30,000 预算内）。

### 2.4 注入顺序（已核对）

```
该阶段提示词卡（read_problem / solve / steps / answers / scene_code / repair 之一）
  → 动画规范卡（3 张，常驻）
  → 元件卡（按元件命中）
  → 场景卡（按题型命中）
```

- **每个阶段只发自己的提示词卡**，不是 6 张全发。
- 提示词卡在 system 条件段按阶段取；**不要拼成一份前缀每次重发**。
- 顺序只对 `scene_code` 有意义；`solve` 阶段没有动画规范/元件/场景卡。
- **已核对**：34 张内置卡 `insertion_slot` 全是 `scene_code`；`prepareWorldbook` 实测 `solve` 槽 **0 条 / 0 字**，
  `scene_code` 才按命中注入。解题阶段实际发送 = 固定前缀 + `solve` 提示词卡 + 6 条阶段规范 + 题面。
- 本地规则卡不参与这个顺序（模型输出后运行）。

---

## 3. 施工顺序（每个 commit 都必须全绿）

### Phase 0 · 冻结与基线（0.5–1 天）

```bat
git switch -c feat/v1.1.9alpha
git tag pre-v1.1.9alpha
git bundle create ..\Work-pre-v1.1.9alpha.bundle --all
node tools\verify-all.mjs
```

备份：
- `ai-rules/` 整个（含 `keys.json`，密钥，别提交/外传）；
- `%APPDATA%\physics-animation-studio\data\` 整个；
- `release/物理解题动画-v1.1.9/` + zip；
- 34 张卡的规范化 JSON + `worldbookHashOf(entries)`，存 `tests/reports/`（不进发布包）。

### Phase 1 · UI 合并（先做，风险最低）

1. `web/src/App.tsx`：删除规则/蒸馏导航与页面分支；保留解题/动画/设置/导出。
2. `SettingsPage`：加页签/分区——知识卡、提示词卡、本地规则卡、AI 帮写。
3. 把 `RulesPage` 里的 Prompt 编辑器、清洗规则编辑器搬进设置；端点/工作区状态删掉。
4. `DistillPage` 删除；世界书编辑器已在设置页，补“知识卡”文案。
5. 更新 `tests/release-switch-selftest.mjs`：
   - 不能只断言“没有 RulesPage”，要断言**规则页不再被 import / 导航里没有“规则”**；
   - 仍断言 SettingsPage 在、保存/恢复入口在。
6. 跑 `verify-all`。

> Phase 1 不动后端，`/api/worldbook` 继续用；页面先叫“知识卡”。

### Phase 2 · 卡片类型与内容（3–5 天）

1. `contracts/worldbook-entry.schema.json` 加 `kind`（`prompt|anim_rule|element|scene|local_rule`），
   老包缺省为空/`element` 的兼容策略要写清。
2. 迁移 34 张：
   - 30 张 `wb_el_*` → `element`；
   - 合并/改名 3 张 → `anim_rule`，`constant: true`；
   - 0 张 `scene`。
3. 改内容（§2.3 四条）。
4. `core/worldbook/engine.mjs` 注入排序：类型顺序 + 类型内 `order`；补门禁。
5. 设置页按 `kind` 筛选/分组；`kind` 只影响 UI 与排序，不影响命中语义。

### Phase 3 · worldbook → knowledgecard 机械改名（10–15 天，可与 Phase 2 分开）

按 [`项目现状与路线.md`](../项目现状与路线.md) 上一轮的 4 阶段方案做：
- 先别名/双读，再机械改名，再迁数据/阶段/事件，最后删旧名。
- 关键持久化标识：
  - `PACK_FORMAT = 'od-worldbook'`；
  - `ai-rules/worldbook/`；
  - `PIPELINE_STAGES` / `stageModels.worldbook`；
  - `worldbook_done` 事件；
  - `contracts/worldbook-*`、`core/worldbook/`、`web/src/lib/worldbook-*`。
- **不要动 git 历史**；旧 commit 里的 worldbook 是历史。
- 用户数据迁移：备份 + 复制 + 双读；旧覆盖副本 id 映射到 `wb_anim_*`。

### Phase 4 · 验收与打包

```bat
node tools\verify-all.mjs
node tools\electron-repack.mjs --zip
```

检查：
- 设置页有 5 类知识卡、保存/恢复/导入可用；
- 发布包没有 RulesPage/DistillPage；
- `solve` 仍只发题面 + solve 提示词 + 6 条阶段规范（0 张卡）；
- 34 张卡迁移前后 id/title/content 指纹一致（除合并的三张）；
- 旧 `od-worldbook` 包能导入；旧 `ai-rules/worldbook` 能迁移；
- 发布包启动一次，旧数据不丢。

---

## 4. 重点文件地图

| 位置 | 作用 |
|---|---|
| `web/src/App.tsx` | 导航与页面分支 |
| `web/src/pages/RulesPage.tsx` | 要拆掉的 5 个页签 |
| `web/src/pages/DistillPage.tsx` | 要删的蒸馏页 |
| `web/src/pages/SettingsPage.tsx` | 合并后的唯一入口 |
| `core/prompts/editor.mjs` | 9 份 Prompt 的分组/编辑 |
| `core/prompts/templates.mjs` | 阶段 system（含 7 条阶段规范） |
| `core/prompts/stage-rules.mjs` | 6 条解题 + 1 条动画规范（**不是卡**） |
| `core/cleaner/*` | 本地规则卡（4 条锁定） |
| `core/worldbook/{engine,store,editor,governance}.mjs` | 知识卡引擎/存储/编辑 |
| `contracts/worldbook-*.json` | 词条/包/词表契约 |
| `tools/rules-service.mjs` | `/api/worldbook`、`/api/prompts`、`/api/cleaning` |
| `tools/verify-all.mjs` | 48 步门禁与步骤索引 |
| `tests/release-switch-selftest.mjs` | 发布版页面开关 |
| `tests/worldbook-selftest.mjs` | ㉒ 世界书取证 |
| `tests/rules-service-selftest.mjs` | 真实 HTTP 存取 |

---

## 5. 已核对的坑（别再踩）

1. **34 张内置卡全是 `scene_code`**；`solve` 槽 0 张。不要为了“顺序”把卡塞进解题阶段。
2. **提示词卡按阶段取**；6 张全发就是“前缀重发”的老路。
3. **本地规则卡内置 4 条锁定**（`strip-code-fence` / `strip-function-wrapper` / `drop-console-log` / `trim-edges`），
   截图/旧文案写 3 条是错的。
4. **`od-worldbook` 是持久化格式**：导出包、备份包都用它；改名必须双读。
5. **`stageModels.worldbook` 在用户 `endpoints.json` 里**：改阶段名必须迁移，否则配置校验会红。
6. **`worldbook_done` 事件**：旧开源日志/回放可能依赖；读取端要兼容。
7. **`web/src/lib/worldbook-engine.js` / `worldbook-concepts.js` 是逐字节副本**：改名要同步生成器和门禁。
8. **`verify-all` 会把 `web/dist` 重建成 dev 形态**；发布打包交给 `electron-repack`（内部 `OD_RELEASE=1`）。
9. `electron-repack` 现在会动态选 `release/` 里任意带 exe 的绿色版作运行时来源，不再依赖 v1.0 目录。
10. **不要 `git clean -xdf`**：会删 `ai-rules/keys.json`、`ai-rules/worldbook/`、`data/history.db`、`release/`。

---

## 6. 验收命令

```bat
:: 基线（开工前）
node tools\verify-all.mjs

:: 卡片/契约改动
node tests\worldbook-selftest.mjs
node tests\rules-service-selftest.mjs
node contracts\generate-contracts.mjs
node contracts\verify-contracts.mjs

:: 页面/发布改动
node tests\release-switch-selftest.mjs
node tools\web-build.mjs
node tools\verify-all.mjs

:: 发布
node tools\electron-repack.mjs --zip
```

补充检查：
- `git grep -n -i worldbook`：除兼容层/历史文档/迁移脚本外应为 0；
- 迁移前后 34 张卡指纹一致；
- `solve` 注入 0 张卡（用 `prepareWorldbook` 跑一次即可）；
- 旧包导入、旧数据目录迁移各跑一次。

---

## 7. 现在就能回答的问题

- **世界书编辑器在哪？** 设置页（合并后）；旧 `DistillPage` 删除。
- **写卡页还有吗？** 没有独立导航；“AI 帮写”在设置页里。
- **端点与 Key 在哪？** 右上角 ⚙。
- **规则页呢？** 删除；提示词/清洗/知识卡都进设置。
- **蒸馏呢？** 产品功能删除；代码在实现阶段清掉。
- **版本号？** 规划叫 v1.1.9alpha；真正发版时再定正式号。
