# 物理解题动画 · **前六期工程总结 + 第 7 期交付（导出 · 联动图表 · 教辅蒸馏）**

> **实施依据**：`物理解题动画软件v1.0自研方案.md`（**唯一依据**）。§3 / §9 / §11.2 / §7.2 的冻结项**七期一字未改**。
> **面向读者**：Agent 与工程师。术语、契约字段、判据编号、门禁步号一律照方案原文，不做通俗化改写。
> （给非工程读者的通俗版另见 **`README-TOYOU.md`** —— 两份文件**不要混用**：这份是口径，那份是导览。）
>
> **本文件的读法（四段式）**：
>
> | 段 | 章节 | 作用 |
> |---|---|---|
> | **① 总览** | 本头部 + **§0 总目录与七期一览** | 七期各自交了什么、证据在哪、基线是多少 —— **先看这一段** |
> | **② 前四期留档** | §一～§十三（第 1–3 期）、**§十四**（第 4 期实施方案）、**§十五**（第 4 期交付说明） | 逐期交付说明、偏差、冲突、缺陷复盘。**§七 / §11.5 / §13.6 / §15.4 是缺陷账** |
> | **③ 第 5 期** | **§十六**（第 5 期工作指导 · 留档）、**§十七**（第 5 期交付说明） | 第 5 期交付了什么、口径决定、缺陷与落点 |
> | **④ 第 6 期交付** | **§十八** | 可配置化完全体：规则工作区 / Prompt 编辑器 / 清洗规则编辑器 / 端点与 Key / 规则工作室界面 —— 交付物、验收原文三条、已知缺口。**§17.9 是它开工前的前置留档** |
> | **⑤ 第 7 期交付** | **§十九** | 导出（单文件网页 + GIF）/ 联动图表与导读栏 / 教辅蒸馏简版 —— 交付物、验收原文四条、**五条方案偏离（本期定案，别改回去）**、七条坑、已知留口 |
>
> **⭐ 想知道"现在能干什么、下一步做什么"，直接跳 §十九**（它自己会把你送回需要先读的章节）。
>
> **⚠ 第十二节 12.6 的"最小宿主"建议已被用户否决**：第 3 期**按方案 §2.2 原文采用
> React 18 + TypeScript + Tailwind + zustand**。12.6 保留为决策记录，**它不是口径**；
> **构建工具 Vite → Rollup**（本沙箱禁止管道捕获子进程，Vite 5 两处必须管道 spawn ⇒ EPERM；
> 7 组实验取证见 12.11；用户第 4 期已裁决**维持 Rollup**，见 15.6 第 1 条）。
>
> **当前状态**：`node tools/verify-all.mjs` → **⓪ 覆盖自检 + 四十四步全绿，exit 0**
> ```
> 15/15 题 C1–C9 通过 · 0 告警 · 0 失败 · 12/12 负向注入被拦下 · Draw.raw 0.00%
> 18 个成品页静态体检通过 · C7 判定与第 3 期基线逐字一致 · 契约 18 份产物
> 世界书 **W1–W13 / W15 / W16 逐条取证** · **W14 只交付机制**（内容覆盖 **0/111**，按用户裁决顺延第 5.5 期）·
> **预览器与实际请求逐字节一致** · 内置词条结构合规 100%
> **第 5.7 期：世界书触发改为「两侧分发」** —— 解题侧由模型判【考点】【题型】触发、动画侧按【动画元件】触发 ·
> 阶段第 0 步：`read_image`（第 5 期旧名）→ 第 5.7 期改名 **`read_problem`（读题与判定，所有题都跑）** · 词条新增 `concepts` / `tags` / `elements` 三栏
> 取证：契约 37 + 网关 63 + 切分 53 + Prompt 111 + 编排 115 + 宿主协议 69 + 自愈与 C7 强化 129 + 世界书 230
> **第 6 期新增 7 份自检 · 469 条断言**：规则工作区 94 · Prompt 编辑器 82 · 清洗策略 68 · 端点配置 75 · 总装验收 44 · 规则工作室服务 61 · 备份与恢复 45
> **第 7 期新增 3 份自检 · 176 条断言**：联动图表与导读栏 75 · 导出 48 · 教辅蒸馏 53
> **第 7 期定案**：WebM 与 PDF 解析**用户砍掉**（不是遗留）；新增运行时依赖 **`gifenc@^1.0.3`**（用户批准）；`contractHash` **未变**
> **第 8 期（进行中）**：已入 **㉝ 安全脱敏与观测 88 条** ＋ **㉞ 标注避让 60 条** ＋ **㉟ 历史与审计 47 条** ＋ **㊱ C2 接线与字体 33 条** ＋ **㊲ 方案 A 29 条** ＋ **㊳ 发布构建开关 18 条** ＋ **㊴ 内置知识层封死 22 条**。
> **方案 A（用户 2026-10-17 拍板，已落地）**：画布上**不再写任何文字**（说明 / 数值 / 矢量标签），只留物理元件与矢量；矢量靠**颜色 + 长度**表达（**绿=速度 · 蓝=加速度 · 红=受力**），图例在**画布外**（`data-od-id="vector-legend"`）。唯一例外：坐标轴轴名（`p / kPa` 这类，删了 p–V 图就不成图），由 `KEEP_AXIS_LABELS` 单独控制。
> **形态收敛三件（用户 2026-10-17 拍板，已落地）**：
> · **A1 构建开关**：`OD_RELEASE=1` 构建 ⇒「设置」「规则」两页**在产物里不存在**（实测 dev 1162 KB → release 432 KB，两页的组件标识符一个都搜不到）；本地开发构建两页都在。
> · **A2 齿轮小窗**：解题页右上角「⚙ 连接设置」——只填 `接口地址 / 模型 ID / Key`，`保存` 与 `保存并测试连接`；**Key 只进不出**（password 框、保存后清空、服务端永不回显）。发布版没有设置页，齿轮是**唯一**配置入口（门禁 ㊳ 断言它在两种构建里都在）。
> · **A3 内置知识层封死**：**只封发行产物，不封本地源码**（用户明确要求）。本地照旧读 `core/worldbook/data/*.json`（可编辑）；打包运行时 `OD_BUILTIN_BUNDLE=1` 读**编译进代码的常量**（`core/worldbook/builtin-bundle.generated.mjs`，由 `tools/build-builtin-bundle.mjs` 生成）。**用户层（蒸馏卡片）永远是磁盘**，打包形态照样可改。
> 新增运行时依赖 **`better-sqlite3`**（用户批准）。**进展**：清目录、箭头 `mag`、C1 判据 8 均已完成；**M24 桌面壳已产出绿色版**（见下）。
>
> **M24 · v1.0 桌面版（2026-10-17）**
> · **产物**：`release/物理解题动画/`（344.6 MB，双击 `物理解题动画.exe` 即用）· `release/物理解题动画-v1.0.0-win-x64.zip`（135.3 MB，便于拷贝）
> · **壳**：`electron/main.cjs` —— **先起本机服务（`port: 0` 系统分配）→ 拿到真实端口 → 再 `http://127.0.0.1:<port>` 打开页面**；不用 `file://`（那样 `/api/*` 全废）。安全口径：关 `nodeIntegration` / 开 `contextIsolation` + `sandbox` / 只绑回环 / 外链交系统浏览器 / 单实例锁。规则与 Key 落在**用户数据目录**（`Program Files` 是只读的）。
> · **打包形态**：`OD_BUILTIN_BUNDLE=1`（内置词条读编译常量）· 账本/观测/导出/蒸馏全部重定向到用户数据目录；前端用 `OD_RELEASE=1` 构建 ⇒ **装出来没有设置页与规则页**。
> · **三处环境限制（已实测，不是猜测）**：
>   ① `npm install electron` 在本沙箱**走不通**（生命期脚本 `spawn` 捕获输出 → `EPERM`）；改用 `tools/_fetch-electron.mjs` 直连镜像下载 zip + `tar` 解压；
>   ② **Electron GUI 在本沙箱启动不了**（`crashpad_client_win.cc: not connected` = 命名管道被禁，Chromium 多进程依赖它）⇒ **窗口是否正常只能由用户双击验**；
>   ③ `electron-builder`（NSIS 安装向导）要调外部 `app-builder.exe` 下载组件，同样被 EPERM 挡住 ⇒ v1.0 交付**绿色版**（功能与安装版一致，只是没有安装向导）。
> · **已验证（不依赖 GUI）**：运行时 3972 个文件齐全（`icudtl.dat`/`v8_context_snapshot.bin`/`resources.pak` 等）· exe 可执行（Node 模式下报 `v20.18.0`）· **打包产物里的服务层真跑通**：`/api/health` `/` `/api/history/stats` `/api/worldbook` 四个端点全 200。
> · **已知风险（未验证）**：`better-sqlite3` 是按 **Node ABI** 编的，Electron 里可能加载失败 ⇒ "看账本"降级（软件其余功能不受影响，日志会明说 `history.driver-missing`）。修法：`@electron/rebuild`（需在用户机器上跑）。
> · **自检开关**：设 `OD_SELFTEST=1` 再启动 exe，会在 `%TEMP%\od-shell.log` 写下端口/首页/账本/版本四项结果后退出（不用开窗口）。
> **矢量长度按类归一（用户 2026-10-17 拍板，已落地）**：长度 = `该箭头量级 ÷ 该类整段最大量级 × 该类满量程`，三类**各自**归一（**力 0.18 > 速度 0.155 > 辅助 0.14 > 加速度 0.13**，单位是"画面短边的分数"）。实现是**两遍法**（与 `AutoView` 同一思路）：第一遍算"不含箭头"的包络并统计每类最大量级，第二遍用归一长度重算包络 —— 否则"箭头长度 ← 相机 ← 包络 ← 箭头长度"会成环。箭头颜色**只由 `category` 决定**；量级为 0 或短于 4px 时**画一个点**（不再"放大到可见"，那会让长度不再等于量级）。
> ✅ **已补齐**：62 处箭头**全部**给了 `mag`（门禁 ㊵『H』节钉住：62/62，缺一根就红）。补的过程中顺带纠正了两处语义：q02 的速度分量改判 `aux`（分量属于"辅助"，与 q04 一致）；q09 回路四边的电流箭头用同一表达式 ⇒ 四条边必然等长。
> **箭头口径的三层防线（第 8 期 · C1 判据 8 · 门禁 ㊶）**：
> · **教**（`sdk/signature-summary.md`，模型读得到的文档）：写明"`mag` 必填、`scale` 已废弃、`color` 由 category 决定"；
> · **拦**（C1 静态预检：`arrow-missing-mag` / `arrow-deprecated-scale` / `arrow-forbidden-color` / `arrow-options-not-literal`）：写了就进校验报告、带行号；
> · **兜**（渲染器）：就算模型写了也不生效（颜色只看 category，长度只看 mag）。
> 三层都要：只靠兜底是**沉默失败**（画面对、报告绿、代码留垃圾，用户称之为"屎山"）；只靠文档拦不住；只靠 C1 则单点失效。
> ```
> **版本口径**：`TEMPLATE_VERSION = SDK_VERSION = 1.0.0`（用户第 4 期裁决**不升**）；
> `contractHash = 225def7f…1a86`（第 5.7 期改 §9.1 字段集与 §2.3 阶段枚举之后的值；本期内变两次：`1ff98c44…48dc` → `2ec3f5a1…3610a`（S2 两处冻结项）→ `225def7f…1a86`（S6 为 `Draw.ground` 补词表元件），见 §17.13）。

---

## 〇、总目录与各期一览

### 0.1 各期一览（交付 / 验收 / 证据 / 落点）

| 期 | 方案 §18 的交付 | 实际交付 | 验收结论 | 证据（门禁步号） | 交付说明 |
|---|---|---|---|---|---|
| **1** | 模板页骨架 · 命令缓冲（M25）· SDK Layer 1 最小集（M28）· `AutoView` | 三栏模板页 + 19 种命令 op + `Draw`/`Phys` + 两遍法 `AutoView` + **手写 15 题** | ✅ 关闭 | ① ② ③ ⑥ ⑦ ⑧ ⑨ ⑩ ⑪ ⑫ | §一～§八 |
| **2** | C1 静态预检（M26）· Worker 沙箱 · C2–C6 · 校验报告（M27） | acorn 单后端 + `worker_threads`+`node:vm`+硬终止 + C2–C6 强化 + **行号级诊断三档强度** | ✅ 关闭 | ④ ⑤（12/12 注入拦下） | §十一 |
| **3** | 端点（M2）· 编排与 SSE（M3）· 标记切分（M4）· 槽位 Prompt（M5）· 播放器协议（M14）· `SYMBOLIC` | 网关 + 编排 + §3.5 零猜测切分 + §13.2 协议定稿 + 关键帧 + **解题页/动画页** | ✅ 关闭 | ⑬～⑳（333 条取证） | §十三 |
| **4** | **C7 强化 · 自愈循环与槽位级重生成（M30）** | 三档证据强度**入契约** + `repair` 进执行链 + 槽位级重生成 + 3 轮上限 + **告警横幅交付** + C7 四项强化 | ✅ 关闭 | **㉑（129 条）** | §十五 |
| **5** | 世界书引擎增强（`code_examples` + `origin` 治理）· 管理器 UI · 预览器 · 词条第三次改写 | `core/worldbook/`（触发六步/三重预算/分槽组装/治理/导入导出/覆盖率）+ 设置页（管理器 + **实时试触发预览器**）+ 解题页「世界书依据」面板 + `od-worldbook` 契约 + **内置最小集 5 条**（内容生产顺延第 5.5 期）<br>**＋ 同日追加：执行链第 0 步 `read_image`（读图转写）**（§17.10）<br>**＋ 同日追加：第 5.5 期工程前置 P1–P3**（词条源目录 / 触发词撞车检查 / 覆盖目标与进度，§17.11） | ✅ 关闭（**W14 内容覆盖部分顺延**，见 17.5） | **㉒（188 条）**＋⑱⑲（读图转写）＋㉒『W14-2/W14-3』（P1–P3） | **§十七**（追加改动见 **17.10 / 17.11 / 17.12**） |
| **6** | **可配置化完全体**：Prompt 编辑器（M5）· 清洗规则编辑器（M4）· 端点管理完整校验（M2）· 规则工作区（SHA256 / 原子载入 / 热重载）· 答案结构模板 | `core/rules/`（工作区底座 + 滚动 5 份备份）· `core/prompts/`（覆盖层 + 硬门禁 + 内置变更提醒 + rebase）· `core/cleaner/policy.mjs`（锁定集，用户绕不过）· `core/gateway/endpoint-store.mjs` + `connection-test.mjs`（Key 单独存 / 导出无 Key / 测试连接）· `core/worldbook/editor.mjs`（词条写回）· `tools/rules-service.mjs` + 前端「规则」页（5 个页签） | ✅ 关闭（**验收原文三条**由总装脚本一口气钉住） | **㉓～㉙（469 条）** ＋ ⑬⑭（含新页面） | **§十八** |
| **7** | 导出三件套（GIF / WebM / 本地 HTML，M17）· 联动图表（M15）· 教辅蒸馏（M19，含扫描版 PDF 逐页多模态） | **联动图表**（独立画布 · 动画下方整宽横条 · 可切量 / 可隐藏 / 常数量不画 · 游标与画布同一个 `t` · 步骤分界线）· **导出网页**（服务端用构建期同一个打包器打单文件页 · 烧录 Provenance · 落 `exports/`）· **导出 GIF**（前端 `gifenc` 逐帧抓取 · 25 fps / 960×540 · 默认不录曲线图）· **教辅蒸馏简版**（`core/distill/` + 蒸馏页 UI：图片/文字导入 · 成本预估 · 页级进度可续做 · 候选卡片 · 人工确认入库）· **版式重构**（三栏 → 两栏 + 导读栏选项卡 + 动画联动开关；画布 16:9 且宽度按视口高度封顶）<br>**WebM 与 PDF 解析：用户取消**（§三.5） | ✅ 关闭（**验收原文四条**由 ㉚㉛㉜ 钉住） | **㉚ 75 · ㉛ 48 · ㉜ 53** ＋ ⑨⑩⑬⑭（模板页改动连带） | **§十九** |

**七期共同的不变量**：§3（7 槽位 / 8 键名）· §9 · §11.2 · §7.2（C1–C9）**一字未改**；
C10 / X1 / X2 始终是**扩展检查**（`blocking:false`，不进 `checks[]`）；
**世界书不是判据**（它是上下文注入，不进 C1–C9 —— 16.4 第 1 条）。

### 0.2 不许退步的基线（每期复跑，第 5.5 / 6 期也要）

| 指标 | 基线值 | 由哪一步守 |
|---|---|---|
| C1–C9 | **15/15 通过 · 0 告警 · 0 失败** | ③ |
| 负向注入 | **12/12 拦下** + 1 条后端一致性对照（口径见 13.5） | ④ |
| 行号级诊断 | 埋点不许挪行、装配后可编译、行号可反查 | ⑤ |
| `Draw.raw` 使用率 | **0.00%**（§19.1 门禁 <10%） | ⑪ |
| 长度上限 | 单槽位 ≤400 行（**`stateAt`+`drawFrame` ≤150 行已于第 8 期取消**，见 §0.4 备忘） | ⑪ |
| 成品页 | **18 个页面**静态体检通过 | ⑩ |
| 公式 | **207 条** MathJax SVG 预渲染 | ⑧ |
| **C7 逐题判定** | 与 `tests/c7-baseline.json` **逐字一致**（第 4 期建立的硬约束） | **㉑『E』** |
| 契约 | `contractHash` 只在**新增产物**时变化，字段形状不得漂移 | ① |
| **世界书：预览器 = 真实请求** | 条件段**逐字节相同**（浏览器侧跑的是 `engine.mjs` 的逐字节副本） | **㉒『W10』+ web-build 判据** |
| **世界书：内置词条结构合规** | **100%**（每条含「生成后自检」小节 + ≥1 段 `code_examples`） | **㉒『W14』** |
| **世界书：空槽 / 截断** | 两者在**数据结构上**就是两个字段，且都能被断言 | **㉒『W7』** |
| **读图转写：纯文字题** | **必跳过**（发 `stage_done` + `skipped:true` + 原因）且**不调模型** | **⑲『A-3』** |
| **读图转写：图片题** | 转写文字**必须进入世界书扫描文本**（正反例各一：转写里有/没有"传送带"） | **⑲『A-3』** |
| **视觉门控（§11.3）** | 带图但 `supportsVision=false` ⇒ 报错停下，**0 次模型调用**（不做假多模态降级） | **⑲『A-3』** |
| 门禁自身的两种读法 | 覆盖自检的 CLI 解析结果 == 内存里的 `STEPS` | **⓪**（第 5 期新增，见 17.4 缺陷 5） |
| **世界书：源 → 库** | `data/`（运行时库）必须等于**从 `source/` 会写出的**内容（逐字节） | **㉒『W14』** |
| **世界书：目标/进度** | 盘上的 `coverage-target.json` == 从书上重新抽取的结果，**且保留已填的 `entryId` 与待办字段** | **㉒『W14-2』** |
| **世界书：触发词撞车** | 主键完全相同或互为子串 ⇒ 报警；槽位不相交 / 同一条内部 / 只在次级键重复 ⇒ **不报** | **㉒『W14-3』** |
| **联动图表：游标 = 读数** | 图表游标的读数与 `readouts(t)` **同一个函数、同一个 t**（不是两套算法各算一遍） | **㉚** |
| **导出 GIF：帧率时长** | 帧数 = `round(duration × fps)`；延时 = 1/fps（25 fps ⇒ 4 cs）；尺寸 = 960×540；末帧 = `t=duration` | **㉛** |
| **导出网页：离线自包含** | 单文件、无外链、`ODRuntime` 就位、Provenance（模板/SDK/模型/promptHash/worldbookHash）**烧录**进页面 | **㉛** |
| **导出落盘边界** | 只走本机同端口（`/api/export/*` → `exports/`）；跨源 403；产物**不进 `ai-rules/`** | **㉛** |
| **蒸馏：人工确认才入库** | 候选卡片不点确认 ⇒ 一个字节都不写；确认后走 `core/worldbook/editor.mjs`（整批校验 + 原子写 + 备份） | **㉜** |

### 0.3 门禁步号索引（`node tools/verify-all.mjs`）

```
⓪ 覆盖自检（漏挂检查脚本 + **两种读法一致**）  ⑰ 标记切分清洗（§3.5 / §12）
① 契约同源校验                          ⑱ Prompt 系统（§10）
② SDK 签名摘要                          ⑲ 编排（§2.3）
③ Dry-Run C1–C9（15 题 · Worker 沙箱）   ⑳ 宿主协议（§13.2）
④ 负向注入验收（§18 期 2）               ㉑ 自愈循环与 C7 强化（第 4 期）
⑤ 埋点与行号映射自检                     ㉒ 世界书（第 5 期 §9.2 / §9.3 / §9.5 · W1–W15）
⑥ C1 判据取证（25 + 6 条）               ㉓ 规则工作区（第 6 期）
⑦ 渲染路径自检                           ㉔ Prompt 编辑器（第 6 期）
⑧ 公式预渲染（MathJax）                  ㉕ 清洗规则策略（第 6 期）
⑨ 成品页打包                             ㉖ 端点配置（第 6 期）
⑩ 成品页静态体检                         ㉗ 第 6 期总装验收（§18 原文三条）
⑪ 长度上限与观测                         ㉘ 规则工作室服务（第 6 期 · 真实 HTTP）
⑫ 总览页生成                             ㉙ 备份与恢复（第 6 期第 3 件）
⑬ 前端类型检查                           ㉚ 联动图表与导读栏（第 7 期）
⑭ 前端打包 + 产物体检                    ㉛ 导出（第 7 期）
⑮ 契约跨字段校验（§11.2 / §12）          ㉜ 教辅蒸馏（第 7 期）
⑯ 模型网关                               ㉝ 安全脱敏与观测（第 8 期 M21/M22）
                                         ㉞ 标注避让（第 8 期 M15 补强）
                                         ㉟ 历史与审计（第 8 期 M23）
                                         ㊱ C2 接线与字体（第 8 期）
                                         ㊲ 方案 A：画布不写文字（第 8 期）
                                         ㊳ 发布构建开关（第 8 期）
                                         ㊴ 内置知识层封死（第 8 期）
                                         ㊵ 矢量按类归一（第 8 期）
                                         ㊶ 箭头参数口径（第 8 期 C1 判据 8）
                                         ㊷ 桌面壳（第 8 期 M24）
                                         ㊸ 真跑链路（第 8 期）
                                         ㊹ 长题归一（第 8 期）
```

**单跑某一步**见 §二；**改模板后必须重跑的三角**见 §16.6 的 C 类坑；
**改世界书引擎后必须重跑的三件事**见 §17.6 的 C 类坑。

> ### ⚠ 2026-10-17 目录清理说明（读本文时必看）
>
> 第 8 期收尾时按用户指示清了一次目录（**35 项 / 17.0 MB / 673 个文件**），删掉的是
> **一次性临时脚本、词条生产的临时工作区、试跑产物，以及已被历史文档取代的语料与留档**。
>
> **所以本文里凡是指向下列名字的引用，都成了"历史记录"（指曾经存在过的东西），不再是可打开的链接**：
> `清理台账-2026-10-16.md` · `测试结果.md` · `测试结果-末轮.md` · `阶段0-题面词汇表.md` ·
> `阶段1-*` 三份 · `主键清单.md` · `第5.7期-S1留档/` · `第5.9期-口径与判准留档/` · `第7期-旧手绘图留档/` ·
> `README-笨蛋版.md` · `exports/` 试跑产物 · `distill-sessions/` 试跑记录 ·
> **第 6 期 6 份交接** · `5.7期工程计划.md` · `5.7期给5.9期的接口说明.md` · `阶段5.7-两侧分发实验报告.md` ·
> `面对第六期工程的交接.md` · `面对第七期工程的交接.md`（第二批 11 份，同日）。
>
> **结论已经抄进两份历史文档**：
> · `软件自研v1开发历史.md`（全量，附录 B 有逐项 SHA256）
> · `软件自研v1开发历史-笨蛋版.md`（大白话）
>
> **明确保留**：`世界书知识库生成指导.md`（词条作业书，正文引用 8 处、`core/worldbook/index.mjs` 注释也指向它）·
> `物理动画原型总览.html`（**构建产物**，门禁 ⑫ 每次重新生成）· `测试用题目/`（视觉门控真图）·
> `_preview-label-avoid/` · `_preview-history/sample.db`（原始教学素材 397 MB 那份**已从仓库移除**，用户曾指定只读）。
>
> 15 道回归题里原本指向旧手绘图留档的 **10 处注释**已同步改写成
> 「软件自研v1开发历史.md 附录 B（原快照已清理）」，不留悬空指针。

### 0.4 目录导航

完整目录树（含每个模块的一句话职责）见 **第十节**。
**第 5 期新增的落点**：
- 引擎与仓库：`core/worldbook/`（engine / store / governance / import-export / coverage / index）· `core/worldbook/data/`（运行时库）· **`core/worldbook/source/`**（词条源，§17.11 P1）· **`core/worldbook/coverage-target.json`**（覆盖目标 + 进度 + 待办，§17.11 P3）· `ai-rules/worldbook/`
- 契约：`contracts/worldbook-pack.schema.json`（+ TS 类型）
- 门禁与工具：`tests/worldbook-selftest.mjs`（㉒）· `tools/rewrite-worldbook-entries.mjs` · `tools/build-worldbook-web.mjs` · **`tools/build-worldbook-targets.mjs`**
- 前端：`web/src/pages/SettingsPage.tsx` · `web/src/lib/worldbook-engine.{js,d.ts}` · `web/src/lib/worldbook-demo.ts` · 解题页「世界书依据」面板
- 文档：**`世界书知识库生成指导.md`**（第 5.5 期作业书）

（完整清单见 §17.8；追加改动的落点见 §17.11）

**第 6 期新增的落点**：`core/rules/`（工作区 / 备份 / 唯一写入口）· `core/prompts/`（覆盖层）· `core/cleaner/policy.mjs`（锁定集）· `core/gateway/endpoint-store.mjs` + `keys.json`（Key 单独存）· `core/worldbook/editor.mjs`（词条写回）· `tools/rules-service.mjs` + `web/src/pages/RulesPage.tsx` + `web/src/lib/rules-api.ts`（规则工作室，门禁 ㉘）

**第 7 期新增的落点**：- 导出：`core/export/page.mjs`（单文件页 + Provenance 烧录 + 落盘清单）· `web/src/lib/gif-encode.js`（浏览器与 node 共用同一份 GIF 编码）· `exports/`（产物，**不进 `ai-rules/`**）
- 蒸馏：`core/distill/index.mjs`（预估 / 消息 / 解析 / 会话 / 入库）· `web/src/pages/DistillPage.tsx`（导航第 5 项）· `distill-sessions/`（会话与候选，可用 `OD_DISTILL_DIR` 重定向）
- 模板与图表：`template/animation-template.html`（两栏 + 导读栏选项卡 + 图表面板 + `window.ODExportHook`）· `template/build-template.mjs`
- 门禁：`tests/chart-selftest.mjs`（㉚）· `tests/export-selftest.mjs`（㉛）· `tests/distill-selftest.mjs`（㉜）
- 服务：`tools/rules-service.mjs` 增 `/api/export/*` · `/api/distill/*` · `/exports/*`（**仍是同一个端口、只绑回环**）
- 留档：`第7期-旧手绘图留档/`（改前的模板页与手绘曲线原件）

**第 8 期新增的落点（进行中）**：
- 安全与观测：`core/security/`（Key 与路径脱敏）· `core/observability/`（运行记录 / 失败复现包 / 自动记录包装器）· `observability/`（产物，**不进 `ai-rules/`**）
- 历史：`core/history/`（SQLite：`runs` / `run_stages` / `audit_log` / `meta`）· `data/history.db`（可用 `OD_HISTORY_PATH` 改）· `4-看账本.bat` + `tools/_history-view.mjs`（**零安装看账本**；`--sample` 造样例库到 `_preview-history/`）
- **看账本的图形工具**：`DB.Browser\DB Browser for SQLite.exe`（用户自装的便携版，**不在清理清单里**）→ `File → Open Database` 选 `data/history.db` 或 `_preview-history/sample.db`
- 标注避让：`sdk/runtime/label-avoid.mjs`（几何与 key 口径，两边共用一份）· `core/dryrun/label-avoid.mjs`（规划器）· 报告里的 `labelAvoid` · `tools/_label-avoid-preview.mjs` → `_preview-label-avoid/index.html`（对比页）
- 门禁：`tests/observability-selftest.mjs`（㉝）· `tests/label-avoid-selftest.mjs`（㉞）· `tests/history-selftest.mjs`（㉟）
- 新增运行时依赖：**`better-sqlite3@13.0.3`**（用户批准；原生模块，**装不上时会明确报 `history.driver-missing`**）

### 0.5 第 8 期用户裁决与**待办备忘**（2026-10-17）

**已裁决并落地**：

| 裁决 | 落地 |
|---|---|
| 思考模式开到 **high**（OpenAI 格式 `thinking:{type:'enabled'}` + `reasoning_effort:'high'`），**读图转写阶段不开** | `core/gateway/model-client.mjs`；网关不认这两个字段时**自动去掉重试一次** |
| **取消 `stateAt + drawFrame ≤150 行`** 上限（"可读性预算不是对错判据"；真题已到 147 行、该用户题实测 154 行） | `contracts/spec/frozen-keys.mjs` 删除该常量；单槽位 400 行**保留** |
| **C2 执行预算 4 秒 → 10 秒** | `DRY_RUN_BUDGET.wallClockMs = 10000` |
| **长题采样归一**：短题（≤10 s）仍 1/240 s；长题封顶 **2400 帧**（`dt = duration/2400`） | `sdk/runtime/animation-runtime.mjs` `scanAll()` |
| **C7 改为在 `at_t` 精确求值**（不依赖采样点）——否则采样变粗会把长题冤杀 | `core/dryrun/dry-run.mjs` `readoutsAt()` |
| `mode`（NUMERIC/SYMBOLIC）**真的进提示词**（只加在任务段，`promptHash` 不变） | `core/prompts/fixed-prefix.mjs` `MODE_NOTES` |

> 门禁 ㊹ 把前四条钉住（含"160 行必须放行"的防回退断言）。

**待办备忘（用户明确"第 2 条不用改，但要加入备忘"）**：

> **规则页 →「动画代码」那段提示是模型真正看到的教材，而它现在教的还是旧口径。**
> 用户将于**新一期对话**里亲自在「规则」页的 `prompts/scene_code.md` 中补写并教会模型；
> **本期不改提示正文**。
>
> 已知需要补的三处（作为下一期的清单，不是本期的改动）：
> 1. 第 142 行的箭头签名是 `Draw.arrow(from, vec, { category, label })` —— **没有 `mag`**；
> 2. 第 146–147 行只说 `setup` 可用 `RETURN` 导出，**没说别的槽位要用 `context.X` 去读**；
> 3. 没有 `VIEW` 的写法说明（必须写 `SIM = {…}`，**不能写 `const SIM = …`**）。
>
> 另外第 8 期还留下两条"待议"：**① `C1` 里 `color`/`scale` 是否降级为提醒**（渲染器已不理它们）；
> **② 缺 `mag` 是否改为"兜底 + 提醒"**（现在仍是硬拒）。



> ⚠ **§一～§十三 的标题沿用各期当时的编号与措辞**（例如 §一 写的是"本期交付了什么"，
> 那个"本期"指**第 1 期**）。它们**是留档**，不是当前期的口径 —— **当前期永远是最后的一节（现在是 §二十）**。
> 这样保留的原因：改标题会让 §四 / §11.7 / §13.4 等处的交叉引用（"见第 X 节"）全部失效，
> 而那些引用散落在代码注释与门禁输出里。
> **第 9 期只改了"口径"（提示词 / 世界书 / 判据分级），见 §二十；完整版见 `第9期交付说明.md`。**

---

## 一、本期交付了什么

| 交付项（§18 期 1） | 落地位置 |
|---|---|
| §3.2 八键名 + §9.1 世界书字段冻结，Schema 与 TS 类型**同源生成** | `contracts/` |
| §3.1 模板页骨架（三栏 + 数据面板 + 播放控件 + 自包含） | `template/animation-template.html` |
| §5 命令缓冲（记录结构 / 三个消费者 / 矢量分类 / `Draw.raw`） | `sdk/runtime/animation-runtime.mjs` |
| §4.2 / §4.3 教具 SDK Layer 1 最小集 + §4.5 签名摘要 | 同上 + `sdk/signature-summary.{json,md}` |
| §4.6 `AutoView`（两遍法，包络来自命令缓冲） | 同上 |
| §19.5 15 道手写题槽位代码 | `tests/regression-15/q*.mjs` |
| §7.2 C1–C9 校验（第 1 期口径：最小可用校验器） | `core/dryrun/` + `core/lint/` |
| 成品单文件页面 + 总览 | `template/build/*.html` · `物理动画原型总览.html` |

### 契约（§3.2 / §3.3 / §3.4 / §3.6 / §9.1 / §11.1 / §12）

`contracts/spec/` 是**唯一事实来源**，`contracts/generate-contracts.mjs` 同一份描述子同时产出 JSON Schema 与 TS 类型——两者不可能各自漂移（§3.6 / §21.1 第 1 条）。

生成前会跑编译期不变量断言，破坏冻结口径即构建失败，例如：
`slots.required` 必须**恰好且按序**等于 `PROBLEM · STEPS · ANSWERS · VIEW · setup · stateAt · drawFrame · readouts`；
`slots` 必须 `additionalProperties: false`（防止偷塞第 9 个键）；
`stateAt` 与 `drawFrame` 不得合并；`insertion_slot` 枚举不得出现 v2 旧名 `scene_spec`。

### 命令缓冲与渲染器（§5 / M25）

- `drawFrame` 拿不到 `ctx`，只能经 `Draw.*` 推记录（19 种 op）；
- 三个消费者共用一套记录：Dry-Run 只计数不画（零 DOM 成本）、实时播放回放 Canvas 2D、导出渲帧**直接送真浏览器截图**（第 1、2 期用 Open Design 的 `od export --format image`；迁移到 DeepSeek Harness 后暂无等价入口，见第三/六节的取证说明与 `清理台账-2026-10-16.md`）；
- 箭头强制带 `category`（`velocity` / `acceleration` / `force` / `aux`），前端按分类过滤即可分别开关，**不需要模型配合**；
- `Draw.raw` 逃生门：Dry-Run 只跳过该条指令的包络计算、**不放弃整帧门禁**，使用率计入观测。

### 模板页（§3.1 / §13）

三栏顺序不可调换（原题 / 分步解析 / 动画与数据），解析栏禁止内部滚动、整页滚动；公式容器无横向溢出；数据面板给出当前步骤标题 + 说明 + 实时读数网格；播放控件在模板页内（播放/暂停、上一步/下一步、重置、时间轴、0.25×–4× 倍速）；矢量三类独立开关 + 轨迹虚线 + 坐标网格；开关状态写入 `localStorage`；`postMessage` 从端已按 §13.2 草案实现（第 3 期定稿）。

---

## 二、怎么跑

**先跑环境自检**（这一步能省掉一小时的误判）：

```powershell
node tools/doctor.mjs
```

它会告诉你：真 Node 在哪、`OD_NODE_BIN` 状态、依赖是否就位。

### ⚠ 关于运行时（2026-10 迁移到 DeepSeek Harness 后已更新）

> **本节原写于第 1 期（当时在 Open Design 里工作），归因有两处不准，已更正。**
> 旧文写"`OD_NODE_BIN` 指向 Electron 壳 ⇒ 两个假故障"，**实测量结果如下**：

| 当时的说法 | 实测真相 |
|---|---|
| `OD_NODE_BIN` 在本机指向 `E:\Work\Open Design\Open Design.exe` | ⚠ **当前环境里它根本没被设置**（进程级 / 用户级注册表 / 机器级注册表三处皆无）。它是**宿主应用启动会话时临时注入**的，只从那个应用里跑脚本才会带上 |
| 用它跑脚本 ⇒ `spawnSync` 一律 EPERM | ⚠ **归因错误**：真 Node 下同样 EPERM。真因是**宿主沙箱禁止管道捕获子进程输出**（本文件第 125 行原本就写对了） |
| 用它跑脚本 ⇒ `fetch` 拿不到网络 | ⚠ **归因不完整**：真 Node 下实测 `fetch` 正常（`HTTP 200`）、本地回环端口可绑定。更可能的原因是那个 exe **压根没在执行 Node 代码**（Electron 主程序不是 Node 运行时） |

**那当时为什么真的会出问题？** 因为若脚本是在 Electron 里被拉起，`process.execPath` 就指向 Electron，
而解析器里的 `isSelfNode()` 只检查 `process.versions.node`——**这个字段在 Electron 主进程里同样存在**，
于是会把壳当作真 Node 放行（`tools/node-bin.mjs` 的 `isRealNode()` 本身是可靠的，但它排在这一道之后）。
这条**已在第 3 期修正**（见 `tools/node-bin.mjs` 的 `isSelfNode`）。

**现在无需手动设任何环境变量**：`tools/node-bin.mjs` 按
`OD_REAL_NODE → process.execPath → OD_NODE_BIN → toolchain 探测 → PATH` 解析，
并会用 `isRealNode()` 拒绝名字含 `open design` / `electron` 的路径。
本机实测解析到宿主 toolchain 的 Node，**直接 `node tools/verify-all.mjs` 即可**：

```powershell
node tools/doctor.mjs        # 应显示运行时来源与版本
node tools/verify-all.mjs    # 十二步全绿
```

> 只有当解析失败时，才需要用 `$env:OD_REAL_NODE = "<node.exe 的路径>"` 显式指定。

### 一条命令跑完全部门禁

```powershell
node tools/verify-all.mjs
```

**二十九步**，任一步失败即整体失败：
```
① contracts:verify   契约产物与 spec 逐字节一致（§21.1 第 1 条）
② sdk:signatures     签名摘要与 SDK 导出面一致（§4.5）
③ dryrun             §7.2 C1–C9 全量（15 题，跑在 Worker 沙箱里）
④ inject:test        §18 期 2 验收：五类负向注入必须被拦下并给出行号级诊断
⑤ instrument:selftest 行号级诊断的地基：埋点不许挪行、装配后必须可编译、行号必须能反查
⑥ lint:selftest      C1 判据 25 条 + ANSWERS 结构 6 条逐条取证
⑦ render:check       命令缓冲 → 屏幕像素这条链路（mock canvas）+ 相机不变量 + **"轨迹"开关必须改变画面** + **画布/读数无长小数** + **SYMBOLIC 题的箭头必须全带 `latex`（符号标注）**
⑧ tex:build          公式预渲染（mathjax-full Node API → SVG + 字形去重）
⑨ template:build     打包成品页 + 题目列表（ESM→经典脚本转换；残留 import/export 一律构建期报错）
⑩ layout:lint        成品页静态体检（自包含 / 三栏 / 焦点环 / 无内部滚动 / 公式内联 /
                     **内联脚本按经典脚本语法检查并真跑一遍运行时，断言 window.ODRuntime 就位** /
                     **相对链接有效** / **"下一步"能逐级走完**）
⑪ budget:check       长度上限（§6.2）与观测指标汇总
⑫ overview:build     总览页（判定取自真实报告）
⑬ web:typecheck      【第 3 期】web/ 的 TypeScript 类型检查（tsc，严格模式）
⑭ web:build          【第 3 期】web/ 转译 + Rollup 打包 + Tailwind + **产物体检**
                     （自包含 / 无外链 / 无残留 ESM 语句）
⑮ contracts:fields   【第 3 期】契约**跨字段**校验逐条取证：§11.2 九条 + §12 清洗规则
                     （§11.2 有一半规则 JSON Schema 表达不了：不得成环 / 引用存在 / 视觉门控 / 体积）
⑯ gateway            【第 3 期】模型网关取证：SSE 流式 / 跨 chunk 缓冲 / 错误分类（401·429·400·5xx·网络）
                     / 超时与取消是两条路径 / 流被截断不静默 / 图片多模态 / §11.3 视觉门控
                     （打**本地假端点**，结论确定性）
⑰ cleaner            【第 3 期】标记切分清洗取证：§3.5 零猜测切分 / 四类硬失败区分 /
                     **行号保真**（切分不许挪动行号）/ §12 兜底与灾难性正则形态拒绝
⑱ prompts            【第 3 期】Prompt 系统取证：§10.2 三段结构 / **promptHash 语义**
                     （换题换图都不变、改 Prompt 必变）/ §10.1 的 7 项 Prompt
⑲ orchestrator       【第 3 期】编排取证：事件流与阶段链 / **每题配置快照** / **取消无残留** /
                     不静默交付（模型报错·切分失败·Dry-Run 失败都如实透传）/
                     端到端（用**真题 q01** 的槽位当"模型输出"，真 Dry-Run 判一次）
⑳ host-protocol      【第 3 期】宿主协议取证（§13.2 定稿）：在 vm 里**真跑一遍模板页内联脚本**，
                     验 `program` 运行时注入 / source 方向判据 / 成品页拒绝覆盖（§13.1 导出保真）/
                     8 条控制消息 / 协议文档与契约同源
㉑ repair             【第 4 期】自愈循环与 C7 强化（B1–B6）+ **15 题 C7 判定与第 3 期逐题一致**
㉒ worldbook          【第 5 / 5.7 期】世界书：触发六步 / 治理 / 导入导出 / 覆盖率 / **预览器与实际请求逐字节一致**
㉓ rules-workspace    【第 6 期】规则工作区：每文件 SHA256 / 整批失败（点名到文件）/ 冲突拒绝 /
                     写盘中途失败回滚 / **热重载 = 下一题生效而跑着的题保持原快照**
㉔ prompt-overrides   【第 6 期】Prompt 覆盖：按"会不会跑"分组 · `read_problem` 缺【考点】/【动画元件】**保存即拒** ·
                     内置变更提醒 + 行级差异 + 换基线 · **覆盖真的进了 system 消息且不改 `promptHash`**
㉕ cleaning-policy    【第 6 期】清洗策略：锁定集是数据且与实现不漂移 · 文件层/运行时/编辑器三条入口都绕不过 ·
                     锁定规则**关不掉**（`enabled:false` ⇒ `cleaning.policy-broken`）· 用户规则真的洗到槽位
㉖ endpoint-store     【第 6 期】端点：Key 单独存 · **导出结构性无 Key** · 导入三种拒绝 · 删除级联 ·
                     孤儿 Key 降级报警 · 测试连接真发请求且出口脱敏
㉗ phase6-acceptance  【第 6 期】**验收原文三条**总装：四类改动下一题生效且跑着的题不受影响 · 导出无 Key ·
                     改坏被拒并指出位置；另含一次整机链路
㉘ rules-service      【第 6 期】本机服务（真实 HTTP）：能改 / 改坏被拒 / **Key 不出门** / 跨源被拦 / 路径穿越被拦
㉙ backup             【第 6 期】备份与恢复：滚动 5 份 · 恢复可撤销 · **`keys.json` 永不备份** · 备份目录不被扫描
```

**另有 ⓪ 覆盖自检**（在 ① 之前跑）：断言仓内所有独立的检查脚本都已被本门禁挂载 ——
它防的是"**检查写了却没接进门禁**"（那种情况下门禁全绿，而检查从未跑过）。
见 `tools/verify-coverage.mjs` 与 13.7。

> **门禁步数沿革**：第 1 期**十步** → 第 2 期**十二步**（新增 ④ 负向注入、⑤ 埋点自检）→
> **第 3 期二十步 + ⓪ 覆盖自检**（新增 ⑬⑭ 前端 · ⑮ 契约 · ⑯ 网关 · ⑰ 切分 · ⑱ Prompt · ⑲ 编排 · ⑳ 宿主协议）→
> 第 4 期**二十一步**（㉑ 自愈与 C7 强化）→ 第 5 / 5.7 期**二十二步**（㉒ 世界书）→
> **第 6 期二十九步**（㉓ 规则工作区 · ㉔ Prompt 覆盖 · ㉕ 清洗策略 · ㉖ 端点 · ㉗ 总装验收 · ㉘ 规则工作室服务 · ㉙ 备份）。

单跑某一步：

```powershell
node contracts/generate-contracts.mjs      # 契约同源生成（改 spec 后必跑）
node core/dryrun/run-suite.mjs             # 全部题目
node core/dryrun/run-suite.mjs q01 q07     # 只跑指定题
node tests/negative-injection/run-injection.mjs    # 负向注入验收（§18 期 2）
node tests/negative-injection/run-injection.mjs nan  # 只跑 id 含 nan 的用例
node tests/instrument-selftest.mjs         # 埋点 / 行号映射自检
node tests/lint-selftest.mjs               # C1 判据逐条取证
node tools/build-tex-svg.mjs               # 公式预渲染
node template/build-template.mjs           # 打包成品页
node tools/budget-check.mjs                # 长度上限与观测
node tools/layout-lint.mjs                 # 成品页静态体检
node tools/build-overview.mjs              # 生成总览页
node tools/probe-question.mjs q02          # 单题几何/数值探针（作者自检，非判据）
node tools/probe-question.mjs q02 --json   # 同上，机器可读（含各阶段状态量实测范围）
node tools/_worker-probe.mjs               # Worker 能力取证（子进程/vm/内存上限/硬终止取行号）
node tools/web-build.mjs                   # 【第 3 期】前端全链：类型检查 + 转译 + 打包 + 产物体检
node tools/web-build.mjs --check           # 【第 3 期】只做前端类型检查
```

### 【第 3 期】前端怎么装、怎么跑

⚠ **Vite 在本沙箱不可用**（详见第十二节 12.11 与 `web/rollup.config.mjs` 顶部说明），
前端用 **TypeScript + Rollup** 构建。安装必须带 `--prefix web` 与 `--ignore-scripts`：

```powershell
# 缓存必须落在项目内（默认缓存在可写范围之外会 EPERM）
$env:NPM_CONFIG_CACHE = "C:\Users\<你>\Desktop\Work\.npm-cache"
npm install --prefix web --ignore-scripts
node tools/web-build.mjs          # 应当全绿，产出 web/dist/
```

产物：`web/dist/index.html` + `web/dist/assets/app.{js,css}` —— **相对路径、无外链**，
双击 `web/dist/index.html` 即可离线打开（第 6 步会把它换成真正的解题页 + 动画页）。

产物：
- `物理动画原型总览.html` —— 入口页，表格里的 C1–C9 九格 + `C10ᵉˣᵗ` 一列都是真实判定（C10 为扩展检查，未声明记 `·`）；
- `template/build/<题目>.html` —— **单文件自包含**，双击离线播放，无外部请求（公式已内联为 MathJax SVG）；
- `template/vendor/tex-svg/` —— 公式预渲染中间产物（每页的 SVG + 用到的字形）；
- `tests/reports/` —— `*.dryrun.json`（逐题）、`dry-run-report.json`、`summary.md`。

> 注：本沙箱禁止**管道捕获**子进程输出（任何 exe 都 EPERM），只能用 `stdio:'inherit'`。
> `verify-all` 因此会先探测：能开子进程就走子进程，否则退化为同进程导入——两条路径跑同一份 `main()`，结论一致。
>
> npm 安装请先让缓存落在项目内（`.npmrc` 已配好 `cache=.npm-cache`），否则会因默认缓存目录在可写范围之外而 EPERM。

---

## 三、第 1 期的执行口径

> **本轮更新（用户决议后）**：C1 已换成 **acorn 单后端**；公式已换成 **MathJax 真渲染**。
> 下表中标注「已按决议更新」的两行是最新的；其余行的口径不变。

| 项 | 方案原文 | 本期实际 | 说明 |
|---|---|---|---|
| C1 解析后端 | `acorn`（§2.2） | **acorn@8 单后端（已按决议更新）** | 之前的"自写 tokenizer"已删除，项目从此强依赖 `node_modules`。判据仍是 §6.2 全表，但语法诊断变成 acorn 的真实行列号，作用域变成真作用域链。原先那条"`stateAt` 内禁止 `Phys.integrate`"曾因 `!isMember` 前置过滤而成为**死代码**，换 AST 后改为直接看 `CallExpression.callee` 结构，并补了正反例取证 |
| 公式渲染 | MathJax 3.2.2 SVG 完全内联（§2.2） | **mathjax-full@3.2.2 构建期预渲染（已按决议更新）** | 浏览器内跑 MathJax 需要把它打成 IIFE，这要 esbuild；本机装不上 esbuild（`npm install` 报 up to date 但包不存在，postinstall 被限制）。因此改为**同样离线、同样零外链**的等价做法：构建期用 mathjax-full 的 Node API `tex2svg` 渲染，产出 SVG + **按页去重的字形 `<defs>`** 内联进单文件 HTML，运行期不再需要 MathJax 本体。15 题共 207 条公式（按页去重后的唯一文本数）全部命中；每页字形 76–156 个，页面总大小 **185–247 KB**（去掉了注释区的重复注入后，比修复前小 27%）。降级链保留为"预渲染 → ODTex 行内 → 原文" |
| Dry-Run 执行 | `worker_threads` + `node:vm` + `resourceLimits`（§6.3） | `node:vm` 新上下文 + 整段扫描在脚本内 + **`vm.Script` 墙钟硬超时** | 原先判断"沙箱禁止子进程"是**误判**（根因是 `OD_NODE_BIN` 指向 Electron 壳）。实测 `stdio:'inherit'` 可以开子进程，只有"管道捕获"被禁。`core/dryrun/child-runner.mjs` 已就绪，第 2 期接 Worker + `resourceLimits` 时直接换后端 |
| 数据型槽位格式 | 标记切分（§3.5） | 标记切分不变；`STEPS` / `ANSWERS` 用**行式表**（`key: value`，`"""` 包多行） | 这两个槽位全是 LaTeX，写成 JSON 会把 `\frac` 吃成转义序列。行式表不解释转义，且解析失败即报错（§3.2 审计 2 不允许静默通过）。JSON 数组仍作为兼容入口 |
| 关键帧（四件套之四） | §7.5 | 本期未产出 | 关键帧是播放器能力，随第 3 期宿主协议落地；本期三件套（校验报告 / 图表数据 / AutoView 包络）已产出 |
| 多场景（一题多段动画） | §22 第 10 条 | 单场景 + 多连续阶段 | 用户已裁决（`single_scene_multi_stage`）；多场景模板排第 3 期，不改模板架构 |
| SDK Layer 1 冻结范围 | §22 第 8 条 | 只冻结 15 道题实际用到的 | 用户已裁决（`used_by_15`）；未被任何一道题用到的原语本期不实现、不进签名摘要 |
| 讲解模式 | §22 第 5 条 | 只留结构位、不做 UI | 用户已裁决（`reserve_only`）；模板暴露 `--scale` 字号变量，无额外交互控件 |

### 两处需要在验收时确认的判据实现细节

1. **C6「比较位置」的口径**（§7.2 原文：*在每个 `t0/t1` ± ε 比较**位置**，不得跳变*）
   摩擦力、加速度这类量在阶段边界**物理上本来就会阶跃**（传送带共速瞬间 `f` 由 `μmg` 突变为 0）。
   因此 C6 只覆盖**位置类分量**：优先用 `VIEW` 槽位的 `SIM.continuityKeys` 显式声明；
   未声明时自动识别"全时段任意相邻采样都连续、且总变化量非零"的分量。判定结果里会写明用了哪些分量与识别方式。

2. **C9「包络必须变化」的口径**（§7.2 原文：*命令缓冲**包络**随时间必须变化*）
   有一类题**物理正确却包络恒定**：p–V 等温图、驻波快照、电路暂态曲线——画布世界坐标范围全程不变，动的是曲线上的数据点与游标。
   若只看包络，这些题会被误判为"静止画面"。实测信号因此取两个：**① 包络变化；② 任一命令坐标发生变化**；两者满足其一即判为有活动，两者都不满足才是真的静止。
   判据强度不变（C9 是告警）。若要求严格按原文只认包络，把 `checkActivity` 的 `requireEnvelope` 置为 `true` 即可。

同时修掉了一个**肯定的误报**：`VIEW` 槽位写的 `SIM.axes[].key` 只是提示信息（前端图表轴的显示名），
不应纳入 C8 的"单位全时段不变"比对——真实稳定性由 `readouts` 的键集合与单位决定。已在 C8 实现里注明。

---

## 四、冲突与偏差（按约定先报告，未擅自改冻结项）

1. **§7.2 与 §18 的期次错位**：§18 把 C1 排在第 2 期、C7 排在第 4 期，但第 1 期验收又要求"跑 §7.2 的 C1–C9"。
   用户裁决：**最小可用校验器**——判据与报告结构写全，重型隔离推迟第 2 期。已按此执行。
2. **§19.5 第 15 题与 §18 的期次错位**：第 15 题是纯符号题（`SYMBOLIC`），而 §18 把 `SYMBOLIC` 模式放在第 3 期。
   第 1 期按"数值基准实例驱动运动 + `latex` 标注"的最小口径手写，模式开关留第 3 期。已在题目文件头注明。
3. **§3.3 命名口径**：`ANSWERS` 的 `at_t` / `latex` 与项目其余地方的 camelCase 口径不一致。
   §3.2 审计要求第 3 条（键名大小写敏感）优先，因此**逐字采用 §3.3 写法**，未合并、未改名。待用户裁决是否统一。
4. **`STEPS` / `ANSWERS` 的书写格式**：方案未规定槽位正文的具体语法。本期定为行式表（见第三节）。**这是新引入的实现约定**，需要用户确认或改口径。
5. **C10「物理包络」与 §7.2 的关系**：审计与修正稿都建议"新增 C10"。**§7.2 冻结的是 C1–C9，我没有改动它**，
   而是把 C10 做成**扩展检查**：报告里单列 `extensions[]`、严重度 `extension`、`blocking: false`，
   未声明 `SIM.regions` 的题记为 `skip` 且不判失败。理由：§7.2 是冻结项，往里加判据属于改冻结口径；
   而"合物理"这一层确实需要一个落点（否则"落地前飞到地下 2 米"这类错误仍能全绿通关）。
   若用户希望 C10 **升级为第 2 期的正式判据**（进 `checks[]`、可 blocking），只需要改 `core/dryrun/dry-run.mjs`
   里 `extensions` 的挂载点——判据实现本身已经写好并用 7 道题验证过。
   C10 当前的能力面：`x`/`y` 区间、`insideCircle`、`belowY`、`maxAbs`（可指定任意状态键）。
   它还**不能**表达"悬挂物不得越过滑轮"这类**相对几何**约束（需要 `expr`/`ref` 之类的扩展），这部分留给第 2 期。

---

## 五、§21.3 每期自查清单（逐条结论）

- [x] **本期交付项全部可用，无占位符、无未完成分支。** 见第六节的逐条结论；全仓检索无未替换占位符、无 `TODO` 残留（`tools/layout-lint.mjs` 会对每个成品页复查一次）。
- [x] **本期新增/修改的契约已写入 `contracts/` 并在文档中同步。** 5 份 schema + 5 份 TS 类型 + `slot-keys.json` + `worldbook-slot-names.json` + `manifest.json`，全部由 `contracts/spec/` 同源生成；`contracts:gen` 内置不变量断言。
- [x] **C1–C9 中本期涉及项可独立触发并有测试。** `tests/lint-selftest.mjs` 对 C1 的 **25 条**判据 + `ANSWERS` 结构 6 条逐条取证（正例 + 反例）；`core/dryrun/run-suite.mjs` 对 15 题跑全表；`tools/render-check.mjs` 覆盖渲染路径。
  （第 2 期的负向注入用例——NaN / 瞬移 / 时间断裂 / 死循环 / `require`——属期 2 验收；本期已用 C1 的静态等价反例先覆盖了一半，见第六节。）
- [x] **回归题集通过率与上一期对比无回退。** 第 1 期为首期，无基线；换 acorn 后端后已复跑：15/15 仍全通过，无回退。
- [x] **依赖清单准确。** `dependencies` = `acorn@8`（C1 AST 后端）、`mathjax-full@3.2.2`（公式预渲染）。**已不再是"零外部依赖"**——这是用户本轮决议的直接结果（C1 只保留 acorn 单后端）。浏览器产物依然零外链、零运行时依赖。
- [x] **取消、错误、空态、降级四种路径均已手动走通。**
  取消：模板页播放可随时暂停/重置；Dry-Run 有墙钟硬超时（C2）。
  错误：槽位缺失/为空、行式表结构错误、`SIM.duration` 缺失、未声明全局、`stateAt` 调 `Phys.integrate`、中段语法错误——均给出**行号级**诊断（acorn 后端下还带精确列号）。
  空态：`readouts(t)` 返回空数组时数据面板给出"该时刻无读数"；`Draw.raw` 计数为 0 时观测值正常显示。
  降级：公式"预渲染 SVG → ODTex 行内 → 原文"三级链；`tools/build-tex-svg.mjs` 渲染失败会逐条告警而不是静默丢公式。
- [x] **本轮遗留问题与冲突已写入交付说明。** 即第三、四节。

---

## 六、回归题集结果（§7.2 C1–C9）

`core/dryrun/run-suite.mjs` 的实际输出（判定取自报告文件，非手写）：

| 指标 | 结果 |
|---|---|
| 题量 | **15 / 15** |
| `C1–C9` 全通过 | **15 题（100%）· 0 告警 · 0 失败** |
| 失败检查号分布 | 无 |
| `C7` 答案闭环 | 4/4、5/5、4/4、5/5、5/5、5/5、5/5、5/5、4/4、3/3、4/4、5/5、4/4、4/4、3/3 —— 全部逐条复现 |
| `Draw.raw` 使用率 | **0.00%**（0 / 252251 条命令，第 2 期复测）——§19.1 门禁 <10%，说明 Layer 1 覆盖够用 |
| 单帧命令数峰值 | 33（预算 800，C9 告警线） |
| `stateAt` 架构不变量 | C1 对 `stateAt` 静态拒绝 `Phys.integrate`，15 题全时段通过 |
| 渲染路径自检 | 15 题全部通过（有帧、有读数、AutoView 缩放合法、**相机全时段锁定**） |
| 成品页静态体检 | **18 个页面**（16 个成品页 + `物理动画原型总览.html` + `tests/regression-15/gallery.html`）全部通过（自包含 / 三栏 / 焦点环 / 无内部滚动 / **公式内联** / **内联脚本可当经典脚本执行、运行时 38 项导出就位** / **相对链接有效**） |
| 代码长度上限 | 15 题均在上限内（单槽位 ≤400 行；`stateAt`+`drawFrame` ≤150 行，实测最大 **146**（q02）、次大 139（q14）） |
| 公式渲染 | **207 条公式全部由 mathjax-full@3.2.2 预渲染为 SVG**；每页字形 76–156 个（按页去重），页面 **185–247 KB**（16 页合计 3.23 MB） |
| `C10` 物理包络（**扩展检查**） | **7 题声明、14 条区域、全部满足**（q01/02/06/07/08/13/14）；其余 8 题未声明即 `skip`，**不判失败** |

`C1` 静态判据另有 **25 条逐条取证** + `ANSWERS` 结构判据 **6 条取证**（`tests/lint-selftest.mjs`），每条配正例或反例：
`require` / `import` / `eval` / `Function` / `window` / `document` / `fetch`、原型链逃逸三连、
`while(true)` / `for(;;)` / 无上界递归、`stateAt` 内 `Phys.integrate`（成员调用与裸调用两种写法）、
未声明全局、跨槽位未走 `context`、**中段语法错误（acorn 给出精确行列号）**、槽位超长——全部按预期被拦下，合法写法不被误伤；
`ANSWERS` 侧覆盖"纯符号题缺 `latex`""缺 `at_t`""缺 `symbol`""值不是数值"四种应拒形态。

完整判定见 `物理动画原型总览.html`；逐题细节见 `tests/reports/`。

> **`C10` 是什么、为什么单列一列**：C10「物理包络合理性」是**扩展检查**，**不属于 §7.2 冻结的 C1–C9**（§7.2 一字未改）。
> 它由 `VIEW` 槽位**自愿**声明各阶段的合法区域（`SIM.regions`，支持 `x`/`y` 区间、`insideCircle`、`belowY`、`maxAbs`），
> Dry-Run 逐采样点校验；**未声明即 `skip`，不判失败**。它被单列一列的原因见第四节第 5 条：
> 有真实的物理错误（"落地前飞到地下"）能骗过 C1–C9，因为那九条只管"自洽"、不管"合物理"。

> **真实浏览器渲染取证（含一次"我先判错、后来自己推翻"的过程，值得一读）**
>
> `tests/reports/q02/q06/q08-preview.png` 是把成品页送进真实渲染器（当时用 Open Design 的
> `od export … --format image`）得到的截图：
> 页面 166–184 KB，动画列在 q02 与 q06 之间有 **24.24%** 的像素不同 —— 画布里的图**确实进了截图**。
>
> 这条结论我一开始是**错的**，两个坑都很典型：
>
> 1. **坑一："截图不含 canvas"的误判。** 我把 `drawFrame` 换成 `return;` 做对照变体，导出后与真图**逐像素完全一致**（0.00%），
>    于是断定"截图工具不截 canvas"。**这个观察是真的，但归因错了**：页面当时根本没跑起来（见坑二），
>    画布全空，清不清空 `drawFrame` 当然都一样。
> 2. **坑二："画布自证探针"的假阳性。** 我写了个变体用 `getImageData` 读回画布、把结论编码成左上角 60×60 色块，
>    读到**洋红（=有内容）**就下了"浏览器确实绘出了动画"的结论 —— **假阳性**：
>    没绘制过的 canvas 读回来是**全透明** `(0,0,0,0)`，我只按 RGB 判 `r<240||g<240||b<240`，
>    而透明像素 RGB 全为 0 ⇒ **整块画布都被算成"有内容"**。判 canvas 必须**同时看 alpha**（探针已修）。
>
> **真相**（你点开白屏后定位到的）：`sdk/runtime/animation-runtime.mjs` 里有一句
> `import { fullEnvelope as computeFullEnvelope } from './program-runner.mjs'`。
> 运行时会被 `toClassicScript` 转成**经典脚本**内联进 HTML，而经典脚本里的 `import` 是**语法错误**，
> 整段脚本不执行 ⇒ `window.ODRuntime` 未定义 ⇒ `boot()` 立刻 `showNotice('运行时未注入…')` ⇒
> **16 个成品页全部白屏**。左栏题目、中栏解析、右栏读数**全都是 `boot()` 里由 JS 填进去的**
> （`buildProblem()` / `buildSteps()` / `renderReadouts()`），`boot()` 一 return，三栏就都是空的 ——
> 所以你看到的是"三栏骨架 + 一句提示"，而不是"只缺动画"。
>
> 这条路径此前**没有任何门禁覆盖**：Dry-Run 走 Node ESM（不碰经典脚本转换）、render-check 用 mock canvas（不读 HTML）、
> layout-lint 只查占位符是否替换（而占位符**确实**替换好了）。现在三层都补上：
> - `toClassicScript` 遇到残留 `import` **构建期直接报错**并指出行号；
> - `tools/layout-lint.mjs` 对每个成品页的每段内联脚本做**经典脚本语法检查**，再把运行时那段**真跑一遍**（喂 `window` 空壳），
>   断言产出 `window.ODRuntime` 且带 `assembleProgramSource / sandboxBundle / createPlayerFromFactory`（当前 38 项导出）；
> - 修好后重跑负对照：清空 `drawFrame` 的变体与真图差 **8784 像素（动画列 1.39%）**，差值恰好是那一帧画出的线条与箭头。
>
> 复现命令（**下面是 Open Design 时代的原始命令，留档**。`od export` 依赖 Open Design 渲染器，
> 迁移到 DeepSeek Harness 后**不可用**；`_make-variant` 与 `_png-stats` 两步仍然有效）：
>
> ```powershell
> node tools/_make-variant.mjs q02-incline-arc-projectile canvas-probe   # 页面内 getImageData 自证（已修 alpha 判据）
> od export template/build/_variant-canvas-probe.html --project <id> --format image --out tests/reports/canvas-probe.png
> #   ↑ 历史步骤：需要 Open Design 的 od CLI（当前环境没有）
> node tools/_png-stats.mjs --pixel 30,30 tests/reports/canvas-probe.png
> #   → #ff00ff（洋红）：画布里有 >2000 个**不透明**非背景像素
>
> node tools/_make-variant.mjs q02-incline-arc-projectile empty-draw    # 负对照：清空 drawFrame
> od export template/build/_variant-empty-draw.html --project <id> --format image --out tests/reports/_v1.png
> #   ↑ 同上，历史步骤
> node tools/_png-stats.mjs --diff tests/reports/q02-preview.png tests/reports/_v1.png
> #   → 动画列不同 1.39%：差值 = 那一帧画出来的图元（若为 0.00% 就说明画布根本没画）
> ```
>
> 用完记得删掉 `template/build/_variant-*.html`（这些是临时变体页）。
>
> 结论：**"页面能启动 + 画布能画"现在由门禁与浏览器双重覆盖**；**像素级观感仍然只能你自己看** ——
> 双击 `template/build/*.html`（离线自包含，公式已是 MathJax SVG）。

---

## 七、本轮发现并修掉的缺陷

前四个是 SDK/判据自身的缺陷（不是题目写错），后两个是书写/环境约定的坑；全部已修并复验：

1. **C1 的"`stateAt` 内禁止 `Phys.integrate`"曾是死代码。**
   原实现先用 `!isMember` 过滤，而 `Phys.integrate(...)` 里的 `Phys` 是成员表达式的**对象**（后面跟 `.`，不是 `.Phys`），
   于是整条判据永远不会触发——这是 §7.6 架构不变量的唯一强制点。换 acorn 后改为直接看 `CallExpression.callee` 结构，并补了正反例取证。
2. **`AutoView` 的箭头包络没乘 `scale`。**
   包络用 `from + vec`，渲染器画的是 `from + vec × scale`；按"`vec` 是物理量、`scale` 是几何换算"的文档口径传参时，
   包络会被放大 1/scale 倍，整幅画面被严重缩小。已统一为 `from + vec × scale`。
3. **跨槽位导出的键名与 `STEPS` 字段同名会被静默覆盖。**
   装配时 `context.STEPS = STEPS`，若 setup 里 `RETURN('t1', …)`，`t1` 会被每步的 `t1` 覆盖（`t0` / `title` / `tex` 同理）。
   这是 §3.5「零猜测」之外必须写进 SDK 约定的坑：**导出键名不得与 `STEPS` 字段同名**，已在题目标注并从装配层注释固化。
4. **C1 按 `Program` 解析槽位会误报。** 槽位代码在装配后是**函数体**，里面有 `return`；
   直接按脚本解析会把 `return {…}` 判成语法错误、并连带掩盖真正的判据问题。
   现在统一包一层合成函数壳再解析，行号减 1 还原回槽位坐标。
5. **`OD_NODE_BIN` 是 Electron 壳，不是 Node。** 由此产生两个连环误判（"网络不通""不能开子进程"）。
   已加 `tools/node-bin.mjs` 统一解析 + `tools/doctor.mjs` 自检；真 Node 下 `verify-all` 现在**以子进程方式**跑完各步（第 1 期时是十步，第 2 期起为十二步）。
6. **npm 默认缓存在可写范围之外**，安装会 EPERM。已用 `.npmrc` 把缓存收进项目目录（`cache=.npm-cache`）。

另外两处判据口径的细化（不改判据强度，只消除误报）已写入第三、四节。

### 七之二、本轮（审计与修正稿之后）又修掉的

审阅 `第一期改进意见.md` 后我出了一份《第一期改进意见-修正稿》，随后按修正稿把**所有条目连同修正稿自己的错漏**一起改完，其中这几条是修正稿之后才定位到的：

7. **`Draw.incline` 的负角语义是错的（审计与修正稿都判错了）。**
   审计说"`Draw.incline` 只能朝右"；修正稿改成"不用新能力，传 `angleDeg: -30` 即可"——**两者都不对**：
   原实现里 `footX = apex.x + L·cos(angleDeg)`，`cos(-30°) = cos(30°) > 0`，负角与正角画出**同一个朝右的斜面**，
   q06 因此画出一个顶点在左、坡脚在右上的巨大三角形（与题意相反）。
   现在 `angleDeg` 的**符号**表示坡面朝哪边下坡（正 = 坡脚在右下，负 = 坡脚在左下），`apex` 恒为最高端，
   签名摘要同步更新（`sdk/signature-summary.{json,md}`）。
8. **q06 的两个物块位移方向都写反了（修正稿写的是"方向是对的、只是箭头反了"，也不对）。**
   旧式：`blockA = apex − (d + s)·û`（物块**滑离**滑轮）、`hangY = apexY − (ropeHang − s)`（悬挂物**往上升**）。
   物理结论恰好相反：`m₂g = 15 N > m₁g·sin30° = 5 N` ⇒ **m₂ 下降、m₁ 沿斜面上升**，
   所以位移与速度/加速度箭头**四个方向都要按这个结论画**。现在状态量直接给出世界坐标（`x/y` 与 `x2/y2`），
   位移、速度、加速度、张力、重力、支持力全部由 `s` 的符号推出。
   同时把时长从 2.5 s 缩到 **0.5 s**（旧口径下 `s` 末值 12.5 m，物块滑出斜面、悬挂物穿过滑轮、绳反向朝天），
   绳改为画到**滑轮切点**（`√((d−s)² + r²)`，绳长恒定 `L₀ = 1.60 m`，漂移量恒为 0 并交给 C10 钉住）。
9. **q02 的圆弧几何整体重写。**
   修正稿当时核验的那版（`R = 2.5`、坡底 `y = 0`、圆心在坡脚**下方**）与现在的成品不是同一版：
   那版在 `B` 点存在**位置跳变**（`ψ_in` 与相切条件不自洽），并且法向取反、滑块被画进斜面内部。
   现在的几何由"入口与斜面严格相切 + 出口切线水平"**唯一**定出：
   `ψ_in = 180° + θ`（ψ 沿运动方向**递减**）、`ψ_out = 180°`（弧底）、`C = B + R(sinθ, cosθ)`、
   出口高度 `h = y_B − R(1 − cosθ)`；`tangentErr / radiusErr / exitTangentErr / exitHeightErr / energyErr` 五项自检全为 0。
   旧的 θ=60° 下"弧底比坡脚低 `R(1−cosθ)`"是几何必然，不是画错。
   `SIM.regions` 连 `insideCircle: [C, R]` 一起声明，把整段圆弧钉在门禁里。
10. **q02 的"滑块"画成了圆球、箭头没绑质心。** 现改为 `Draw.box` 沿轨道切向转正（状态新增 `tAng`），
    三类箭头一律从质心出发；`Draw.trace` 的偏移同步改用同一法向。
11. **新增 `tools/probe-question.mjs`（作者自检工具，不是判据）。** C1–C9 只看自洽、C10 只看自己声明的区域，
    "圆弧到底切没切上""滑块有没有陷进斜面""阶段交界处**画出来的**滑块有没有横跳"这些问题判据看不见、人眼又只能看生成后的 HTML。
    这个探针把 `setup` 导出的自检量、各阶段状态量实测范围、交界处 `state` 与 `state + n̂·rOff` 的前后差打成一张表，
    写 `SIM.regions` 时可直接抄。
12. **★ 16 个成品页全部白屏（你点开后报的"运行时未注入"）。**
    根因：`animation-runtime.mjs` 里有一句指向 `program-runner.mjs` 的反向 `import`；
    运行时被 `toClassicScript` 转成**经典脚本**内联进 HTML，经典脚本里 `import` 是**语法错误**，
    整段脚本不执行 ⇒ `window.ODRuntime` 未定义 ⇒ `boot()` 直接提示"运行时未注入"后返回。
    而三栏内容（题目 / 解析 / 读数）**全在 `boot()` 里由 JS 填**，所以是"骨架在、内容全空"。
    修法：把共用执行器（`instantiate / sampleFrame / fullEnvelope / scanAll / runnerBundle`）**搬进**运行时文件，
    `program-runner.mjs` 退化成转发薄壳，依赖方向单向化（`program-runner → animation-runtime`），"共用一份实现"不变。
    **门禁同时补上三层**（详见第六节末的取证说明）：`toClassicScript` 遇到 `import` 构建期报错、
    布局体检对每段内联脚本做经典脚本语法检查并**真跑一遍运行时**断言 `window.ODRuntime` 就位、
    负对照实验（清空 `drawFrame`）确认画布内容确实出现在浏览器截图里。
    教训：**"占位符替换干净"不等于"页面能启动"** —— 当时十步门禁全绿，却漏掉了浏览器里最致命的一环。
13. **每个成品页白背了约 110 KB 的重复注入（定位白屏时顺手发现的）。**
    模板顶部那段 HTML 说明注释里，我当初把占位符写成了完整字面量（`/*__OD_RUNTIME__*/`、`/*__OD_PROGRAM__*/`），
    构建脚本是**全局字面量替换**，于是 62 KB 运行时代码 + 整份公式 SVG（`PROGRAM_DATA.texSvg.formulas`）又被复制一份塞进注释：
    q02 页 344 KB 里有 110 KB 是"注释里的影子副本"，`<use>` 引用数正好是正常值的 2 倍。
    而且这还是个定时炸弹：注入内容里一旦出现 HTML 注释结束标记，注释会被提前闭合，后面的脚本全变成文本。
    现在：模板说明区不写完整占位符；`buildQuestionHtml` 加**构建期断言**（逐段检查注释体，发现注入物即报错）；
    `layout-lint` 断言运行时注入份数**恰好为 1**。页面从 260–344 KB 降到 **185–247 KB**（小 27%）
    —— 顺带说明：这类"体积翻倍"是判据完全看不见的问题，只有把成品页真的读一遍才会发现。
14. **`tests/regression-15/gallery.html` 的 15 个链接全是死链（顺着你"点开没东西"往下查时发现的）。**
    它写在 `tests/regression-15/` 下，到成品页要退**两级**（`../../template/build/…`），源码里写成了 `../template/build/…`，
    于是解析到不存在的 `tests/template/build/`。已修，并把**相对链接检查**并进 `layout-lint`
    （现在连入口页一起体检：18 个页面、30 个相对链接全部有效）。
    另外把空壳模板 `template/build/animation-template.html` 的提示改清楚了 —— 它**故意不含题目**，
    提示里直接告诉你从 `物理动画原型总览.html` 或 `template/build/q01-*.html` 进；"运行时未注入"那条也补了指路说明。
15. **★ "下一步"按钮点一下就再也点不动（审计第 3 条）。**
    根因在模板的 `indexOfStep(t)`：原实现用**闭区间** `t0 − ε ≤ t ≤ t1 + ε` 且从前往后找，
    而"下一步"恰好把时间停在边界（本步 `t1` ＝ 下一步 `t0`）上 ⇒ 每次都被判成**上一步** ⇒ 第二次点击原地不动。15 题全中。
    改为「`t ≥ 该步 t0`、从后往前找」的左闭判定，末步行为定成"跳到动画结尾"。
    取证：`tools/_step-nav-check.mjs`（从**成品页**抠出 `indexOfStep` 的真实源码，用每题真实 STEPS 模拟连点），
    同一套逻辑也并进了 `layout-lint` ⇒ 现在属于门禁。修复后前进序列都是 `0 → 各步起点 → duration`。
16. **"轨迹"虚线只在 5/15 题里实装（审计第 2 条）。**
    `Draw.trace` 只有 q02/q04/q05/q08/q12 用了，其余 10 题（q01/03/06/07/09/10/11/13/14/15）根本没画轨迹 ⇒ 开关点了没反应。
    现在 10 题全部补上**全程轨迹**：
    - 自由运动类（q01 物块、q03 两车、q06 两物块、q07/q15 金属棒、q13 落体、q14 滑块+木板）画物体中心的全程路径；
    - 路径与已有实线重合的（q09 回路导线、q11 两条光线、q13 竖直基准线）改用**点线** `dash [2,6]` 覆盖，看得见又不像重复描边；
    - q10 的"轨迹"是等温线的完整范围：实线只画 `V₁…V₂` 段，虚线补两侧延伸，不与面积图重叠。
    取样统一走只读探针 `context.at(t)`（只能在 `drawFrame` 用，`stateAt` 里用 C1 会拦）。
    取证：`tools/_trace-toggle-check.mjs` + `render-check` 新增断言 —— 同一时刻只切 `mask.trace`，比较真正回放的命令数，15 题全部 ≥1 条差异。
17. **★ q03「追及相遇」的动画与题意不符（审计第 1 条）。**
    不是运动学算错，而是**动画窗口切错了位置**：原 `duration = 4.5 s`，而相遇发生在 `t₁ = 10.39 s` ——
    整段动画里乙车始终在甲车后面、且 `v乙 < v甲`（`t = 4.5 s` 时 9 < 10 m/s），于是看起来"甲总在前、乙越走越慢"，追及根本没演出来。现在：
    - `duration` 4.5 → **11.2 s**，覆盖 `t′ = 5 s`（距离最大 29 m）、`t₁ = 10.39 s`（相遇）与相遇后的反超；
    - 比例尺重排（`0.055 世界单位/米`，覆盖 121 m 路程）；两车仍按示意图大小画（不做等比缩小，否则 121 m 公路上车只有几像素）；
    - 车道线移到车轮高度、轨迹虚线走车中心，两者不再重叠；相遇时刻在公路上留标记；
    - STEPS 五步按**物理时间轴**重写（方程 → 间距先变大 → 速度相等时最大 → 相遇条件 → 相遇后反超），`ANSWERS.at_t` 同步，并补 C10 区域声明；
    - 取证：`tests/reports/q03-preview.png`（真浏览器截图；清空 `drawFrame` 的对照变体与它差 7973 像素 ⇒ 画面确实在工作）。
18. **"画面上摆十几位小数"—— 第一轮没复现，拿到题号后定位并修掉（审计第 6 条）。**
    第一轮我只扫了"题目交给渲染器的文字"和"读数显示串"，所以扫不到**渲染器内部拼出来**的字符串。
    用户指出 q07 后顺着代码找到了真正的出处：`drawArrow` 的矢量标签用
    `` `${rec.label} = ${rec.mag}${unit}` `` **直接拼原始浮点数**，于是画布上真的印出了
    `v = 3.385926899562456 m/s`（q04/q07/q13 共 78 处；q07 就是你看到的那个）。
    三处修正：
    - **渲染器**：标签改走 `format(rec.mag, rec.unit, 3)`（与读数栏、`Phys.format` 同一套 3 位有效数字）⇒ 现在显示 `v = 2.2 m/s`；
    - **判据**：`_number-format-check` 与 `render-check` 改为扫**真正画到画布上的字符串**（`fillText`/`strokeText` 的实参），
      为此给 mock canvas 加了 `texts` 记录；只查命令记录永远抓不到渲染器内部拼的文字；
    - **判据本身的误报**：原来按"小数点后 ≥5 位"判，把 `0.00347`（3 位有效数字的**正确**输出）误判成违规；
      改为按**有效数字**判（去掉小数点与前导零后 >4 位才算）。
    修完复跑：15 题画布与读数 **0 处长小数**；`tests/reports/q07-preview.png` 是修后截图（清空 `drawFrame` 的对照差 10586 像素 ⇒ 画面确实在工作）。
    项目根目录那份 `q07-rod-emf.html`（当时为了方便双击而放的副本）**已于 2026-10 清理时删除** ——
    它是过时的（234710 字节 vs 当前 `template/build/q07-rod-emf.html` 的 239658 字节）。
    要看 q07 请直接双击 `template/build/q07-rod-emf.html`。详见 `清理台账-2026-10-16.md`。

---

---

## 九、第 2 期交接【留档 · 已于第 2 期完成】（第 3 期入口见**第十二节**）

> 这一节是写给"下一期的我"的：先读它，再读方案 §18 期 2 与 §19，然后跑一次基线命令。
> 第 1 期已验收通过，**下面的基线数字就是你的起点**。

### 9.1 五分钟恢复上下文（第 3 期起改为读第十二节；本小节留档）

```powershell
# 直接跑即可 —— 运行时由 tools/node-bin.mjs 自动解析（详见第二节的更正说明）。
# 仅当解析失败时，才需要手动指定：
#   $env:OD_REAL_NODE = "<你的 node.exe 路径>"
node tools/doctor.mjs        # 环境自检：真 Node / 依赖 / 占位符
node tools/verify-all.mjs    # 十二步门禁，应当全绿
```

应当看到：契约同源 OK · 签名摘要 27 函数 · Dry-Run **15/15 通过**（C10 扩展 8 题声明）·
C1 取证 25+6 条 · 渲染路径 15 题（含轨迹开关与长小数断言）· 公式 207 条 · 16 页打包 ·
18 页静态体检 · 长度上限 · 总览页生成。

### 9.2 第 1 期留下的基线（不要退步）

| 项 | 基线 |
|---|---|
| C1–C9 | 15/15 通过、0 告警、0 失败 |
| `Draw.raw` 使用率 | 0.00%（0 / 约 20 万条命令） |
| C10 扩展（物理包络） | 8 题声明、15 条区域、全满足（未声明即 skip，**不阻塞**） |
| 长度上限 | 单槽位 ≤400 行；`stateAt`+`drawFrame` ≤150 行（实测最大 147 = q02） |
| 代码契约 | `contractHash = d8af94b1a6d2e4c293538a14582baa1f28bd18fbfc145cad65b91d6e9382af8e`（13 份产物与 spec 一致） |
| 冻结项 | §3（7 槽位 / 8 键名）、§9、§11.2、§7.2（C1–C9）**一字未改** |
| 成品页 | 16 个（15 题 + 空壳）+ 2 个入口页；单文件自包含、公式已内联为 SVG |
| 交付入口 | `物理动画原型总览.html`（判定表）· `tests/regression-15/gallery.html`（题目列表）· `template/build/q*.html`（单题） |

### 9.3 第 2 期要做的事（方案 §18 期 2 原文）【留档 · 已于第 2 期完成】

> ⚠ **本节是第 1 期结束时写的计划书，第 2 期已按它交付完毕。**保留它只为说明"第 2 期的判据是从哪来的"。
> 实际结果见**第十一节**；第 3 期的指导见**第十二节**。

> 交付：**C1 静态预检（M26）· Worker 沙箱 · C2–C6 检查 · 校验报告（M27）**
> 验收：**故意注入 NaN / 瞬移 / 时间断裂 / 死循环 / `require`，全部被准确拦下并给出行号级诊断**

第 1 期已按"最小可用校验器"把判据与报告结构写全（用户裁决），所以第 2 期是**把它做实**，重点在三件事：

1. **Worker 沙箱（本期最大的一件事）**
   现状：Dry-Run 在**主线程**用 `node:vm` 新上下文 + `vm.Script` 墙钟超时（合作式）。
   目标：`worker_threads` + `resourceLimits`（内存硬上限）+ 硬 kill（CPU 硬上限），超限报告要能区分"超时/超内存/被 kill"。
   起点：`core/dryrun/child-runner.mjs` 是第 1 期就写好的子进程执行体（未启用）；`core/dryrun/program-runner`（现已并入 `sdk/runtime/animation-runtime.mjs`）
   是**唯一**的执行路径，Worker 里必须复用它，不能另抄一份采样逻辑（§13.1"屏幕上看到的 = 校验过的"）。
   ⚠ Worker 只能 import `*.mjs` 的 **Node 侧**模块；**不要**把 Worker 相关代码放进渲染器文件（见 9.4 第 1 条）。
2. **负向注入用例（本期的验收标准）**
   第 1 期只覆盖了 C1 的**静态**等价反例（`tests/lint-selftest.mjs` 25 条）。本期要建 `tests/negative-injection/`：
   对一道真题做 5 类注入 —— NaN / 瞬移（阶段边界跳变）/ 时间断裂（STEPS 不连续）/ 死循环 / `require` ——
   每类断言"**哪一条判据失败** + **诊断能指到行号**"，并接进 `verify-all` 作为新的一步。
   建议同时覆盖：`stateAt` 里出现 `Phys.integrate`、跨槽位导出同名键、`Draw.raw` 越界使用。
3. **C2–C6 强化 + M27 报告**
   C2 的时间/内存预算改由 Worker 硬性执行；C3–C6 的阈值继续用"实测速率/分位数"口径（第 1 期已按此实现，见第三节）；
   报告补齐 §7.5 的四件套（第 1 期交付三件：校验报告 / 图表数据 / AutoView 包络；**关键帧**留到宿主协议那期或本期视情况）。

### 9.4 易踩的坑（第 1 期都真踩过，门禁现在能拦，但别去试）

1. **`sdk/runtime/animation-runtime.mjs` 里绝不能出现 `import` / `export`**（`export` 会被构建脚本剥掉，`import` 不行）。
   它会被转成**经典脚本**内联进 16 个成品页；一句 `import` ⇒ `window.ODRuntime` 未定义 ⇒ **整页白屏**（只剩"运行时未注入"）。
   现在 `toClassicScript` 与 `layout-lint` 都会在构建期报错，但改这个文件时心里要有这根弦。
2. **`program-runner.mjs` 只是转发壳**；共用执行器（`runnerBundle/instantiate/sampleFrame/fullEnvelope/scanAll`）住在 `animation-runtime.mjs`，依赖方向单向。
3. **读数对象的 `value` 保持全精度**（C7 按容差比对），只在**显示**时格式化。画布上的文字一律走 `Phys.format(...)` 或渲染器里的 `format(...)`（3 位有效数字）——
   门禁会扫**真正画到画布上的字符串**，绕过去会被拦。
4. **改模板必须重新打包**：`node template:build` 等价命令是 `node template/build-template.mjs`；成品页把运行时 + 载荷 + SVG 全内联了。
   模板说明注释里**不要写完整占位符**（会被全局替换，把 60 KB 运行时复制进注释），构建期断言会报错。
5. **步进导航依赖 `indexOfStep` 的左闭判定**（`t ≥ 该步 t0`、从后往前找）。改回闭区间 ⇒ "下一步"点一次就卡住（第 1 期审计第 3 条）。
6. **轨迹必须用 `Draw.trace`（或带 dash 的 `curve`）画**，否则"轨迹"开关控不到它；门禁会检查"开关确实改变画面"。
7. **`Draw.incline` 的 `angleDeg` 用符号表示坡向**（正 = 坡脚在右下，负 = 坡脚在左下），`apex` 恒为最高端。
8. **依赖不是零**：`acorn@8`（C1 的 AST 后端）+ `mathjax-full@3.2.2`（构建期公式预渲染）。npm 缓存已收进项目（`.npmrc` → `cache=.npm-cache`），否则 EPERM。
9. 沙箱禁止**管道捕获**子进程输出；用 `stdio:'inherit'`，`tools/node-bin.mjs` 已经处理好这件事。

### 9.5 待用户裁决的四件事（第 1 期结束时挂起，别自己拍板）

| # | 议题 | 现状与建议 |
|---|---|---|
| 1 | **C10 是否升格为正式判据** | 现在是 `extensions[]`、`blocking:false`、未声明即 `skip`。升格 = 进 `checks[]` 并可阻塞。建议：本期一起定；升格只需改 `core/dryrun/dry-run.mjs` 的挂载点（判据本身已在 8 题上跑通） |
| 2 | **`STEPS`/`ANSWERS` 的行式表格式** | 方案未规定，第 1 期自定（`key: value` 一行一项、`"""` 包多行）。建议保留（JSON 会被 LaTeX 反斜杠打坏） |
| 3 | **`§3.3` 的 `at_t` / `latex` 命名** | 方案原文是下划线，项目其余部分是驼峰。第 1 期照抄方案。建议维持照抄（冻结口径优先） |
| 4 | **排版两项（用户审计第 4、5 条）** | ① 画布上的说明文字挤在一起；② 右侧读数 9 行同权重、密密麻麻。建议先做②：读数分两级（过程量弱化、结论量突出）+ 数字对齐小数点；① 要动 15 题，可放本期或下期 |

### 9.6 用户审计的其余条目（第 1 期已修，供回归参考）

已修：q03 动画窗口（第 1 条）· 轨迹未实装（第 2 条）· "下一步"失效（第 3 条）· 画布长小数（第 6 条）。
未修（用户标"不急"，见 9.5 第 4 行）：说明文字拥挤（第 4 条）· 数据密集（第 5 条）。

### 9.7 给新会话的开场白（第 2 期已按这段做完，留档）

> ⚠ **第 3 期不要再用这段开场白**——请改用**第十二节 12.6 的开场白**（它已把第 3 期的入口、范围与前置条件写全）。

> 接着做《物理解题动画软件v1.0自研方案.md》第 2 期。先读 `README.md` 第九节（第 2 期交接）、第三/四节（口径与偏差）、第七与七之二节（已修缺陷），
> 再跑 `node tools/verify-all.mjs` 确认基线全绿（第 2 期起是**十二步**）。第 1 期冻结项（§3 / §9 / §11.2 / §7.2）不动，C10 仍是扩展检查。
> 本期目标见方案 §18 期 2 与 §19.1，验收是五类负向注入都能被拦下并给出行号级诊断。

> ✅ **第 2 期已完成**（结果见第十一节：12/12 负向注入被拦下且行号指到注入点；15/15 题无退步）。
> 第 3 期开工前请先读 **第十一节 11.7（偏差与待裁决）与 11.8（交付落点）**。

---

## 十一、第 2 期交付说明

> 依据：方案 §18 期 2（C1 静态预检 M26 · Worker 沙箱 · C2–C6 检查 · 校验报告 M27）
> 与 §19.1。**第 1 期冻结项 §3 / §9 / §11.2 / §7.2 一条未改**，C10 仍是扩展检查。
> 验收原文：*故意注入 NaN / 瞬移 / 时间断裂 / 死循环 / `require`，全部被准确拦下并给出**行号级**诊断*。

### 11.1 交付了什么（对照 §18 期 2）

| 交付项 | 落地位置 |
|---|---|
| C1 静态预检（M26） | `core/lint/`（acorn 单后端不变；本期补齐：诊断一律带**槽位名**，并新增埋点自检门禁） |
| **Worker 沙箱** | `core/dryrun/worker-sandbox.mjs`（父进程调度 + 硬终止 + 三态归类）· `core/dryrun/scan-worker.mjs`（Worker 执行体）· `core/dryrun/vm-context.mjs`（内层 `node:vm` 上下文，与回退路径共用） |
| C2–C6 检查强化 | `core/dryrun/dry-run.mjs`（C2 终止类型 · C4 数据驱动阈值 · C5/C6 行号归因 · C6 分量识别修正） |
| 校验报告（M27） | 同上：`report.version = 2`，新增 `execution.backendId / termination / budget`、`checks[].diagnostics[]`、扩展 `X1 / X2` |
| **行号级诊断** | `core/lint/slot-instrument.mjs`（埋点 + 行表）· `core/dryrun/trace.mjs`（快照重放）· `core/dryrun/diagnostics.mjs`（归因与三档证据强度） |
| **负向注入验收** | `tests/negative-injection/cases.mjs` + `run-injection.mjs`（对真题注入，接进 `verify-all` 第 ④ 步） |
| 埋点自检（新增门禁） | `tests/instrument-selftest.mjs`（`verify-all` 第 ⑤ 步） |

### 11.2 验收结果（第 ④ 步的真实输出）

注入对象是**真题** `tests/regression-15/q01-conveyor-heat.mjs`（不是玩具代码），
每条用例跑完整链路，断言「期望的检查号失败」**且**「有诊断指到注入的那一行」：

| 类别 | 注入 | 拦下的检查 | 终止类型 | 行号级诊断 |
|---|---|---|---|---|
| 对照 | 未注入（原样） | — | completed | — |
| **NaN** | `stateAt` 里算出 NaN 并喂给状态量 | C3 | completed | stateAt 第 6 行（重放定位） |
| **NaN** | `readouts` 里直接算出 NaN | C3 | completed | readouts 第 7 行（精确） |
| **瞬移** | 共速边界后给位移加 0.4 m 常数跳变 | C6 | completed | stateAt 第 5 行（重放定位） |
| **时间断裂** | STEPS 第 2 步 `t0: 0.6 → 0.7`（留缝） | C5 | completed | STEPS 第 9 行（精确） |
| **死循环** | `while (true) {…}`（静态可判） | C1 | 未执行 | stateAt 第 6 行（重放定位） |
| **死循环** | `while (tt < 1e9) {…}`（静态判不出） | C2 | **timeout** | stateAt 第 5 行（精确） |
| **require** | `stateAt` 里 `require("fs")` | C1 | 未执行 | stateAt 第 6 行（重放定位） |
| 附加·架构不变量 | `stateAt` 里调 `Phys.integrate` | C1 | 未执行 | stateAt 第 6 行（重放定位） |
| 附加·超内存 | `setup` 里无限膨胀数组 | C2 | **out-of-memory** | setup 第 7 行（精确） |
| 附加·跨槽位同名键 | `setup` 里 `RETURN("t1", 0.5)` | X1（扩展） | 未执行 | setup 第 7 行（精确） |
| 附加·逃生门越界 | `drawFrame` 里 `Draw.raw` 刷量 | X2（扩展） | completed | drawFrame 第 6 行（精确） |
| 附加·后端一致性 | 同一道真题跑 Worker 与同进程回退 | —（对照） | completed | 判定 / 9 个检查 / 时长 / 帧数 / 命令数 / 首末读数**逐项一致** |

**12/12 全部被拦下，且 14 条行号诊断全部指向注入点。** 另有两点值得单独说：

- **`while (tt < 1e9)` 这条是本期最有价值的一例**：C1 的白名单判据**无法**证明它不是无上界循环
  （它既不是 `while(true)` 也不是 `for(;;)`），只有 Worker 的墙钟硬终止能抢回 CPU。
  第 1 期的"主线程 `vm.Script` 超时"在这里是失效的——它只能在语句边界中断，
  而这个循环恰好卡在同一条语句里。
- **硬终止依然给得出行号**：`__odMark` 每执行到一条语句就把行号写进 `SharedArrayBuffer`，
  Worker 被杀之后父进程照样读得到"最后执行到 `stateAt` 第 5 行"。
  这是"死循环也有行号诊断"的唯一可行做法（被杀掉的线程里插不进任何回调）。

> **交付页的版面实测**：总览页加了两列扩展判定 + 一张 6 列的负向注入表之后，"会不会顶出容器"
> 不能只靠 CSS 算（auto 表格的最终宽度取决于 min-content 与可用宽度）。于是把页面送进真渲染器导出截图
> （`tests/reports/overview-preview.png`），再用 `tools/_layout-probe.mjs` 从像素里量事实：
> 内容实际右边界、逐列墨迹剖面、纵向 12 个带的墨迹分布。
> 结论：**1440×3156 全幅有内容（无空白带）；表格内容止于 x≈1300，未越过容器右边界；
> 右边缘那条 8 px 竖带是浏览器滚动条（944 行连续、起始 y=5），不是被切掉的内容。**
> 代价说明：这一步只能证明"没溢出、没重叠"，**观感仍要你自己看**。
>
> **回退后端不再"没人跑过"**：本机 Worker 可用，`node:vm` 回退路径平时走不到，
> 因此新增了"后端一致性对照"用例（`meta.forceBackend = 'vm-fallback'`）——
> 同一道真题跑两遍，断言**判定 / 九个检查的状态 / 时长 / 帧数 / 命令总数 / 单帧峰值 / 首末帧读数**逐项一致。
> 结论：一致。这条用例防的是"换后端悄悄换了判据"，也是 `execution.backendId` 这个字段存在的意义。

### 11.3 行号级诊断怎么做的（三档证据强度）

| 手段 | 覆盖 | 报告里的 `precision` |
|---|---|---|
| 埋点 `__odMark(槽位, 行)` 的"当前行" + 命令记录上的行号戳 | 死循环卡在哪一行 · 是哪一行推入了非有限坐标 | `exact` |
| AST 直接命中 | `readouts` 的条目行 · STEPS 的行式表字段行 · `Draw.raw` 调用行 | `exact` |
| 快照重放（`__odSnap(槽位, 行, {…绑定})`，诊断时才跑） | "第一次算出 NaN 的那一行" · "最后一次改写该绑定的那一行" | `replayed` |
| 静态候选（AST 里可能写这个键的行） | 上面两条都不可用时的兜底，**明确标注"候选"，不假装精确** | `candidate` |

三条实现约束（写进代码注释了）：**只归因、不判据**（`status` 完全由 C1–C9 决定）；
**只在确有失败时才重放**，且**超时/超内存之后绝不重放**（那类代码本来就会卡住）；
重放本身跑在 `vm` 里并套 `runInContext({timeout})`，一次诊断拖不死父进程。

埋点有一条硬性前提：**不许改变行号**（插入文本不含换行、只插在 `{}` / `case` 的语句表里、
插在语句起始处）。这条前提一旦破了，所有"第 N 行"都会变成假话，而且**别的门禁一条都发现不了**
（判据照样通过，只是诊断指错地方）——所以新增了 `tests/instrument-selftest.mjs` 专门钉它：
15 题 × 4 个代码型槽位，逐条断言"行数逐字不变 / 埋点后可解析 / 装配后可编译 / 生成行号可反查回槽位坐标"。

### 11.4 第 1 期基线（第 2 期没有退步）

| 项 | 第 1 期基线 | 第 2 期实测 |
|---|---|---|
| C1–C9 | 15/15 通过 · 0 告警 · 0 失败 | **15/15 通过 · 0 告警 · 0 失败**（全部跑在 Worker 里） |
| `Draw.raw` 使用率 | 0.00%（0 / 约 20 万条命令） | **0.00%**（不变） |
| C10 物理包络（扩展） | 8 题声明 · 全部满足 · 其余 skip | **8 题声明 · 8 通过 · 7 skip**（不变） |
| 长度上限 | 单槽位 ≤400 行；`stateAt`+`drawFrame` ≤150（最大 147） | 不变（最大仍是 q02 的 147） |
| 契约 | `contractHash = d8af94b1…af8e` | **同一哈希**（13 份产物未动） |
| 冻结项 | §3 / §9 / §11.2 / §7.2 一字未改 | **一字未改** |
| 成品页 / 静态体检 | 16 个成品页 + 2 个入口页 | 18 个页面**全部通过**（第 1 期全部检查项仍在） |
| 公式 | 207 条 MathJax SVG | 207 条（不变） |
| 单次 Dry-Run 耗时 | 主线程 vm | Worker：**均 89 ms / 最大 246 ms**（预算 4000 ms） |

> 新观测项（第 2 期新增，不参与判定）：`X1` 在 **q03 与 q14 上报警**——
> 这两题把 `RETURN('t1', …)` 当作跨槽位导出键，而 `t1` 正是 `STEPS` 的字段名
> （就是第七节第 3 条记的那个坑，现在能机检了）。**不阻塞、未擅自改名**，见 11.7 待裁决。

### 11.5 本期修掉的缺陷（含"我先做错了一版"）

1. **★ C6 的阈值公式偏松约 1440 倍（第 1 期就存在）。**
   原式 `rate * eps * 6 / dt`：`rate` 的单位已经是"状态量/秒"，再乘 ε 就是这一邻域内的自然位移；
   那个多余的 `/ dt` 把安全系数从 6 倍放大成 6/dt ≈ 1440 倍。
   后果：0.4 m 的边界跳变（负向注入「瞬移」）一开始**没被 C6 抓到**（靠 C10 才拦下）。
   现改为"6 倍自然位移"。
2. **★ C6 的连续性分量自动识别会把"真跳变的分量"自己排除掉（自证式漏洞）。**
   原判据是"最大相邻差分 ≤ 总变化量的 25%"——某个位置分量一旦真的跳变，它自己就会被踢出候选集。
   现改为看**平台占比**（分段常值 = 过程量/开关量，如摩擦力 `μmg → 0`、`sliding`），
   这个信号与"是否恰好跳变"无关，注入的跳变洗不白自己。
3. **埋点插错了位置（本期自造、本期发现）。** AST 节点的 `start` 是**包装后源码**的偏移，
   我没减掉合成函数壳的长度，于是 `__odMark` 被插进 `Math.min(Math.__odMark(1,1);max(…))` 这种语句中间，
   装配后编译报 `Unexpected token '('`。修法：`parseSlot` 返回 `headOffset`，埋点减去它。
4. **快照把合成壳的名字 `__slot__` 当成槽位绑定**，重放到槽位里直接 ReferenceError，
   整次快照变成 `null`，诊断静默降级成"候选行"。修法：收集绑定时排除函数自身。
5. **快照归因差一条语句。** 探针插在语句**之前**，所以"第 i 条快照里第一次出现 NaN"
   其实是**第 i-1 条语句**算出来的。不修的话行号会稳定偏一行。修法：`line` 取上一条语句的探针行。
6. **C1 的部分诊断不带槽位名**，"第 6 行"到底属于哪个槽位得靠猜。修法：装配报告时补 `slot`。
7. **行表把最后一个槽位的收尾代码算进了正文**（`readouts` 区间 17 行 vs 实际 9 行）。
   这个是**新加的埋点自检第一次跑就逮到的**——它此前不影响任何诊断（行表当时只用于异常栈），
   属于"埋在地里的错"。修法：给了槽位原文就按行数精确算，并顺手校验下一行确实是收尾 `}`。
8. **C4 阈值第一版取"跨度的 0.1%"，在 q03 相遇时刻误报**：那一刻新增了一个标记图元，
   包络中心动了 0.03 —— **新元素出现不是位移**。修法：阈值放到跨度的 2%，并要求"两帧命令构成一致"
   才做逐命令归因，否则如实说明"图元有增减、逐命令比对不成立"。

### 11.6 调用方需要注意的接口变化

- **`dryRun()` 变成 `async`**（Worker 是异步的）：`await dryRun({…})`。`core/dryrun/run-suite.mjs` 已改。
- `runtime`（`sdk/runtime/animation-runtime.mjs`）新增三个**加法式**导出，浏览器行为不变：
  `runnerBundle(extra)`（注入诊断探针/带戳缓冲）· `instantiate(factory, {runner})` · `dataSlotLineIndex(text, key)`；
  装配源码里多了 `var __odMark = (runtime && runtime.__odMark) || function (){};`（浏览器里是空操作）。
- 报告升到 `version: 2`：新增 `execution.backendId / termination / budget`、
  `checks[].diagnostics[]`、`observations.diagnosticCount`，扩展数组里多了 `X1 / X2`。
- `verify-all.mjs` 从十步变**十二步**（新增 ④ 负向注入、⑤ 埋点自检）。

### 11.7 偏差与仍待你裁决的事

1. **C10 / X1 / X2 都保持"扩展检查"**（`extensions[]`、`blocking:false`、不进 `checks[]`）。
   按你本轮的口径「第 1 期冻结项不动、C10 仍是扩展检查」执行，没有把它们升格为 §7.2 判据。
   X2（`Draw.raw` 使用率 >10%）与 X1（导出键与 `STEPS` 字段重名）都只提醒不拦。
2. **★ X1 在 q03 / q14 上报警，需要你拍板**：这两题用 `RETURN('t1', …)` 导出"相遇时刻/共速后时刻"，
   与 `STEPS` 字段名 `t1` 重名。今天不影响任何结果（`context.t1` 与 `context.STEPS` 是两个键），
   但它是第七节第 3 条记的那个"静默覆盖"隐患。**改法很简单（改名为 `tMeet` / `tStar` 并同步槽位引用），
   但会动到题目语义，我没有擅自改。**
3. **C4 的阈值口径**：§7.2 原文只说"相邻帧位移不超阈值"，没给数值。第 1 期取了一个等于没有判据的
   硬上限（1e4）；本期改成"实测分布"（`max(20×p99, 跨度 2%)`）。这是**新引入的实现约定**，需要你确认。
4. **"精确/重放/候选"这套证据强度标注**是新引入的报告字段（§7.5 没规定诊断字段形状）。若第 3 期
   要拿它做自愈回灌，建议以它为准；不合适也可以只保留 `line/column`。
5. **§9.5 挂起的四件事**：C10（维持扩展，你已明确）· `STEPS`/`ANSWERS` 行式表格式（维持）·
   `at_t` / `latex` 下划线命名（维持照抄）· 排版两项（读数分级 + 画布说明文字拥挤）**第 2 期未动**，
   第 3 期仍未动（第 3 期不碰 15 题正文）；累计挂起清单见**第十二节 12.5**。
6. **关键帧（§7.5 四件套之四）** 仍未产出，理由同第 1 期：它是播放器能力，随第 3 期宿主协议落地。

### 11.8 本次交付的落点（重要）

本轮会话里，**被链接的仓库目录是只读的**（沙箱只允许写会话工作区），
因此第 2 期代码落在会话工作区的**同构副本**里，路径与文件名与仓库完全一致。

把改动同步回你的仓库，只需把下面这些文件覆盖回去（其余文件与第 1 期逐字节相同）：

```
sdk/runtime/animation-runtime.mjs          （加法式：探针钩子 / runnerBundle(extra) / instantiate(opts) / dataSlotLineIndex）
core/lint/acorn-parser.mjs                 （加法式：parseSlot 返回 headOffset）
core/lint/slot-instrument.mjs              （新增）
core/dryrun/dry-run.mjs                    （Worker 后端 + C2–C6 强化 + 诊断挂载 + 报告 v2）
core/dryrun/run-suite.mjs                  （await dryRun + 汇总表新增后端/终止/诊断列）
core/dryrun/worker-sandbox.mjs             （新增）
core/dryrun/scan-worker.mjs                （新增）
core/dryrun/vm-context.mjs                 （新增）
core/dryrun/trace.mjs                      （新增）
core/dryrun/diagnostics.mjs                （新增）
tests/instrument-selftest.mjs              （新增）
tests/negative-injection/cases.mjs         （新增）
tests/negative-injection/run-injection.mjs （新增）
tools/verify-all.mjs                       （十步 → 十二步）
tools/build-overview.mjs                   （第 2 期总览：后端列 / X1·X2 列 / 负向注入表）
tools/_worker-probe.mjs                    （新增，Worker 能力取证）
tools/_layout-probe.mjs                    （新增，从导出截图量版面事实：有没有横向溢出）
tools/_png-stats.mjs                       （加一行：导出 decodePng 供上面的探针复用）
package.json · README.md
tests/reports/*                            （重新生成；含 overview-preview.png）
template/build/* · 物理动画原型总览.html    （重新生成）
```

---

## 十、目录导航

```
contracts/     冻结契约：spec/（唯一事实来源）→ *.schema.json + types/*.d.ts + manifest.json
sdk/           Layer 1/2 运行时（命令缓冲 + Draw + Phys + AutoView）与签名摘要
template/      模板页骨架、ODTex 兜底渲染器、构建链、已打包成品页（build/）
                vendor/tex-svg/  公式预渲染产物（MathJax SVG + 按页字形表）
core/lint/     C1 静态预检（acorn 单后端：acorn-parser.mjs + contract-lint.mjs）
                slot-instrument.mjs  第 2 期：埋点 + 行表（行号级诊断的地基）
core/dryrun/   C1–C9 校验器（+ C10/X1/X2 扩展）、回归题集执行入口
                worker-sandbox.mjs   第 2 期：Worker 调度 + 硬终止 + 超时/超内存/步数/崩溃归类
                scan-worker.mjs      第 2 期：Worker 执行体（复用 runtime 的 instantiate/scanAll）
                vm-context.mjs       第 2 期：内层 node:vm 上下文（Worker 与回退路径共用）
                trace.mjs            第 2 期：快照重放（定位"哪一行算出 NaN / 哪一行写的值跳变"）
                diagnostics.mjs      第 2 期：行号归因 + 扩展检查 X1/X2
                child-runner.mjs     第 1 期的子进程执行体（保留，未启用）
tests/         15 道手写题、mock canvas 测试台、C1 取证自测、埋点自检、Dry-Run 报告与渲染截图
                negative-injection/  第 2 期：五类负向注入验收（cases.mjs + run-injection.mjs）
tools/         node-bin / doctor（环境）· verify-all（**⓪ + 二十九步**门禁）· rules-service（第 6 期本机规则工作室服务）· render-check / layout-lint /
               budget-check / build-tex-svg / build-overview / probe-question（单题探针）
               web-build（【第 3 期】前端构建链门禁：演示数据 + tsc + Rollup + Tailwind + 产物体检）
               build-demo-questions（【第 3 期】从真题源生成浏览器演示数据）
               verify-coverage（【第 3 期】门禁 **⓪ 覆盖自检**：有没有检查脚本没被挂载）
               _worker-probe（Worker 能力取证：子进程 / vm / 内存上限 / 硬终止取回行号）
               _layout-probe（从导出截图量版面事实：容器右边界有没有被顶出去、带宽有没有溢出）
               _ranges / _png-stats / _make-variant / _check-built / _step-nav-check /
               _trace-toggle-check / _number-format-check
               （下划线 = 取证用的一次性工具：抄状态量范围、PNG 逐像素比较与取色、生成对照变体页、
                 成品页可启动性体检、步进导航取证、轨迹开关取证、长小数扫描、版面溢出实测）
物理动画原型总览.html   交付入口：15 题的 C1–C9 判定表 + 扩展列 + 第 2 期负向注入验收表
清理台账-2026-10-16.md  2026-10 从 Open Design 迁移到 DeepSeek Harness 时的清理记录
                        （被删文件的 SHA256 台账 / 保留项说明 / "真浏览器截图"能力缺口的记录）
web/           【第 3 期】前端（React 18 + TypeScript + Tailwind + zustand）
                src/pages/          解题页 SolvePage.tsx · 动画页 AnimationPage.tsx
                src/lib/            host-protocol.ts（协议类型）· run-stream.ts（事件流：演示源 + SSE 源）
                                    markdown.tsx（极小的 Markdown + LaTeX 占位渲染）
                                    demo-questions.ts（**构建期生成**，来源是 tests/regression-15/）
                src/state/store.ts  zustand store · src/hooks/useRun.ts（卸载即取消）
                index.html          引用 ./assets/app.{css,js}（固定名，便于门禁断言与离线打开）
                rollup.config.mjs   打包配置；**顶部注释记录了"为什么不是 Vite"**
                tsconfig.app.json   类型检查（noEmit）· tsconfig.build.json 转译（→ .build/）
                dist/               产物（离线自包含、无外链；含拷贝进来的空壳模板页）
                node_modules/       前端依赖独立安装（**不污染根目录**）

core/gateway/  【第 3 期】模型网关：OpenAI 兼容手写流式 · 错误分类 · 端点配置与 §11.3 视觉门控 · Key 脱敏
               【第 6 期】+ endpoint-store.mjs（endpoints.json / keys.json 分离读写）· connection-test.mjs（测试连接）
core/cleaner/  【第 3 期】标记切分（§3.5 零猜测，**行号保真**）· §12 正则兜底 · 组装 AnimationProgram
               【第 6 期】+ policy.mjs（锁定集是数据）· editor.mjs（规则表编辑）· pattern-guard.mjs
core/prompts/  【第 3 期】Prompt 系统：§10.1 七项 · §10.2 三段注入 · promptHash
               【第 6 期】+ overlay.mjs（硬门禁/代际状态/行级差异）· editor.mjs（覆盖副本）· getPrompt(id, rules)
core/rules/    【第 6 期】规则工作区：workspace.mjs（SHA256/原子载入/整批失败/热重载）· kinds.mjs（文件类型与内容）
               backup.mjs（保存前滚动 5 份备份 + 恢复）· cli.mjs（status/check/init/adopt/prompts/cleaning/endpoints/restore）
core/orchestrator/ 【第 3 期】编排：阶段链 · 每题配置快照 · 取消语义 · SSE 事件定义
               【第 6 期】+ 每题快照里冻结 `rules`（Prompt 覆盖 + 清洗规则），实现"下一题生效、跑着的题不受影响"
ai-rules/      【第 5/6 期】**用户区**（升级不动）：worldbook/*.json · prompts/*.md · cleaning.json · endpoints.json ·
               keys.json（**永不导出/永不备份**）· .workspace.json（revision + 每文件 SHA256）· .backup/（滚动 5 份）
tools/rules-service.mjs  【第 6 期】本机规则工作室服务（同端口发静态页 + /api；只绑回环、校验 Origin、不透传 Key）
contracts/validate.mjs     【第 3 期】§11.2 跨字段校验 + §12 清洗规则表（不是生成物，不影响 contractHash）
contracts/host-protocol.md 【第 3 期】**§13.2 协议定稿**（11 条消息 + source 字段 + program 注入）
```

> **迁移说明（2026-10）**：第 1、2 期在 **Open Design** 里完成，之后工作迁到 **DeepSeek Harness**。
> 清理时删除了只对 Open Design 有意义的残留：`.od-skills/`（它的 Web 原型技能包）、
> `.file-versions/`（它的文件版本备份）、4 个 `.artifact.json`（它的交付描述文件）、
> 以及根目录那份**过时**的 `q07-rod-emf.html` 副本。
> **没有删任何一条项目源码、测试、契约或成品页**；详情与逐文件哈希见 `清理台账-2026-10-16.md`。

> ⚠ **上表是第 2 期结束时的目录。第 3 期会新增 `core/gateway/` · `core/cleaner/` · `core/orchestrator/` ·
> `core/prompts/` · `core/server/` · `host/` · `tests/fake-endpoint/`；新区块见第十二节 12.7。**

---

## 十二、第 3 期工作指导【留档 · **已于第 3 期完成**】（第 4 期入口见 **第十四节**）

> ⚠ **本节已完成使命**：它是第 3 期开工前写给"下一期的我"的入口。
> **第 3 期已全部交付**（9 步全绿，见**第十三节**）。
> 第 4 期开工请先读 **13.10**（下一期从哪开始）与 **12.5**（待裁决清单）。

> **本节是写给"下一期的我"的入口，不依赖任何对话记忆。**
> 第 1、2 期已验收关闭；第一～十一节全部转为**基线记录与坑表**，不再有"待办"含义。
> 第 3 期的设计与实施记录见本文件**第十二、十三节**；第 4 期的方案见**第十四节**。
>
> ## 📍 第 3 期进度（实时更新）
>
> | 步 | 内容 | 状态 |
> |---|---|---|
> | **0** | 前端构建链（React 18 + TS + Tailwind + zustand；**Rollup 代替 Vite**） | ✅ **已完成**（门禁 ⑬⑭） |
> | **1** | 契约补齐 `validateEndpointConfig` + §11.2 反例取证 | ✅ **已完成**（门禁 ⑮，37 条取证；详见 12.12） |
> | 2 | 模型网关（内置 `fetch` 流式）+ 假端点 + 图片多模态 + §11.3 视觉门控 | ✅ **核心已完成**（门禁 ⑯，63 条取证；详见 12.13）· 真端点联调待你给 Key |
> | 3 | 标记切分清洗 + 行号保真 | ✅ **已完成**（门禁 ⑰，53 条取证；详见 12.14） |
> | 4 | 槽位 Prompt + 固定前缀 + `promptHash` | ✅ **已完成**（门禁 ⑱，62 条取证；详见 12.15） |
> | 5 | 编排 + SSE + 取消语义 | ✅ **已完成**（门禁 ⑲，67 条取证；详见 12.16） |
> | 6 | 宿主协议定稿 + 解题页 + 动画页 | ✅ **已完成**（协议定稿 + 两块页面可构建；门禁 ⑳ 43 条；详见 12.17） |
> | 7 | `SYMBOLIC` + 关键帧 | ✅ **已完成**（渲染层符号优先 + 关键帧落地；详见 12.18） |
> | 8 | 三处小修（X1 改名 / 读数分级 / 僵尸 manifest） | ✅ **已完成**（X1 归零 · 读数分级 · 僵尸产物修复；详见 12.19） |
> | 9 | 全部接进门禁（当前二十步 + ⓪ 覆盖自检）+ 第十三节交付说明 | ✅ **已完成**（第十三节） |

### 12.1 一句话说清现在在哪

前两期把**"校验内核"**做实了：手写 15 题 → 命令缓冲 → Worker 沙箱试跑 → C1–C9 判定 → 行号级诊断。
但**整条链路里没有任何一环来自模型**：15 道题是手写的 `.mjs` 对象（`export default { slots: { PROBLEM, … } }`），
**没有经过 Prompt、没有经过标记切分、没有经过端点**。

**第 3 期要补的就是这三段**，把"手写题能画出好动画"变成"**输入一道文字题 → 流式出解题过程 → 出可播放动画**"。
**第 0 步（前端构建链）已完成**，见 12.11（含 Vite 不可用的完整取证）。

### 12.2 第 3 期基线（实测于 2026-10 · `node tools/verify-all.mjs` **二十步**全绿）

| 项 | 基线值（**这是你的起点，不许退步**） |
|---|---|
| 门禁 | `node tools/verify-all.mjs` **二十步全绿，exit 0**（⑬⑭ 前端 · ⑮ 契约 · ⑯ 网关 · ⑰ 切分 · ⑱ Prompt · ⑲ 编排 · ⑳ 宿主协议） |
| C1–C9 | **15/15 通过 · 0 告警 · 0 失败**（全部跑在 Worker 里） |
| 负向注入 | **13/13 被拦下**（含后端一致性对照），行号全部指到注入点 |
| `Draw.raw` 使用率 | **0.00%**（0 / 252251 条命令） |
| C10 / X1 / X2 | C10：8 题声明全满足、7 题 skip；**X1 在 q03/q14 报警（未修，见 12.5）**；X2 无 |
| 长度上限 | 单槽位 ≤400 行；`stateAt`+`drawFrame` ≤150 行（实测最大 **147** = q02、次大 145 = q14） |
| 契约 | `contractHash = 13acace279604228cd67b8d374ba1bef37f81c7694be1f5cbf3cbe85669bf676`（13 份产物）<br>⚠ **第 3 期第 1 步改了哈希**：只改了 `endpoint` schema 的**描述文本**（把"由 `contracts/index.mjs` 实现"更正为真实模块 `contracts/validate.mjs`），字段形状一字未改（见 12.12 第 1 步） |
| SDK 签名摘要 | **27 个函数** 与 SDK 导出面一致 |
| 公式 | **207 条** MathJax SVG 预渲染（按页去重后的唯一文本数）· ✅ **第 3 期第 8 步已修**：`doctor.mjs` 原先读僵尸产物报 **205**，现已与真实值一致（见 12.19） |
| 成品页 | 16 个（15 题 + 空壳）+ 2 个入口页，单文件自包含、公式已内联 |
| Dry-Run 耗时 | Worker：**均 89 ms / 最大 246 ms**（§6.3 预算 4000 ms） |
| 冻结项 | §3（7 槽位 / 8 键名）· §9 · §11.2 · §7.2（C1–C9）**一字未改** |
| 环境 | 真 Node 靠 `tools/node-bin.mjs` 自动解析（`OD_REAL_NODE → execPath → OD_NODE_BIN → toolchain → PATH`）；本机实测 v22.19.0 |

### 12.3 第 3 期要交付什么（方案 §18 期 3 原文）

> 交付：**端点（M2）· 编排与 SSE（M3）· 标记切分清洗（M4）· 槽位 Prompt（M5，7 槽位 / 8 键名）·
> 播放器宿主协议（M14）· `SYMBOLIC` 模式**
> 验收：**输入一道文字题 → 流式出解题过程 → 出可播放动画；纯符号题能播且标注全为符号；中途取消无残留**

**七个模块 + 一项补漏，按依赖排序（详细设计见本文件 12.12–12.19 的实施记录）：**

> ⚠ **第 0 行是补漏项，不是方案新增**：初稿把"题目图片输入"误当成"以后再说"。
> 复核原文后发现它是 **§2.3 主链路输入端的一等公民**，且 **§11.3 视觉门控属于 M2（= §18 期 3 范围）**；
> 真正排在第 7 期的是**扫描版 PDF 教辅蒸馏**（M19），两者不是一回事。详见实施方案 **3.9**。

| 序 | 模块 | 落点（建议） | 为什么排这个位置 |
|---|---|---|---|
| 0 | **★ 题目图片输入 + 视觉门控**（§11.3 / M2） | `core/gateway/` + `web/` 解题页 | **方案原文的一等功能**：§0"粘贴/拍照一道题"、§2.3 主链路输入"题面文字 / 图片 + 可选配图补充描述"、§10.2 任务段"题目 + 图片"、§11.3 视觉门控 + §16 图片 ≤15 MB。**初稿曾误写成"以后再说"，已修正**（详见 `第三期实施方案v1.md` 3.9） |
| 1 | 端点契约落地（§11.1/§11.2） | `contracts/` + `core/gateway/endpoint-config.mjs` | 契约先行（§21.1 第 1 条）；`contracts/index.mjs` 的 `validateEndpointConfig` 目前**只写在描述里、代码里不存在** |
| 2 | 模型网关（M2） | `core/gateway/` | 编排要调它；必须先有"能流式拿文本"的能力；**含图片多模态消息体** |
| 3 | 标记切分清洗（M4） | `core/cleaner/` | **把模型文本变成 `AnimationProgram` 的唯一入口，当前完全缺失** |
| 4 | 槽位 Prompt（M5） | `core/prompts/` | 决定模型产出质量；SDK 签名摘要作**固定前缀**（已有 27 函数的摘要产物） |
| 5 | 编排与 SSE（M3） | `core/orchestrator/` + `core/server/` | 串起 2–4；验收里的"流式"与"取消"落在这里 |
| 6 | 播放器宿主协议（M14） | `web/`（React 18 + Vite + TS）+ `template/` 从端定稿 | 从端草案已在 `template/animation-template.html:717` 实现，**本期是 §13.2 字段冻结那一次** |
| 7 | `SYMBOLIC` 模式 | `sdk/runtime/` + `template/` | q15 目前是"数值驱动 + `latex` 标注"的最小口径，本期变成真正的模式开关 |
| 8 | 三处挂账的小修（**用户本期裁决要做**） | `tests/regression-15/q03`、`q14`、`template/` | ① q03/q14 导出键 `t1` → `tMeet`/`tStar`（消除 X1 静默覆盖隐患）；② 右栏读数分级 + 小数对齐（§9.5-4 第②项）；③ 见 12.5 |

**两条必须提前知道的前置条件（不定就没法开工）：**

1. **验收需要模型端点。**"输入一道文字题 → 流式出解题过程"必须有真实端点才能验。
   用户已决定：**先搭 OpenAI 兼容的本地假端点跑通链路，再切真端点** ——
   假端点负责可重复地验收 SSE 时序 / 取消 / 清洗 / Prompt 组装 / 错误分类，
   真端点负责验收"生成质量"（该项是**观测报告**，不是门禁）。
2. **宿主技术栈已裁决：按方案 §2.2 原文上 React 18 + Vite + TypeScript + Tailwind + zustand。**
   ⇒ 第 3 期**会新增一条构建链与一批前端依赖**（这是本方案唯一一次大规模引入依赖），
   交付说明里必须列出依赖清单（§21.3 第 5 条）。12.6 的"最小宿主"建议**已被否决**，留作决策记录。

### 12.4 前两期踩过的坑（改代码前先读这一节，别去试）

| # | 坑 | 现门禁能拦吗 |
|---|---|---|
| 1 | **`sdk/runtime/animation-runtime.mjs` 里绝不能出现 `import` / `export`** ——它被转成**经典脚本**内联进成品页，一句 `import` 就整页白屏（只剩"运行时未注入"） | ✅ 构建期 + layout-lint 拦 |
| 2 | `program-runner.mjs` 只是转发壳；共用执行器住在 `animation-runtime.mjs`，依赖方向单向 | — |
| 3 | 读数对象的 `value` **保持全精度**（C7 按容差比对），只在**显示**时格式化；画布文字一律走 `Phys.format(...)` | ✅ 门禁扫真正画到画布上的字符串 |
| 4 | 改模板必须重新打包（`node template/build-template.mjs`）；模板说明注释里**不要写完整占位符** | ✅ 构建期断言 |
| 5 | 步进导航依赖 `indexOfStep` 的**左闭判定**（`t ≥ 该步 t0`、从后往前找） | ✅ layout-lint |
| 6 | "轨迹"必须用 `Draw.trace`（或带 dash 的 `curve`）画，否则"轨迹"开关控不到 | ✅ render-check |
| 7 | `Draw.incline` 的 `angleDeg` **符号表示坡向**（正 = 坡脚在右下），`apex` 恒为最高端 | — |
| 8 | 依赖不是零：`acorn@8` + `mathjax-full@3.2.2`；npm 缓存已收进项目（`.npmrc`），否则 EPERM | — |
| 9 | 沙箱禁止**管道捕获**子进程输出（EPERM），要用 `stdio:'inherit'`；真 Node 靠 `tools/node-bin.mjs` 解析 | — |
| 10 | **新增第 3 期时的第 10 条**：`.mjs` 里的正则字面量、模板字符串会被 §3.5 的标记切分误伤 —— §3.5 明确**禁止用正则做 JS 结构切割**，切分必须走标记 | 待第 3 期建门禁 |
| 11 | **★ `template/vendor/tex-svg/manifest.json` 是一份"没人写的僵尸产物"**（第 3 期开工前核对基线时发现）：它的 mtime 停在 `2026-10-15 20:05`，而 15 份按页产物是每次构建重写的；`tools/build-tex-svg.mjs` **只写 `q*.json`、从不写这个 manifest**，`tools/doctor.mjs:41` 却读它报"已预渲染 N 题 / M 条公式" ⇒ **doctor 报的数字是过期值**（曾因此让本次核对误判公式条数）。详见第十二节 12.9 | ⚠ **无门禁能拦**（两份产物都在、都能解析，只是互不一致） |
| 12 | **★ 主链路"输入端"的能力容易被排期漏掉**（第 3 期方案初稿就把"题目图片输入"误写成"以后再说"）：图片输入是 §2.3 主链路的输入项、§11.3 门控属 M2，**不是**第 7 期的"扫描版 PDF 蒸馏"。**教训：凡属"输入 / 输出"的主链路能力，必须回原文逐条比，不能凭印象定"以后再做"**。详见 12.3 第 0 行与实施方案 3.9 | ⚠ **文档层无门禁**；建议第 3 期起把"§18 各期范围 vs 方案主链路要素"做成一张对照检查表 |
| 13 | **★ Electron 的 `process.versions.node` 也存在**（2026-10 清理时发现并修掉）：`tools/node-bin.mjs` 的 `isSelfNode()` 原判据是"execPath === process.execPath 且带 versions.node"，在 Electron 主进程里**同样成立** ⇒ 会把 `Open Design.exe` 当真 Node 放行，而可靠的 `isRealNode()` 排在它后面没机会执行。已加 `if (process.versions?.electron) return false;` | ⚠ **当时无门禁**；修法已落地，建议第 3 期加一条断言（在 Electron 语义下 `resolveNodeBin()` 不得返回壳） |
| 14 | **换宿主/换机器后，"宿主注入的环境变量"会静默消失**：`OD_NODE_BIN` 在 Open Design 会话里被注入，迁到 DeepSeek Harness 后**三处（进程/用户/机器）皆无设置**。凡是把宿主的临时注入当成"本机固有配置"写进文档或代码，迁移后就会误导人 | ⚠ **无门禁**；口径：**只把 `node-bin.mjs` 当唯一入口**，不读宿主变量 |
| 15 | **删除/核对操作不要共用同一套判断**（2026-10 清理时自己踩的）：批量删 `*.artifact.json` 时，含**中文文件名**与**子目录**的两个静默没删掉，而核对循环用了同一套不加 `-LiteralPath` 的判断 ⇒ **一起失败、一起报"✓ 已清除"**。改用 `-LiteralPath` + 全仓兜底扫描后才揪出残留 | ⚠ **无门禁**；口径：**核对必须独立于被检验的对象**（同第 2 期 `instrument-selftest` 的道理）；Windows 上凡涉及含中文/特殊字符的路径，一律 `-LiteralPath` |

### 12.5 待你裁决的事（**累计清单，请一次性给口径**）

> 前两期结束时挂起的项，加上第 3 期新产生的项。**第 3 期开工前建议先把 1–3 条定掉。**

| # | 议题 | 来源 | 现状与建议 |
|---|---|---|---|
| 1 | **宿主技术栈**：React 18 + Vite + TS（方案 §2.2 原文）还是先做最小宿主？ | 第 3 期新增 | ✅ **已裁决：按方案原文上 React 18 + Vite + TypeScript + Tailwind + zustand。** 12.6 的"最小宿主"建议**已被否决**（那一小节保留为决策记录） |
| 2 | **X1 在 q03 / q14 报警**：`RETURN('t1', …)` 与 `STEPS` 字段重名 | §11.7-2 | ✅ **已裁决：本期改。** q03 改 `tMeet`、q14 改 `tStar`，同步槽位引用；改完 X1 应归零 |
| 3 | **C4 阈值口径**（`max(20×p99, 跨度 2%)`） | §11.7-3 | 方案原文没给数值；这是新引入的实现约定。建议**确认维持** |
| 4 | **三档证据强度**（`exact` / `replayed` / `candidate`）报告字段 | §11.7-4 | §7.5 未规定形状。第 4 期自愈回灌要用它 ⇒ 建议**以它为准并写进契约** |
| 5 | **排版两项**：① 画布说明文字拥挤；② 右栏读数 9 行同权重、密密麻麻 | §9.5-4 | ✅ **第②项已裁决：本期做**（读数分两级 + 小数点对齐）。第①项（画布说明文字拥挤）要动 15 题正文，**本期仍不做** |
| 6 | `STEPS` / `ANSWERS` 行式表格式 | §9.5-2 | 方案未规定，第 1 期自定。建议**维持**（JSON 会被 LaTeX 反斜杠打坏） |
| 7 | §3.3 的 `at_t` / `latex` 下划线命名 | §9.5-3 | 与项目其余 camelCase 不一致。建议**维持照抄**（冻结口径优先） |
| 8 | C10 是否升格为正式判据 | §11.7-1 | ✅ **已定：维持扩展检查**，不需再议 |
| 9 | 关键帧（§7.5 四件套之四） | §11.7-6 | 仍未产出。它是播放器能力，**第 3 期随宿主协议落地是自然收口** ⇒ 建议本期做 |
| 10 | 多场景（一题多段动画）模板支持排期 | §22-10 | ✅ 用户已裁决 `single_scene_multi_stage`；多场景**本期不做**（会改模板架构，风险高于收益） |
| 11 | 讲解模式（按关键时刻暂停 + 投影仪大字号）是否进 v1 | §22-5 | 待会议决定 |
| 12 | 20 题回归集的 5 道延伸题 | §22-4 | 方案给了建议清单。建议**第 3 期后**再加（本期验收用 15 题够） |
| 13 | 是否在 `dry_run` 之后加 LLM 场景语义复核（`scene-review`） | §22-1 | 方案主链路未列入。建议**不加**（职责由 C1–C9 + 自检条款承接） |
| 14 | 是否引入 `openai` SDK（方案 §2.2 原文） | 第 3 期新增 | ✅ **已裁决：不装**，用 Node 内置 `fetch` 手写 `/chat/completions` 流式调用（约 100 行、零新增依赖） |
| 15 | **★ 题目图片输入是否第 3 期做**（初稿误写成"可留空位"） | 用户 2026-10 提问后核实 | ✅ **已裁决：本期必做。** 依据：§0"粘贴/拍照一道题"、§1.2 范围内、§2.3 主链路输入、§2.1 架构图、§10.2 任务段、§11.1 `visionModel`/`supportsVision`、**§11.3 视觉门控（M2 = §18 期 3）**、§16 图片 ≤15 MB、§15 解题页。**第 7 期只负责"扫描版 PDF 教辅蒸馏"（M19），两者不是一回事** |
| 16 | **★★ 构建工具：Vite 还是 Rollup**（方案 §2.2 写的是 Vite） | 第 0 步实测 | ⚠ **待裁决。** Vite 5 在本沙箱**结构性不可用**（配置加载用 esbuild 服务进程、Windows realpath 用 `execFile`，两处都必须管道 spawn ⇒ EPERM；已 7 组实验确认）。**当前按 Rollup 推进**（不阻塞后续步骤）。<br>**A. 保持 Rollup**（推荐，代价：偏离 §2.2，无 HMR）<br>**B. 为本项目放开沙箱管道限制**，换回 Vite（需你确认放宽是否可接受）<br>**C. 两套配置都留**，环境允许时再切<br>完整取证见 **12.11** |

### 12.6 关于"宿主技术栈"这个选择（**决策记录 · 建议已被否决**）

> ## ⛔ 本节结论已作废
>
> ⛔ 本节结论已作废
>
> 我当时建议"第 3 期先做最小宿主、不上 React"，**用户否决了这个建议**。
> **第 3 期的口径是：按方案 §2.2 原文，采用 React 18 + TypeScript + Tailwind + zustand。**
> 开工请以 **12.11**（Vite 不可用的取证）为准。
>
> ⚠ **唯一没能照做的是构建工具**：方案写的是 Vite，实测本沙箱**结构性不可用**，
> 已换 **Rollup**（取证与裁决点见 **12.11**）。其余四项（React / TS / Tailwind / zustand）
> 均按原文落地。
>
> 下面这段解释**保留下来**，因为它是"React / Vite / TS 分别是什么"的入门说明，
> 对非技术背景的读者仍然有用；**但它的建议部分不是口径**。
> 已知代价：第 3 期会新增一条构建链与一批前端依赖，交付时必须列依赖清单（§21.3 第 5 条）。

**先说清楚 React / Vite / TS 分别是什么：**

- **React** = 一套"用 JavaScript 拼界面"的工具库。它把页面拆成一个个"组件"，数据一变页面自动更新。
  好处是界面复杂以后好维护；代价是必须先"搭架子"再写内容。
- **Vite** = 一个**打包/编译工具**。浏览器只认最基本的 JS，React 和 TypeScript 写的代码浏览器不认，
  得先用 Vite 把它们"翻译"成浏览器能跑的代码。**引入它 = 项目从此多一道"必须先编译"的工序**，
  不能像现在这样双击 `.mjs` 直接跑。
- **TypeScript（TS）** = 带类型标注的 JavaScript。写错字段名、传错参数会在编译时就报错。
  好处是契约多、字段多的时候少踩坑；代价是每处都要写类型。
- **zustand** = 一个很小的状态管理库，管"当前选了哪个模型、时间轴拖到哪"这类全局数据。

**现状对比（这才是关键）：**

| | 现在的代码（第 1、2 期） | 换上 React + Vite + TS |
|---|---|---|
| 怎么改怎么跑 | 直接 `node xxx.mjs`，改完立刻见效 | 必须先 `vite build`，再看效果 |
| 构建依赖 | **零**（只有 acorn + mathjax 两个运行时依赖） | 多几十个 npm 包 + 一条构建链 |
| 出问题怎么查 | 只有一层，报错就是代码本身 | 多一层"构建报错"，对新手更难分辨 |
| 15 题的成品页 | 单文件自包含、双击就播 | **不受影响**（成品页是纯 HTML，与宿主无关） |
| 加功能 | 手写 DOM 操作，界面复杂后会很啰嗦 | 界面复杂后确实更好维护 |

**我当时建议（已被否决）第 3 期先做"最小宿主"，不上 React。**

理由：第 3 期真正要验的是 **SSE 流式、取消无残留、标记切分、Prompt 组装、iframe 协议**——
这些全是"后端 + 一个页面"的事，跟 React 一点关系都没有。用最小宿主，
**能改一行看一行，出问题一眼看到底**；等第 6 期（可配置化完全体：Prompt 编辑器 + 世界书管理器 +
清洗规则编辑器）界面真的复杂起来了，再换 React，那时换的还只是"壳"，后端一行不用动。

**但用户裁决：按方案 §2.2 原文上 React 18 + Vite + TS。** 所以：

- 上面的理由**不生效**，第 3 期就搭正式前端架子；
- 相应代价要提前接受：**改一行代码要先过一遍编译**，出错时可能多一层"构建报错"要分辨；
- 交付时要**如实列出新增依赖清单**（这是本项目第一次大规模引入依赖，§21.3 第 5 条要求列清单并说明）；
- **15 道题的成品页不受任何影响**（它们是纯 HTML 单文件，与宿主技术栈无关）。

> ⚠ **后续发展（第 0 步实测，见 12.11）**：React 18 + TS + Tailwind + zustand **照方案落地了**，
> 但 **Vite 在本沙箱结构性不可用**（两处必须管道 spawn ⇒ `spawn EPERM`），
> 构建工具被迫换成 **Rollup**。这一项需要你裁决（12.5 第 16 条）。

### 12.7 第 3 期开场白（复制这一整段开新会话即可）

> 接着做《物理解题动画软件v1.0自研方案.md》**第 3 期**。读 `README.md` **第十二节**（第 3 期工作指导）
> 与 **本文件第十四节**（第 4 期）或 **第十二、十三节**（第 3 期留档），再读方案 §18 期 3、§2.3、§10、§11、§12、§13。
> 第 1、2 期已验收关闭：**不要改 §3 / §9 / §11.2 / §7.2 冻结项**，C10/X1/X2 仍是扩展检查。
>
> 先跑基线确认没退步：
> ```powershell
> node tools/doctor.mjs
> node tools/verify-all.mjs        # 应二十步全绿（⑬⑭ 前端 · ⑮ 契约 · ⑯ 网关 · ⑰ 切分 · ⑱ Prompt · ⑲ 编排 · ⑳ 宿主协议）
> ```
> 本期目标：把"手写题能画动画"变成"**输入文字题或题目图片 → 流式出解题过程 → 出可播放动画**"，
> 验收口径是 §18 期 3 原文（含"中途取消无残留"与"纯符号题标注全为符号"）。
>
> **开工前已裁决/已补漏的六件事（不必再问）**：
> ① 前端**按方案 §2.2 原文上 React 18 + Vite + TypeScript + Tailwind + zustand**（12.6 的最小宿主建议已否决）；
> ② **不装 `openai` 包**，用 Node 内置 `fetch` 手写流式调用；
> ③ **本期修 X1**：q03 的 `t1` → `tMeet`、q14 的 `t1` → `tStar`，同步槽位引用；
> ④ **本期做右栏读数分级**（分级 + 小数点对齐）；第①项"画布说明文字拥挤"本期不做；
> ⑤ 端点两条路径都要：**先假端点验收链路，再切真端点验质量**（假端点进门禁、真端点进观测报告）；
> ⑥ **★ 题目图片输入 + §11.3 视觉门控本期必做**（§2.3 主链路输入 + M2 端点范畴；**PDF 教辅蒸馏才是第 7 期**，两者别混——见实施方案 3.9）。
> 另有三处顺手小修：X1 改名 · 读数分级 · 僵尸产物 `tex-svg/manifest.json`（12.9）。
> 其余待裁决项见 12.5，可边做边定。

### 12.8 第 3 期结束时要交的东西（对照 §21.3 自查清单）

除方案 §21.3 的七条外，第 3 期必须额外做到：

1. `README.md` 增写**第十三节（第 3 期交付说明）**，并把第十二节改为留档；
2. 新增的门禁步骤全部接进 `tools/verify-all.mjs`（十二步 → N 步），任一步失败即整体失败；
3. 第 3 期方案里答应的裁决点，逐条给结论（含"用户选了什么、为什么"）——**已在 14.7 汇总**；
4. 假端点验收与真端点验收**分开记录**：前者进门禁，后者进观测报告；
5. 交付落点清单（照第 2 期 11.8 的做法：列"把哪些文件覆盖回仓库"）。

### 12.9 ✅ 遗留缺陷：`tex-svg/manifest.json` 僵尸产物（**第 3 期第 8 步已修**，见 12.19）

> 本节记录**问题本身**（当时未修）；**修法与取证见 12.19**。保留此节是因为它的"根因分析"仍有参考价值。

**现象**：`tools/doctor.mjs` 报"MathJax：已预渲染 15 题 / **205** 条公式"，
而 `node tools/build-tex-svg.mjs` 报"已预渲染 15 题 · **207** 条公式"。两个数字长期不一致。

**根因（已定位）**：

| 文件 | 谁写它 | mtime | 内容 |
|---|---|---|---|
| `template/vendor/tex-svg/manifest.json` | **没有任何代码写它**（全仓 grep 只在 `doctor.mjs` 里被读） | 冻结在 `2026-10-15 20:05` | 15 题 / **205** 条 |
| `template/vendor/tex-svg/q*.json`（15 份） | `tools/build-tex-svg.mjs:106` **每次构建重写** | 每次构建刷新 | 15 题 / **207** 条（q02=14、q06=15、q15=15…） |

⇒ **`manifest.json` 是一份"僵尸产物"**：它是第 1 期某次构建留下的快照，之后源码改了（q02/q06/q15 各多出 1–2 条公式），
但**没有任何构建步骤会更新它**，于是它永远停在旧数字上；而 `doctor.mjs` 恰好读这个文件 ⇒ **环境自检报的是过期数据**。

**为什么门禁没发现**：两份产物都在、都能解析、格式都合法，只是**互不一致**。
`verify-all` 的 ⑧ 步（`tex:build`）只看本次构建的输出，从不回头看 `manifest.json`。

**建议修法（第 3 期做，工作量很小）**：→ **已于第 3 期第 8 步全部执行，见 12.19**

1. `tools/build-tex-svg.mjs` 在写 15 份 `q*.json` 之后，**顺手生成 `manifest.json`**（题目数 / 公式数 / 字形数 / 渲染器）；
2. `doctor.mjs` 改为**读 `q*.json` 汇总**（或读新生成的 manifest，两者必须一致）；
3. `verify-all` 的 ⑧ 步加一条断言：**`manifest.json` 的汇总必须等于本次构建的汇总**；
4. 记进第 3 期交付说明的"本期修掉的缺陷"。

> **教训（与第 2 期第 13 条同类）**：**"产物存在且格式合法"不等于"产物是当前的"**。
> 这类"僵尸产物"骗过的不是判据，而是**人对基线的判断**——本次核对就因此差点把 207 写成 205。

### 12.10 ★ 环境迁移清理（Open Design → DeepSeek Harness，2026-10 已完成）

**背景**：第 1、2 期在 **Open Design** 里工作，之后迁到 **DeepSeek Harness**。
工作目录里因此残留了一批**只对 Open Design 有意义**的文件与指向。本节记录**已经清理掉什么**。

**已删除（逐文件哈希见 `清理台账-2026-10-16.md`）**：

| 删除项 | 它是什么 | 为什么能删 |
|---|---|---|
| `.od-skills/`（6 文件 / 51.8 KB） | Open Design 的 Web 原型技能包（`open-design.json` / `SKILL.md` / 模板） | 与物理动画项目零关系；全仓无任何引用 |
| `.file-versions/`（8 文件 / ~320 KB） | Open Design 的**文件版本备份**（每条 manifest 记着当时的提示词） | 已逐一核对：4 条备份里 **3 条与当前文件逐字节相同**，第 4 条是 7 小时前的旧版 ⇒ 无独有内容 |
| `q07-rod-emf.html`（**根目录副本**，234710 B） | 当时"方便双击"而放在根目录的副本 | **过时**：当前版在 `template/build/q07-rod-emf.html`（239658 B，含第 2 期后续修复） |
| 4 个 `*.artifact.json` | Open Design 的**交付描述文件**（`renderer: html` + `exports: [html,pdf,zip]`） | DSH 下交付走 `present` 工具，不读这种文件。**只删描述文件，对应的 html 全部保留** |

**明确保留（并说明原因）**：

| 保留项 | 原因 |
|---|---|
| `.npm-cache/`（17 MB） | **不能删**：`.npmrc` 的 `cache=.npm-cache` 依赖它；删了下次 `npm install` 会因默认缓存在可写范围之外而 EPERM |
| `tests/reports/*.png`（7 张截图） | 第 1、2 期的视觉取证留档，README 与《修正稿》都引用其结论 |
| `tools/_*.mjs`（11 个下划线工具） | 是判据/取证的辅助工具，仍可用于静态体检与任意 PNG 分析 |

**顺带修掉的一个真缺陷**：`tools/node-bin.mjs` 的 `isSelfNode()` 会把 Electron 当成真 Node
（Electron 同样带 `process.versions.node`），从而让 `isRealNode()` 的可靠过滤失效。
已加 `if (process.versions?.electron) return false;`，并在文件头更正了原先的归因。

**⚠ 一处能力缺口（不是缺陷，是环境差异）**：第 1、2 期的"像素级取证"依赖
Open Design 的 `od export --format image`（把成品页送进真渲染器截图）。
迁移后**没有等价入口**，因此：

- **不影响任何门禁**：十二步全绿与截图无关（`layout-lint` 是静态体检，`render-check` 用 mock canvas）；
- **影响"观感"这一层**：像素级结论暂时只能靠人肉双击成品页看；
- README 里那些 `od export …` 命令**已全部标注为"Open Design 时代的历史记录"**。

> **给第 3 期的提醒**：以后写文档提到"本机环境"时，要分清三类——
> ① 操作系统级（注册表里的、稳定）；② **宿主应用会话级**（如 `OD_NODE_BIN`，换个宿主就没了）；
> ③ 项目级（本项目自己的文件）。
> 把 ② 当成 ① 写进文档或代码，就是本次清理的根因。

### 12.11 ★★ 第 3 期实施记录：**Vite 在本沙箱不可用，前端改用 Rollup**（重要偏差）

**这一节记录第 3 期第 0 步的真实经过。它是本项目至今最大的一处"环境迫使的偏差"，请完整读。**

#### 结论先说

| 项 | 方案原文（§2.2） | 第 3 期实际 | 性质 |
|---|---|---|---|
| 前端框架 | React 18 | **React 18.3.1** | ✅ 照做 |
| 类型系统 | TypeScript | **TypeScript 5.9（严格模式）** | ✅ 照做 |
| 样式 | Tailwind | **Tailwind 3.4（PostCSS 插件，进程内）** | ✅ 照做 |
| 状态管理 | zustand | **zustand 4.5** | ✅ 照做 |
| **构建工具** | **Vite** | **Rollup + tsc** | ⚠ **偏离（被迫）** |
| 包管理器 | （未指定） | **npm**（`--prefix web --ignore-scripts`） | 说明性选择 |

#### Vite 为什么用不了：本沙箱禁止"管道捕获子进程输出"

DSH 沙箱的硬限制：**任何程序用管道（pipe）捕获子进程输出都会 EPERM**，
只有 `stdio:'inherit'` / `'ignore'` 放行。而 **Vite 5 有两处必须用管道 spawn**：

| # | 触发点 | 调用链 | 结果 |
|---|---|---|---|
| ① | **加载配置文件** | `loadConfigFromFile` → `bundleConfigFile` → **esbuild 的 Node API** → `ensureServiceIsRunning` → 管道 spawn esbuild 服务进程 | `spawn EPERM` |
| ② | **Windows 路径优化** | `commonjs--resolver` → `windowsSafeRealPathSync` → `optimizeSafeRealPathSync` → **`execFile`** | `spawn EPERM` |

**第 ① 条是根本性的**：esbuild 的 Node API 架构就是"启动一个常驻服务进程、通过管道通信"，
`ESBUILD_BINARY_PATH` 只是把服务换成原生二进制，**管道这一步绕不过去**（已实测）。

**我做了 7 组实验才敢下这个结论**（全部记录在此，避免以后重复踩）：

| # | 尝试 | 结果 |
|---|---|---|
| 1 | `pnpm install` 默认 | ✗ pnpm 10+ 拦住依赖构建脚本（`ERR_PNPM_IGNORED_BUILDS`） |
| 2 | `.npmrc` 写 `onlyBuiltDependencies[]=esbuild` | ✗ pnpm 11.7 不认这个键 |
| 3 | `pnpm-workspace.yaml` 写 `allowBuilds: {esbuild: true}` | ✗ 仍被忽略，且 `pnpm run` 前的依赖检查直接崩 |
| 4 | `pnpm approve-builds --all` | ✗ 它自己去 spawn lifecycle 脚本 ⇒ `spawn EPERM` |
| 5 | `vite build`（CLI，`.ts` 配置） | ✗ ① 处 EPERM |
| 6 | 配置改 `.mjs` | ✗ Vite 5 对**任何**配置都先过 esbuild 打包 |
| 7 | **Vite API + `configFile:false` 内联配置** | ✓ 跳过了配置加载，但**又卡在 ② 处** `execFile` EPERM |

#### 为什么 Rollup 可以

**Rollup 是纯 JavaScript，运行期不 spawn 任何子进程**（原生加速是 napi 绑定、进程内调用）。
配套插件也全是纯 JS：

| 依赖 | 作用 | 是否 spawn |
|---|---|---|
| `@rollup/plugin-node-resolve` | 解析 `react` 等裸模块说明符 | 否 |
| `@rollup/plugin-commonjs` | React 18 是 CJS，zustand 按 ESM 消费它 ⇒ 需要互操作 | 否 |
| `rollup-plugin-postcss` | 跑 `postcss.config.js`（tailwindcss + autoprefixer） | 否 |
| `typescript`（`tsc`） | 类型检查 **+ 转译 JSX** | 否 |

**构建分两段**（"转译"与"打包"各由一件工具负责，便于排错）：

```
web/src/**.ts(x) --[tsc -p tsconfig.build.json]--> web/.build/**.js
                                                    |
                                    [rollup -c]-----+--> web/dist/assets/app.js + app.css
```

#### 安装与构建的三条硬约束（都踩过，别省）

```powershell
$env:NPM_CONFIG_CACHE = "<仓库根>\.npm-cache"   # ① 缓存必须在项目内，否则 EPERM
npm install --prefix web --ignore-scripts        # ② --prefix：依赖落在 web/ 内，不污染根
                                                 # ③ --ignore-scripts：依赖的 postinstall 会 spawn EPERM
node tools/web-build.mjs                         # 门禁：类型检查 + 转译 + 打包 + 产物体检
```

已验证：**根 `package.json` / `package-lock.json` 逐字节未变、根 `node_modules` 仍只有
acorn + mathjax-full**（后端零新增运行时依赖的口径保住了）。

#### 这条偏差怎么处置（**待你裁决**，见 12.5 第 16 条）

- **选项 A（当前做法）**：保持 Rollup。项目能跑、门禁全绿、离线自包含；
  代价是偏离 §2.2 原文，且 `vite dev` 的 HMR 开发体验没有（改成 `tsc --watch` + 静态服务）。
- **选项 B**：让你在 DSH 里为本项目**放开沙箱**（允许子进程管道），然后换回 Vite。
  需要你确认这个放宽是否可接受（它同时会解除其它限制）。
- **选项 C**：保留两套配置（Rollup 为准、Vite 配置一并留着），日后环境允许时再切。

**目前按 A 推进**，因为它不阻塞后续 8 个步骤；B/C 随时可以切换（换的是构建壳，业务代码不动）。

### 12.12 ★ 第 3 期实施记录：**第 1 步 · 契约跨字段校验补齐**（已完成）

#### 补的是什么：契约里写着一个不存在的守门人

`contracts/endpoint.schema.json` 的描述从第 1 期起就写着：

> "…这些是跨字段约束，JSON Schema 层只表达字段形状，跨字段部分由 **`contracts/index.mjs`** 的
> `validateEndpointConfig` 实现。"

**但 `contracts/index.mjs` 与 `validateEndpointConfig` 从来不存在**——契约里指着一个空的守门人。
第 3 期第 1 步把它实现，并**顺手把描述改成指向真实模块** `contracts/validate.mjs`。

#### 交付物

| 文件 | 作用 |
|---|---|
| `contracts/validate.mjs` | `validateEndpointConfig()`（§11.2 九条）+ `validateCleaningRuleSet()`（§12 / §16）+ `formatIssues()` |
| `tests/contract-validator-selftest.mjs` | **逐条正反例取证**，接进门禁 ⑮ |

#### 为什么手写而不引入 JSON Schema 校验器（ajv 之类）

1. **§11.2 有一半规则根本表达不了**在 JSON Schema 里：`apiKeyModelId` 不得成环、
   `stageModels` 引用必须存在、`distill` 视觉门控、体积上限；
2. 本项目从第 1 期就定下"依赖最小"口径（后端至今只有 acorn + mathjax-full），
   为一个字段量很小的配置树引入校验器 + 依赖树不划算；
3. 手写能给出**面向用户的中文诊断 + 可操作建议**（§21.1 第 5 条），
   通用校验器给的是英文路径式报错。

> **不影响 `contractHash`**：`contracts/validate.mjs` **不是** `contracts/` 的生成物，
> `verify-contracts.mjs` 只比对 `buildContractArtifacts()` 产出的 13 份文件。
> 但**描述文本的更正**确实改了哈希（见下）。

#### §11.2 九条 → 规则号的映射（自愈回灌与测试都按规则号断言）

| §11.2 规则 | 规则号 | 说明 |
|---|---|---|
| 1 远程必须 HTTPS | `endpoint.url.https-required` | `http://127.0.0.1` / `localhost` 例外 |
| 2 不得含凭据/查询/片段 | `endpoint.url.has-credentials` / `.has-query` / `.has-fragment` | 另含 `endpoint.url.unparsable` |
| 3 id 字符集 | `endpoint.id.charset` | 只允许字母/数字/点/下划线/连字符 |
| 3 id 不重复 | `endpoint.id.duplicate` | |
| 4 最多 300 项 | `endpoints.too-many` | |
| 5 `apiKeyModelId` 必须存在 | `endpoint.apiKeyModelId.dangling` | |
| 5 `apiKeyModelId` 不得成环 | `endpoint.apiKeyModelId.cycle` | 自环与多节点环都覆盖（沿链走 + visited 集合） |
| 6 `stageModels` 引用必须存在 | `stageModels.dangling` / `.unknown-stage` | 键必须 ∈ §2.3 阶段枚举 |
| 7 `distill` 视觉门控 | `stageModels.distill.vision-required` | 端点 `supportsVision !== true` 即拒 |
| 8 配置 ≤4 MB · 版本 | `config.too-large` / `config.version-unsupported` | |
| 9 测试连接 | *（不做配置校验：它是 UI 动作）* | ✅ **第 6 期已接入**：`core/gateway/connection-test.mjs`（最小请求 `GET {baseURL}/models` + 延迟 + 出口脱敏 + 只对 https/本机 http 发请求），界面在「规则 → 端点与 Key」 |

补充的形状规则：`endpoint.missing-field` · `endpoint.timeoutMs.too-small`（下限 1000）·
`endpoint.flag.not-boolean` · **`keys.orphan`**（keys 里有 endpoints 里不存在的端点 ⇒ 历史残留，
避免 Key 无意义地留在配置里）。

§12 清洗规则：`rule.pattern.invalid`（**非法正则即时报错、不落盘**）· `rule.stage.unknown` ·
`rule.flags.unknown` · `rule.id.duplicate` · `rule.enabled.not-boolean` · `rules.bad-format` / `.bad-version`。

#### 取证结果（门禁 ⑮ 的真实输出）

```
✓ 契约校验取证：通过 37 条，失败 0 条
```

每条反例断言的**是"被哪条规则号拒绝"**，不是"有没有报错"——
否则规则被写宽了也照样绿（这是第 1、2 期 `lint-selftest` 的同一套做法）。

#### 契约哈希变化（**已知且已同步**）

| | contractHash |
|---|---|
| 第 1、2 期基线 | `d8af94b1…af8e` |
| **第 3 期第 1 步之后** | **`13acace279604228cd67b8d374ba1bef37f81c7694be1f5cbf3cbe85669bf676`** |

**变化原因只有一个**：`endpoint` schema 的 `description` 文本改了（更正模块路径）。
**字段形状（properties / required / enum）一字未改**，13 份产物数量不变。
已同步到 12.2。

### 12.13 ★ 第 3 期实施记录：**第 2 步 · 模型网关 + 本地假端点**（核心已完成）

#### 交付物

| 文件 | 作用 |
|---|---|
| `core/gateway/error-taxonomy.mjs` | 错误分类（§11.2 要求的网络/鉴权/限流/超时/内容拒绝 + 三类补充）与 `ModelError` |
| `core/gateway/model-client.mjs` | **手写**的 OpenAI 兼容流式客户端（用户裁决不引入 `openai` 包） |
| `core/gateway/endpoint-config.mjs` | 配置读取与校验（复用 `contracts/validate.mjs`）· 阶段→端点解析 · **§11.3 视觉门控** · **Key 脱敏** |
| `tests/fake-endpoint/server.mjs` | **本地假端点**（可复用）：能配置回复内容、节奏、故障模式，并**如实记录收到的请求体** |
| `tests/gateway-selftest.mjs` | 取证 **63 条**，接进门禁 ⑯ |

#### 为什么必须有假端点（这是本期验收设计的地基）

真实模型的输出**不可重复**。若门禁直接打真端点，就会变成"随机绿/随机红"，等于没有门禁。
所以本期把验收分成两层（**假端点进门禁 / 真端点进观测**）：

| 层 | 打什么 | 判定 | 是否进门禁 |
|---|---|---|---|
| **链路正确性** | **本地假端点** | 确定性：SSE 时序、取消、错误分类、图片编码、Prompt 组装、清洗切分 | ✅ 进门禁 |
| **生成质量** | 真端点 | 人工看 | ❌ 只进观测报告 |

**假端点不"看懂"图片**（那是模型能力，桩服务不该假装具备）——
它的职责是**如实回报收到了什么**，供门禁用例断言。

#### 自写流式必须覆盖的六件事（逐条都有取证）

| # | 要点 | 取证 |
|---|---|---|
| ① | SSE 行解析、**跨 chunk 的不完整行要缓冲** | 把事件从中间切开（甚至在 JSON 中间）仍能正确还原 AB+CD |
| ② | `delta.content` + `reasoning_content` | 正文与思维链分流正确 |
| ③ | 取消 → `cancelled`，**不算错误** | 外部 `AbortSignal` 触发后分类为 cancelled |
| ④ | 超时与取消是**两条不同路径** | `timeoutMs` 到点 → `timeout`；外部 abort → `cancelled` |
| ⑤ | 流被截断**不能静默当成"生成完了"** | 中途断开 → `bad-response`，且保留已收到的部分文本 |
| ⑥ | 多模态：`content` 数组，**图片只在任务段** | base64 解码长度 == 原图字节数；MIME 与上传一致 |

#### 错误分类 → 可操作建议（§11.2 明确要求"分别给建议"）

| 情形 | kind | 给用户的建议 |
|---|---|---|
| 401 / 403 | `auth` | 检查 Key 是否正确/过期、账号是否有该模型权限 |
| 429 | `rate-limit` | 稍后重试或换端点分担流量 |
| 400 / 422 | `content-refused` | 检查题面是否触发内容策略，或换模型 |
| 5xx | `server` | 对端故障，稍后重试 |
| 连不上（ENOTFOUND/ECONNREFUSED…） | `network` | 检查网络与 baseURL；本地推理要确认服务已启动 |
| 超时 | `timeout` | 调大该端点的 `timeoutMs` |
| 响应不是预期形状 / 流截断 | `bad-response` | 确认 baseURL 指向 OpenAI 兼容端点（通常以 `/v1` 结尾） |
| 用户取消 | `cancelled` | "已按你的要求取消"（**不是错误**，UI 不应报红） |

> **诚实说明一处不精确**：400/422 既可能是"请求写错"也可能是"内容被拒"，
> 响应体里未必有可辨关键词。代码里**没有假装精确**——统一归类为 `content-refused`
> （它的建议比"未知错误"更有用），原始响应片段保留在 `ModelError.raw` 里供排查。

#### §11.3 视觉门控的落地形状

`assertVisionAvailable()` 返回 `{ available, reason, hint }`：

- `supportsVision = true` → 可用；
- `supportsVision = false` → **禁用**，`reason` **逐字对齐 §11.3 原文**
  （"当前模型不支持图片输入，请更换支持视觉的模型或改为文字输入"），
  并给 `hint` 指向"配图补充描述"人工兜底入口；
- **绝不降级**：不偷偷丢图、不做本地 OCR、不假装读了图（§1.3 / P4 明令禁止）。

`resolveStageEndpoint()` 的取舍：单端点时未配置阶段**自动用它**（单端点场景不必重复配置）；
多端点时未配置**明确报错并列出可选 id**，**不猜**。

#### Key 的安全边界（§16 / §21.2 第 6 条）

`redact()` 把 Key 变成 `sk-a…mnop`（≤8 字符整体打码）；
`redactText()` 从任意文本里抹掉**已知 Key 字面量**，并**兜底**抹掉 `sk-…` / `Bearer …` 形态。
**所有要落盘或上屏的文本都必须先过这一道**——包括 `ModelError.raw`（对端可能把请求回显在错误里）。

#### 取证结果（门禁 ⑯ 的真实输出）

```
✓ 模型网关取证：通过 63 条，失败 0 条
```

覆盖：模型选择与脱敏 7 条 · 状态分类 9 条 · 图片校验 5 条 · 消息构造 7 条 ·
流式解析 7 条 · 跨 chunk 缓冲 2 条 · reasoning 2 条 · 错误分类（走真实 HTTP）6 条 ·
超时与取消 2 条 · 流截断 2 条 · 多模态送达 4 条 · 阶段解析与视觉门控 10 条。

#### 还没做的（第 2 步的余项）

- **真端点联调**：需要你提供 baseURL / 模型 ID / Key（Key 只落在 `ai-rules/endpoints.json`，不进日志）。
- `ai-rules/endpoints.json` 的**示例配置**与"测试连接"（§11.2 第 9 条）——排在**第 6 步解题页**一起做，
  因为它是 UI 动作。

### 12.14 ★ 第 3 期实施记录：**第 3 步 · 标记切分清洗 + 行号保真**（已完成）

方案把这个标为"**本期最关键**"，理由是：切分一旦破坏行号，第 2 期辛苦做的**行号级诊断全部变成假话**，
而且**别的门禁一条都发现不了**（判据照样通过，只是诊断指错地方）。

#### 交付物

| 文件 | 作用 |
|---|---|
| `core/cleaner/marker-split.mjs` | §3.5 **零猜测**切分；四类硬失败区分；**行号保真** |
| `core/cleaner/regex-rules.mjs` | §12 兜底（内置最小集 + 用户规则）· 灾难性正则形态拒绝 · 标记保护 |
| `core/cleaner/to-program.mjs` | 组装 `AnimationProgram`（§3.6）+ **行偏移表** |
| `tests/cleaner-selftest.mjs` | 取证 **53 条**，接进门禁 ⑰ |

#### 行号保真是怎么做到的

切出来的槽位正文**用空行占位补齐到原始位置**，因此有一条硬不变式：

```
槽位正文第 (firstLine) 行  ==  模型输出第 firstLine 行
不变式：firstLine − 1 == "首个非空行" 在槽位正文里的下标 == 占位空行数
```

于是第 2 期的埋点与 `buildLineMap` **可以直接沿用**，不需要第二套坐标系。
`to-program.mjs` 另给出 `lineOffset[slot] = firstLine − 1`，
诊断层把它加到槽位内行号上就得到"模型输出里的真实行号"（`toSourceLine()`）。

> **★ 这一步我自己写错过一次，值得记下**：第一版把占位行数写成 `bodyStart - 1 + from`，
> 多算了一行；而**我的测试断言当时也写错了**（用 `slotLines[0]` 去对 `firstLine`，
> 混淆了"正文首行"与"首个非空行"），两者凑巧在无前导空行时互相掩盖。
> 是「前导空行」那组用例把两个错误一起暴露出来的 ——
> **这正是"每条判据都要配能证伪它的用例"的价值**。

#### 四种硬失败必须区分开（提示语与修复建议完全不同）

| 情形 | 规则号 | 为什么必须区分 |
|---|---|---|
| 标记名不认识 | `marker.unknown` | 特别提示 `scene_spec` 是 v2 旧名，**切分路径不归一化**（§9.1 只允许在导入路径归一化） |
| 同一个键出现两次 | `marker.duplicate` | 指出首次出现的行号 |
| 有 `@slot` 没有 `@end` | `marker.unclosed` | 指出未闭合的那个标记行 |
| 该出现的键没出现 | `marker.missing` | 逐字给出该槽位应有的标记写法 |
| 槽位正文为空 | `slot.empty` | §3.2 审计 2：**空串按缺失报错，不得静默通过** |
| 孤立 `@end` | `marker.stray-end` | |

**散落文本**（标记之外的解释性文字）只出 `text.outside-markers` **告警**，不算硬失败。

#### §21.2 第 4 条（禁止用正则做 JS 结构切割）怎么落的

本实现**只做"整行精确匹配"**：一行要么恰好等于某个标记（允许两侧空白），要么就是普通内容。
于是 `const s = "/* @slot:setup */"` 这种**字符串里的假标记不会被误识别**——因为它那一行并不等于标记本身。
代价是"标记必须独占一行"，这本来就是 §3.5 的书写协议。取证里专门有一组用例钉这条。

#### §12"隔离执行 + 超时"的诚实记录（**一处能力缺口**）

§12 原文要求"正则在**隔离环境运行 + 超时**"。本沙箱**禁止管道捕获子进程**（第 2 期已实测），
"把正则丢给子进程跑、超时 kill"这条常规路走不通。因此本模块采用**主力防御 + 明确记录缺口**：

| 层 | 做法 | 是否可机检 |
|---|---|---|
| 配置层 | `contracts/validate.mjs` 试编译，非法正则即拒 | ✅ |
| **形态层** | `detectCatastrophicPattern()` 拒绝嵌套量词 `(a+)+`、择一量词 `(a\|a)*`、相邻贪婪 `.*.*` | ✅ |
| 规模层 | 单次清洗输入上限 `MAX_CLEAN_INPUT_CHARS`，超限拒绝而不是硬跑 | ✅ |
| **墙钟超时** | **没有**（沙箱不允许） | ❌ **已记录的缺口** |

内置规则**全部是字面量操作、不用正则**，因此内置路径零回溯风险。
用户自定义正则的风险被"形态拒绝 + 规模上限"压到很低，**但不是零** ——
等沙箱允许子进程管道时，这里换成 worker + 超时即可（**接口不变**）。

### 12.15 ★ 第 3 期实施记录：**第 4 步 · Prompt 系统 + promptHash**（已完成）

#### 交付物

| 文件 | 作用 |
|---|---|
| `core/prompts/templates.mjs` | §10.1 的 7 项 Prompt（6 个阶段 + 答案结构模板） |
| `core/prompts/fixed-prefix.mjs` | §10.2 三段注入 + **promptHash** |
| `tests/prompts-selftest.mjs` | 取证 **62 条**，接进门禁 ⑱ |

#### §10.2 的三段与"第 3 期条件段为空"

```
[固定前缀]  角色与输出规约 → 模板骨架 → SDK 签名摘要     ← buildFixedPrefix()
[条件段]    命中的世界书词条                            ← 第 3 期恒为空（第 5 期接入）
[任务段]    题目 + 图片 + 已知条件                      ← buildTaskSegment()
```

**第 5 期接入时只填中间那个槽，不动前后两段** —— 这正是 §10.2 要的前缀稳定性。

#### promptHash 的语义（门禁 ⑱ 的核心）

| 操作 | 哈希应当 | 实际 |
|---|---|---|
| 同一配置组装两次 | **不变** | ✅ 逐字节一致 |
| 换题目文字 | **不变** | ✅ |
| **换图片** | **不变** | ✅（图片只在任务段） |
| 加/换世界书词条 | **不变** | ✅（条件段不属于固定前缀） |
| 改 Prompt 正文 / 改 SDK 摘要 | **必须变** | ✅ |

最后一行尤其重要：**如果改 Prompt 也不变哈希，那 Provenance 烧录的哈希就是假的**。
为此门禁 ⑱ 有一条反例断言：改角色段后重新计算的哈希必须不等于原哈希。

哈希覆盖 `[role, skeleton, sdk, templateVersion, sdkVersion]` 以 `\u0000` 连接后取 SHA-256；
**不覆盖任务段**——这正是"换题换图哈希不变"的实现根据。

#### 一个能从**函数签名**上防错的细节

`buildFixedPrefix()` **不接受任何参数**（取证里断言了 `buildFixedPrefix.length === 0`）。
这样从接口层就杜绝了"把题面塞进固定前缀"这一最贵的误用——
一旦塞进去，prompt cache 每次失效，真实成本成倍上升。

#### 顺带修掉的一条**无效测试**

第一版里有一条 `check('prefixBytes 与实际字节数一致', p.prefixBytes === undefined || true)`
——它是**恒真**的，等于没测。已改为真实断言：`assemblePrompt().prefixBytes` 必须等于前缀的 UTF-8 字节数，
且中文按 3 字节计（不是字符串长度）。

### 12.17 ★ 第 3 期实施记录：**第 6 步 · 宿主协议定稿 + 解题页 + 动画页**（已完成）

#### 交付物

| 文件 | 作用 |
|---|---|
| `contracts/host-protocol.md` | **§13.2 定稿**（§22 第 11 条要求本期定稿）：11 条消息 + `source` 字段 + **`program` 注入** + 时序 + 错误码 |
| `template/animation-template.html`（**改**） | 从端实现 `program` 注入；`setTheme` 补上；修掉两个启动期缺陷（见下） |
| `web/src/lib/host-protocol.ts` | 宿主侧协议类型与收发封装（协议文档是唯一依据） |
| `web/src/lib/run-stream.ts` | 前端事件流接口：**演示源** + **服务端源（SSE）** |
| `web/src/lib/markdown.tsx` | 极小的 Markdown + LaTeX 占位渲染（不引库，保产物自包含） |
| `web/src/state/store.ts` · `hooks/useRun.ts` | 状态与运行驱动（**卸载即取消**） |
| `web/src/pages/SolvePage.tsx` | 解题页：题面 / **图片输入** / **配图补充描述** / **§11.3 门控禁用态** / 阶段进度 / 流式过程 / 校验报告 |
| `web/src/pages/AnimationPage.tsx` | 动画页：宿主控制条 + iframe 模板页 + 实时读数 |
| `tools/build-demo-questions.mjs` | **构建期**从真题源生成浏览器可用的演示数据（单一事实来源） |
| `tests/host-protocol-selftest.mjs` | 取证 **43 条**，接进门禁 ⑳ |

#### ★ 协议定稿：新增 `program` 消息与两条装载路径

§13.2 草案只说"字段冻结"，没规定两件本期必须定的事：

**① `source` 字段**（草案未规定，但从端已在用）。定稿为对称规则：

| 收到 | 处理 |
|---|---|
| `source` 是期望值（`od-host` / `od-template`） | 接受 |
| `source` 存在但不是期望值 | **忽略** |
| `source` **不存在** | **接受**（向后兼容草案） |

**② `program` 注入**（运行时装载）。两条路径都必须支持：

| 路径 | 何时用 | `PROGRAM_DATA` 从哪来 |
|---|---|---|
| **A 构建期内联**（主路径） | 导出成品页、`template/build/*.html` | 构建时写进 HTML |
| **B 宿主运行时注入** | 宿主 iframe 装载空壳模板 | 宿主发 `program` 消息 |

**A 是导出保真的根基**（§13.1"屏幕上看到的 = 导出的"）；
**B 是"刚生成的题还没构建产物但要立刻看"的必需**。

而且定稿明确：**路径 A 下收到 `program` 必须拒绝覆盖**并回 `error: program-already-inlined` ——
否则运行期覆盖会让"显示的内容"与"导出文件里的内容"不一致，**直接破坏 §13.1**。

#### ★ 改模板时修掉的两个真缺陷（都是"启动期"的）

1. **空壳模板永远收不到 `program`**：原先 `bindHost()` 是在 `boot()` **成功之后**才调用的，
   而空壳模板的 `boot()` 会提前 `return` ⇒ 监听从未挂上 ⇒ **路径 B 完全不可用**。
   修法：把 `bindHost()` 移到脚本初始化处（在任何 `boot` 之前），并加重入闸防止重复挂载。
2. **重复 boot 会留下多套监听与多个心跳定时器**：`program` 注入会再次调用 `boot()`。
   修法：`booting` 重入闸 + `hostBound` 只挂一次 + `stateTimer` 每次清理上一个。

#### ★ 门禁 ⑳ 的做法：**在 vm 里真跑一遍模板页的内联脚本**

不"模拟浏览器"，而是把成品页/空壳页的 `<script>` 拿出来在 `node:vm` 里执行，
喂一个**够用的 DOM 桩**（querySelector / createElement / createTreeWalker / NodeFilter …），
然后**断言它回给宿主的消息**——也就是协议的可观察面。

> **这一节自检也踩了 DOM 语义的坑，值得记**：桩里的 `createTreeWalker().nextNode()`
> 最初"返回节点但没设 `walker.currentNode`"，而 TeX 渲染器的写法是
> `while (walker.nextNode()) { var node = walker.currentNode; … }` ⇒ 读到 `undefined` 崩掉。
> **教训：桩必须照真实语义实现"返回 + 设状态"两件事，只做一半比不做更危险**
> （不做会立刻报"方法不存在"，做一半会伪装成"能用"然后在深处崩）。

**同时门禁 ⑳ 顺带查出**：`setTheme` 在 §13.2 协议与 `HOST_MESSAGES` 里都冻结了，
但**从端从未实现**——协议列了却没人接。已补上（落 `<html data-theme>`）。

#### ★ 前端的两处诚实边界（必须让用户看得见，不能含糊）

**① 判定来自哪里。** 真正的链路在 `core/`，那是 **Node 代码**（读文件、`node:vm`、`worker_threads`），
**浏览器里跑不了**——这和第 1 期"成品页必须自包含"是同一个约束。
所以前端只能从本机服务拿事件流；而本期沙箱不允许起 HTTP 服务/绑端口，
**服务端事件流留到第 9 步**。本期前端跑的是**演示源**：

- 用本地真题（q01）走**完整前端流程**（三段渲染、阶段进度、流式、iframe 注入、取消）；
- 它的 `dryrun_done.verdict` 是 **`skipped`**，并在 UI 里以横幅 + 报告标题双重标明
  **「未校验」**，理由写在 `note` 里。**绝不谎报 pass。**
- `serverEventSource()` 接口已就位：只要有一个按事件形状发 SSE 的 `/api/run`，接上即可。

**② 公式排版。** 前端里的公式是**占位排版**；成品页里的公式是**构建期 MathJax 预渲染的真 SVG**。
UI 上已写明这层区别，避免让人以为这里就是最终排版。

#### 顺带用新能力做的一次自查（**这一节是意外收获**）

`read_image` 工具能读 PNG —— 所以我能**自己看一眼**第 1、2 期留下的真浏览器截图，
不必只依赖文档结论。看了 `tests/reports/q07-preview.png`（1440×1000）：

- ✅ 三栏齐全、画布有内容、播放控件与五类开关都在、读数面板 9 行带符号与单位、步骤与解析联动；
- ⚠️ **确认了第 1 期审计第 4 条说的"画布说明文字拥挤"确实存在**：
  右下角箭头标签（`F = 0.8N`、`E = 1.6V`、`v = 4 m/s`）与场区 ×/· 符号、坐标轴刻度挤在一起。
  这条**第 3 期不做**（要动 15 题正文），但现在是**我亲眼确认过的**，不再只是转述审计。

> 这条也说明：**观感问题只有"看图"能发现**，判据与静态体检都看不见它。

### 12.18 ★ 第 3 期实施记录：**第 7 步 · SYMBOLIC 模式 + 关键帧**（已完成）

#### 7.1 `SYMBOLIC`：缺的那一环在**渲染层**，不在数据层

§18 期 3 的验收条件之一是「**纯符号题能播且标注全为符号**」。

排查后发现：**q15 的数据层早就对了** —— `ANSWERS` 的 `value` 为 `null` 且 `latex` 必填（§3.3），
`readouts` 的每一项也都带 `latex`。缺的是**渲染层愿不愿意用它**：

| 位置 | 改动 |
|---|---|
| `template/animation-template.html` 的读数面板 | 有 `latex` 就渲染符号，**且 `SYMBOLIC` 下不再补数值** —— 原先会在符号后面缀 `(4.000 m/s)`，那就成了"符号 + 数值"，不满足"全为符号" |
| 同文件的步骤结论（`ANSWERS`） | `SYMBOLIC` 下优先给 `latex`，即便该项同时有 `value` |
| `sdk/runtime/animation-runtime.mjs` 的 `Draw.arrow` | 新增 `opts.latex`：**画布可直接绘制的符号文本** |
| 同文件的 `drawArrow` | 给了 `latex` 就**只画符号**；未给则保持原行为（`label = 数值`，NUMERIC 一字未改） |
| `tests/regression-15/q15-symbolic.mjs` | 两个箭头补上 `latex` |

> **为什么 `latex` 是"可绘制的符号文本"而不是完整 LaTeX 源码**：
> canvas 的 `fillText` 不认识 `\frac{}{}` 这类命令。完整排版只在**成品页**里做
> （构建期 MathJax 预渲染成 SVG）。这两条路的分工必须写清楚，否则会以为"符号没渲染出来是 bug"。

#### 7.2 门禁新增判据：**可机检的那一半**

`render-check` 新增：**`SYMBOLIC` 题的画布矢量箭头必须全带 `latex`**。

为什么以"箭头全带 `latex`"为判据，而不是"正则扫画布文字里有没有数字"：
给了 `latex` 渲染器就只画符号 ⇒ **这两件事等价**；而正则扫数字会**误伤几何标注**
（`θ=30°`、坐标刻度、`2d`）。**判据要么可机检，要么不做**，不做"看起来在检查"的检查。

**做了负对照验证它真能失败**：临时把 q15 的 `latex` 去掉 → 门禁立刻报错（2 道题异常）。
否则这条断言就是装饰。

#### 7.3 关键帧（四件套之四）：落地了，但**不夸大它的作用**

§7.5 说关键帧用于"步骤边界画面，供'上一步/下一步'秒跳"。**这里要如实说明**：
本项目里**秒跳本来就已经是 O(1)** —— `stateAt(t)` 被 C1 强制为 O(1)（查表/解析式），
相机由 AutoView 一次定死，没有跨帧缓存。所以关键帧**不是播放性能的必需品**。

它的真实价值是这两处（报告与代码注释里都这么写）：

1. **一份不依赖 `stateAt` 重算的画面存档**：步骤边界那一刻的 `state` / 命令条数 / `readouts` /
   包络被固化，导出对齐、缩略图、"这一帧到底画了什么"的事后排查不必重跑程序
   （§14"三者均复用同一次 Dry-Run 的产物"）；
2. **让"每一步边界都画得出东西"成为可机检的事** —— 这是它最实用的地方：
   某个步骤边界若**命令数为 0**，通常意味着那一步的 `stateAt` 分支**写漏了**，
   而只看总帧数/总命令数的判据**看不出这一点**。

**拒绝体积膨胀**：刻意**不把整帧 `records` 塞进报告**（那会让报告翻好几倍），
关键帧只带计数与状态；真要看某一帧画了什么，用 `trace.mjs` 的快照重放更合适。

落地位置：`core/dryrun/dry-run.mjs` 的 `buildKeyframes()` → 报告的 `keyframes[]`，
并在 `run-suite.mjs` 里加了**报告后置体检**（三条可机检判据）：
① 关键帧数 == 步骤数；② `t0` 递增；③ 每个边界帧 `commands > 0`。
汇总表 `summary.md` 新增「关键帧」列（含"空 N"提示）。

实测：**67 个关键帧（15 题 × 各自步骤数）· 步骤边界帧全部非空 · t0 递增**。

#### 7.4 ★ 这一步踩的坑：**注释里的反引号闭合了模板字面量**

给 q15 加注释时我写了：

```
// §18 期 3 的验收条件「…」落在下面两行的 `latex` 上：
```

**而这段注释位于 `String.raw` 模板字面量内部**（槽位正文就是模板字符串）——
反引号**提前闭合了模板**，于是整个文件 `SyntaxError: Unexpected identifier 'latex'`。

**教训**：`tests/regression-15/q*.mjs` 的槽位正文是**模板字面量**，
里面的注释**不能出现反引号**（`${` 同理）。这条已写进 q15 的注释提示。
它和第 3 步那条"切分器不许挪行号"是同源风险：**在别人的容器里写内容，要先想清楚容器的终止符是什么。**

### 12.19 ★ 第 3 期实施记录：**第 8 步 · 三处挂账小修**（已完成）

#### 修 1：X1 命名隐患（q03 / q14）——**X1 已归零**

第 2 期新增的扩展检查 X1 一直在 q03 / q14 上报警：这两题用 `RETURN('t1', …)` 导出，
而 `t1` 正是 `STEPS` 的字段名（装配时 `context.STEPS = STEPS` 会写进同一个 context ⇒ **静默覆盖**隐患）。

| 题 | 改动 |
|---|---|
| q03 追及相遇 | 导出键 `t1` → **`tMeet`**；同步 `context.t1` → `context.tMeet`（读 3 处）、readout 取值、注释说明 |
| q14 板块相对滑动 | **导出键** `t1` → **`tStar`**；同步 7 处 `context.t1` → `context.tStar` |

> **q14 有一处需要留心的区分**：该题 `setup` 里有个**局部变量**也叫 `t1`
> （`var t1 = v0 / (a1 - a2)`）。它**不进 context**，因此**不需要改名** ——
> 真正有隐患的是**导出键**。所以 `RETURN('tStar', t1)` 这种写法是**正确且有意**的。
> 把局部变量也一起改掉是无害的，但会把 diff 放大到没必要；这里选择只改隐患本身。

**取证**：`tests/reports/summary.md` 的 X1 列由 **q03/q14 两个 ✗ → 15/15 全 ✓**。

#### 修 2：右栏读数分级 + 小数点对齐（第 1 期审计第 5 条）

**做法**：

1. **分级判据复用 C7 的符号匹配**（`core/dryrun/dry-run.mjs` 的 `checkAnswerClosure`）：
   `item.key === symbol` 或 `item.label === symbol` 或 `item.latex` 含 `symbol`。
   > ⚠ 这条必须复用同一套 —— 否则会出现"动画里高亮的结论量"与"C7 认定闭环的结论量"**不一致**，
   > 那比不做分级更糟（用户会以为高亮的就是答案）。
2. **结论量突出**（`.is-conclusion`：`--accent-soft` 底、17px/650、`--fg`）；
   **过程量弱化**（`.is-process`：13.5px，颜色取 `color-mix(--muted 75%, --fg)`）。
3. **小数点对齐**：数值/单位单独成 `.num` 列（`margin-left:auto` + `text-align:right` + `tabular-nums`）。

**两个刻意的取舍**：

- **过程量弱化但不牺牲可读性**：13.5px 的字若用纯 `--muted`（52% 亮度）在密排里偏淡，
  故与 `--fg` 混合到约 75% 处 —— 仍明显弱于结论量，但不至于看不清。
- **只用既有设计 token**：模板顶部写明"六个 token 是唯一允许出现颜色字面量的地方"，
  因此第一版我误用的 `--text` / `--surface-2`（**不存在**）已改回 `--fg` / `--accent-soft`。
  > 顺手加了一道检查：**扫描产物里 `var(--x)` 用到的变量是否都有定义**。
  > CSS 的失败是**静默**的（用不存在的变量只是不生效，不报错），所以这类检查有价值。

**取证**（门禁 ⑳ 新增 8 条）：结构断言（两个类名、判据函数、`.num` + `tabular-nums`）+ **语义断言**：
拿真题 q01 的 `ANSWERS` 与 `readouts` **实算一遍**，确认分级**不空转** ——
q01 得到 **4 个结论量 / 3 个过程量，两类都非空**（若永远只命中一边，这个特性等于没做）。

#### 修 3：僵尸产物 `tex-svg/manifest.json` ——**doctor 的数字终于对了**

12.9 记录的问题：`manifest.json` **没有任何代码写它**（第 1 期某次构建留下的快照），
而 `doctor.mjs` 恰恰读它报数 ⇒ 环境自检长期报 **205**，真实值是 **207**。

**修法（三条一起做，缺一不可）**：

1. `tools/build-tex-svg.mjs` 写完 15 份 `q*.json` 后**一并生成 `manifest.json`**；
2. 同一脚本内**自校验**：逐页 `q*.json` 的公式数必须与汇总一致、manifest 必须与页面一致，
   不一致就**非零退出**（不再是"两份产物各自合法、只是互不一致"）；
3. 门禁 ⑧ 的输出里现在有一行显式确认：`✓ manifest.json 已同步（15 题 · 207 条公式；与逐页产物一致）`。

**取证**：`node tools/doctor.mjs` 由 `205` → **`207`**，与 `build-tex-svg` 的输出一致。

> **为什么这条值得单独记**：这类"僵尸产物"骗过的**不是判据，而是人对基线的判断** ——
> 我在第 3 期开工核对基线时，就因为它差点把 README 里的 207 **改成 205**。
> 通用教训：**凡"派生汇总物"必须由构建生成，并被门禁反向校验**；只生成一方向来不够。

### 12.16 ★ 第 3 期实施记录：**第 5 步 · 编排 + SSE + 取消语义**（已完成）

#### 交付物

| 文件 | 作用 |
|---|---|
| `core/orchestrator/events.mjs` | SSE 事件定义（阶段名逐字取自 §2.3 冻结枚举）· 序号 · 线上帧格式 |
| `core/orchestrator/pipeline.mjs` | 阶段链 · **每题配置快照** · **取消语义** · 事件流（async generator）|
| `tests/orchestrator-selftest.mjs` | 取证 **67 条**，接进门禁 ⑲ |
| `core/dryrun/worker-sandbox.mjs`（**改**） | 新增 `signal` 取消：中止时立刻 `terminate()`，`budget.kind = 'cancelled'` |
| `core/dryrun/dry-run.mjs`（**改**） | 透传 `signal`；**取消不判 C2 失败**；取消时 C3–C9 标"未执行"而不是真空通过 |

#### 为什么返回**事件流**而不是返回值

`runPipeline()` 是一个 **async generator**。三个理由：

1. 验收要求是"**流式**出解题过程"——返回值形态天然做不到逐字上屏；
2. 取消语义变简单：generator 的 `return()` 就是"停止拉取"，配合 `AbortController` 收尾；
3. 消费端既能做 SSE 直推（`for await … toSseFrame()`），也能在测试里收集成数组。

#### 取消语义：本期把它做实了（不是装饰）

§21.1 第 3 条要求"所有耗时操作必须可取消，且取消后无残留 worker"。本期的落法：

| 环节 | 取消怎么生效 |
|---|---|
| 模型请求 | `AbortSignal` 一路透传到 `fetch`；归类为 `cancelled`，**不算错误**，UI 不报红 |
| **Dry-Run Worker** | **本期给 `dryRun` 加了 `signal`**：中止时立刻 `worker.terminate()` |
| 阶段之间 | 每个阶段开始前检查取消，命中即发 `cancelled` + `run_done` 收尾 |

**并且取消不改判据口径**（这是最容易做错的地方）：
- **取消不算 C2 失败**——取消是用户意图，超时/OOM 才是预算被击穿；把取消判成失败会让 UI 报一个用户自己造成的红错；
- **取消时 C3–C9 标"未执行"**——帧数据是空的，判据会在空输入上**真空通过**，那等于给没跑完的程序盖合格章。

报告里新增 `cancelled` 字段（顶层与 `execution` 里各一份），让调用方能区分"真的通过了"与"中途停了"。

#### ★★ 本步自检逮到的三个真缺陷（都不是测试的问题）

这一轮测试**第一次跑就红了 4 条**，逐个查下来发现是**三处实现缺陷 + 一处测试缺陷**：

| # | 缺陷 | 为什么危险 | 修法 |
|---|---|---|---|
| 1 | **悬挂请求被取消时被报成 `stage_error`** | 编排的 catch 把非 `ModelError` 一律归 `unknown`，于是 `fetch` 抛的 `AbortError` 变成了"错误" ⇒ **用户点取消会看到红错** | 复用网关的 `classifyFetchError()` 分类，而不是自己猜 |
| 2 | **图片被静默丢弃** | `assemblePrompt()` 只负责三段文本拼接与 `imageCount` 统计，**不做多模态编码**；pipeline 直接用了它的 `messages`，于是"带图"只体现在计数上，**图根本没进请求** | 用 `buildUserMessage()` 显式编码 user 消息（与假端点用例同一套编码） |
| 3 | `dryRun()` 的返回形状用错 | 它返回 `{ report, run, lint }`，我按 `report` 直接用了 ⇒ `report.checks` undefined，**只在真 Dry-Run 路径崩**（假实现掩盖了它） | 解构 `{ report }` |
| 4 | （测试自己的问题）假 `streamImpl` 不调用 `onDelta` | 于是"流式"这件事**在测试里根本没被覆盖**，而"有 stage_delta 携带正文"那条断言靠兜底分支假通过 | 假实现按 4 字符一片真回调 |

**缺陷 2 最值得记**：它**不影响 `promptHash`**（图片本来就不该进前缀），所以"哈希语义"那组用例全绿；
只有"图片真的送达了吗"这条**端到端**断言能发现它。**这正是"每层都要有一条打穿到边界的断言"的价值。**

#### 端到端那条用例（门禁 ⑲ 里最重的一条）

它**不用假 Dry-Run**：拿 **真题 `q01-conveyor-heat` 的 8 个槽位**包成标记文本充当"模型输出"，
跑完整链路，让第 2 期的**真校验内核**判一次。断言：

- 判定 `pass`（q01 本就是通过 C1–C9 的真题）；
- `termination = completed`、帧数 > 0（说明沙箱真的跑了）；
- 给出可装配的程序载荷（8 槽位 + mode）与**行偏移表**（第 3 步的产物）；
- 任务段里确实是那道题（"传送带 / 物块"）。

**意义**：这是第一次把"模型输出 → 切分 → 校验"整条链在门禁里跑通 ——
即 §18 期 3 验收里"出可播放动画"那一半的**后端部分**已经具备。



---

## 十三、第 3 期交付说明

> **依据**：`物理解题动画软件v1.0自研方案.md` §18 期 3，以及 §2.3 / §2.1 / §10 / §11 / §12 / §13 / §15 / §16。
> **冻结项**：§3（7 槽位 / 8 键名）· §9 · §11.2 · §7.2（C1–C9）**一字未改**；C10 / X1 / X2 仍是扩展检查。
> **验收原文**：*输入一道文字题 → 流式出解题过程 → 出可播放动画；纯符号题能播且标注全为符号；中途取消无残留。*

### 13.1 交付了什么（对照 §18 期 3）

| §18 期 3 要求 | 落地位置 | 状态 |
|---|---|---|
| 端点（M2） | `contracts/validate.mjs`（§11.2 全量校验）· `core/gateway/endpoint-config.mjs`（阶段→端点、Key 复用链、脱敏） | ✅ |
| 编排与 SSE（M3） | `core/orchestrator/pipeline.mjs` + `events.mjs` | ✅ |
| 标记切分清洗（M4） | `core/cleaner/marker-split.mjs` · `regex-rules.mjs` · `to-program.mjs` | ✅ |
| 槽位 Prompt（M5） | `core/prompts/templates.mjs`（§10.1 七项）· `fixed-prefix.mjs`（§10.2 三段 + promptHash） | ✅ |
| 播放器宿主协议（M14） | `contracts/host-protocol.md`（**§13.2 定稿**）· `web/src/lib/host-protocol.ts` · 模板从端 | ✅ |
| `SYMBOLIC` 模式 | 模板读数/结论 + `Draw.arrow` 的 `latex` + q15 | ✅ |
| 关键帧（§7.5 四件套之四） | `core/dryrun/dry-run.mjs` 的 `buildKeyframes()` | ✅ |
| 题目图片输入 + §11.3 视觉门控 | `core/gateway/model-client.mjs`（多模态编码）· `endpoint-config.mjs`（门控）· `SolvePage.tsx`（入口禁用态 + 配图描述兜底） | ✅ |
| 解题页 + 动画页（§15） | `web/src/pages/SolvePage.tsx` · `AnimationPage.tsx` | ✅ |
| 三处挂账小修 | X1 改名 · 读数分级 + 小数点对齐 · 僵尸产物 manifest | ✅ |
| **前端构建链** | `tools/web-build.mjs` + `web/`（React 18 + TS + Tailwind + zustand） | ✅（**Vite 被迫换 Rollup**，见 13.4） |

### 13.2 验收结果

**验收条件逐条结论**：

| 验收条件 | 结论 | 证据 |
|---|---|---|
| 输入一道文字题 → **流式**出解题过程 | ✅ **后端已可**，前端界面已接线 | 门禁 ⑲：`stage_delta` 逐块推送（假实现按 4 字符一片真回调）；门禁 ⑳：解题页三段渲染 |
| → 出**可播放动画** | ✅ **后端端到端已通** | 门禁 ⑲ 的端到端用例：拿**真题 q01 的 8 槽位**当"模型输出"→ 切分 → **真 Dry-Run 判 pass** → 产出可装配载荷 |
| 纯符号题能播且**标注全为符号** | ✅ | 门禁 ⑦：q15「符号标注缺口 0 处」；**并做了负对照**（去掉 `latex` 立刻失败） |
| 中途取消**无残留** | ✅ | 门禁 ⑲：取消后不再调用模型、不执行 Dry-Run、仍有 `run_done` 收尾；`dryRun` 新增 `signal`，中止即 `worker.terminate()` |

**门禁：二十步 + ⓪ 覆盖自检，全绿（exit 0）**

```
⓪ 覆盖自检            候选 15 个检查脚本，全部已被挂载
① 契约同源校验        contractHash = 13acace279604228cd67b8d374ba1bef37f81c7694be1f5cbf3cbe85669bf676（13 份产物）
② SDK 签名摘要        27 个函数（Draw 23 · Phys 4）
③ Dry-Run C1–C9       通过 15 · 告警 0 · 失败 0 · 关键帧 67 个（边界帧全非空）
④ 负向注入验收        12 条全部被拦下，行号级诊断均指向注入点
⑤ 埋点自检            15 题 × 4 个代码型槽位逐条断言
⑥ C1 判据取证         C1 25 条 + ANSWERS 结构 6 条
⑦ 渲染路径自检        15 题全过；相机全时段锁定；轨迹开关均生效；SYMBOLIC 符号标注缺口 0
⑧ 公式预渲染          15 题 · 207 条公式；**manifest.json 已同步**（与逐页产物一致）
⑨ 成品页打包          15 题 + 1 空壳
⑩ 成品页静态体检      18 个页面
⑪ 长度上限            最大 147/150（q02）
⑫ 总览页生成          15 题通过 / 0 告警 / 0 未通过
⑬ 前端类型检查        tsc 严格模式通过
⑭ 前端打包            演示数据 + tsc + Rollup + Tailwind + 产物体检（含**引用落点检查**）
⑮ 契约跨字段校验      37 条
⑯ 模型网关            63 条
⑰ 标记切分清洗        53 条（含**行号保真**）
⑱ Prompt 系统         62 条
⑲ 编排                67 条
⑳ 宿主协议            51 条
```

**本期新增的取证合计 333 条**（37 + 63 + 53 + 62 + 67 + 51）。

### 13.3 第 2 期基线：**没有退步**

| 项 | 第 1 期基线 | 第 2 期 | **第 3 期实测** |
|---|---|---|---|
| C1–C9 | 15/15 · 0 告警 · 0 失败 | 同 | **15/15 · 0 告警 · 0 失败** |
| 负向注入 | — | 13/13（含后端对照） | **12/12 拦下 + 后端一致性对照**（口径见 13.5） |
| `Draw.raw` 使用率 | 0.00% | 0.00% | **0.00%** |
| 长度上限 | 最大 147（q02） | 同 | **不变**（最大仍 q02 的 147） |
| 成品页 / 静态体检 | 16 页 + 2 入口 | 18 页全过 | **18 页全过** |
| 公式 | 207 条 | 207 条 | **207 条**（且 doctor 的数字终于对了） |
| 冻结项 | §3 / §9 / §11.2 / §7.2 一字未改 | 同 | **一字未改** |

**唯一变化的基线是 `contractHash`**（`d8af94b1…` → `13acace2…`），原因只有一个：
`endpoint` schema 的**描述文本**更正（把"由 `contracts/index.mjs` 实现"改为真实模块 `contracts/validate.mjs`）。
**字段形状一字未改**，13 份产物数量不变。

### 13.4 偏差与需要你知道的边界（**请重点看这一节**）

#### ① 构建工具：Vite → Rollup（**被迫偏离 §2.2**）

`web/` 用 **Rollup** 而不是方案原文的 Vite。原因：本沙箱**禁止管道捕获子进程输出**，
而 **Vite 5 有两处必须管道 spawn**（① 配置加载走 esbuild 的常驻服务进程；② Windows 上 `optimizeSafeRealPathSync` 走 `execFile`），
均 `spawn EPERM`。**用 7 组实验确认**（从 pnpm 配置键名一路试到 Vite API 内联配置），完整取证见 **12.11**。

**React 18 / TypeScript / Tailwind / zustand 四项均按 §2.2 原文落地**，只有"打包器"这一项变了。
待你裁决（12.5 第 16 条）：**A 保持 Rollup（当前）/ B 放开沙箱管道限制换回 Vite / C 两套都留**。

#### ② 前端的"判定"来自哪里（**这条最重要**）

真正的链路住在 `core/`，那是 **Node 代码**（读文件、`node:vm`、`worker_threads`），**浏览器里跑不了**。
而本期沙箱不允许起 HTTP 服务/绑端口，**服务端事件流排到第 9 步之后再接**。

因此本期前端跑的是**演示源**：用本地真题走完整前端流程，但 `dryrun_done.verdict` 是 **`skipped`**，
UI 里用**顶部横幅 + 报告标题**双重标明「**未校验**」，理由写在 `note` 里。

> **绝不谎报 pass。** `web/src/lib/run-stream.ts` 的 `serverEventSource()` 接口已就位 ——
> 只要有一个按 `core/orchestrator/events.mjs` 发 SSE 的 `/api/run`，接上即可。

#### ③ 公式排版的两层

前端里的公式是**占位排版**（不引 Markdown/MathJax 库，保产物自包含）；
**成品页**里的公式是**构建期 MathJax 预渲染的真 SVG**。
UI 上已写明这层区别，避免让人以为控制台里的排版就是最终排版。

#### ④ §12"正则隔离执行 + 超时"仍有缺口（**如实记录**）

§3.5 的标记切分是**零猜测**（不用正则做结构切割）；§12 的正则兜底用了
"**形态拒绝**（拒绝嵌套量词/择一量词/相邻贪婪）+ **输入规模上限**"两道可机检的防线，
但**真正的墙钟超时没有** —— 沙箱不允许把正则丢给子进程跑。内置规则全是字面量操作，零回溯风险。
换 worker + 超时只需改 `core/cleaner/regex-rules.mjs` 的内部实现，**接口不变**。

#### ⑤ 端点联调仍待你的 Key

`ai-rules/endpoints.json` 的**示例配置**与"测试连接"（§11.2 第 9 条）尚未落地（属 UI 动作）。
`contracts/validate.mjs` 的九条校验**已全部实现并有 37 条取证**，但**真端点联调需要你提供
baseURL / 模型 ID / Key**（Key 只落在本机配置文件，不进日志）。

### 13.5 一处口径需要你知道：负向注入从 13 条变 12 条

第 2 期的负向注入是 **13 条**（含 1 条后端一致性对照），第 3 期实测 **12 条 + 对照**。
变的是**对照的计法**，不是覆盖范围：`run-injection.mjs` 把"后端一致性对照"单列为一句结论，
不再计入用例数。**被拦下的注入类别一条没少**（NaN / 瞬移 / 时间断裂 / 死循环 / require 五类全在）。

### 13.6 本期修掉的缺陷（累计）

第 3 期在第 1、2 期共 18 条 + 第 7 之二节 16 条之外，**又修掉 12 条**，其中值得单独记的：

| # | 缺陷 | 为什么危险 |
|---|---|---|
| 1 | **契约里写着一个不存在的守门人** | `endpoint.schema.json` 从第 1 期起就写着"跨字段校验由 `contracts/index.mjs` 实现"，而那个文件从未存在（12.12） |
| 2 | **编排把取消报成错误** | `AbortError` 被归成 `unknown` ⇒ **用户点取消看到红错**（12.16） |
| 3 | **图片被静默丢弃** | `assemblePrompt` 只统计图片数、不做多模态编码 ⇒ 图根本没进请求。**它不影响 `promptHash`，只有端到端断言能发现**（12.16） |
| 4 | **空壳模板永远收不到 `program`** | `bindHost()` 在 `boot()` 成功后才调用，而空壳 boot 会提前 return ⇒ 宿主注入路径**完全不可用**（12.17） |
| 5 | **`setTheme` 协议列了却没人接** | 冻结在 `HOST_MESSAGES` 里，从端从未实现（12.17） |
| 6 | **切分器占位行数多算一行** | 而我的测试断言当时也写错了，两个错误**互相掩盖**；是"前导空行"那组用例把两者一起暴露（12.14） |
| 7 | **注释里的反引号闭合了模板字面量** | q15 槽位正文是 `String.raw` 模板，注释里写 `` `latex` `` 直接语法错误（12.18） |
| 8 | **僵尸产物 `tex-svg/manifest.json`** | 没有任何代码写它，而 `doctor` 读它报数 ⇒ 环境自检长期报过期值（**205 vs 207**），差点让基线的 207 被改成 205（12.19） |
| 9 | **CSS 用了不存在的变量** | 我第一版写了 `--text` / `--surface-2`（真实名是 `--fg` / `--accent-soft`）；**CSS 的失败是静默的**，故加了一道"变量是否都有定义"的检查（12.19） |
| 10 | **覆盖自检自己报了 19 个假阳性** | 规则太松，把题目数据/假端点/测试台都当成检查脚本 ⇒ 补了**逐条写明理由**的目录级豁免（13.7） |
| 11 | **AnimationPage 的 effect 自触发循环** | 依赖数组含 `mask`/`rate`，而效果内部又 `setTemplateReady` ⇒ **重复注入 program**（12.18） |
| 12 | **`dryRun()` 返回形状用错** | 它返回 `{ report, run, lint }`，我按 report 直接用 ⇒ 只在**真 Dry-Run 路径**崩（假实现掩盖了它）（12.16） |

> **贯穿本期的教训**：① **"绿着但没跑"比"红"更危险**（缺陷 8、10）；
> ② **静默失败最贵**（缺陷 2、3、9）—— 它们不报错、不崩溃，只是不做该做的事；
> ③ **判据要么可机检、要么不做**，且每条判据都要有能证伪它的用例（缺陷 6 的两个错误就是靠这个暴露的）。

### 13.7 门禁的 ⓪ 步：覆盖自检（本期新增）

走过三期之后，门禁的失败模式变了：前两期的风险是"判据写错了"，现在多了一条
**"检查写了却没接进门禁"** —— 那种情况下门禁**全绿**，但那个检查**从来没跑过**。

`tools/verify-coverage.mjs` 把"该被挂载的脚本"定义成**可机检的规则**
（`tests/*.mjs` + `tests/<子目录>/*.mjs` + `tools/*.mjs`，排除一次性工具与工具库），
断言它们都出现在 `verify-all.mjs` 的 `STEPS` 里。**它第一次跑就抓出 19 个假阳性**，
于是补上了**逐条写明理由**的豁免表（`EXEMPT_DIRS` / `EXEMPT_FILES`）——
豁免必须能被第二个人复核，否则它就成了"把报错按掉"。**并做了负对照**：放一个未挂载的检查脚本，它立刻报错。

### 13.8 §21.3 每期自查清单（逐条结论）

- [x] **本期交付项全部可用，无占位符、无未完成分支。** 见 13.1；
      全仓检索无未替换占位符（`layout-lint` 对每个成品页复查）。
- [x] **本期新增/修改的契约已写入 `contracts/` 并在文档中同步。**
      新增 `contracts/host-protocol.md`（§13.2 定稿）与 `contracts/validate.mjs`（跨字段校验）；
      5 份 schema + 5 份 TS 类型仍由 `contracts/spec/` 同源生成，`contractHash` 已同步。
- [x] **C1–C9 中本期涉及项可独立触发并有测试。** 本期主要新增"链路侧"取证：
      门禁 ⑮–⑳ 共 333 条；C1–C9 本身的门禁（③④⑤⑥⑦）一条未减。
- [x] **回归题集通过率与上一期对比无回退。** 15/15 · 0 告警 · 0 失败；12 条负向注入全部拦下。
- [x] **无新增外部依赖（如有，已列清单并说明）。**
      **后端仍只有 `acorn@8` + `mathjax-full@3.2.2`**（零新增）；
      **前端首次引入依赖**，装在 `web/` 内（React 18 / TypeScript / Tailwind / zustand / Rollup 及三个插件），
      **根 `package.json` 与 `package-lock.json` 逐字节未变、根 `node_modules` 内容未变**（已在构建门禁里复核）。
- [x] **取消、错误、空态、降级四种路径均已手动走通。**
      取消：门禁 ⑲ 三条取消用例（开始前/中途/悬挂中）+ UI 卸载即取消；
      错误：网关五类分类 + 编排 `stage_error` + 契约诊断；
      空态：读数"该时刻无读数"、空槽位按缺失报错、空规则表合法；
      降级：公式三级链、Dry-Run 后端回退（并有一致性对照）。
- [x] **本轮遗留问题与冲突已写入交付说明。** 即 13.4 / 13.5 / 13.9。

### 13.9 交付落点（把改动同步回你的仓库）

**新增文件**：

```
contracts/validate.mjs                      §11.2 跨字段校验（第 1 步）
contracts/host-protocol.md                  §13.2 协议定稿（第 6 步）
core/gateway/                               index/error-taxonomy/model-client/endpoint-config（第 2 步）
core/cleaner/                               index/marker-split/regex-rules/to-program（第 3 步）
core/prompts/                               index/templates/fixed-prefix（第 4 步）
core/orchestrator/                          index/events/pipeline（第 5 步）
tests/fake-endpoint/server.mjs              本地假端点（第 2 步）
tests/contract-validator-selftest.mjs       门禁 ⑮（37 条）
tests/gateway-selftest.mjs                  门禁 ⑯（63 条）
tests/cleaner-selftest.mjs                  门禁 ⑰（53 条）
tests/prompts-selftest.mjs                  门禁 ⑱（62 条）
tests/orchestrator-selftest.mjs             门禁 ⑲（67 条）
tests/host-protocol-selftest.mjs            门禁 ⑳（51 条）
tools/web-build.mjs                         前端构建链门禁（第 0 步）
tools/build-demo-questions.mjs              演示数据生成（构建期）
tools/verify-coverage.mjs                   门禁 ⓪ 覆盖自检（第 9 步）
web/                                        前端工程（React 18 + TS + Tailwind + zustand + Rollup）
清理台账-2026-10-16.md                       环境迁移清理记录
```

**修改文件**：

```
tools/verify-all.mjs                        十二步 → 二十步 + ⓪；新增覆盖自检
tools/build-tex-svg.mjs                     一并生成并自校验 tex-svg/manifest.json（第 8 步）
tools/render-check.mjs                      新增 SYMBOLIC 符号标注判据（第 7 步）
tools/doctor.mjs                            文案更正（运行时解析的真实情况）
tools/node-bin.mjs                          isSelfNode 不再把 Electron 当真 Node
core/dryrun/dry-run.mjs                     signal 取消 · 取消不判 C2 · 关键帧
core/dryrun/worker-sandbox.mjs              signal 取消 + 'cancelled' 终止类型
core/dryrun/run-suite.mjs                   关键帧体检 + summary 新增「关键帧」列
template/animation-template.html            program 注入 · setTheme · SYMBOLIC 渲染 · 读数分级
sdk/runtime/animation-runtime.mjs           Draw.arrow 的 latex
tests/regression-15/q03-pursuit.mjs         t1 → tMeet（第 8 步）
tests/regression-15/q14-blocks-relative-slide.mjs  导出键 t1 → tStar（第 8 步）
tests/regression-15/q15-symbolic.mjs        箭头补 latex（第 7 步）
contracts/spec/contract-fields.mjs          endpoint 描述更正为真实模块路径
.npmrc · web/.npmrc · web/package.json      前端安装与构建配置
README.md                                  文档（含第 4 期实施方案：第十四节）
```

**重新生成（跑一次门禁即可）**：`tests/reports/*` · `template/build/*` · `template/vendor/tex-svg/*` ·
`物理动画原型总览.html` · `web/dist/*` · `web/src/lib/demo-questions.ts`。

### 13.10 第 4 期开工前请先读

1. **本节 13.4**（四条边界：Vite/Rollup · 判定来源 · 公式两层 · §12 正则超时缺口）；
2. **12.5 的待裁决清单**（尤其第 16 条 Vite/Rollup）；
3. 门禁现状：**⓪ + 二十步**，`node tools/verify-all.mjs` 应当全绿；
4. 第 4 期范围（§18 期 4）：**C7 强化 · 自愈循环与槽位级重生成（M30）**，
   验收是"注入错误代码 → 自动修复收敛；三轮不通过时带告警横幅交付"。
   本期的**行号级诊断**（第 2 期）与**事件流/取消语义**（第 5 步）正是自愈回灌的输入，
   可直接复用；`X1` 与"三档证据强度"是否写进契约（12.5 第 4 条）建议在那一期定掉。

### 13.11 ★★ 交付后立即发现并修复的白屏故障（**第 3 期最严重的一次漏检**）

**现象**：用户按 `2-OpenUI.bat` 打开界面，**页面一片空白**（标题出来了，内容全空）。
服务是好的（`Serving HTTP on ... 8080`、`/` 与 `/assets/app.js` 都返回 200），
所以问题在**产物本身**：它**下载得下来，但跑不起来**。

**根因**：产物里有 **68 处 `process.env.NODE_ENV`**。

React / scheduler / zustand 的**开发构建**靠它判断模式：
```js
if (process.env.NODE_ENV !== "production") { ... }
```
而**浏览器里没有 `process` 这个全局** ⇒ 顶层求值立刻 `ReferenceError: process is not defined`
⇒ **整个 bundle 一行都不执行**（连 React 的挂载都没跑到）⇒ 白屏。

**为什么必须由构建期替换**：`process.env.NODE_ENV` 是 **Node 的**约定，
打包器不会自动处理；必须由插件在构建期换成字面量。
修法：`web/rollup.config.mjs` 加 `@rollup/plugin-replace`，把
`process.env.NODE_ENV` 替换为 `"production"`。

**顺带的好处（重要）**：替换之后 React 的开发期分支被摇掉，
**产物从 1430 KB 降到 218 KB**（约 1/6.5）。也就是说：**白屏这个 bug 一直在掩盖一个体积问题**。

#### 为什么门禁没拦住（**这是本节最该看的部分**）

三门禁当时全绿，但**没有一条在执行产物**：

| 门禁 | 它查什么 | 为什么漏掉 |
|---|---|---|
| ⑬ 前端类型检查 | `tsc` 类型 | 类型与运行时全局无关 |
| ⑭ 前端打包 | 打包成功 | 打包**成功**了，只是产物跑不起来 |
| ⑭ 的产物体检 | 文件在不在 / 引用有无落点 / 有无 ESM 语法 | **只做静态检查，从不执行** |

**更糟的是我自己的一次错误排查**：交付前我扫过一遍产物，用的是
`\bprocess\.`——但把它传进 PowerShell 时**反斜杠被吃掉**，匹配的是 `bprocess.`，
于是得到"**0 处**"这个**假的干净结论**，白屏因此溜过我自己的检查。
> **教训**：一次性的命令行实验**不能当作判据**。扫描用的正则必须落在
> **每次构建都会真跑**的代码路径里——否则它只是一次"看起来查过了"。

#### 修法（三层，缺一不可）

1. **构建期替换**：`@rollup/plugin-replace` 把 `process.env.NODE_ENV` → `"production"`；
2. **静态判据进产物体检**（`tools/web-build.mjs`）：产物里出现
   `process.env` / Node 的 `process` API / `require(` / `__dirname` / `Buffer.` / 顶层 `import|export`
   任一项 ⇒ **构建失败并打印片段**；
3. **可执行性探针进构建门禁**（`tools/_run-bundle-probe.mjs`）：在 `node:vm` 里喂一个够用的 DOM 桩，
   **真的执行一遍 `app.js`**，抓顶层异常。这一层直接对应白屏这个失效模式。

> 探针本身也踩了两个"桩的假阳性"，都已修并记在文件注释里：
> ① 桩缺 `ownerDocument` ⇒ React 挂事件时报错；
> ② 用 Node 内建的 `MessageChannel` ⇒ 事件对象跨 vm 边界、`instanceof` 拿到别的 realm 的构造函数而抛错。
> **假阳性会掩盖真问题**，所以桩要补到"不再因为桩本身而失败"为止。

#### 这一点也修正了 13.2 的表述

13.2 里"前端界面已接线"当时只是**静态证据**（构建成功 + 引用有落点）。
现在多了一层**执行证据**（vm 里真跑 + 产物静态扫描），但**仍不等价于真浏览器渲染**——
"React 是否真的把界面挂进 DOM、观感如何"**只有你在浏览器里能确认**。
这条边界必须写清楚，不能拿构建成功冒充"界面能用"。

### 13.12 ★★ 用户验收发现的两个问题（演示界面掉格式 · 空壳模板）——**根因与修复**

用户在浏览器里验收时当场指出两件事。**两件都是真问题**，而且第一件的根因是我的**设计错误**。

#### 问题 1：演示界面里公式掉成 LaTeX 原文

**现象**：右侧「分步解析」里显示成 `\frac{u}{\mu g}`、`\Delta x=\frac{u^{2}}{2\mu g}` 这样的原文。

**先排除了一个错方向**：我一度以为浏览器版行内渲染器（`template/tex-inline-renderer.js`）不支持
`\mathrm`/`\frac`。**写探针实测后否掉了** —— 拿 q01 真实的 11 条公式逐条跑，
**10 条都生成了结构正确的节点**（分式/上下标/希腊字母全对），只有 `\mu=0.2` 被我的探针判为"无结构"，
那是**探针的假阳性**（渲染成 `μ=0.2` 本来就该没有标签）。

**真根因**：**两条公式渲染路径没有对齐。**
- 15 个成品页：`tools/build-tex-svg.mjs` 在**构建期**用 MathJax 把公式渲染成真 SVG，内联进 HTML；
- 演示界面：我直接把**原始槽位文本**喂给了前端，而前端当时**只有"占位排版"**（把 `$…$` 包成等宽块）。

所以掉格式是**必然的**，不是偶发。模板页内部**早就支持**由宿主注入预渲染公式
（`PROGRAM_DATA.texSvg`），**但宿主从来没把预渲染结果发过去**。

**修法（按项目既定做法：构建期预渲染，不在浏览器里跑 MathJax）**：

1. 抽出共用实现 `tools/tex-render.mjs`（`createTexRenderer` / `extractInlineTex` / `extractRowTableTex`）——
   **成品页与演示界面必须走同一套渲染口径**，复制一份实现是最容易发生的漂移来源；
2. `tools/build-demo-questions.mjs` 收集演示会显示的公式（`PROBLEM` 的 `$…$` + `STEPS` 的 `tex:`），
   构建期渲染成 SVG + 按需字形，写进 `demo-questions.ts` 的 `TEX_SVG`；
3. 前端 `markdown.tsx` 命中预渲染 → 注入真 MathJax SVG（与模板页 `preRenderedSvg()` 同一做法：
   剥掉 `<mjx-container>` 外壳、把基线对齐接到自己的 span 上）；
   未命中 → **显示原文并标出"未预渲染"**（琥珀底 + `title` 提示），**不静默降级**；
4. 宿主把 `texSvg` 一起发给模板（协议 §3 补记该字段）。

**取证**：字形引用完整性 —— `demo-questions.ts` 里 **98 个字形定义 / 98 个被引用 / 0 缺失**；
门禁 ⑳ 新增断言"注入后页面上必须出现 `.tex-svg` 且 `title` 等于宿主发的那条公式"。

#### 问题 2：动画页显示"空壳模板（等待宿主注入 slots）"

**这个提示本身是正确的** —— iframe 里装的**就是**空壳模板，它自报家门没有错。
**真正的缺陷是它注入成功后仍然这么写**：模板的页头 `<h1>` 与 meta 是**构建期的静态文本**，
`applyProgram()` 成功后只重新 `boot()`，**没有更新页头**。
于是用户**分不清"注入成功了"还是"注入失败、停在了空壳状态"** —— 这是一条**有害的歧义**。

**修法**：
1. 模板 `applyProgram()` 成功后更新页头：`h1` → 题目名、meta → `id · 模板版本 · 运行时注入`，并隐藏提示；
2. 协议 §3 给 `program` 消息补上**可选**字段 `id` / `title`（给了就用，没给退化为"宿主注入的题目"）。

#### ★ 修这两条时，我自己的测试台连错三次（**这部分比修复本身更值得记**）

要验证"注入后页头变了没有"，桩就必须**真的解析 HTML、真的维护元素树**。
第一版的桩是"每个选择器返回一个**空**元素"，于是：

| 版本 | 桩的缺陷 | 造成的后果 |
|---|---|---|
| 1 | `querySelector` 返回空元素 | 断言永远读到空串（**假绿**：看着在测，其实没测） |
| 2 | `textContent` 是静态空串，不读子文本节点 | 用 `appendChild(createTextNode())` 写进去的文字读不到（**假红**） |
| 3 | `className` 与 `classList` 互不相干 | `querySelectorAll('.tex-svg')` 永远查不到（**假红**） |

另外还踩了两个：HTML 标签正则 `[^>]*?` **会吞掉闭合标签**（`<h1 a="b">x</h1>` 被当成一个开始标签）；
以及**夹具造错** —— 我随手编了个 `u=2` 塞进 `texSvg`，而题面里并没有 `$u=2$`，
于是模板当然不用它 ⇒ 又一次假红。

**共同教训**：**桩的能力边界就是判据的能力边界。**
桩少实现一点语义，判据就少一分可信；而"假绿"比"假红"危险得多 ——
假红会被发现并修掉，假绿会一路亮着直到用户在浏览器里看见白屏或乱码。
所以这个桩被抽成了 `tests/harness/dom-stub.mjs`，把三条坑写在文件注释里。

#### 门禁 ⑭ 新增的两条判据（不让同类事故再溜过去）

- **产物可执行性探针**（`tools/_run-bundle-probe.mjs`，见 13.11）：在 `node:vm` 里真跑一遍 `app.js`；
- **产物静态扫描**：出现 `process.env` / `require(` / `__dirname` / `Buffer.` / 顶层 `import|export`
  任一项即**构建失败**并打印片段。

#### 13.12 补记：上面两条修复**第一次没生效**，各自的真实根因

用户按 `Ctrl+F5` 后两个问题**依旧存在**。再查一遍，发现我第一轮的定位**两条都没到位** ——
修的是"看起来该修的地方"，不是真正的断点。

**公式那条：真根因是"接线"，不是"渲染能力"。**
我第一轮做对了"构建期预渲染 + 宿主把 `texSvg` 发过去"，但**前端还是没把 STEP 的公式喂给公式渲染器**：
`<Markdown text={s.tex} />` —— 而 `Markdown` 只把 `$…$` 当公式，
行式表 `STEPS` 的 `tex` 字段是**裸 LaTeX**（§3.3，没有 `$` 定界符）。
于是 `\frac{u}{\mu g}` 被当作**普通文字**输出。
→ 修法：新增专用入口 `MathBlock`（语义就是"整段即 LaTeX"），`SolvePage` 改用它。
**我第一轮的探针验的是"渲染器认不认这条公式"，而真正的断点在"公式有没有走到渲染器"。**
判据测错了环节，所以全绿却没有效果。

**空壳那条：真根因是 `ready` 死锁。**
我第一轮修的是"注入成功后更新页头"—— 但**注入根本没发生**，所以页头当然不会变。
死锁是这样形成的：`ready` 原先只在 `boot()` **成功之后**发，而空壳的 `boot()` 会提前 `return`
⇒ 空壳永不发 `ready`；宿主又规定"**收到 `ready` 才发 `program`**" ⇒ **两边互相等，永远卡住**。
浏览器上表现就是"正在等待模板页就绪…" + 空壳，永远不动。
→ 修法：空壳在挂上 `bindHost()` 之后**主动**报一次 `ready`（带 `shell: true` 以便区分）。
语义澄清：**"就绪"指"已能接收控制"，"尚未拿到题目"不等于"未就绪"。**

**★ 两次都栽在同一件事上：判据测的环节，不是故障发生的环节。**

第一轮我给两条修复都加了门禁断言，而且是"真的会失败"的断言（节点存在性、文本内容），
但两条断言都**恰好绕过了真正的断点**：
- 公式：断言查"页面上有没有 `.tex-svg`"，用**手工构造的 querySelector** 去找 —— 而真实路径是
  `<Markdown>` 把裸 LaTeX 当纯文本；我构造的场景里公式带了 `$` 定界符，所以命中了。
- 空壳：断言查"注入**之后**页头变了没有"，而故障是"**注入压根没发生**"。我手工注入，绕过了死锁。

**教训**：加断言时不能只问"这个函数对不对"，要问
**"用户看到的那个东西，数据是怎么一路走到它上面的，我在哪一环上验的"**。
两次都是"验了下游、漏了上游"。完整的三道判据现已补上（门禁 ⑳ 的『F』段与主动 `ready` 断言）：
1. **接线**：`SolvePage` 必须用 `MathBlock` 而不是把裸 LaTeX 丢给 `Markdown`；
2. **覆盖**：q01 的 4 条 STEP 公式 + 7 条题面行内公式**必须全部**在预渲染表里（逐条比对真值）；
3. **时序**：空壳在**未收到 `program`** 时必须主动报 `ready`（这条直接钉死死锁）。

#### 13.12 补记二：**动画已正常播放，但仍挂着一条红色错误**（自我竞争）

修好注入通道后，用户那边**动画正常出来了**（时长 2.00 s、时间轴可控），
但界面上挂着一条红色错误：

```
模板页报告错误：program-already-inlined
本页已内联 AnimationProgram（成品页），运行时注入被忽略以保持"导出 = 屏幕所见"。
```

**这不是真故障，是两处设计撞在一起产生的噪音**：

- 为了摆脱"双向握手"（见上一则补记），宿主改成**重试注入 4 次**；
- 模板有 §13.1 的**防覆盖保护**，会拒绝第 2～4 条；
- 而宿主把这个**预期内的拒绝**当成用户级错误显示了。

判断依据很明确：**动画能播、时长正确** ⇒ 第一条注入已成功，后面三条是多余的。

**修法（关键在"区分"，不是"屏蔽"）**：
`program-already-inlined` **只有在"我们从未成功注入过"时才算错误** ——
判据是 `templateReady` 是否已置真：
- **已成功过** ⇒ 写进通信日志、**不报错**（这正是用户看到的情况：自我竞争输掉）；
- **从未成功** ⇒ 那是真拒绝（例如宿主错把成品页当空壳注入），**照实报**。

两种都**留痕在日志里**，只是级别不同 —— **不静默**。
§13.1 的保护一行未改（门禁 ⑳ 的『B-4』仍在验成品页必须拒绝覆盖）。

> 一条更一般的教训：**加了重试，就等于承认"同一个动作会被执行多次"** ——
> 那么所有"只该做一次"的保护（防覆盖、去重、幂等锁）都会开始报警。
> 这时不要削弱保护，而要**教会调用方区分"竞争输掉"与"真的出错"**。
> 削弱保护会同时丢掉它本来要守的那条不变量（这里是"导出 = 屏幕所见"）。

---

## 十四、第 4 期实施方案【**留档 · 已于第 4 期执行完毕**】（第 5 期入口见 **第十六节**）

> **来源**：本节由三份文件**提取合并**而成（合并后原件已删除，SHA256 台账见 14.10）：
> `第三期实施方案v1.md`（设计与实施记录）· `第一期改进意见-修正稿.md`（第 1 期联合审计）·
> `明天看这里-验收说明.md`（用户验收指引）。
> 三份里**已过期的第 3 期过程细节不复抄**（它们已在第十二、十三节留档），
> 这里只保留**对第 4 期仍然有效**的东西。
>
> **依据**：`物理解题动画软件v1.0自研方案.md` §18 期 4 / §7 / §19 / §21。
> **冻结项**：§3（7 槽位 / 8 键名）· §9 · §11.2 · §7.2（C1–C9）**一字不改**；C10 / X1 / X2 维持扩展检查。
> **基线**：README **第十三节**（第 3 期交付说明）。第 1、2、3 期均已验收关闭。

### 14.1 一句话说清现在在哪

第 1、2 期交付了**校验内核**（手写题 → 命令缓冲 → Worker 沙箱试跑 → C1–C9）。
第 3 期补上了**模型链路**（Prompt → 网关 → 切分 → 编排 → 宿主协议 → 两块前端页面）。

**现在的问题不再是"能不能生成"，而是"生成得不对时怎么办"** —— 这正是第 4 期要解决的。

### 14.2 本期要交付什么（方案 §18 期 4 原文）

> **交付**：**C7 强化 · 自愈循环与槽位级重生成（M30）**
> **验收**：*注入错误代码 → 自动修复收敛；三轮不通过时带告警横幅交付*

拆成可判定的验收项：

| # | 验收项 | 判定方式 | 进门禁？ |
|---|---|---|---|
| B1 | 注入错误代码 → **自动修复收敛** | 假端点先吐一份有错的槽位代码（例如 C3 越界），第 2 轮吐修好的；断言 `repair` 阶段被触发、最终 `verdict = pass` | ✅ |
| B2 | 修复轮数有上限 | 连吐 3 轮坏代码；断言第 4 轮**不再修复**，且 `verdict` 带告警横幅 | ✅ |
| B3 | **槽位级重生成** | 只有 `drawFrame` 出错时，只重生成该槽位（断言 prompt 里只含出错槽位的上下文 + 诊断） | ✅ |
| B4 | 告警横幅交付（不静默） | 三轮不过时**仍交付可播放动画**（若 8 槽位齐全）+ 明确横幅；断言横幅存在且文案含失败检查号 | ✅ |
| B5 | C7 强化 | 见 14.4 | ✅ |
| B6 | 修复过程对用户可见 | SSE 事件流里 `repair` 阶段的 `stage_start/delta/done` 与诊断一起推送 | ✅ |

### 14.3 ★ 第 4 期开工前**必须**先做的三件事

**① 把三档证据强度写进契约**（第 3 期挂账，见 14.7 第 4 条）。
第 4 期的自愈回灌**要用它**——诊断要告诉模型"这个行号是精确的 / 重放定位的 / 只是候选的"，
否则模型会照着错行号改代码。**这是第 4 期的接口前置条件，不是可选项。**

**② 确认 `repair` 阶段枚举已就位。** 第 3 期**已冻结**在 `PHASE3_STAGES` 与 SSE 事件里
（`core/orchestrator/events.mjs` 的 `STAGE_CHAIN` 末尾就是 `repair`），
但**第 3 期不实现它**（`STAGE_CHAIN` 里被 `slice(0, -1)` 排除）。
第 4 期把它**接进实际执行链**，并把"进度模型不要写死成最后一步"这条落实。

**③ 读 14.6 的坑清单。** 第 3 期有 5 个错误值得记住，其中 3 个是**同一类**（判据测错环节）。

### 14.4 C7 强化（§18 期 4 · 与第 3 期的关系）

**第 3 期现状**：C7 已实现，口径是"`ANSWERS` 的每个 `symbol` 在 `at_t` 时刻的 `readouts` 里
必须能找到同名/同标签/`latex` 含该符号的项，且数值在容差内"（`ANSWERS_DEFAULT_TOL`）。

**第 4 期要强化的方向**（依据 §7.2 与 M30 的语义）：

| 方向 | 说明 |
|---|---|
| 容差口径可配 | 每题可声明 `tol`（现已支持），另需**按量级自适应**的默认值（当前是固定相对容差 + 绝对下限） |
| 多时刻校验 | 现在只验 `at_t` 一个时刻；强化为**可选多时刻**（`at_t` 数组），覆盖"结论在多个时刻都应成立"的情形 |
| 符号歧义检测 | 两个 `ANSWERS` 项映射到**同一个 readout** 时应报警（现在会各自通过） |
| 与自愈联动 | C7 失败时给出**可回灌的诊断**：哪个符号、期望值、实际值、差多少、建议改哪个槽位 |

> ⚠ **C7 属 §7.2 冻结判据**：强化必须是**加法**（新增可选能力），
> 不得改变现有 15 题的判定结果 —— 这是"不许退步"的硬约束。
> 门禁里要有断言：**强化后 15 题的 C7 判定与第 3 期逐题一致**。

### 14.5 自愈循环与槽位级重生成（M30 · 本期核心）

**设计要点（第 3 期已备好的地基，直接复用）：**

| 需要什么 | 第 3 期已有什么 |
|---|---|
| 知道"错在哪个槽位、哪一行" | ✅ 行号级诊断（三档证据强度，第 2 期）· `core/cleaner/marker-split.mjs` 的 `lineOffset` |
| 把诊断回灌进 Prompt | ✅ `core/prompts/templates.mjs` 的 7 个 Prompt + `buildTaskSegment()` |
| 每题配置快照（改配置不影响在跑的题） | ✅ `snapshotConfig()`（第 3 期第 5 步） |
| 阶段链与事件 | ✅ `PHASE3_STAGES` 已含 `repair` 槽位 |
| 取消语义（修复途中取消无残留） | ✅ `signal` 全程贯通（第 3 期第 5 步） |
| 不静默交付 | ✅ 事件流里错误如实透传；门禁 ⑲ 有断言 |

**要新写的：**

1. **`repair` 阶段的执行**：把诊断 + 出错槽位的现有代码 + 原题，组装成修复 Prompt；
2. **槽位级重生成**：只重生成失败的槽位，其余槽位**原样保留**（比较产物断言未涉及槽位逐字节不变）；
3. **收敛判据**：每轮跑完 C1–C9，`pass` 即停；上限 3 轮；
4. **失败后的交付形态**：3 轮不过 ⇒ 仍交付（若 8 槽位齐）+ **告警横幅**（§21.2 第 8 条）；
5. **SSE 事件**：`repair` 与其它阶段同形（`stage_start` / `stage_delta` / `stage_done`），
   外加每轮的诊断快照。

**风险（提前写明）：**

| # | 风险 | 对策 |
|---|---|---|
| 1 | **修复把对的槽位改坏** | 槽位级重生成 + 断言"未涉及槽位逐字节不变" |
| 2 | **无限循环 / 成本失控** | 硬上限 3 轮；每轮记录 token 与耗时进观测 |
| 3 | **行号证据强度被忽略，照着错行号改** | 14.3 ① 把三档强度写进契约，修复 Prompt 里**必须带强度标记** |
| 4 | **修复 Prompt 自己变成"关闸指令"注入点** | 复用第 3 期用例 10：Prompt 注入"忽略校验"必须无效 |
| 5 | **与 §7.2 冻结判据冲突** | 修复**只改模型输出**，不改判据；C1–C9 一行不动 |

### 14.6 ★ 第 3 期踩过的坑（**改代码前先读这一节，别去试**）

**A. 判据类（三个同源错误，代价最大）**

1. **判据测错了环节** —— 第 3 期交付后"演示界面掉格式"我**连错两轮**：
   我验的是"渲染器认不认这条公式"，而断点在"**公式有没有走到渲染器**"（裸 LaTeX 被当纯文本）。
   另一条"停在空壳模板"同理：我验的是"注入**之后**页头变没变"，而故障是"**注入压根没发生**"。
   → **加断言时不能只问"这个函数对不对"，要问"用户看到的那样东西，数据是怎么一路走到它上面的"。**
2. **桩太弱 ⇒ 假绿** —— 测试台 DOM 桩第一版"每个选择器返回空元素"，
   于是内容级断言**看着在测、其实什么都没测**。桩连错三次（空元素 / `textContent` 不读子节点 /
   `className` 与 `classList` 不相干）。**桩的能力边界就是判据的能力边界**；
   **假绿比假红危险**——假红会被发现，假绿会一路亮着直到用户在浏览器里看见白屏。
3. **一条恒真断言**（第 3 期第 4 步）：`check('…', p.prefixBytes === undefined || true)` 等于没测。

**B. 工程类**

4. **"绿着但没跑"比"红"更危险** —— `tex-svg/manifest.json` 是**没有任何代码写它**的僵尸产物，
   而 `doctor.mjs` 读它报数 ⇒ 环境自检长期报过期值（205 vs 真实 207），
   差点让我把基线里的 207 改成 205。→ 第 3 期加了 **⓪ 覆盖自检**（门禁是否漏挂检查脚本）
   与 **产物可执行性探针**（在 `node:vm` 里真跑一遍 `app.js`）。
5. **静默失败最贵** —— `process.env` 未替换导致**白屏**（整个 bundle 一行不执行）；
   图片被静默丢弃（`assemblePrompt` 只统计不编码，**不影响 `promptHash`，只有端到端断言能发现**）；
   取消被报成错误（`AbortError` 归成 `unknown`）；CSS 用了不存在的变量（**CSS 失败是静默的**）。
6. **凡"派生汇总物"必须由构建生成 + 被门禁反向校验** —— 只生成一方向来不够。
7. **一次性的命令行实验不能当判据** —— 我扫产物时 `\bprocess\.` 的反斜杠被 PowerShell 吃掉，
   得到"0 处"这个**假干净结论**，白屏因此溜过检查。正则必须落在**每次构建都真跑**的路径里。
8. **在别人的容器里写内容，先想清楚容器的终止符** ——
   `q*.mjs` 的槽位正文是 `String.raw` 模板字面量，注释里写反引号会**提前闭合模板**（语法错误）。
9. **加了重试，就等于承认同一动作会被执行多次** —— 那么所有"只该做一次"的保护
   （防覆盖 / 去重 / 幂等锁）都会开始报警。这时**不要削弱保护**，
   而要教会调用方**区分"竞争输掉"与"真的出错"**；削弱保护会连它守的不变量一起丢掉。
10. **不要依赖完美的双向握手** —— 第 3 期写成"宿主等 `ready`、空壳等 `program`"，
    任何一端出问题都表现为"永远停在空壳"，且**外在表现完全一样、极难定位**。
    改成"重试注入 + ready 快路径"双路兜底。**握手要能容忍对方不说话。**

**C. 环境类（本沙箱专属，第 4 期同样适用）**

11. **禁止管道捕获子进程输出 ⇒ Vite 5 结构性不可用**（两处必须管道 spawn）。
    前端用 **Rollup**（纯 JS，不 spawn）。7 组实验取证见 12.11。
12. **装包三条硬约束**：
    ```powershell
    $env:NPM_CONFIG_CACHE = "<仓库根>\.npm-cache"   # ① 缓存必须在项目内，否则 EPERM
    npm install --prefix web --ignore-scripts        # ② 依赖落 web/ 内 ③ postinstall 会 EPERM
    node tools/web-build.mjs                         # 门禁
    ```
13. **改模板必须重跑 `template/build-template.mjs` + `tools/layout-lint.mjs`**；
    **改了模板还要重跑 `tools/web-build.mjs`**（它把模板拷进 `web/dist/template/`，
    不重跑的话服务发出去的还是旧模板 —— 第 3 期因此白折腾过一轮）。
14. **模板源码里不得出现 `import`/`export`**（成品页要当经典脚本跑，门禁与 `layout-lint` 都查）。

### 14.7 待裁决清单（**累计 · 请一次性给口径**）

> ⚠ **本节已被第 4 期执行**：第 4 期用户裁决了第 2、4、7 条（见 15.6）。
> **当前有效的累计清单在 15.6**（13 条）。本节保留为第 4 期开工时的原始口径。

**第 3 期已裁决 6 条**（照 §2.2 原文上 React / 不装 `openai` 包 / 本期修 X1 / 做读数分级 /
假端点+真端点两条都要 / 题目图片输入必做）—— 均已落地，见 13.1。

| # | 事项 | 我的建议 | 影响 | 状态 |
|---|---|---|---|---|
| 1 | **构建工具：Rollup（当前）还是放开沙箱换回 Vite** | **维持 Rollup**（换的是构建壳，业务代码不动） | 偏离方案 §2.2 的 "Vite" 一项 | ⬜ 待定 |
| 2 | `TEMPLATE_VERSION` / `SDK_VERSION` 是否升 1.1.0 | **不升**（第 3 期改的是观感与协议，不改"槽位代码 → 画面"的语义） | 影响 `contractHash` 基线与 16 页 Provenance | ⬜ 待定 |
| 3 | 槽位注入路径：构建期内联为主 + `postMessage` 为辅 | **是**（守住 §13.1"导出 = 另存，逐像素一致"） | M14 实现形状 | ✅ 第 3 期已按此落地 |
| 4 | **三档证据强度（`exact`/`replayed`/`candidate`）写进契约** | **写入** —— **第 4 期自愈回灌要用** | 第 4 期接口稳定性 | ⬜ **本期前置** |
| 5 | 假端点是否随交付留在仓库 | **留**（它是门禁的一部分，不是临时工具） | 仓库多一个 `tests/fake-endpoint/` | ⬜ 待定 |
| 6 | C4 阈值口径 `max(20×p99, 跨度 2%)` 是否维持 | **维持** | 第 2 期引入的实现约定 | ⬜ 待定 |
| 7 | **`repair` 上限轮数与"不过也交付"的形态** | **3 轮**；不过则带横幅交付（§21.2 第 8 条） | 本期验收 B2/B4 | ⬜ **新增** |
| 8 | **负向注入计数口径**：12 条 + 1 条后端一致性对照，还是凑成 13 | 维持 **12 + 对照**（覆盖的五类一条没少，只是对照不计入用例数） | 只影响文档写法 | ⬜ **新增** |
| 9 | **两处仍是"实现约定"**：`STEPS`/`ANSWERS` 的行式表格式 · §3.3 的 `at_t`/`latex` 命名口径（未随项目其余部分改 camelCase） | 维持现状（方案未规定，第 1 期自定） | 需要你确认或改口径 | ⬜ **新增** |

### 14.8 第 4 期开工前的三分钟复核

> ⚠ **本节已过期**（第 4 期已交付）。第 5 期的同类内容见 **16.7**；本节保留为留档。

```powershell
cd C:\Users\Liu LuMing\Desktop\Work
node tools/verify-all.mjs      # 应全绿：⓪ 覆盖自检 + 二十步
```

看完这三行就够：`通过 15 · 告警 0 · 失败 0` / `12 条负向注入全部被准确拦下` / `全部门禁通过`。

**不许退步（每期都要复跑）：**
15/15 题 C1–C9 全通过 · 0 告警 · 0 失败 · 12/12 负向注入被拦下 ·
`Draw.raw` 0.00% · 18 页静态体检通过 · 长度上限内（当前最大 147/150，q02）。

### 14.9 §21.3 每期自查清单（交付时逐条给结论，同前两期）

- [ ] 本期交付项全部可用，无占位符、无未完成分支；
- [ ] 本期新增/修改的契约已写入 `contracts/` 并在文档中同步（**含 14.3 ① 的三档证据强度**）；
- [ ] C1–C9 中本期涉及项可独立触发并有测试（**本期 C7 强化后 15 题判定必须与第 3 期逐题一致**）；
- [ ] 回归题集通过率与上一期对比无回退；
- [ ] 无新增外部依赖（若有，已列清单并说明）；
- [ ] 取消、错误、空态、降级四种路径均已手动走通（**含"修复途中取消"**）；
- [ ] 本轮遗留问题与冲突已写入交付说明。

### 14.10 本次合并的台账（原件已删，SHA256 留档）

> 删除前已取 SHA256；三份文件的内容**已被本节吸收**（第 3 期过程细节在第十二、十三节留档）。

| 原件 | 大小 | 去向 |
|---|---|---|
| `第三期实施方案v1.md` | 63.5 KB | 有效内容 → 本节 14.2–14.7；过程记录已在 README 第十二、十三节留档 |
| `第一期改进意见-修正稿.md` | 24.7 KB | 有效内容 → 本节 14.6-B/14.6-A（判据类教训）；已修复项在 README 第七节留档 |
| `明天看这里-验收说明.md` | 3.9 KB | 有效内容 → 本节 14.8 + `1-Check.bat` / `2-OpenUI.bat` 仍在根目录（可按需删除） |

**SHA256（删除前实测）：** 见本节末尾的台账文件 `清理台账-2026-10-16.md` 追加段。

---

## 十五、第 4 期交付说明

> **依据**：`物理解题动画软件v1.0自研方案.md` §18 期 4（**C7 强化 · 自愈循环与槽位级重生成 M30**）
> 与 §7 / §8 / §19 / §21；实施方案见本文第十四节。
> **冻结项**：§3（7 槽位 / 8 键名）· §9 · §11.2 · §7.2（C1–C9）**一字未改**；C10 / X1 / X2 仍是扩展检查。
> **验收原文**：*注入错误代码 → 自动修复收敛；三轮不通过时带告警横幅交付。*
> **用户本期裁决三条**（2026-10-16）：① 三档证据强度**写入契约**；② `repair` 上限 **3 轮**、不过则带横幅交付；
> ③ `TEMPLATE_VERSION` / `SDK_VERSION` **维持 1.0.0 不升**。

### 15.1 交付了什么（对照第十四节的 B1–B6）

| # | 验收项 | 落地位置 | 取证 |
|---|---|---|---|
| **B1** | 注入错误代码 → **自动修复收敛** | `core/orchestrator/pipeline.mjs`（自愈循环） | 门禁 ㉑『B1』：首轮 fail → 修复 → **pass**，`rounds=1` |
| **B2** | 修复轮数**硬上限 3** | `core/repair/plan.mjs` 的 `REPAIR_MAX_ROUNDS` + `shouldContinue()` | 门禁 ㉑『B2』：连吐坏代码 ⇒ **修复调用恰好 3 次**、Dry-Run 恰好 4 次 |
| **B3** | **槽位级重生成** | `CHECK_TO_SLOTS` / `planRepair()` + `core/cleaner/to-program.mjs` 的 `mergeRepairOutput()` | 门禁 ㉑『B3』：只重发 drawFrame，**其余 7 个槽位逐字节不变** |
| **B4** | 告警横幅交付（不静默） | `core/repair/plan.mjs` 的 `buildBanner()` + `deliveryShape()`；前端两页都显示 | 门禁 ㉑『B4』：`fail` 时**仍交付可播放程序** + 横幅含失败检查号 |
| **B5** | **C7 强化** | `core/dryrun/dry-run.mjs`（量级自适应容差 / 多时刻 `at_t` / 符号歧义 / 可回灌诊断） | 门禁 ㉑『D』『E』：15 题判定**与第 3 期逐题一致** |
| **B6** | 修复过程**对用户可见** | `repair_round` / `repair_done` 事件 + 解题页「自愈修复过程」面板 | 门禁 ㉑『B6』：每轮的 `stage_start/delta/done` + 诊断快照 |

**另外交付的（第十四节 14.3 的前置条件）**：

| 前置项 | 落地位置 | 说明 |
|---|---|---|
| **① 三档证据强度写进契约** | `contracts/spec/diagnostic.mjs` → `diagnostic-record.schema.json` · `diagnostic-record.d.ts` · `diagnostic-evidence.json` + `contracts/evidence.mjs` | 自愈回灌**必须**带上强度（`§14.5 风险 3`），现在它是契约而不是约定 |
| **② `repair` 接进执行链** | `core/orchestrator/events.mjs` 的 `PHASE4_STAGES` · `pipeline.mjs` | 进度模型不再写死"最后一步是 dry_run"（门禁断言了这一条） |
| ③ 修复 Prompt（扩展 Prompt） | `core/prompts/templates.mjs` 的 `EXTENSION_PROMPTS.repair` | **不属于 §10.1 的 6 项清单**（自检断言 §10.1 仍恰好 6 项） |

### 15.2 验收结果

**门禁：⓪ 覆盖自检 + **二十一步**全绿，exit 0**

```
⓪ 覆盖自检            候选 16 个检查脚本，全部已被挂载
① 契约同源校验        contractHash = 5fce7c7b1b0ca41868ff33cf364187ab85466965360e439000f9fc88af746ca1（16 份产物）
② SDK 签名摘要        27 个函数（Draw 23 · Phys 4）
③ Dry-Run C1–C9       通过 15 · 告警 0 · 失败 0 · 关键帧 67 个
④ 负向注入验收        12 条全部被拦下
⑤ 埋点自检            15 题 × 4 个代码型槽位逐条断言
⑥ C1 判据取证         C1 25 条 + ANSWERS 结构 6 条
⑦ 渲染路径自检        15 题全过
⑧ 公式预渲染          15 题 · 207 条公式
⑨ 成品页打包          15 题 + 1 空壳
⑩ 成品页静态体检      18 个页面
⑪ 长度上限            最大 147/150（q02）
⑫ 总览页生成          15 题通过
⑬ 前端类型检查        tsc 严格模式通过
⑭ 前端打包            构建 + 产物体检 + **证据强度标签与契约一致** + **前端阶段链与编排层一致**（两条都是本期新增判据）
⑮ 契约跨字段校验      37 条
⑯ 模型网关            63 条
⑰ 标记切分清洗        53 条
⑱ Prompt 系统         **73 条**（新增 §10.1 仍恰好 6 项 + 扩展 Prompt repair 的 9 条）
⑲ 编排                **73 条**（新增"阶段链含 repair / 进度索引取自完整链条 / 通过时不进 repair"）
⑳ 宿主协议            69 条
㉑ 自愈循环与 C7 强化  **129 条**（本期新增）
```

**本期新增取证 141 条**（Prompt +11、编排 +6、自愈与 C7 强化 +129；另有前端产物 2 条新判据）。

**逐条验收条件**：

| 验收条件 | 结论 | 证据 |
|---|---|---|
| 注入错误代码 → **自动修复收敛** | ✅ | 门禁 ㉑『B1』（首轮 fail → 修复后 pass，`converged=true`） |
| **三轮不通过时带告警横幅交付** | ✅ | 门禁 ㉑『B2』『B4』（`rounds=3`、`verdict=fail`、横幅含 `C3/C7`、仍 `playable`） |
| **只重生成出错的槽位** | ✅ | 门禁 ㉑『B3』（7 个未涉及槽位逐字节不变 + 修复 Prompt 里只有该槽位的代码块） |
| **C7 强化后 15 题判定不回退** | ✅ | 门禁 ㉑『E』（与 `tests/c7-baseline.json` 的**状态 + 明细 + 匹配到的 readout** 逐字比对） |
| 修复途中取消无残留 | ✅ | 门禁 ㉑『C』（不再调模型、不报红错、仍有 `run_done`） |
| "忽略校验"类指令关不掉门禁 | ✅ | 门禁 ㉑『F』（4 次 Dry-Run 每次都真跑） |

**不许退步的基线（第 3 期 → 第 4 期）**：

| 项 | 第 3 期 | **第 4 期实测** |
|---|---|---|
| C1–C9 | 15/15 · 0 告警 · 0 失败 | **同（未退步）** |
| 负向注入 | 12/12 拦下 + 对照 | **同** |
| `Draw.raw` 使用率 | 0.00% | **同** |
| 长度上限 | 最大 147（q02） | **同** |
| 成品页 / 静态体检 | 18 页全过 | **同** |
| 公式 | 207 条 | **同** |
| **C7 逐题判定** | （本期建立基线） | **与第 3 期实测基线逐字一致** |
| 冻结项 | §3 / §9 / §11.2 / §7.2 一字未改 | **一字未改** |

**唯一变化的基线仍是 `contractHash`**（`13acace2…` → `5fce7c7b…`），原因是**新增**第 6 份契约
`diagnostic-record` 与 `contracts/diagnostic-evidence.json`（13 份产物 → 16 份）。
**前 5 份契约的字段形状一字未改** —— 这一点由 `contracts:verify` 的逐字节比对保证。

### 15.3 「15 题 C7 判定逐题一致」是怎么保证的

§14.4 把这一条定成**硬约束**（"强化必须是加法，不得改变现有 15 题的判定结果"）。
本期用两层保证它，而不是靠"我跑了一遍看着没问题"：

1. **机制层**：`adaptiveTolerance()` 在 `|v| < 1e3` 时**恰好退化成第 3 期的式子**
   `max(|v|·tol, 1e-6) + |v|·1e-6`（门禁逐值断言）。15 题里出现的期望值最大是 34.6，
   全部落在这一区间 ⇒ 容差**逐值不变**，判定不可能因此改变。
2. **证据层**：`tests/c7-baseline.json` 冻结了第 3 期收尾时**从 `tests/reports/*.dryrun.json` 实测**
   的 15 题判定（状态 + 明细 + 每条结论匹配到的 readout），门禁 ㉑『E』逐字比对。
   **值取自实测、不是手写，也不是从第 4 期的实现反推** —— 否则就成了自证。

### 15.4 本期修掉的缺陷（含两处"我第一版做错了"）

| # | 缺陷 | 为什么危险 |
|---|---|---|
| 1 | **契约不变量断言写成恒真**（第一版） | 断言比的是 `values` 与**它自己**（同一个被 import 的数组），重排枚举也能通过。**这是第 3 期记过的同一类错**（那条 `x === undefined \|\| true`）。改成与独立字面量 `FROZEN_EVIDENCE_PRECISIONS` 比对，并跑了两组负对照（重排 / 加第四档）证明它真会失败 |
| 2 | **"量级自适应容差"其实没有自适应**（第一版） | 写成 `max(|v|·1e-2, |v|·1e-4)` —— 永远是 `|v|·1e-2`，一句好听的话而已。是门禁里那条"必须**严格小于**名义容差"的断言把它逼出来的，改成**用量级档位收紧生效的相对容差** |
| 3 | **`slotsFromReport()` 把空槽位混进默认计划** | 只要有一个槽位是空的（例如模型少写了 `PROBLEM`），计划就退化成"重发全部 8 个槽位"——§8.1 的槽位级粒度白费。改成独立的 `withEmptySlots()`，并加了两条负对照 |
| 4 | **`repair_round` 记的是修复**之后**的报告** | 修复成功时那报告里没有诊断 ⇒ "这一轮为什么被触发"完全丢失（UI 上是一片空白）。改成记录**触发本轮**的那份报告 |
| 5 | **扩展检查 `X1` 的升级点没接**（`checkContextKeyCollision` 无变化，但 `build-overview` 把"非 exact"一律显示成"重放定位"） | 三档里 `candidate` 会被错标成 `replayed` —— 在一个专门讲"证据强度"的项目里，这个错标直接误导读者。改为取 `contracts/evidence.mjs` 的 `labelOf()` |
| 6 | **前端 `STAGE_CHAIN` 可能悄悄漏掉 `repair`** | 门禁 ⑲ 只覆盖 `core/` 侧的事件流，**前端漏了它照样全绿**，表现是"修了好几轮进度条上看不出来"（B6 静默失败）。新增构建期判据：前端阶段链必须与 `PHASE4_STAGES` 逐项一致（**已跑负对照**：删掉 `repair` 立刻构建失败） |
| 7 | **前端证据强度标签是抄录、会漂移** | 浏览器拿不到 Node 侧的 `contracts/`，只能抄一份。新增构建期判据：`PRECISION_LABEL` 的键与标签必须等于 `contracts/diagnostic-evidence.json`（**已跑负对照**：把「候选」改成「候选行」立刻构建失败） |
| 8 | **漏写 `await` 时错误信息完全指不到现场** | `problems.push(...checkStageChain())` 漏了 `await`，报的是 `Spread syntax requires ...iterable[Symbol.iterator]` —— 与"少了个 await"毫无字面关联。已在代码里写明这个坑 |
| 9 | **`repair` 加进 `PROMPTS` 会算改方案** | §10.1 的清单是方案正文。本期把它做成 `EXTENSION_PROMPTS`，`listPrompts()` 仍返回 6 项，并**加断言钉住**；否则下一次没人会注意到"清单被悄悄改了" |

> **贯穿本期的教训（与第 3 期同源）**：**"我以为它更合理"不等于"它确实更合理"**。
> 缺陷 1、2 都是"看起来对、其实什么都没做"的写法，发现它们的都不是我review，而是**门禁里那条会失败的断言**
> —— 而写那条断言之前，还要先问一句"这条断言**怎么才能失败**"。

### 15.5 偏差、边界与待裁决

**本期新产生的偏差**：

1. **`contractHash` 变化**（`13acace2…` → `5fce7c7b…`）：新增第 6 份契约与一份枚举产物。
   **不是**字段形状变化 —— 前 5 份契约逐字节未改（由 `contracts:verify` 保证）。
2. **`repair` Prompt 不在 §10.1 的清单里**（见 15.4 缺陷 9）。按"不改方案正文"处理。
3. **`core/repair/` 是新目录**，不在方案 §2.4 的建议目录结构里（那里列的是 `core/` 下的十个模块名）。
   自愈属 M30，方案把它的职责写在 §8；落成独立目录是为了让它与 `dryrun`（判据）分居两处 ——
   **判据与"决定怎么修"必须能分别被测试**。

**继承自第 3 期、本期未动的边界**（仍然成立）：前端跑的是**演示源**（`dryrun_done.verdict = skipped`，
**不谎报 pass**）；前端的公式是占位排版、成品页才是 MathJax 真 SVG；§12 正则**仍无真墙钟超时**
（只有形态拒绝 + 输入上限）；真端点联调仍需你的 Key；**真浏览器像素级取证无入口**。

### 15.6 待裁决清单（**累计 · 13 条**，请一次性给口径）

> ⚠ **本节已并入第十六节的累计挂账总表**：A 类（等裁决）见 **16.7-A**，B/C 类见 **16.7-B / 16.7-C**。
> 本节保留为第 4 期交付时的原始记录。

**第 4 期已裁决 3 条**（三档证据强度写入契约 / `repair` 上限 3 轮 + 横幅交付 / 版本号不升）—— 均已落地，见 15.1。

| # | 事项 | 我的建议 | 状态 |
|---|---|---|---|
| 1 | 构建工具 Rollup（当前）/ 放开沙箱换回 Vite | **维持 Rollup** | ⬜ 待定（**第 3 期第 16 条**，本期未变） |
| 2 | `TEMPLATE_VERSION` / `SDK_VERSION` 是否升 1.1.0 | **不升** —— **已按你的裁决执行** | ✅ 已定 |
| 3 | 槽位注入路径：构建期内联为主 + `postMessage` 为辅 | 是 | ✅ 第 3 期已落地 |
| 4 | 三档证据强度写进契约 | **写入** | ✅ **本期已落地** |
| 5 | 假端点是否随交付留在仓库 | **留** | ⬜ 待定 |
| 6 | C4 阈值口径 `max(20×p99, 跨度 2%)` 是否维持 | **维持** | ⬜ 待定 |
| 7 | `repair` 上限轮数与"不过也交付"的形态 | **3 轮 + 横幅** | ✅ **本期已落地** |
| 8 | 负向注入计数口径：12 条 + 1 对照，还是凑 13 | 维持 **12 + 对照** | ⬜ 待定 |
| 9 | 两处实现约定：`STEPS`/`ANSWERS` 行式表格式 · §3.3 的 `at_t`/`latex` 命名 | 维持现状 | ⬜ 待定 |
| 10 | **新增**：`adaptiveTolerance` 的量级档位阈值（`1e3` 与 `1e-4`） | **维持**（15 题的期望值最大 34.6，离阈值很远；真要改只影响 1e3 以上的量级） | ⬜ **新增** |
| 11 | **新增**：`repair` 阶段的**成本可观测性**（每轮 token/耗时） | 本期记了 `ms` 与诊断条数，**token 未记**（假端点不产生真 token） | ⬜ **新增** |
| 12 | **新增**：C7「符号歧义」的判定口径（同一符号 + **同一时刻** + 两个不同值） | **维持** —— 更宽的"同一符号出现在两条就算歧义"会误伤 q09（`uC` 在 t=1 与 t=3 各一次，**合法**） | ⬜ **新增** |
| 13 | **新增**：`core/repair/` 的目录位置（见 15.5 第 3 条） | **维持**（判据与修复决策分居两处） | ⬜ **新增** |

### 15.7 ★ 第 4 期踩过的坑（**改代码前先读这一节，别去试**）

沿用 14.6 的 A/B/C 三类，本期新增的都是 **A 类（判据类）**：

**A 类（本期新增，代价最大的一类）**

1. **"写完断言就算测了"是本次最贵的错觉。** 本期两次写出的"自适应"与"不变量断言"，
   **都能通过、都什么也没测**（15.4 缺陷 1、2）。→ **写断言时先问"它怎么才能失败"**，
   并为它写**负对照**（本期为门禁新增的每一条判据都跑了负对照：重排枚举 / 加第四档 /
   删 `repair` 阶段 / 改标签）。
2. **测试夹具会把被测语义"喂"成另一回事。** 『空槽位』那条用例传了 `{ PROBLEM: '  ' }`，
   于是**其余 7 个槽位也成了"空"**，断言看到的是"8 个都该重发"。→ 夹具必须**把不相关的字段填满**，
   否则你测的是夹具的缺省行为。
3. **星号在 shell 里会被吃掉。** 用 `node -e` 探查回灌文本里 ```` ```js ```` 的个数时，
   反引号被 PowerShell 处理掉，得到 `0` —— 与"有 2 个"的结论正好相反。→ **一次性命令行实验不能当判据**
   （第 3 期已记过一次，本期又踩）；要数就往**文件里**数。
4. **`problems.push(...asyncFn())` 的报错完全指不到现场**（15.4 缺陷 8）。
5. **假绿最危险的形态是"下游验了、上游没验"**：门禁 ⑲ 验的是 `core/` 的事件流，
   而 B6 的断点可能在**前端的阶段链**上（15.4 缺陷 6）。→ 凡是"跨端接口"，
   **两端都要有判据**，且判据要能证明"另一端改了会被发现"。

**B 类（沿用 14.6-B，本期再次印证）**

6. **凡是"派生汇总物"，必须由构建反向校验**（第 3 期的 `tex-svg/manifest.json` 是僵尸产物）。
   本期把它落成两条**新增的构建期判据**：证据强度标签、前端阶段链（15.4 缺陷 6、7）。
7. **加了重试/循环，就等于承认同一动作会被执行多次** ⇒
   所有"只该做一次"的保护都会开始报警（第 3 期 13.12 补记二）。本期自愈循环天然是"多次"：
   前端因此**必须**按"最后一次 `dryrun_done`"取判定，否则会把中间那轮的 `fail` 当结论。

**C 类（本沙箱专属，仍然适用）**：与 14.6-C 相同（禁止管道捕获 ⇒ 前端用 Rollup；
装包三条硬约束；**改模板必须重跑 `build-template` + `layout-lint` + `web-build`**；
模板源码不得出现 `import`/`export`）。

### 15.8 §21.3 每期自查清单（逐条结论）

- [x] **本期交付项全部可用，无占位符、无未完成分支。** 见 15.1；全仓检索无未替换占位符。
- [x] **本期新增/修改的契约已写入 `contracts/` 并在文档中同步（含 14.3 ① 的三档证据强度）。**
      新增 `diagnostic-record`（schema + TS 类型，同源生成）与 `diagnostic-evidence.json`；
      `contracts:verify` 逐字节比对通过。
- [x] **C1–C9 中本期涉及项可独立触发并有测试（本期 C7 强化后 15 题判定与第 3 期逐题一致）。**
      门禁 ㉑『D』（C7 强化的 4 个方向各有正反例）·『E』（与 `tests/c7-baseline.json` 逐字比对）。
      **C1–C9 的判据代码一行未改**（只增强了 C7 的诊断与容差口径，且容差在 15 题上逐值不变）。
- [x] **回归题集通过率与上一期对比无回退。** 15/15 · 0 告警 · 0 失败；12 条负向注入全部拦下；
      `Draw.raw` 0.00%；18 页体检通过；长度上限内。
- [x] **无新增外部依赖。** 根 `package.json` / `package-lock.json` **逐字节未变**；
      `web/package.json` 未变；**没有**引入任何新包（自愈用的是既有的网关 / 清洗 / Dry-Run）。
- [x] **取消、错误、空态、降级四种路径均已手动走通（含"修复途中取消"）。**
      取消：门禁 ㉑『C』（修复途中取消 ⇒ 不再调模型、不报红错、仍有 `run_done`）；
      错误：修复阶段模型报错 ⇒ 如实 `stage_error` + 记入 `repairRounds`，不静默（门禁 ㉑『B4』路径）；
      空态：`plan.slots` 为空（无槽位可归因）⇒ 如实说明并停止，`repair_done.reason` 带原因；
      降级：3 轮不过 ⇒ **带横幅交付**（若 8 槽位齐则仍可播放）。
- [x] **本轮遗留问题与冲突已写入交付说明。** 即 15.4 / 15.5 / 15.6。

### 15.9 交付落点（把改动同步回你的仓库）

**新增文件**：

```
contracts/spec/diagnostic.mjs               三档证据强度的 SSOT（第 4 期前置①）
contracts/diagnostic-record.schema.json     生成物（6 份契约之一）
contracts/types/diagnostic-record.d.ts      生成物
contracts/diagnostic-evidence.json          生成物（枚举 + 中文标签 + 回灌指引）
contracts/evidence.mjs                      运行时入口（转发 spec，不定义枚举）
core/repair/plan.mjs                        自愈的**决定**（重发哪些槽位 / 能否交付 / 回灌文本）
core/repair/index.mjs                       入口聚合
tests/repair-selftest.mjs                   门禁 ㉑（129 条取证）
tests/c7-baseline.json                      C7 的第 3 期判定基线（15 题实测值）
```

**修改文件**：

```
contracts/spec/contract-fields.mjs       新增 diagnosticRecord 到 CONTRACT_SPECS
contracts/_compile.mjs                   新增三档证据强度的编译期不变量断言（含"必须会失败"的负对照）
contracts/generate-contracts.mjs         生成 diagnostic-evidence.json + manifest 的 diagnosticEvidence 字段
contracts/verify-contracts.mjs           产物数量 13 → 16（逻辑不变）
core/dryrun/dry-run.mjs                  C7 强化（量级自适应容差 / 多时刻 at_t / 符号歧义 / 可回灌诊断）；
                                         adaptiveTolerance 与 checkAnswerClosure 改为导出（供门禁直接取证）
core/dryrun/diagnostics.mjs              证据强度文案与校验取自 contracts/evidence.mjs；新增 diagWithPrecision()
core/dryrun/run-suite.mjs                证据强度文案改取 labelOf()
core/cleaner/to-program.mjs              新增 mergeRepairOutput()（**部分**重生成的接口前提）
core/cleaner/index.mjs                   导出 mergeRepairOutput
core/prompts/templates.mjs               新增 EXTENSION_PROMPTS.repair（**不属于 §10.1**）+ listExtensionPrompts()
core/prompts/index.mjs                   导出扩展 Prompt
core/orchestrator/events.mjs             PHASE4_STAGES（含 repair）· repair_round / repair_done 事件
core/orchestrator/pipeline.mjs           自愈循环（planRepair → 回灌 → 合并 → 重跑 → 收敛/上限/横幅）
tools/verify-all.mjs                     二十步 → 二十一步（新增 ㉑）
tools/web-build.mjs                      新增两条构建期判据（证据强度标签 / 前端阶段链）+ 改为 async main
tools/build-overview.mjs                 证据强度标签改取 labelOf()（原先把 candidate 错标成"重放定位"）
tests/prompts-selftest.mjs               断言 §10.1 仍恰好 6 项 + 扩展 Prompt repair 的 9 条
tests/orchestrator-selftest.mjs          D-3/D-4 用 disableRepair 隔离"不静默"口径；新增阶段链/进度索引断言
web/src/lib/run-stream.ts                STAGE_CHAIN 含 repair · 新增 repair 事件类型 · PRECISION_LABEL
web/src/state/store.ts                   repairRounds / repairConverged / banner / delivery；
                                         **同时认 `program` 与 `programs`**（真实链路发前者、演示源历史上发后者）
web/src/hooks/useRun.ts                  初始阶段链含 repair
web/src/pages/SolvePage.tsx              告警横幅（不可折叠）+「自愈修复过程」面板（含证据强度标签）
web/src/pages/AnimationPage.tsx          动画页也挂告警横幅（不能因为翻页就看不见）
README.md                                本第十五节 + 第十六节；头部状态与步数更新
```

**重新生成（跑一次门禁即可）**：`contracts/*`（16 份）· `tests/reports/*` · `template/build/*` ·
`物理动画原型总览.html` · `web/dist/*` · `web/src/lib/demo-questions.ts`。

---

## 十六、第 5 期工作指导【**留档 · 已于第 5 期完成**】（第 5 期交付说明见 **第十七节**）

> **依据**：`物理解题动画软件v1.0自研方案.md` §18 期 5 · §9（**冻结项**）· §19.2 / §19.3 · §21。
> **前置**：第 1–4 期均已验收关闭。开工前请先读 **§0.1**（四期一览）与 **§0.2**（不许退步的基线）。
> **本节结构**：
> 16.1 现在在哪 → 16.2 交付与验收 → **16.3 开工前必须做的四件事** → 16.4 工作约定与判据形态
> → 16.5 衔接点（可直接复用）→ 16.6 坑清单 → **16.7 累计挂账总表（唯一的待办入口）**
> → 16.8 三分钟复核 → 16.9 §21.3 自查清单 → 16.10 预计落点
>
> ⚠ **第 4 期的实施方案（§十四）保留为留档**；它的 14.6 坑清单与 §15.7 是 §16.6 的来源。
> ⚠ **本节已按第 5 期的实际执行情况就地更新**（交付项状态、挂账表回填），
> 原文口径未删改 —— 哪些做到了、哪些顺延，逐条写在 **§十七**。

### 16.1 一句话说清现在在哪

第 1、2 期给了**校验内核**；第 3 期给了**模型链路**；第 4 期给了**出错之后怎么办**（自愈 + 告警交付）。
**现在的问题是"知识从哪来"** —— 校验与自愈都只能保证"自洽"（§7.4 明说了 C7 拦不住自洽的错误），
而**题型级的物理正确性**要由**世界书词条正文的自检条款**承接（D7：v1 不做探针引擎）。

这正是第 5 期的范围。

### 16.2 本期要交付什么（方案 §18 期 5 原文）

> **交付**：世界书引擎增强（`code_examples` + `origin` 治理）· 管理器 UI · 预览器 ·
> **词条第三次改写**（含"生成后自检"条款，M6 / M7 / M20）
> **验收**：*传送带题命中词条并递归唤醒共速判据；单槽词条只影响对应槽位；
> 两槽都无命中时链路正常；预览器与实际请求**逐字一致***

拆成可判定项（**每条都要有正反例，且能机检**）：

> **第 5 期实际状态（逐条，证据见门禁 ㉒ 的『W1』～『W15』与 §17.2）**：
> W1–W13、W15 **全部达成**；**W14 部分达成** —— "结构合规 100% 可机检"这条达成，
> 但"内置 44 条（乃至按 111 个题型重写）的内容"按用户 2026-10 的裁决**顺延到第 5.5 期**
> （本期只交付**机制**与**最小集 5 条**，覆盖率报告会如实标出"内容覆盖未完成"）。

| # | 验收项 | 判定方式 | 进门禁？ | 第 5 期状态 |
|---|---|---|---|---|
| W1 | 主键：字面量包含 + `/正则/flags`，全半角与大小写归一化（§9.2 第 1 步） | 正反例：`传送带` 命中、`皮带` 不命中；`/共速.{0,6}摩擦/` 命中 | ✅ | ✅ |
| W2 | 次级逻辑四种：`AND_ANY` / `AND_ALL` / `OR` / `NOT`，**含 list 为空时的口径**（§9.2 第 2 步） | 四组各一对正反例；空 list 的四条口径逐条取证 | ✅ | ✅ |
| W3 | **常驻**（`constant:true`）无条件注入；`keys` 为空时只有 `constant` 或递归能救它 | 不匹配题面也必须进上下文 | ✅ | ✅ |
| W4 | **递归唤醒**（`recursive`）与**环检测**（A→B→A 只记一次） | 传送带题命中 A，A 唤醒"共速摩擦突变" B；造一个 A↔B 环断言不死循环 | ✅ | ✅ |
| W5 | **三重预算**：`maxDepth=3` / `maxEntries=40` / `maxChars=30000`（**按槽位独立计算**；第 8 期定案：正文 30000 + 示例 10000 = 40000，见门禁 ㉒『W5』的注释） | 造超限用例：截断顺序必须按 `priority → order → 强度` | ✅ | ✅ |
| W6 | **分槽组装**：`solve` / `scene_code` 各自独立 | 单槽词条只影响该槽；双槽词条按 `## 解题` / `## 动画建模` 标题切分 | ✅ | ✅ |
| W7 | **空槽静默跳过 vs 被截断要告警**（§9.2 的"重要边界"） | **两者必须都能被断言**（见 16.3 ③） | ✅ | ✅ |
| W8 | 双槽词条**无标题**时：全文注入已声明槽位 + 预览器提示 | 正例（有标题→切分）+ 反例（无标题→全文+提示） | ✅ | ✅ |
| W9 | **来源标记**（`【世界书·解题：<title>】` / `【世界书·动画建模：<title>】`）与**溯源记录** | 溯源精确到命中方式（key / secondary / constant / recursive(来源 id)）与**实际注入槽位** | ✅ | ✅ |
| W10 | **预览器与实际请求逐字一致** | 同一输入跑两条路径，**拼接结果逐字节相同**（见 16.3 ②） | ✅ | ✅ |
| W11 | 导入导出 `.json`（`format:"od-worldbook"`, `version:1`）跨机器可复现同一套命中结果 | 导出→导入→命中集合逐条相同 | ✅ | ✅ |
| W12 | **旧名归一化只发生在导入路径**：`scene_spec` → `scene_code`；`"both"` → `["solve","scene_code"]`，UI 提示"已转换 N 条" | 正例（导入转换）+ 反例（**导出与内部一律只写新名**） | ✅ | ✅ |
| W13 | `origin` 治理：内置只读可停用；编辑生成 `user` 覆盖副本；升级只替换**未被覆盖**的内置条目；导出默认只导 `user` | 逐条取证（含"恢复默认只影响内置"） | ✅ | ✅ |
| W14 | **词条第三次改写**：内置 44 条（30 解题 + 13 场景 + 1 兜底）+ 视觉词条；每条含「生成后自检」小节 + ≥1 段 `code_examples` | **自检条款覆盖率 100%**（§19.3，可机检：逐条 grep 小节标题） | ✅ | ⚠ **机制达成 / 内容顺延 5.5 期**（见 17.5 偏差 1） |
| W15 | 管理器的**实时试触发**（不调模型、不保存）：命中清单 / 解题槽拼接 / 动画槽拼接 / 空槽提示 | 与 W10 共用同一条组装路径 | ✅ | ✅ |

### 16.3 ★ 开工前必须先做的四件事

**① 读冻结契约与算法原文，不要凭印象重写。**
`contracts/worldbook-entry.schema.json`（第 1 期就冻结了，**`code_examples` 字段那时就在**）
+ §9.2 触发算法六步 + §9.3 治理 + §9.4 三类内容规范 + §9.5 管理器 UI 与预览器。

**② 预览器必须走与真实请求**同一条**组装路径（W10 —— 本期最容易做成"看着对"的一条）。**
用 `core/prompts/fixed-prefix.mjs` 的 `buildConditionalSegment()` / `assemblePrompt()`，
**不要另写一套"看起来一样"的拼接**。第 3、4 期各有一次同类教训
（判据测错环节、桩太弱造成假绿）：**这是可以机检的** —— 同一输入跑两条路径，逐字节比。

**③ 在数据结构上就把"空槽"与"被截断"分开（W7）。**
§9.2 的边界注释写得非常明确；建议引擎返回结构里直接分成两个字段，例如
`emptySlots: string[]` 与 `truncatedSlots: Array<{ slot, dropped }>`，
**不要靠 UI 各自判断** —— 那会让"动画槽空"与"该槽词条全被截断"在外观上无法区分。

**④ 决定"用户已有词条"的处理（W13），并把"将被覆盖的清单"打印出来。**
词条第三次改写会**替换内置词条**；§9.3 规定"编辑生成 `user` 覆盖副本"、
"恢复默认只影响内置"。改内置之前必须先确认**没有 user 覆盖副本会被误伤**，
建议在改写脚本里做成"**只替换未被覆盖的内置条目**"并**打印将被覆盖的清单**。

### 16.4 工作约定与判据形态（第 5 期新增，供 §16.10 落地时照做）

1. **世界书不进 C1–C9。** 它是**上下文注入**，不是**判据**。任何"用世界书去把关"的想法都要先想清楚
   §7.2 是冻结项；物理正确性靠**词条正文的自检条款 + `code_examples`**（D7），不靠新增检查号。
2. **世界书要进"每题配置快照"。** `snapshotConfig()` 已经是第 3 期的地基；
   词条集合（含哈希）必须进快照，否则"下一题生效、正在跑的题保持原快照"（§16 热重载语义）会被破坏。
   同时 `provenance.worldbookHash` 要在这一刻**真正有值**（第 3、4 期都写的是 `'empty-phase3'`）。
3. **词条正文的写法口径**：解题规范五段式（`适用判据` / `建模步骤` / `参考公式` / `验算` / `常见错误`）；
   场景建模规范只讲四件事（阶段怎么切 / 边界怎么表达 / 实体与标注怎么挂 / 特殊渲染需求）；
   **教"怎么建模、怎么调 SDK"，不教"怎么手写轨迹"**（§9.4）。
4. **`code_examples` 的文体要与自愈 Prompt 一致**（§15.9 已记：第 4 期的 `repair` Prompt 在教模型
   "按证据强度改代码"，世界书的示例不要另起一套措辞）。
5. **UI 文案一律简体中文**（§21.1 第 5 条）；关键区域加可定位标识（§21.1 第 6 条）。
6. **交付时附 §21.3 自查清单逐条结论**（同前四期，见 16.9）。

### 16.5 衔接点（直接复用，不要重写）

| 需要什么 | 已有的是什么（在哪） |
|---|---|
| Prompt 的"条件段"位置 | ✅ `assemblePrompt({ worldbookEntries, worldbookSegment, instructions, stageSlot })` —— 第 3 期留的**空槽已被第 5 期填上**；"本阶段指令"另有标签（见 17.3 第 4 条） |
| 每题配置快照 | ✅ `core/orchestrator/pipeline.mjs` 的 `snapshotConfig()`（第 5 期起含 `worldbook` 与 `worldbookHash`） |
| 事件流 | ✅ `stage_start/delta/done` + **第 5 期新增 `worldbook_done`**；`worldbook` / `distill` 已在 §2.3 枚举里（`contracts/spec/frozen-keys.mjs` 的 `PIPELINE_STAGES`） |
| 三档证据强度 | ✅ `contracts/evidence.mjs` —— 世界书触发不产生行号诊断，但**报告结构可沿用** |
| 假端点（不花真钱就能验收） | ✅ `tests/fake-endpoint/server.mjs`（网关 63 条取证就是打它） |
| 词条字段形状 | ✅ `contracts/spec/contract-fields.mjs` 的 `worldbookEntry`（`code_examples` 已在） |
| 双槽标题切分 | ✅ **第 5 期已实现**：`core/worldbook/engine.mjs` 的 `splitEntryContent()`（口径照 §9.2 第 5 步④ + §20 风险表） |

### 16.6 坑清单（第 1–4 期的**累计**，改代码前先扫一遍）

- **14.6-A**（判据类 3 条）：判据测错环节 / 桩太弱造成假绿 / 一条恒真断言。
- **14.6-B**（工程类 7 条）："绿着但没跑"比"红"更危险 / 静默失败最贵 /
  **凡"派生汇总物"必须由构建生成 + 被门禁反向校验** / 一次性命令行实验不能当判据 /
  **在 `String.raw` 模版里写反引号会提前闭合** / 加了重试就要区分"竞争输掉"与"真出错" /
  握手要能容忍对方不说话。
- **14.6-C**（本沙箱专属 4 条）：**禁止管道捕获 ⇒ Vite 结构性不可用**；
  装包三条硬约束（`NPM_CONFIG_CACHE` 落项目内 + `--prefix web --ignore-scripts`）；
  **改模板必须重跑 `template/build-template.mjs` + `tools/layout-lint.mjs` + `tools/web-build.mjs`**；
  模板源码不得出现 `import`/`export`。
- **15.7**（第 4 期新增 5 条）：**写完断言先问"它怎么才能失败"**（并为它写负对照）；
  夹具别把被测语义喂成另一回事；**星号/反斜杠会被 shell 吃掉**；
  `problems.push(...asyncFn())` 的报错完全指不到现场；**跨端接口两端都要有判据**。
- **一句话**：**"绿着但没跑"比"红"更危险；"我以为它更合理"不等于"它确实更合理"。**

### 16.7 累计挂账总表（**唯一的待办入口**）

> 来源：§4（第 1 期冲突与偏差）· §9.5 挂起四项 · §11.7 · §12.5 · §13.4 · §14.7 · §15.5 · §15.6。
> **本表是唯一口径**；上述各节保留为各自期次的历史记录。
> 标记：**A 类** = 等你拍板；**B 类** = 已知工程债（不需你拍板，但要有人认领）；**C 类** = 能力缺口/后置。

#### A 类 · 等用户裁决（15 条 + 已裁决 1 条）

| # | 事项 | 我的建议 | 影响 | 状态 |
|---|---|---|---|---|
| A1 | **构建工具：Rollup（当前）还是放开沙箱换回 Vite** | **维持 Rollup** | 偏离 §2.2 的 "Vite" 一项；无 HMR | ⬜ 待定（第 3 期第 16 条，第 4/5 期未变） |
| A2 | 假端点是否随交付留在仓库 | **留**（它是门禁的一部分） | 仓库多一个 `tests/fake-endpoint/` | ⬜ 待定 |
| A3 | C4 阈值口径 `max(20×p99, 跨度 2%)` 是否维持 | **维持** | 第 2 期引入的实现约定 | ⬜ 待定 |
| A4 | 负向注入计数口径：12 条 + 1 对照，还是凑 13 | 维持 **12 + 对照** | 只影响文档写法 | ⬜ 待定 |
| A5 | 两处实现约定：`STEPS`/`ANSWERS` 的**行式表格式** · §3.3 的 `at_t`/`latex` **下划线命名** | 维持现状 | 方案未规定，第 1 期自定 | ⬜ 待定 |
| A6 | `adaptiveTolerance` 的**量级档位阈值**（`1e3` 与 `1e-4`） | **维持**（15 题期望值最大 34.6，离阈值很远） | 只影响 ≥1e3 的量级 | ⬜ 待定（第 4 期新增） |
| A7 | `repair` 阶段的**成本可观测性**（每轮 token） | **补**（本期只记了 `ms` 与诊断条数） | 观测指标完整性 | ⬜ 待定（第 4 期新增） |
| A8 | C7「符号歧义」判定口径（同一符号 + **同一时刻** + 两个值） | **维持**（放宽会误伤 q09 的合法写法） | C7 语义 | ⬜ 待定（第 4 期新增） |
| A9 | `core/repair/` 的目录位置（不在 §2.4 的建议结构里） | **维持**（判据与"怎么修"分居两处才好分别测试） | 目录结构 | ⬜ 待定（第 4 期新增） |
| ~~A10~~ | ~~第 5 期改写内置词条：是否接受"只替换未被覆盖的内置条目"~~ | **接受** | 会替换你手改过的内置词条 | ✅ **用户 2026-10 已裁决"按建议接受"**，已落地（`planUpgrade()` + 打印将被覆盖清单） |
| A11 | **`keys: []` + `recursive: true` 的唤醒语义**：§9.2 说"仅可被递归唤醒"，但递归仍按主键匹配 ⇒ 无键词条**永远不可能被唤醒** | **本期取"让那句话成立"的读法**：被唤醒正文里出现它的 `title` 时唤醒；`engine.mjs` 里一个常量 `WAKE_BY_TITLE_FOR_KEYLESS` 可一键关掉 | 无键词条的命中行为 | ⬜ 待定（第 5 期新增） |
| A12 | **命中强度刻度**：§9.2 第 4 步说"按 `priority → order → 强度` 排序截断"，但没定义强度 | **key 4 / secondary 3 / constant 2 / recursive 1**（越直接越强） | 预算截断时留谁 | ⬜ 待定（第 5 期新增） |
| A13 | `maxChars` 计什么字符：正文长度，还是**渲染后的整块文本**（含来源标记）？ | **渲染后的整块**（那才是真正进上下文的量；用正文长度会系统性少算） | 预算松紧 | ⬜ 待定（第 5 期新增） |
| A14 | 归一化对**正则** key 是否生效 | **不生效**：字面量 key 匹配归一化文本，正则 key 匹配**原始文本**（否则 `/[A-Z]/` 这类写法会被悄悄破坏） | 正则 key 的写法 | ⬜ 待定（第 5 期新增） |
| A15 | **世界书内容生产拆到第 5.5 期**（本期只搭仓库 + 机制 + 最小集） | —— | W14 的"内容覆盖 100%"验收时点后移 | ✅ **用户 2026-10 已裁决**（见 17.5 偏差 1） |
| A16 | "本阶段指令"改用独立标签 `【本阶段指令：…】`（第 3 期起它与世界书词条**共用**同一个标记） | **改**（否则溯源分不清"这条是词条还是阶段指令"，W10 也无法对齐） | Prompt 的 system 段文本；消费者的阶段识别要跟着改（第 5 期已改 3 处测试夹具） | ⬜ 待定（第 5 期新增，已实施） |
| ~~A17~~ | ~~图片题要不要做"几何转写"~~ | **做**（新增执行链第 0 步 `read_image`） | 阶段枚举新增一项 | ✅ **用户 2026-10 已裁决并落地**（见 **17.10**） |
| A18 | **"几何朝向"没有判据**：斜面画反时 C1–C9 一条都拦不住（C7 只在方向恰好落在带符号读数上时才可能抓到） | **补一条扩展检查**（像 C10/X1/X2 那样 `blocking:false`）：从命令缓冲算**实际朝向**，与代码里的朝向声明比对，不一致就告警。⚠ 它只能抓"画面与声明不一致"，抓不到"两者一起错"——后者仍需人工复核位 | 动画"画反"的可发现性 | ⬜ 待定（第 5 期新增；**不动 C1–C9**） |
| ~~A19~~ | ~~`scene_code` 阶段是否也带图~~ | **不带**（图片只进 `read_image` 与 `solve` 两个阶段；动画阶段靠第 0 步的转写文字拿几何，避免"两个阶段各自看图、各自理解"） | 动画阶段的输入 | ✅ 已在 17.10 按此实施；若要改成"带图"，只需改 `pipeline.mjs` 的一处 |
| A20 | **非文字触发**：让词条能声明"仅在本次带图时注入"（现在的触发引擎只认文本，§9.2 的输入是题面文本） | **不必需**。理由：需要它的只有"配图拓扑提取规范"这一类，而它已写进 **Prompt**（§9.6 的分工：阶段契约 ≠ 条件知识）。真要加就得给 `worldbook-entry` 增字段 ⇒ 再改一次冻结契约 | 世界书触发条件 | ⬜ 待定（第 5 期新增；建议第 5.5 期开工时评估） |
| A21 | **`solve` 阶段是否继续带图**（第 0 步已经把图转写过了） | **带**：此时转写已成了模型的"工作笔记"，带着图复查反而更稳（不是"两份互相猜"） | 图片题的模型输入 | ✅ **用户 2026-10 已裁决**（见 17.10） |
| A22 | ★ **动画侧的"第二字段"叫什么、字段名怎么定**（第 5.7 期 S1 末轮实测：同表同规矩、只改称呼） | **对外称「动画元件」，字段名 `devices` → `elements`**。改名前先拟过「物理图元」，因"物理图元"混入了尺寸标注/文字标注这类**非元件**而废弃 | `contracts/worldbook-concepts.json` 的字段与语义；第 5.9 期完整词表沿用此名 | ✅ **用户 2026-10 已裁决**（见 5.7 期 S1 报告与词表 `decisions.S1-D1`） |
| A23 | **词表内容是否随改名一起调整**（实测发现缺【质点/圆形】（`Draw.circle` 15 题调用 26 次）与【直线段/墙·地面·杆·导轨】（`Draw.line` 调用 60 次）） | **本期不动内容**：只改字段名 + 在词表里记 `knownGaps`；缺的元件、以及该移出的 `text_label`/`dimension_label` 统统留给 **5.9 期** | 词表规模与覆盖率判据；`pulley_rope`/`block_board` 一条捆两原语 ⇒ 覆盖率断言机检不了 | ✅ **用户 2026-10 已裁决**（`decisions.S1-D2`） |
| A24 | ★ **S1 闸门（🚦 继续/停止）的判准率口径** | **由用户人工判定**：用户判定 **90%（满意）⇒ 闸门通过、继续 S2–S7**。⚠ 自动化严格口径（预测集合与人工标准集合完全相等）在 36 题上测得 **75%**，两者差距**集中在「该报几个考点」的粒度分歧**，不是"看不出考什么" | 决定本期是否继续；也说明"严格相等"口径对多标签任务系统性偏低 | ✅ **用户 2026-10 已裁决**（`decisions.S1-D3`） |
| A25 | **"动画元件"的判定细则**（S1 实测暴露出边界未定死） | **矢量箭头算**；**尺寸标注、文字标注不算**；纯文字无配图报"无"**算对**；弹簧那类**词表问题不计模型错** | 器材/元件那一栏的准确率是否可测；S6 覆盖率判据的分子分母 | ✅ **用户 2026-10 已裁决**（`decisions.S1-D4`） |
| **A26** | ★ **§9.1 词条字段集变更**（冻结项）：词条新增 `concepts` / `tags` / `elements` 三栏 | **加**。枚举**从 `contracts/worldbook-concepts.json` 派生**（不手写 —— 手写就是第二份事实来源）；三栏**可选**，缺省 `[]` = 不走概念分发（灰度期老词条仍靠 `keys` 工作）；跨字段约束（`tags` 必须属于本词条某个 `concepts`）落在 `core/worldbook/store.mjs` 的 `validateEntry` | `contracts/worldbook-entry.schema.json`（新增 `$defs` 的 `ConceptId`/`TagName`/`ElementId`）· `contracts/spec/contract-fields.mjs` · `spec/frozen-keys.mjs`（词表派生）· `_compile.mjs`（三条派生断言）· `store.mjs`（跨字段校验 + 规范化）· 前端类型 `WorldbookEntryLike`。`contractHash` **变一次**：`1ff98c44…` → `2ec3f5a1…` | ✅ **用户 2026-10 已裁决**（本行即交付说明；逐条取证见门禁 ① ⑮ ㉒） |
| **A27** | ★ **§2.3 阶段枚举变更**（冻结项）：`read_image` → **`read_problem`** | **改名**。语义从"读图转写"拓宽为"读题与判定"：该步现在**总是跑**（纯文字题也跑），除转写外还要判出【考点】【题型】【动画元件】。理由：考点不可能写在题面里（必须由模型判）；两半触发源不是同一类任务（考点＝语义推理，元件＝感知识别） | `contracts/spec/frozen-keys.mjs` 的 `PIPELINE_STAGES` + `CLEANING_STAGES`（两处同步，`_compile.mjs` 用结构断言守着）· `endpoint.schema.json` / `cleaning-rule.schema.json` 的阶段枚举 · 连带改名见 S4（`templates.mjs` / `pipeline.mjs` / `events.mjs` / 前端 3 个文件 / 4 处测试） | ✅ **用户 2026-10 已裁决**（本行即交付说明） |

#### B 类 · 已知工程债（不需拍板，但要认领）

| # | 债务 | 现状 | 建议处理 |
|---|---|---|---|
| B1 | **§12"正则在隔离环境运行 + 超时"仍有缺口** | 只有"形态拒绝 + 输入规模上限"两道防线，**没有真墙钟超时**（沙箱不允许把正则丢给子进程） | 换 worker + 超时只需改 `core/cleaner/regex-rules.mjs` 内部，**接口不变** |
| ~~B2~~ | ~~`provenance.promptHash` 仍是 `null`；`worldbookHash` 是 `'empty-phase3'`~~ | ✅ **第 5 期已收口**：`promptHash` 取第 0 个阶段组装时拿到的真值；`worldbookHash` 由 `worldbookHashOf()` 算真哈希（空集合也算，不再写假值） | 已解决（门禁 ㉒『X』逐条断言） |
| B3 | `X1` 在 q03 / q14 上报警（`RETURN('t1', …)` 与 `STEPS` 字段同名） | 不阻塞；第 3 期已改名（`tMeet` / `tStar`），**X1 仍会提醒** | 保留（子类提醒本身是对的） |
| B4 | 前端**只认演示源**，不调真模型、不跑真校验 | `dryrun_done.verdict = 'skipped'`，**绝不谎报 pass**（这是刻意的诚实设计） | 随 C2 一起解决 |
| ~~B5~~ | ~~假端点的 `supportsVision` 与真端点联调未做~~ | ✅ **第 6 期已收口**：`ai-rules/endpoints.json` 的读写闭环 + 「测试连接」已落地（`core/gateway/endpoint-store.mjs` / `connection-test.mjs`，界面在「规则 → 端点与 Key」） | 已解决（门禁 ㉖ / ㉘） |
| B6 | `template/build/_variant-*.html` 是临时变体页 | `tools/_make-variant.mjs` 生成，用完应删 | 交付前清理（勿与成品页混淆） |
| B7 | **设置页的编辑写不回 `ai-rules/worldbook/`** | ✅ **第 6 期部分收口**：「规则 → 世界书」页签已能真正写回（服务端 `core/worldbook/editor.mjs`，整批校验 + 原子写 + 备份）；**设置页那个管理器仍是"预览/分析"**，页面顶部已写明"要存回磁盘请去规则页" | 若要合并成一个入口，留到第 9 步统一 |
| B8 | 浏览器侧导入只做**形状提示** | 完整字段校验与旧名归一化（`scene_spec` → `scene_code`）在 Node 侧执行 | 接上服务后改为调服务校验；口径已由 ㉒『W12』钉住，不会两边漂移成两套 |
| B9 | **内置词条只有最小集 5 条** | 题型覆盖地图（111 个题型）与全库内容待第 5.5 期 | 第 5.5 期按《世界书知识库生成指导》生产；`tools/rewrite-worldbook-entries.mjs` 就是扩编入口（改 `LAYERS` 即可） |
| B10 | 解题页「世界书依据」面板的数据是**构建期快照** | 演示源的输入是构建期真题题面 + 构建期词条库（触发与组装是真引擎跑的） | 接上 C2 的服务后自然变成运行时数据；面板代码不用改 |

#### C 类 · 能力缺口与明确后置（8 条）

| # | 缺口 / 后置项 | 为什么 | 何时 |
|---|---|---|---|
| C1 | **真浏览器像素级取证无入口** | `od export` 随 Open Design 迁移失效，DSH 下暂无等价方式 | 找到 DSH 下的截图途径时；**不影响任何门禁** |
| C2 | **本地服务那一层**（浏览器 ↔ `core/`） | 沙箱当时不允许起服务/绑端口；`serverEventSource()` 接口已就位 | 排在更后面（原 §2.1 架构） |
| ~~C3~~ | ~~**端点与分阶段模型配置界面 + 「测试连接」**（§11.2 第 9 条）~~ | ✅ **第 6 期已交付**：`ai-rules/endpoints.json`（Key 单独存于 `keys.json`，**导出永不含 Key**）+ 九条校验前置到保存 + 「测试连接」+ 界面（「规则 → 端点与 Key」） | 已解决（门禁 ㉖ / ㉘ + 总装 ㉗） |
| C4 | **导出三件套（GIF / WebM / 本地 HTML）+ 联动图表 + 教辅蒸馏** | M17 / M15 / M19 | **第 7 期** |
| C5 | 安全与脱敏 · 日志与失败复现包 · 历史表 · Electron 壳 | M21 / M22 / M23（**暂缓 UI**）/ M24 | **第 8 期** |
| C6 | ⚠ **第 4 期的界面目视验收**（告警横幅 + 自愈过程面板） | 代码已写、已编译、已过 `tsc` 与产物体检，**但演示源不产生 repair 事件**（演示是"首轮就过"），所以**没有真数据可看**；B1–B6 的证据全部来自命令行门禁 | **与 C2 / C3 一起，后置到总验收 + 压力测试阶段**（用户 2026-10-16 决定） |
| C7 | 讲解模式（按关键时刻逐步暂停 + 投影仪友好大字号） | §22 第 5 条：只留结构位（模板暴露 `--scale` 字号变量），不做交互控件 | 待会议决定 |
| C8 | 多场景（一题多段动画）模板支持排期 | §22 第 10 条：当前是"单场景 + 多连续阶段"（用户已裁决 `single_scene_multi_stage`） | 第 1 期还是第 3 期的问题已过期，**待重排** |
| C9 | **第 5.5 期：世界书知识库内容生产**（111 个题型 → 词条；图以**笔记电子版 png** 为准） | ✅ **入口已就位**：`世界书知识库生成指导.md`（作业书）已产出，工程前置 P1–P3 已落地（§17.11），三项口径已由用户裁决（全收 / 111 全收但按模型收敛 45–60 条 / 图全读电子版） | **可直接开工**（开新会话粘作业书 §12 的开场白）；入口见 **§17.9** |

#### D 类 · 本期（第 4 期）已落地，供第 5 期参照

| # | 事项 | 结论 |
|---|---|---|
| D1 | 三档证据强度（`exact`/`replayed`/`candidate`）写进契约 | ✅ 已落地（`diagnostic-record` + `diagnostic-evidence.json`） |
| D2 | `repair` 上限 **3 轮**、不过则带横幅交付 | ✅ 已落地（`REPAIR_MAX_ROUNDS` + `buildBanner()`） |
| D3 | `TEMPLATE_VERSION` / `SDK_VERSION` **不升** | ✅ 已执行（仍为 1.0.0） |
| D4 | 第 3 期遗留的三处挂账小修（X1 改名 / 读数分级 / 僵尸产物） | ✅ 第 3 期第 8 步已完成（12.19） |
| D5 | 第 1 期挂起四项（C10 维持扩展 / 行式表格式 / `at_t` 命名 / 排版两项） | ⚠ 前三项升格为 **A3–A5**；排版两项见 C6 的同类后置 |

### 16.8 第 5 期开工前的三分钟复核

```powershell
cd C:\Users\Liu LuMing\Desktop\Work
node tools/verify-all.mjs      # 应全绿：⓪ 覆盖自检 + 二十二步（第 5 期开工当时是二十一步；同日追加改动后为 22）
```

看完这几行就够：`通过 15 · 告警 0 · 失败 0` / `12 条负向注入全部被准确拦下` /
`C7 判定与基线逐字一致` / `全部门禁通过`。

**不许退步（每期都要复跑）**：见 **§0.2 的表**（含第 4 期新增的"C7 与基线逐字一致"）。

### 16.9 §21.3 每期自查清单（交付时逐条给结论，同前四期）

- [ ] 本期交付项全部可用，无占位符、无未完成分支；
- [ ] 本期新增/修改的契约已写入 `contracts/` 并在文档中同步；
- [ ] C1–C9 中本期涉及项可独立触发并有测试（**世界书不进 C1–C9，别去动判据**）；
- [ ] 回归题集通过率与上一期对比无回退（**含 C7 基线比对**）；
- [ ] 无新增外部依赖（若有，已列清单并说明）；
- [ ] 取消、错误、空态、降级四种路径均已手动走通（**含"空槽静默 / 截断告警"这一对**）；
- [ ] 本轮遗留问题与冲突已写入交付说明（并**回填 §16.7 的挂账总表**）。

### 16.10 预计落点（开工时按实际调整）

```
core/worldbook/       引擎：trigger.mjs（§9.2 六步）· budget.mjs（三重预算+截断）· assemble.mjs（分槽组装）
                      governance.mjs（origin 升级/覆盖/恢复默认）· import-export.mjs（od-worldbook v1 + 旧名归一化）
core/worldbook/data/  内置 44 条 + 视觉词条（**第三次改写版**，每条含「生成后自检」+ code_examples）
web/src/pages/        SettingsPage（世界书管理器：卡片列表 / 槽位筛选 / 实时试触发预览器 / 冲突提示）
tests/worldbook-selftest.mjs        门禁 ㉒（W1–W15 逐条正反例 + **预览器与真实请求逐字节一致**）
tools/rewrite-worldbook-entries.mjs 词条第三次改写（**只替换未被覆盖的内置条目**，并打印将被覆盖的清单）
```

> ⚠ 落成之后，**门禁步号会从二十一步变成二十二步**（新增 ㉒）。
> 覆盖自检（⓪）会自动点名新脚本 —— **别走"加豁免"那条路**，除非有可复核的理由（见 §13.7）。
>
> **实际落点与上面这份草案的差异（第 5 期交付后回填）**：
> `trigger.mjs` / `budget.mjs` / `assemble.mjs` 三份**合并成了 `engine.mjs`** ——
> 因为它们必须整体被复制到浏览器侧（预览器要跑同一份字节），拆成三个文件会让"逐字节副本"
> 变成三份副本、三个判据。其余落点照草案；`data/` 本期只放**最小集 5 条**（44 条内容顺延 5.5 期）。
> 新增的两份工具（草案里没有）：`tools/build-worldbook-web.mjs`（生成浏览器侧引擎副本与演示数据）。

---

## 十七、第 5 期交付说明

> **依据**：`物理解题动画软件v1.0自研方案.md` §18 期 5 · §9（**冻结项**）· §19.2 / §19.3 / §21；
> 实施方案见本文第十六节。
> **冻结项**：§3（7 槽位 / 8 键名）· §9 · §11.2 · §7.2（C1–C9）**一字未改**；C10 / X1 / X2 仍是扩展检查。
> **验收原文**：*传送带题命中词条并递归唤醒共速判据；单槽词条只影响对应槽位；两槽都无命中时链路正常；
> 预览器与实际请求**逐字一致***。
> **用户本期裁决四条**（2026-10）：① 内置词条**不再局限于"30 解题 + 13 场景 + 1 兜底"**，按题型重写；
> ② **内容生产拆到第 5.5 期**，本期只搭"仓库"；③ 旧 `ai-rules` / 教师 skill **不照抄，只取题型与关键词**；
> ④ A10"只替换未被覆盖的内置条目"**按建议接受**。

### 17.1 交付了什么（对照 §16.2 的 W1–W15）

> ⚠ **§17.1–§17.9 的数字是"第 5 期首次交付时"的快照** —— 随后的同日追加改动把它们抬高了。
> **以文件头部状态块与 §0.2 为准**；逐项对照见 **§17.2 开头的表**。

| 交付块 | 落地位置 | 说明 |
|---|---|---|
| **世界书引擎（§9.2 六步）** | `core/worldbook/engine.mjs` | 主键扫描 / 四级次级逻辑 / 常驻 / 递归唤醒（三重预算 + 环检测）/ 分槽组装 / 双槽标题切分 / 来源标记 / 溯源记录 / 冲突提示。**纯逻辑、零 Node 依赖** —— 因为它要被逐字节复制到浏览器 |
| **仓库（两个抽屉）** | `core/worldbook/store.mjs` + `core/worldbook/data/` + `ai-rules/worldbook/` | 内置只读、用户可写；§9.1 全字段校验；规范化 + **稳定哈希**；**整批生效或整批失败**；原子写（`tmp` + `rename`） |
| **origin 治理（§9.3）** | `core/worldbook/governance.mjs` | 覆盖副本 / 升级只替换未被覆盖 / 恢复默认只影响内置 / 导出默认只导 `user` —— **纯决定**，与落盘分居两处 |
| **导入导出（§9.5）** | `core/worldbook/import-export.mjs` | `od-worldbook` v1；旧名归一化**只在此处**发生，并逐条记下"已转换 N 条" |
| **覆盖率校验器（§19.3）** | `core/worldbook/coverage.mjs` | 每条内置词条必须含「生成后自检」小节 + ≥1 段 `code_examples`；**内容进度与结构合规分开报告**，未完成就如实说未完成 |
| **编排接线** | `core/orchestrator/pipeline.mjs` · `events.mjs` | 世界书进**每题快照**（深拷贝 + 冻结）；逐阶段触发；`worldbook_done` 事件；`provenance.worldbookHash` **取真值**（B2 收口）；`promptHash` 不再恒为 `null` |
| **Prompt 分槽** | `core/prompts/fixed-prefix.mjs` | 条件段按槽位渲染来源标记；**"本阶段指令"有了独立标签**（第 3 期起它与词条共用同一个标记） |
| **设置页（M7 / M20）** | `web/src/pages/SettingsPage.tsx` | 管理器（分类分栏 / 搜索 / 启用开关 / 常驻与递归标记 / 槽位标记与筛选 / 全字段编辑 / `code_examples`）+ **实时试触发预览器（四区块）** + 冲突提示 + 导入导出 |
| **解题页「世界书依据」面板（§15）** | `web/src/pages/SolvePage.tsx` | 命中方式 / 实际注入槽位 / 字符数 / **空槽与截断分开显示**；数据由**构建期真引擎**在真题题面上跑出来 |
| **契约** | `contracts/worldbook-pack.schema.json` + TS 类型 | §9.5 的交换格式；编译期不变量断言 3 条（含**负对照**） |
| **门禁 ㉒** | `tests/worldbook-selftest.mjs` | **158 条**取证（W1–W15 + 接线 + 基础契约未变） |
| **内置最小集** | `core/worldbook/data/`（3 个文件 · 5 条） | 元规范（常驻）/ 兜底 / 传送带（双槽）/ 被递归唤醒的共速判据 / 视觉规范。**唯一作者入口**是 `tools/rewrite-worldbook-entries.mjs` |

### 17.2 验收结果

> ⚠ **本节的数字是"第 5 期首次交付时"的快照**（§17.1–§17.9 同理）。
> 之后的**同日追加改动**把其中几项抬高了 —— **以文件头部的状态块与 §0.2 的基线表为准**：
>
> | 项 | 首次交付（本节） | **当前** | 由谁改动 |
> |---|---|---|---|
> | 门禁 ㉒ 取证条数 | 158 | **188** | §17.10（read_image）· §17.11（P1–P3） |
> | ⑱ Prompt 取证 | 83 | **95** | §17.10 |
> | ⑲ 编排取证 | 73 | **101** | §17.10 |
> | `contractHash` | `a1a3e6fd…` | **`1ff98c44…`** | §17.10（阶段枚举新增 `read_image`） |
> | 契约产物 | 18 份 | 18 份（数量不变，内容变） | §17.10 |
> | 世界书内容覆盖 | —（口径未定） | **0/111**（真口径，§17.11 P3） | §17.11 |

**门禁：⓪ 覆盖自检 + 二十二步全绿，exit 0**

```
⓪ 覆盖自检            候选 17 个检查脚本全部挂载 · **源文本解析的 STEPS 与内存一致（22 条）**
① 契约同源校验        contractHash = a1a3e6fdbe89c5420192805549bad77c9f79fb00b70d472a3e523ddab34729c9（18 份产物）
② SDK 签名摘要        27 个函数（Draw 23 · Phys 4）
③ Dry-Run C1–C9       通过 15 · 告警 0 · 失败 0 · 关键帧 67 个
④ 负向注入验收        12 条全部被拦下 + 后端一致性对照通过
⑤ 埋点自检            15 题 × 4 个代码型槽位逐条断言
⑥ C1 判据取证         C1 25 条 + ANSWERS 结构 6 条
⑦ 渲染路径自检        15 题全过
⑧ 公式预渲染          15 题 · 207 条公式
⑨ 成品页打包          15 题 + 1 空壳
⑩ 成品页静态体检      18 个页面
⑪ 长度上限            最大 147/150（q02）· Draw.raw 全题 0.00%
⑫ 总览页生成          15 题通过
⑬ 前端类型检查        tsc 严格模式通过
⑭ 前端打包            + 产物体检 + **4 条第 5 期新判据**（见下）
⑮ 契约跨字段校验      37 条
⑯ 模型网关            63 条
⑰ 标记切分清洗        53 条
⑱ Prompt 系统         83 条（第 5 期 +10：分槽标记与"本阶段指令"标签）
⑲ 编排               73 条
⑳ 宿主协议            69 条
㉑ 自愈循环与 C7 强化  129 条
㉒ 世界书              **158 条**（本期新增）
```

**第 5 期新增的构建期判据（门禁 ⑭，都跑了负对照的思路）**：
浏览器侧引擎副本与本源**逐字节一致** · `worldbook-engine.d.ts` 的声明集合 **==** `engine.mjs` 的导出面 ·
导出包常量 **==** 契约的 `format.const` / `version.const` · 解题页的世界书依据数据**来自真引擎**（命中非空且哈希等于库哈希）。

**逐条验收条件**：

| 验收条件 | 结论 | 证据 |
|---|---|---|
| 传送带题命中词条并**递归唤醒**共速判据 | ✅ | ㉒『W4』（A 命中 → 唤醒 B，`from === A`）＋ 真实内置库上『W15』预览器命中 3 条；**真词条复跑留到第 5.5 期**（见 17.5 偏差 1） |
| 单槽词条只影响对应槽位 | ✅ | ㉒『W6』（solve-only 时 `scene_code` 槽为空且进 `emptySlots`） |
| 两槽都无命中时链路正常 | ✅ | ㉒『W7』（空槽静默跳过、不报错、不告警；且与"被截断"在数据结构上分开） |
| **预览器与实际请求逐字一致** | ✅ | ㉒『W10』：真编排的 system 消息 vs 浏览器侧引擎副本算出的条件段，**逐字节比对**（solve 与 scene_code 各一条） |
| 旧名归一化只发生在导入路径 | ✅ | ㉒『W12』正反例 + 反例"内部不接受旧名" |
| origin 治理四条 | ✅ | ㉒『W13』（含**临时目录里的真实文件往返**：写盘 → 覆盖 → 删除 → 恢复默认 → 坏文件整批失败） |
| 自检条款覆盖率可机检 | ✅ | ㉒『W14』（结构合规 100%；两条负对照把覆盖率打下来） |

**不许退步的基线（第 4 期 → 第 5 期）**：

| 项 | 第 4 期 | **第 5 期实测** |
|---|---|---|
| C1–C9 | 15/15 · 0 告警 · 0 失败 | **同（未退步）** |
| 负向注入 | 12/12 拦下 + 对照 | **同** |
| `Draw.raw` 使用率 | 0.00% | **同** |
| 长度上限 | 最大 147（q02） | **同** |
| 成品页 / 静态体检 | 18 页全过 | **同** |
| 公式 | 207 条 | **同** |
| C7 逐题判定 | 与第 3 期基线逐字一致 | **同** |
| 冻结项 | §3 / §9 / §11.2 / §7.2 一字未改 | **一字未改** |

**唯一变化的基线是 `contractHash`**（`5fce7c7b…` → `a1a3e6fd…`），原因是**新增**第 7 份契约
`worldbook-pack`（16 份产物 → 18 份）。**前 6 份契约的字段形状一字未改**（由 `contracts:verify` 的逐字节比对保证）。

### 17.3 本期的口径决定（**需要你知道，逐条都留了开关或理由**）

1. **`keys: []` + `recursive: true` 怎么被唤醒**（A11）：§9.2 说"仅可被递归唤醒"，
   但递归仍按主键匹配 ⇒ 无键词条**永远不可能**被唤醒。本实现取"让那句话成立"的读法：
   被唤醒正文里出现它的 `title` 时唤醒。一个常量（`WAKE_BY_TITLE_FOR_KEYLESS`）可一键改回。
2. **命中强度刻度**（A12）：§9.2 只说"按 `priority → order → 强度` 排序截断"，没定义强度。
   本实现取 `key 4 / secondary 3 / constant 2 / recursive 1`（越直接越强）。
3. **`maxChars` 计什么**（A13）：计**渲染后的整块文本**（含 `【世界书·…：标题】` 来源标记）——
   那才是真正进上下文的字符量；用正文长度会系统性少算。
4. **归一化只作用于字面量 key**（A14）：字面量 key 匹配归一化文本，正则 key 匹配**原始文本**
   （正则作者自己写了 flags，再喂归一化文本会把 `/[A-Z]/` 这类写法悄悄破坏）。
5. **"本阶段指令"改用独立标签**（A16）：`【本阶段指令：<label>】`。
   第 3 期起它与世界书词条**共用** `【世界书·解题：…】`，真词条进来后溯源就分不清
   "这条是命中词条还是阶段指令"。世界书词条的标记格式**一字未改**（§9.2 冻结）。
6. **内容生产顺延第 5.5 期**（A15，用户裁决）：本期 W14 只交付**机制**，覆盖率报告会如实写"内容覆盖未完成"。

### 17.4 本期修掉的缺陷（含两处"我第一版做错了"）

| # | 缺陷 | 为什么危险 |
|---|---|---|
| 1 | **`parseKey` 多了一条判 `/…/` 的分支**（第一版） | 那条分支把 `regex` 停在 `null`，后续 `matchKey` 会调 `null.test(...)` ⇒ **TypeError 崩在解题路径上**。写完立刻自查发现（一行多余的分支就够埋雷） |
| 2 | **`scanKeys` 遇到第一个坏 key 就 `return`**（第一版） | 后果是"同一词条里写在坏 key 后面的合法 key **永远不被尝试**"——表现是"明明写了关键词却从不命中"，最难查的静默失败。**被 ㉒『W1』的断言逮住** |
| 3 | **条件段的两个组成部分用 `split('\n\n')` 反推**（第一版） | 词条正文里本来就有空行 ⇒ 会把正文切碎。改成由 `engine.buildSlotConditional()` **返回**两块，并加了断言（"正文里的空行不会把条件段切碎"） |
| 4 | **Rollup 的 `redirectAssetsToSrc` 只取 `basename`** | 第 5 期的 `../lib/worldbook-engine.js` 一带目录就解析不到；报错是 Rollup 的 "Could not resolve"，**指不到"少拼了一段路径"**。改为用完整相对路径 `resolve` |
| 5 | ⚠ **历史缺陷：覆盖自检的 CLI 读法从第 4 期起就漏解析多行 `STEPS`** | 那条正则要求第二个字符串后**紧跟 `]`**，而 `㉑` 是"多行 + 尾随逗号"写法 ⇒ `node tools/verify-coverage.mjs` 一直把 `tests/repair-selftest.mjs` 报成"没被挂载"（假阳性）。**而门禁走的是内存里的 `STEPS`，所以全绿** —— 又一次"两条路径、只有一条被测过"。已修，并在 ⓪ 里加了"两种读法必须逐项一致"的断言 |
| 6 | `emitDryRunDone` 原先**不发 `provenance`** | §14 要求导出 HTML 烧录 Provenance，而导出用的正是这份载荷 —— 少了它，导出产物无法回答"它是用哪套规则生成的"。本期补上 |
| 7 | 写盘的导出包里顺手加了 `note` 字段（第一版） | 契约的 `additionalProperties` 为 false ⇒ 写出的文件立刻不合契约，而"整批失败"的载入逻辑会让它**连自己都读不回来**。自检发现并删掉，并在注释里写明理由 |
| 8 | 生成物里写 `as const` | 会把 `insertion_slot` 变成 `readonly ["solve", …]`，而 `readonly string[]` **不能**赋给 `string[]` ⇒ 整个设置页的 `tsc` 报一串看不出原因的错。已在生成器注释里钉住这条 |

> **贯穿本期的教训（与第 3、4 期同源）**：**"绿着但没跑"比"红"更危险。**
> 缺陷 5 就是活例子：门禁绿了四期，而它自己的一条读取路径一直在撒谎。
> 本期因此把"两种读法一致"也变成了一条断言。

### 17.5 偏差、边界与待裁决

**本期新产生的偏差**：

1. **W14 的"内置 44 条 + 视觉词条（覆盖率 100%）"顺延到第 5.5 期**（用户 2026-10 裁决）。
   本期交付的是**机制**（覆盖率校验器 + 数据结构 + 命名/`order` 规范 + 唯一作者入口脚本）与**最小集 5 条**。
   ⚠ 因此**不能**说"W14 已完成"：本期只做到"**已存在的内置词条**结构合规 100%"，
   **题型覆盖进度**在覆盖率报告里**明确标为"未完成（第 5.5 期）"**，且它不进本期的完成判定。
2. **`contractHash` 变化**（`5fce7c7b…` → `a1a3e6fd…`）：新增第 7 份契约（`worldbook-pack`）与 2 份产物。
   **不是**字段形状变化。
3. **`engine.mjs` 一份文件承担了 §16.10 草案里的三个文件**（`trigger` / `budget` / `assemble`）：
   因为它们必须**整体**被复制到浏览器侧，拆开会让"逐字节副本"变成三份副本、三个判据。
4. **新增了两份工具**（草案里没有）：`tools/build-worldbook-web.mjs`（生成浏览器侧引擎副本 + 演示数据）、
   `tests/worldbook-selftest.mjs` 的『W14』会 import `tools/rewrite-worldbook-entries.mjs` 的
   `plannedFiles()` 来断言"盘上的内置库 == 脚本会写出的内容"。二者都在覆盖自检里**带理由豁免**（子是"子步骤"而非"漏挂"）。
5. **`worldbook_done` 是新增事件**（`EVENT_TYPES` 追加在末尾，不动既有事件）；前端 `RunEvent` 同步加了该成员。

**继承自前几期、本期未动的边界**（仍然成立）：前端跑的是**演示源**
（`dryrun_done.verdict = skipped`，**不谎报 pass**）；前端的公式是占位排版、成品页才是 MathJax 真 SVG；
§12 正则**仍无真墙钟超时**；真端点联调仍需你的 Key；**真浏览器像素级取证无入口**（C1）。

**本期新增的边界**：设置页的编辑**写不回** `ai-rules/worldbook/`（没有本地服务，见 B7）；
浏览器侧导入**只做形状提示**（完整校验与旧名归一化在 Node 侧，见 B8）。

### 17.6 ★ 第 5 期踩过的坑（**改代码前先读这一节，别去试**）

沿用 14.6 的 A/B/C 三类，本期新增的按类归入：

**A 类（判据类，本期新增 3 条）**

1. **"两条实现路径只测了一条"是本期最贵的形态。** 覆盖自检有"内存 `STEPS`"与"读源文本解析"
   两条读法，门禁只跑前者 ⇒ 后者坏了四期没人知道（17.4 缺陷 5）。
   → **凡是同一件事有两个入口，就要有一条断言钉住"两个入口给出同一个答案"。**
2. **夹具把被测语义喂成另一回事**（第 4 期已记，本期再次遇到）：`E()` 夹具必须**填满不相关字段**，
   否则"某字段缺失"会被当成被测行为。
3. **`as const` 会把 `readonly` 传染给类型**：生成物里一个 `as const` 就能让消费端的 `tsc` 报一串
   与真正原因无关的错。生成**数据**时不要 `as const`。

**B 类（工程类，本期新增 3 条）**

4. **用管道截命令输出会让退出码变成假的 1。** 本期两次因此误判"门禁失败"——
   而真实退出码是 0。**要判退出码就不要接管道**（要留证据就重定向到文件再读）。
5. **"给写盘函数顺手加个字段"会立刻违反契约**（缺陷 7）：契约是 `additionalProperties: false`，
   而读回来的路径又是"整批失败" ⇒ 一次手滑就能让整库读不回来。
6. **"绿着但没跑"的另一种形态：数据是空的时候，功能看起来一切正常。**
   解题页的世界书依据面板在**空词条集合**上也能渲染得很好看 ⇒ 增加了一条构建期判据要求
   "命中的条目非空且哈希等于库哈希"。

**C 类（本沙箱 / 本仓库专属，本期新增 2 条）**

7. **改世界书引擎后必须重跑三件事**（漏一件就会让"预览器 = 真实请求"变成一句口号）：
   `node tools/build-worldbook-web.mjs`（重新复制引擎副本）→ `node tools/web-build.mjs`（构建期判据会核对副本与本源）
   → `node tests/worldbook-selftest.mjs`（㉒『W10』逐字节比对）。
   **正常情况下跑一次 `node tools/verify-all.mjs` 就全盖住了。**
8. **内置词条不要手改 JSON**：内置库由 `tools/rewrite-worldbook-entries.mjs` 生成，
   ㉒『W14』会断言"盘上的 == 脚本会写出的"，手改会被门禁拦下（这是**有意的** ——
   手改 JSON 会让"哪个是权威"变成疑问）。要改内置词条 → 改脚本里的 `LAYERS` → 重跑脚本。

### 17.7 §21.3 每期自查清单（逐条结论）

- [x] **本期交付项全部可用，无占位符、无未完成分支。** 见 17.1；设置页与解题页面板的每个区域都能跑通；
      唯一"未完成"的是**内容生产**，它被**显式标注**在界面上（覆盖率面板写"内容覆盖：未完成 —— 第 5.5 期"）
      与门禁输出里，不是占位符。
- [x] **本期新增/修改的契约已写入 `contracts/` 并在文档中同步。** 新增 `worldbook-pack`
      （schema + TS 类型，同源生成）+ 3 条编译期不变量断言（各配负对照）；`contracts:verify` 逐字节比对通过。
- [x] **C1–C9 中本期涉及项可独立触发并有测试。** —— **世界书不进 C1–C9**（16.4 第 1 条）；
      本期的判据全部落在门禁 ㉒（158 条），且**没有新增检查号**。
- [x] **回归题集通过率与上一期对比无回退。** 15/15 · 0 告警 · 0 失败；12 条负向注入全部拦下；
      `Draw.raw` 0.00%；18 页体检通过；**C7 与基线逐字一致**；长度上限内。
- [x] **无新增外部依赖。** 根 `package.json` / `package-lock.json` / `web/package.json` **逐字节未变**；
      世界书用的是既有的 `node:crypto` / `node:fs` 与前端既有的 React/zustand。
- [x] **取消、错误、空态、降级四种路径均已手动走通（含"空槽静默 / 截断告警"这一对）。**
      取消：管线取消路径未改（㉑『C』仍绿）；错误：坏词条文件 ⇒ **整批失败**且 `entries` 为空（㉒『W13』）；
      空态：空槽静默 + 预览器显式说"本次没有任何词条命中"（㉒『W7』『W15』）；
      降级：预算截断 ⇒ 明确告警 + 面板分开显示（㉒『W5』『W7』）。
- [x] **本轮遗留问题与冲突已写入交付说明（并回填 §16.7 的挂账总表）。** 即 17.4 / 17.5 / 17.6；
      A10 已裁决、B2 已收口，新增 A11–A16 / B7–B10 / C9。

### 17.8 交付落点（把改动同步回你的仓库）

**新增文件**：

```
core/worldbook/engine.mjs             §9.2 触发六步 + 分槽组装 + 来源标记 + 冲突提示（**纯逻辑，浏览器侧要逐字节复制它**）
core/worldbook/store.mjs              仓库：内置只读 + ai-rules 用户区 + 校验 + 规范化 + 稳定哈希 + 原子写
core/worldbook/governance.mjs         origin 治理的纯决定（覆盖副本 / 升级 / 恢复默认 / 导出）
core/worldbook/import-export.mjs      od-worldbook v1 + 旧名归一化（只在此处转换）
core/worldbook/coverage.mjs           「生成后自检」+ code_examples 覆盖率（内容进度与结构合规分开）
core/worldbook/index.mjs              入口聚合 + loadWorldbookOrThrow + mergeWorldbookStages + prepareWorldbook
core/worldbook/data/00-meta.json      内置最小集：符号约定（常驻）+ 兜底
core/worldbook/data/10-conveyor.json  内置最小集：传送带（双槽）+ 共速摩擦突变判据（被递归唤醒）
core/worldbook/data/90-visual.json    内置最小集：场符号铺陈与矢量标注规范
ai-rules/worldbook/README.md          用户区说明（两个抽屉的分工、格式、易踩点）
contracts/worldbook-pack.schema.json  生成物（第 7 份契约）
contracts/types/worldbook-pack.d.ts   生成物
tests/worldbook-selftest.mjs          门禁 ㉒（158 条取证）
tools/rewrite-worldbook-entries.mjs   内置词条的**唯一作者入口**（改 LAYERS → 重跑；打印将被覆盖清单）
tools/build-worldbook-web.mjs         生成浏览器侧引擎副本 + 内置词条/覆盖率/依据数据的构建期快照
web/src/pages/SettingsPage.tsx        设置页：世界书管理器 + 实时试触发预览器 + 冲突提示 + 导入导出
web/src/lib/worldbook-engine.js       **生成物**：engine.mjs 的逐字节副本（构建期判据钉住）
web/src/lib/worldbook-engine.d.ts     engine 副本的类型声明（导出面由构建期判据核对）
web/src/lib/worldbook-demo.ts         **生成物**：内置词条 + 覆盖率 + 导出包常量 + 世界书依据数据
```

**修改文件**：

```
contracts/spec/contract-fields.mjs    新增 worldbookPack 契约描述子
contracts/_compile.mjs                §9.5 三条编译期不变量断言（含负对照）
core/prompts/fixed-prefix.mjs         buildConditionalSegment 支持分槽 + 指令标签；assemblePrompt 支持 instructions/stageSlot/worldbookSegment
core/prompts/index.mjs                （导出面不变）
core/orchestrator/events.mjs          EVENT_TYPES 新增 worldbook_done
core/orchestrator/pipeline.mjs        世界书进快照（深拷贝+冻结）；逐阶段触发；worldbook_done；provenance 取真值；program 载荷带 provenance
tools/verify-all.mjs                  二十一步 → **二十二步**（新增 ㉒）；⓪ 新增"两种读法一致"断言
tools/verify-coverage.mjs             修 CLI 读法（多行 STEPS 尾随逗号 + 过滤非 .mjs 的字符串数组）；新增两条豁免（附理由）
tools/web-build.mjs                   ⓪ 段调用世界书生成器；新增 4 条构建期判据
web/rollup.config.mjs                 redirectAssetsToSrc 支持"生成但不转译的 .js"（改为按完整相对路径解析）
web/src/lib/run-stream.ts             WorldbookEvidence / WorldbookProvenance / ProgramProvenance 类型；worldbook_done 事件；演示源发世界书依据
web/src/state/store.ts                RunState.worldbook + applyEvent 处理 worldbook_done
web/src/pages/SolvePage.tsx           「世界书依据」面板
web/src/App.tsx                       第三个页面（设置）+ 导航 + 期次文案
web/src/styles.css                    .input / .label 两个表单组件类
tests/prompts-selftest.mjs            第 5 期 +10 条（分槽标记 / 指令标签 / 条件段不靠分隔符反推）
tests/orchestrator-selftest.mjs       detectStage 改用新标签（保留旧标记兜底）
tests/repair-selftest.mjs             同上
README.md                             本第十七节 + §0 五期一览 + 挂账总表回填
```

**重新生成（跑一次门禁即可）**：`contracts/*`（18 份）· `tests/reports/*` · `template/build/*` ·
`物理动画原型总览.html` · `web/dist/*` · `web/src/lib/demo-questions.ts` ·
`web/src/lib/worldbook-engine.js` · `web/src/lib/worldbook-demo.ts`。

### 17.9 第 5.5 / 第 6 期入口

**第 5.5 期：世界书知识库内容生产 —— ✅ 可以直接开工（入口已就位）**

- **入口条件已满足**：作业书 **`世界书知识库生成指导.md`** 已产出（自包含，新会话可独立执行）；
  工程前置 **P1–P3 已落地**（§17.11）；**三项口径已由用户裁决**（见下）。
- **开工方式**：开一个新会话，把作业书 **§12 的开场白**整段粘进去。它会先读作业书与 `core/worldbook/coverage-target.json`，
  然后从**第一个 `entryId` 为 `null` 的题型**（1.1 匀变速直线运动的三大推论）开始，一题一题往下做（同会话内自动继续）。
- **三项口径（已裁决，不必再问）**：
  ① **覆盖范围全收**（第 16 章电磁波 / 第 18 章近代物理 / 22 个实验题型**都做**）；
  ② **111 个题型全收**，但**词条按"物理模型"收敛**（目标 45–60 条，一条词条可覆盖若干相邻题型）；
  ③ **图全读**，权威来源是**笔记电子版 png**（教学素材里的图，**已从仓库移除**，见 §17.12）。
- **素材**（原始教学素材，**已从仓库移除**）：
  `笔记电子版/`（**2603 张 png** 带题型编号 + **486 个真矢量 .eps** + 一份 docx；**图的权威来源**）·
  一份 4 万余行的文本化稿（**文本来源**，唯一保住公式与表格的机器可读版本；已从仓库移除）·
  旧版 `ai-rules`（30 条解题 skill + 14 个动画 skill + 现成关键词表；**JSON 架构已废弃，只取题型与关键词**）·
  另一位教师的 Agent skill（`SKILL.md` + 6 份学科参考手册；**只取覆盖地图与"自检清单/易错点"的思路**）。
- **落点**：词条写进 `core/worldbook/source/*.json`（**不是**脚本内联了，§17.11 P1）；
  覆盖率/撞车/进度三者由 `tools/rewrite-worldbook-entries.mjs` 一并打印，进度填在 `core/worldbook/coverage-target.json`。

**第 6 期：可配置化完全体（§18 期 6）**：Prompt 编辑器 · 清洗规则编辑器 ·
端点管理完整校验 · 规则工作区（SHA256 / 原子载入 / 热重载）· 答案结构模板。
设置页的骨架本期已就位（`.input` / `.label` 与三栏布局可直接复用）。
⚠ 其中"端点与分阶段模型配置界面 + 测试连接"是 **C3**（后端第 3 期就全做完了，只差界面）。

---

### 17.10 第 5 期追加改动（同日裁决）：执行链第 0 步 —— **读图转写 `read_image`**

> **为什么追加**：第 5 期收尾后讨论"**图片题怎么办**"时发现一个结构性缺口 ——
> 世界书的第一次触发发生在**发请求之前**，而图片不是文字 ⇒
> **纯图片题在第一轮没有任何可匹配的文本**（实测：只会命中"常驻"词条 1 条）。
> 用户 2026-10 裁决：**新增一个阶段，放在第 0 步**，先把图转成结构化文字。
>
> **用户对四件事的裁决**：① 阶段名 `read_image` / 中文标签「读图转写」✅；
> ② **纯文字题跳过**它 ✅；③ `solve`（解题）**继续带图** ✅；④ **现在就改完** ✅。

#### 它解决什么

```
图片 ──第 0 步（新）──▶ 结构化转写文字 ──┐
                                        ├─▶ 世界书第 1 次触发（终于有文本可匹配）
题面文字 + 用户手打的描述/已知条件 ──────┘        │
                                                ▼
                                     命中知识 ──▶ 解题（带图复查）──▶ … ──▶ 动画代码
```

**转写要求**（写在 Prompt 里，**不给它世界书槽位**）：按【题面复述】【物体与姿态】
【相对位置与朝向】【尺寸与比例】【已知量与标注】【图中文字与符号】【不确定之处】分节输出；
**不解题、不给答案**；**沿用题面与图片里的原词**（换同义词会让后续检索找不到规范）；
**看不清就写"图中未标注"**（编一个"看起来合理"的图，比承认看不清危险得多）。

其中【相对位置与朝向】一节**专门针对"斜面画反"**：斜面哪一端高、运动朝哪、正方向朝哪，必须写死。

#### 为什么把"转写规范"放进 Prompt 而不是世界书词条

因为**第 0 步自己吃不到词条**：它的触发条件其实是"这次带图"，而 §9.2 的触发引擎**只认文本**
（这也是一条挂账：**A20**）。而"怎么把图转写成文字"是**对所有题都一样的阶段契约**，
按 §9.6 的分工本就该写在 Prompt 里 —— 于是这条缺口被顺手消化掉了，**不必**改冻结契约。

#### 验收结果（门禁 ⑲『A-3』15 条 + ⑱『D-3』12 条，全绿）

| 情形 | 行为 | 证据 |
|---|---|---|
| **纯文字题** | 跳过：发 `stage_done` + `skipped:true` + **原因**；**不调模型**；不发 `stage_start` | ⑲『A-3』① |
| **图片题** | 第 0 步真的跑；**转写文字进入世界书扫描文本**（正反例：转写里有/没有"传送带"） | ⑲『A-3』②（正例命中夹具词条、反例不命中） |
| 模型调用次数 | 纯文字题 4 次；图片题 **5 次** | ⑲『A-3』①② |
| **视觉门控**（§11.3） | 带图但 `supportsVision !== true` ⇒ `stage_error` 停下，**0 次模型调用**，并给"换模型 / 手打配图描述"的建议 | ⑲『A-3』③ |
| 图片只进哪些阶段 | `read_image` 与 `solve`（其余阶段仍是纯文本） | ⑲『E-3』 |
| **纯图片题的运行标题** | 开跑时题面为空 ⇒ 先显示「(未命名题目)」；读图转写跑完后发一条 **`run_label`** 用转写的第一句内容回填（**剥掉**`【题面复述】`这类小标题、剥掉 Markdown 装饰、超 40 字截断）；**纯文字题不回填**（用户打了题面就用他的话） | ⑲『A-4』（含取标签规则的 6 条单测 + 正反例） |
| 前端展示 | 进度条把跳过的阶段显示为**「（已跳过）」**（虚线框 + 悬停原因），与"做完了"明确区分 | 构建产物字符串取证 + `stageStatus:'skipped'` |

#### 一处顺带修掉的老缺口（**缺口 1**）

原来世界书的扫描文本**只有 `problem.text`** —— 用户手打的**配图补充描述**与**已知条件**
（§11.3 的人工兜底入口）**根本不参与匹配**，等于"填了也白填"。
现在两个槽位都扫「题面 + 描述 + 已知条件 + **读图转写**（+ 解题文本）」——
这既修掉了老缺口，也让第 0 步的产出真正接进了触发链。

> ⚠ 这条修法对**旧行为**是一处可见变化：以前只靠题面就能命中的，现在**靠描述也能命中**了
> （命中集合**只可能变多、不会变少**）。对既有 15 题回归**无影响**（它们不跑管线）。

#### 偏差（**必须记账**）

1. **§2.3 的阶段枚举新增了一项 `read_image`。** §2.3 是**定案值**（不在 §3 / §9 / §11.2 / §7.2
   四个**冻结项**之内），按 §21 的"发现冲突先报告再动"要求，本次已**先取得用户裁决**再改。
   ⚠ **方案文档本身不改**（它是唯一依据），偏差记在这里。
2. **连带改了 3 份契约产物的内容**（端点契约的"分阶段模型"键、清洗规则的 `stage` 枚举、
   以及 `CleaningStage`），`contractHash` 由 `a1a3e6fd…` 变为 **`1ff98c44…`**。
3. **`read_image` 的 Prompt 落在 `EXTENSION_PROMPTS`**（与第 4 期的 `repair` 同一处置），
   因此 **§10.1 的清单仍是恰好 6 项**（门禁里有一条断言钉着）。
4. **新增阶段不挂世界书槽位**：§9.1 的"槽位名 = 阶段名"仍是 **2 个**（`solve` / `scene_code`）。
5. **`read_image` 属于"有模型文本产出"的阶段**，因此它同时进入了 §12 的清洗 `stage` 枚举。

#### 本期追加改动修掉的缺陷

| # | 缺陷 | 为什么危险 |
|---|---|---|
| 9 | **`promptHash` 曾经只在"第 0 个阶段"上报** | 第 0 步会**被跳过** ⇒ 纯文字题的 `promptHash` 一次都不上报，`provenance.promptHash` 也跟着变回 `null`。**是门禁 ⑲『A』（"promptHash 只报一次"，实际 0 次）把它逮住的**；改成"第一个真正组装了提示词的阶段报一次" |
| 10 | **`validate.mjs` 里藏了第二份清洗 stage 清单** | 它自己写了一份 `['solve',…,'distill']`，与 `frozen-keys.mjs` 的 `CLEANING_STAGES` 是**两个事实来源**，各自漂移不会被发现。已改成直接引用冻结常量 |
| 11 | **§12 的编译期不变量是"手写字符串比对"** | 扩枚举时**必须记得**回来改那一行，忘了就静默放过（守卫最不该有这种性质）。已改成**结构断言**：清洗枚举 == 主链路枚举去掉 `dry_run`/`repair`，顺序也一致 |

#### 追加改动的落点

```
contracts/spec/frozen-keys.mjs     PIPELINE_STAGES / CLEANING_STAGES 前置新增 read_image；新增 CLEANING_EXCLUDED_STAGES
contracts/_compile.mjs             §12 不变量改为结构断言（并新增"排除项不得进入"）
contracts/validate.mjs             删掉本地重复的清洗 stage 清单，改为引用冻结常量
core/orchestrator/events.mjs       新增 PHASE5_STAGES（当前链）与 MODEL_STAGES；PHASE4_STAGES 降为留档；EVENT_TYPES 新增 run_label
core/orchestrator/index.mjs        导出 PHASE5_STAGES / MODEL_STAGES / deriveEntryLabel
core/orchestrator/pipeline.mjs     第 0 步（跳过/视觉门控/带图）；扫描文本补全（描述+已知条件+转写）；promptHash 上报口径修正；deriveEntryLabel + run_label 回填标题
core/prompts/templates.mjs         EXTENSION_PROMPTS.read_image（读图转写的阶段契约）
web/src/lib/run-stream.ts          STAGE_CHAIN/STAGE_LABEL 加 read_image；stage_done 支持 skipped/reason；RunEvent 加 run_label；演示源发"跳过"
web/src/hooks/useRun.ts            初始阶段链
web/src/state/store.ts             stageStatus 支持 'skipped' + stageSkipReason；处理 run_label
web/src/pages/SolvePage.tsx        进度条显示「（已跳过）」与原因
tools/web-build.mjs                阶段链判据改用 PHASE5_STAGES
tests/prompts-selftest.mjs         『D-2』扩到 2 个扩展 Prompt；新增『D-3』读图转写 12 条
tests/orchestrator-selftest.mjs    新增『A-3』15 条 + 『A-4』13 条；『E-3』改为"图片进两个阶段"；进度索引改用 PHASE5_STAGES
tests/repair-selftest.mjs          阶段常量改用 PHASE5_STAGES
tests/worldbook-selftest.mjs       "不注入词条"的阶段加上 read_image
```

**交付说明**：见 `世界书知识库生成指导.md`（第 5.5 期作业书）。

**重新生成**：与 17.8 同一份清单（跑一次门禁即可）。

---

### 17.11 第 5 期追加改动（同日）：第 5.5 期的三项工程前置 **P1–P3**

> **背景**：`世界书知识库生成指导.md`（第 5.5 期作业书）列出了 4 件"开工前必须做的工程改动"。
> 用户 2026-10 裁决：**P1/P2/P3 现在就做**（留在本会话，因为要动的是刚建好的门禁），**P4 取消**。
>
> **P4 取消后的替代**：不再单独开一个断点文件 —— **进度与待办台账都写进 P3 那个文件**
> （`coverage-target.json`：`targets[].entryId` 是进度，作者另外加的 `openQuestions` / `tokenLog`
> 等顶层字段由生成器**原样保留**）。**一个文件顶两个**，少一个会漂移的地方。

| # | 交付 | 落地位置 | 取证 |
|---|---|---|---|
| **P1** | 内置库的通道改成 **`source/`（人写）→ `data/`（派生）**；脚本只做"读源 → 校验 → 治理报告 → 覆盖率 → 撞车提示 → 写库" | `core/worldbook/source/*.json`（新增）· `tools/rewrite-worldbook-entries.mjs`（重写） | ㉒『W14』（`data` == 从 `source` 会写出的，逐字节）·『W14-2』（源与库条数一致、源文件与库文件同名、格式就是 §9.5 导出包） |
| **P2** | **触发词撞车检查** `detectKeyCollisions()` | `core/worldbook/engine.mjs`（+ `detectConflicts` 汇总 · 设置页自动显示 · 改写脚本打印） | ㉒『W14-3』11 条（含 4 条负对照） |
| **P3** | **覆盖目标 + 进度**（111 个题型从书上自动抽取；`entryId` 人工填、**重新生成时保留**；未知顶层字段也保留） | `core/worldbook/coverage-target.json`（新增）· `tools/build-worldbook-targets.mjs`（新增）· `core/worldbook/coverage.mjs`（`targetFromFile()` + 永远说得出"还差多少"） | ㉒『W14-2』16 条（含"填一个 entryId ⇒ 覆盖数 +1"与"全部填满 ⇒ `contentComplete` 翻转"两条负对照） |

**实测口径落地**：目标 **111 个题型 / 19 章**（脚本从书上抽出来的，不是我手数的）；
覆盖率一行结论现在会打印 **`覆盖进度 0/111（第 5.5 期）`** —— "还没做"这件事自己说得出来。

**本期追加改动修掉的缺陷**：

| # | 缺陷 | 为什么危险 |
|---|---|---|
| 12 | **`targetFromFile()` 只返回 `coveredIds`（数组），没返回 `covered`（计数）** | 调用方（门禁 / 脚本 / UI）都得自己数一遍；我写断言时**当场踩了**：`covered` 是 `undefined` ⇒ `111 - undefined = NaN` ⇒ 三条断言静默地比了个 NaN。补上 `covered` 字段，并让形状自描述 |
| 13 | **`data/` 里可能残留 `source/` 已不存在的文件** | 那些文件会被 `loadLibrary` 当成**正式词条**载入（用户看到的是"删了却还在")。现在 `--check` 会明确报出来并失败，写盘模式打印提示，`--prune` 可选删除（**默认不删** —— 本仓库没有 git，删除不可逆） |

**落点**：

```
core/worldbook/source/00-meta.json · 10-conveyor.json · 90-visual.json   ← P1：词条源（由现有 data/ 逐字节迁移）
core/worldbook/coverage-target.json                                      ← P3：目标 + 进度 + 待办台账（生成物，entryId 人工填）
tools/build-worldbook-targets.mjs                                        ← P3：从书抽取目标题型（保留 entryId 与未知字段）
tools/rewrite-worldbook-entries.mjs                                      ← P1：重写为"源 → 库"的通道（含 --check / --prune）
core/worldbook/store.mjs                                                 ← SOURCE_DIR / COVERAGE_TARGET_FILE / readCoverageTarget()
core/worldbook/coverage.mjs                                              ← targetFromFile() · reason 永远说得出进度 · formatCoverageLine 带进度
core/worldbook/engine.mjs                                                ← detectKeyCollisions()（+ 并入 detectConflicts）
web/src/lib/worldbook-engine.d.ts                                        ← 补 detectKeyCollisions 声明（构建期判据要求导出面一致）
（生成物）web/src/lib/worldbook-engine.js                                 ← 重新逐字节复制
tools/build-worldbook-web.mjs                                            ← 覆盖率演示数据带真口径（111 个题型）
tools/verify-coverage.mjs                                                ← 新增 build-worldbook-targets.mjs 的豁免（附理由：子步骤）
tests/worldbook-selftest.mjs                                             ← 『W14』改造 + 新增『W14-2』『W14-3』（158 → 188 条）
世界书知识库生成指导.md                                                   ← 第 5.5 期作业书（新增；P1–P3 标记完成、P4 取消、单文件进度口径）
```

---

### 17.12 素材变更（同日）：**笔记电子版**到位，"图看不清"这个头号风险解除

> **背景**：此前实测的图来自 OCR 抽取（中位 **303×216**，最大 780×702），
> 我当时把"图够不够清楚"列为第 5.5 期的**头号不确定性**，并请用户提供原 PDF。
> 用户随后说明**没有 PDF**，但提供了**笔记电子版**（教学素材，**已从仓库移除**）。

**实测（这是一次独立的、可复核的测量）**

| 来源 | 数量 | 尺寸 | 文件名 |
|---|---|---|---|
| OCR 抽取 jpg（原用） | 2508 | 宽中位 303 / 高中位 216 / 最大 780×702 | SHA256 命名，**不带题型信息** |
| **笔记电子版 png（改用）** | **2603** | 宽中位 **412** / 高中位 **295** / 最大 **1206×954** | **带题型编号**（`笔记4.3原型题1.png`）**且按章分目录** |
| 矢量 `.eps`（最后手段） | 486（第 7/16/17/18 章） | 中位 279 KB，最大 1.65 MB | 真 PostScript（`%!PS-Adobe-3.0 EPSF-3.0`，前面带二进制预览头） |

**抽样实测（两张最难的图，都已人工判读）**

| 题型 | 图 | 尺寸 | 结论 |
|---|---|---|---|
| 19.4 伏安特性曲线 | `19/笔记19.4-1-2.png` | 408×373 | ✅ 电压表 V / 电流表 A 的表盘与 **± 极性**、滑动变阻器的**滑片与四个接线柱**、蓄电池正负极、开关刀闸 —— 全部分明（**实物连线图**是最难的一类） |
| 13.8 带电体在复合场中 | `13/笔记13.8原型题10.png` | 687×328 | ✅ 向下**电场箭头**与带电体 `P`(⊕)、竖直**虚线边界 `MN`**、密铺的 `·` **磁场符号**、底部编号物体 `1 2 … n` —— 几何朝向、场区边界、场符号类型都能判读 |

⇒ **"几何朝向"（谁在左谁在右、哪边高）与"关键标注"（元件符号 / 场区边界 / 坐标轴）在电子版 png 上可以判读。**

**因此做的三件事**：

1. **图的权威来源改为电子版 png**；OCR 版 jpg **降级为备用**（只用它确认"md 这一段里有哪几张图、顺序如何"）。
2. **不再需要索取 PDF**；`origin.docx` 里是同一批低清图（已实测），`.eps` 光栅化需要 Ghostscript ⇒ 记为**最后手段、不引入依赖**。
3. **作业书 §2 / §3 / §6 / §11 已同步更新**（抽图规则改成"文件名含 `<章>.<节>`"，并把上面两张图的实测结论写进去当依据）。
   成本略升但可忽略：图 **0.26M → 0.47M token**，一遍过合计仍约 **1.1–1.5M**。

> ⚠ 一条仍然成立的老实话：**命中与准确率的杠杆不在"读多少张图"，而在触发词写准、自检条款可核对、`code_examples` 给足**（§17.10 与作业书 §4/§5）。
> 图变清楚解决的是**读得对**，解决不了**写得准**。

**同日追加的一次排查（用户问"为什么文本源是 md、不能读 docx 吗"）**：

| 问题 | 实测结论 |
|---|---|
| docx 能不能读？ | **能**（`python-docx` 在本机），但**读出来会丢公式** |
| 丢到什么程度？ | docx 里 `$` 与 `\` 各 **0** 个；`v=v₀+at, x=v₀t+½at², v²−v₀²=2ax` 那一行读出来只剩 `,,.`；`对于参量 v₀、a、t、v 和 x` 变成 `对于参量、、、和`；连题目里的数值都丢（`A.前内位移一定是`）。**原因**：docx 的公式是 **Word 公式对象**，`python-docx` 的 `paragraph.text` 不返回它们 |
| md 为什么能用？ | 它是 OCR/转换产物，**把公式转成了 LaTeX、把 106 个 docx 表格转成了 28 个 HTML `<table>`** ⇒ **唯一同时保住公式与表格的机器可读版本** |
| md 的 OCR 靠得住吗？ | 受控比对：**1.1 一节与 docx 逐字相似度 0.9993**（2760 vs 2762 字，唯一差异是一处 `*.*` vs `.`）⇒ 可信。<br>⚠ 但**"全库命中率"这个指标我测了四次、口径一变数字就从 95.5% 掉到 54.7%** ⇒ **不可信、不引用**；改用**每章抽一个题型人工校对**（作业书 §8 新增 **V9**） |
| docx 的正确用法 | **只当"非公式文字"的校对参考**（它的普通文字与数字是准的，公式位置是空的） |

⇒ 作业书 §2 已把这条写清（含"为什么不是 docx"与 docx 的正确用法），§8 新增 V9 文本保真抽查。

---

## 17.13 第 5.7 期交付说明：世界书触发改为「**两侧分发**」

> **依据**：`5.7期工程计划.md`（本期作业书）· `物理解题动画软件v1.0自研方案.md` §9（冻结项）· §4.2/§4.4 · §19.3 · §21。
> **一句话**：把世界书的"查手册"动作，从**比题面字符串**改成 —— **解题侧**由模型判【考点】【题型】触发；**动画侧**由模型识别【**动画元件**】触发。
> **本期只做机制 + 最小夹具词表**；完整词表与 137 条内容迁移整体划给第 5.9 期（接口见 `5.7期给5.9期的接口说明.md`）。

### 17.13.1 两处**冻结项**变更（用户 2026-10 已裁决，逐条记台账）

| # | 改什么 | 裁决依据 | 落点 |
|---|---|---|---|
| **A26** | **§9.1 词条字段集**：新增 `concepts` / `tags` / `elements` 三栏 | 用户裁决；**枚举从 `contracts/worldbook-concepts.json` 派生**（不手写） | `contracts/spec/contract-fields.mjs`（三个 `$defs`）· `spec/frozen-keys.mjs`（派生常量）· `_compile.mjs`（**三条派生断言**）· `core/worldbook/store.mjs`（跨字段校验 + 规范化）· 前端类型 |
| **A27** | **§2.3 阶段枚举**：`read_image` → **`read_problem`** | 同上 | `spec/frozen-keys.mjs`（`PIPELINE_STAGES` + `CLEANING_STAGES`，`_compile.mjs` 用结构断言守着）· `core/prompts/templates.mjs` · `core/orchestrator/{pipeline,events}.mjs` · 前端 `run-stream.ts` / `useRun.ts` / `store.ts` · 4 处测试 |

**契约哈希只变两次**（本期内）：`1ff98c44…48dc` →（S2，两处冻结项）`2ec3f5a1…3610a` →（S6，为 `Draw.ground` 补词表元件 `shadow_ground`）`225def7f…1a86`。
第二条也是**冻结项**（词表是 schema 枚举的单源真相，改词表必然改契约哈希），但它不是"为了让门禁变绿"—— 它是**动画元件覆盖率断言**（每个 `Draw.*` 原语都要有元件指向它）要求补的，且**已如实记账**。

### 17.13.2 新旧对照

| 维度 | 旧（第 5 期） | 新（第 5.7 期） |
|---|---|---|
| 触发源 | 题面文本的字面 `keys`（+ `secondary_keys` 锚点） | **两侧分发**：解题侧按【考点】【题型】；动画侧按【动画元件】（经考点收窄） |
| 第 0 步 | `read_image` 读图转写；**纯文字题跳过** | **`read_problem` 读题与判定**；**所有题都跑**（含纯文字题） |
| 词条字段 | `keys` / `secondary_keys` | 加 `concepts` / `tags` / `elements`（三栏**可选**，缺省 `[]` = 不走概念分发） |
| 命中方式溯源 | `key` / `secondary` / `constant` / `recursive` | 加 `concept+tag` / `concept` / `element+concept` / `element`；强度刻度重定为 `concept+tag 5 > concept 4 > key 3 > secondary 2 = element+concept 2 > element 1 = constant 1 > recursive 0` |
| 撞车检查 | 主键撞车（W14-3） | 加 **标签撞车**（只对考点相交的词条比）+ **元件撞车** |
| 留痕 | `worldbook_done`（抽了什么） | 加 **`judgement_done`**（判了什么 + 表外词 + 结构问题 + 判定依据）；`worldbook_done` 追加 `judgement` / `judgementUnknowns` / `judgementProblems` |
| 界面 | 预览器只输题面 | 预览器可输入/粘贴判定；新增**词表浏览面板**；命中清单显示**为什么抽它** |

### 17.13.3 **灰度**说明（这是本期刻意的状态）

- **137 条老词条仍靠 `keys` 字面工作**（它们没有三栏）。命中 = `concepts 相交 且（tags 相交 或 tags 为空）` **OR** `element 命中（经考点收窄）` **OR** 旧的 `keys` 字面命中 —— **两条路并存**。
- **旧路径优先**：同一条词条既被 `keys` 命中又被概念命中时，`via` 取 `key`（不改老行为）。
- ⇒ **可一条一条迁、随时回退**。本期结束时**系统可用，但质量还没变好**（真正的提升要等 5.9 写完新库）。
- **判定为空**（一个考点都没判出来）⇒ 触发**退化为纯字面 keys**，**不是错误**。

### 17.13.4 第 5.7 期各阶段交付

| 阶段 | 交付 | 验收证据 |
|---|---|---|
| **S-1** | 核实现状 | `verify-all` 22 步全绿 · `rewrite --check` 源库一致（前后各测一次） |
| **S0** | `contracts/worldbook-concepts.json`：**56 考点 · 259 细考点 · 32 动画元件**（对齐 SDK 原语名） | 细考点重名 0 · 别名冲突可解释（正式名优先）· 每个元件原语都存在于 SDK |
| **S1** | 闸门实验（用户人工判定 **90% ⇒ 通过**） | `阶段5.7-两侧分发实验报告.md` · 原始留证 `测试结果-末轮.md` / `_s1-final-raw.json`（含 AI 原样返回） |
| **S2** | 契约一次改到位（A26/A27） | 契约 37/37 · 三栏枚举 56/259/32 **逐项等于词表派生** |
| **S3** | `core/worldbook/concepts.mjs`（解析器）+ `engine.mjs` 两侧命中与撞车 | 解析器探针 19/19（含真模型输出端到端）· 浏览器副本逐字节一致 |
| **S4** | Prompt 改名 + 三节输出 + 词表注入 + 编排接线 | Prompt 111/111 · 编排 115/115（含"没有任何阶段被跳过"） |
| **S5** | 设置页：词表面板 + 判定输入 + 粘贴自动解析 | 前端构建链通过（typecheck + 副本/导出面/可执行性探针） |
| **S6** | 门禁新增 **『W16』39 条**（词表完整性 / 跨字段 / 覆盖率 / 撞车 / heading-missing / 解析器正反例） | 世界书 227/227（原 188 + 39；其中 3 条由验收时修正，见 17.13.5 #8） |
| **S7** | 本文 + `README-笨蛋版.md` + `5.7期给5.9期的接口说明.md` | —— |

### 17.13.5 第 5.7 期发现的**缺陷与缺口**（如实记账，未隐瞒）

| # | 发现 | 处置 |
|---|---|---|
| 1 | **"器材识别是感知识别、几乎不该错"这个立论前提未成立**（S1 实测：撤掉配图后 47% 的题考点预测不变、33% 的元件预测不变；分层样本上**不给图的考点判准 75% 反高于给图 55%**） | 记入 S1 报告与接口说明第 5 节第 6 条；**S4 的 Prompt 已改为显式要求"先转写、再判定"**，但"视觉质量"仍需后续验证 |
| 2 | **词表缺【质点/圆形】与【直线段/墙·地面·杆】** | `Draw.circle` 15 题调用 **26 次**、`Draw.line` **60 次**；本期只补了 `Draw.ground`（覆盖率断言要求），其余记入 `knownGaps` 留 5.9 |
| 3 | **`text_label` / `dimension_label` 不算动画元件**（用户口径 A25），但仍在表里 | 记入 `knownGaps.toRemove`，留 5.9 移出 |
| 4 | **`pulley_rope` / `block_board` 一条捆两个原语** ⇒ "每个原语都有对应元件"这条判据机检不了 | 记入 `knownGaps.granularityConflicts`，留 5.9 拆开 |
| 5 | **「弹簧」被同时当成考点与元件**（按用户口径「弹簧弹力」才是考点） | 记入 `knownGaps.wordlistProblems`，留 5.9 |
| 6 | 计划 §5 S1 表格里 A 的基线 `45/111` **不可引用**（那是返工前的旧键、且只统计 111 条） | S1 报告 §2.1 给出**现场实测**：空命中 **78/136**（仅 1–2 步）/ **67/136**（生产默认）；**664/1092 的题面一条词条都命中不了** |
| 7 | **S1 与 S2 有次序耦合**：S1 要量"C 的空命中词条数"，而 C 要靠 S2 才有的 `concepts` 字段 | 记入 S1 报告 §6；本期**未测**该项，如实标注 |
| 8 | **门禁三处"绿着但没跑"的断言**（第 5.7 期**验收时**发现，细节见 `5.7期给5.9期的接口说明.md` §7） | **已修**：『W16-7』`missing.length >= 0` 是**恒真**（"禁止 heading-missing"成了空头支票）⇒ 改成 **`missing ⊆ 基线`**（新增即红、修好不红）；『W16-3』`missing.length === 56` 与『W16-6』`withElements.length === 0` **把"还没做"当不变量**（5.9 一成功就**按计划变红**）⇒ 改成**恒等式**与**槽位一致性**判据。三条各补负对照，**并用真库证伪过**（临时塞两个坏词条 ⇒ **只红该红的两条**并点出 id；撤掉后 227/227 全绿） |
| 9 | **`_` 前缀的 S1 证据散落在仓库根目录**（23 个数据/留证文件 + `tools/` 下 10 个一次性脚本），其中含**人工黄金集** | **已只移动、不删除**（本仓库无 git）：归入 **`第5.7期-S1留档/`**（`data/` + `scripts/` + 索引 `README.md`）。★ `data/_s1-gold.json`（人工标准答案）是 **5.9 的回归基线**，已在交接单 §四登记 |
| 10 | **交接单漏了 S1 报告里最重的两条**：器材判准 **41.7%/61.1%** 远低于 **≥95%** 门槛；"器材是感知识别、几乎不该错"这个**立论前提未成立** | **已补进交接单新增的 §八**（连同"先定死器材边界与考点粒度、再写内容"的两条开工前必做），并要求 5.9 引用"S1 已通过"时**同时引用保留意见** |

### 17.13.6 本期**未做**（边界，不是漏项）

- ❌ 完整词表内容 · ❌ 137 条内容迁移与合并 · ❌ SDK Layer 1 扩编 → 均见 `5.7期给5.9期的接口说明.md` §6
- ❌ 不新增阶段（判定并进 `read_problem`，**没有** `classify`）
- ✅ **禁区未碰**：C1–C9 仍 **15/15 · 0 告警 · 0 失败**；§9.2 六步触发与三重预算、分槽组装、来源标记、双槽切分口径、零像素坐标**一条未改**

---

## 十八、第 6 期交付说明：可配置化完全体（§18 期 6 · ✅ 已关闭）

> 交付日期 2026-10-17。**验收原文三条**由 `tests/phase6-acceptance-selftest.mjs`（门禁 ㉗）一口气钉住。
> 分项交接（都能独立复核，不必读本文件其它部分）：
> `第6期-第1项-规则工作区交接.md` · `第6期-第2项-Prompt编辑器交接.md` · `第6期-第3项-清洗规则编辑器交接.md` ·
> `第6期-第4项-端点管理交接.md` · `第6期-第5项-收口交接.md` · `第6期-第3件-备份与恢复.md`

### 18.1 交付物与落点

| 能力（§18 第 6 行的五件事） | 落点 | 门禁 |
|---|---|---|
| **规则工作区**（SHA256 / 原子载入 / 整批失败 / 热重载 / 体积上限 / 滚动 5 份备份） | `core/rules/workspace.mjs` · `kinds.mjs` · `backup.mjs` | ㉓ 94 · ㉙ 45 |
| **Prompt 编辑器**（覆盖副本 + 硬门禁 + 内置变更提醒 + rebase + 真的进 system 消息） | `core/prompts/overlay.mjs` · `editor.mjs` · `getPrompt(id, rules)` · 编排快照 `snapshot.rules` | ㉔ 82 |
| **清洗规则编辑器**（内置 3 条锁定、用户规则可增删改启停排序、真的洗到槽位） | `core/cleaner/policy.mjs` · `editor.mjs` · `applyRegexRules()` 从策略表取锁定集 | ㉕ 68 |
| **端点管理完整校验**（Key 单独存、导出结构性无 Key、九条前移到保存、测试连接） | `core/gateway/endpoint-store.mjs` · `connection-test.mjs` | ㉖ 75 |
| **答案结构模板** | 作为"嵌在 `answers` 正文里的替换"实现（没有自己的阶段） | ㉔ |
| **界面 + 本机通道**（规则页 5 页签：Prompt / 清洗 / 端点 / 世界书 / 状态） | `tools/rules-service.mjs` + `web/src/pages/RulesPage.tsx` + `web/src/lib/rules-api.ts` + `3-OpenRules.bat` | ㉘ 61 · ⑬⑭ |
| **词条写回**（`ai-rules/worldbook/`，整批校验 + 原子写 + 备份） | `core/worldbook/editor.mjs` | ㉘ |
| **总装验收**（验收原文三条 + 一次整机链路） | `tests/phase6-acceptance-selftest.mjs` | ㉗ 44 |

### 18.2 六条口径（用户裁决，**后续期别推翻**）

1. **未登记的文件 ⇒ 拒绝载入并点名**（代价：手动丢文件要再点一次"登记"；换来：任何绕过界面的改动逃不掉）。
2. **保存撞车 ⇒ 拒绝**（提示"文件已被外部修改"，勾选 force 才覆盖）。
3. **底座只管两类文件**：`ai-rules/prompts/*.md`、`ai-rules/cleaning.json`。词条归 `core/worldbook/store.mjs`、端点归 `core/gateway/endpoint-store.mjs`，**不让两套判据打架**。
4. **Key 单独存**（`ai-rules/keys.json`），可导出的 `endpoints.json` 里恒为 `keys: {}` —— 导出不含 Key 是**结构性**的，不是"记得删"。
5. **清洗锁定集是数据**（`core/cleaner/policy.mjs`，有版本号、每条写明"为什么锁"），但**用户绕不过**：文件层 / 运行时 / 编辑器三个入口一起拦；代码里把它标 `enabled:false` 会直接判 `cleaning.policy-broken`（宁可炸，不静默跳过）。
6. **备份滚动 5 份**（`ai-rules/.backup/`，点开头所以不会被当成规则文件）；**`keys.json` 永不备份**（每份副本都是明文密钥）；**恢复前先把当前版本也备份**，所以恢复可撤销。

### 18.3 验收原文三条，怎么被证的

| 原文 | 怎么验（㉗） |
|---|---|
| 四类改动都"**下一题生效**"且"**在跑题目不受影响**" | 同一道"正在跑的题"先钉住快照；改 Prompt / 结构模板 / 清洗 / 端点后再取新快照，逐次断言"新的变了、旧的一个字没变"（含 `revision` 断言） |
| 导出的配置**不含任何 Key** | 设 Key → 导出 → 断言无 Key 值、无 `sk-` 形态、`keys:{}`、导出包能原样导入；反向：带 Key 的导入包被拒 |
| 规则文件被改坏时**载入被拒并指出具体位置** | 六种坏法：坏 JSON（给行号）、非法正则（给 `cleaning.json:rules[1].pattern`）、空 Prompt、端点坏 JSON、端点字段非法、外部改动（先报哈希不符） |

另加一段**整机链路**：真跑一次 `runPipeline`，断言 Prompt 覆盖出现在 system 消息里、清洗规则改到了槽位、端点配置生效、判定 pass。

### 18.4 几个关键设计（为什么这么做）

- **热重载 = 快照钉住**：`createRulesRuntime()` 把快照钉在某道题上；`snapshotConfig()` 再把它拷进每题配置快照。跑着的题永远不会看到中途改动。
- **Prompt 覆盖不影响 `promptHash`**：覆盖只进条件段（本阶段指令），不进固定前缀 —— 前缀缓存不受影响（㉔ 里钉住）。
- **内置变更提醒**：保存覆盖时记 `basedOn`（内置正文的 sha256 + 原文），内置升级后状态变 `stale` 并给**行级差异**；可"换基线"（正文不动）或"恢复默认"（删文件）。**登记外部改动也保留基线**（血统没变）。
- **答案结构模板**没有自己的阶段：它是 `answers` 正文里的一段，所以覆盖它 = 在**内置** `answers` 里把那段替换掉；若同时整份覆盖了 `answers`，则整份覆盖赢（并给警告）。
- **界面不自己判任何事**：能不能保存、错在哪个字段、有没有撞锁定规则，全由 Node 侧回答，页面只显示 `issues`。
- **错误边界 + 形状回归**（第 6 期真实事故的教训）：某份 Prompt 只配了 `warnings`、没有 `errors` 键 ⇒ 界面读 `.length` 抛 TypeError ⇒ React 卸载整棵树 ⇒ **白屏**。现在：① `openPrompt` 保证两个数组恒在；② 界面 `?? []` 兜底；③ 每页套 `ErrorBoundary`；④ 门禁 ㉘ 对 **9 份 Prompt + 清洗 + 端点**逐条断言形状。

### 18.5 本期**未做**（边界，不是漏项）

| 未做 | 归属 |
|---|---|
| 解题页真正调模型 + SSE（前端仍是演示源、判定显示"未校验"） | **第 9 步**（本地服务接管事件流；`serverEventSource()` 接口早已就位） |
| 设置页那个世界书管理器仍是"预览/分析"（写回入口在「规则 → 世界书」） | 第 9 步合并入口 |
| **规则预览器**（§15 提到：拿一段样例跑一遍规则看效果） | 独立小功能 |
| **变量插值**（§10.3） | 当前 Prompt 正文里没有 `{{}}` 占位符，插值没有落点 |
| **偏好配置层**（§16 的 `config.json`）+ 整份配置导入导出 | 只做了端点那一份 |
| `keysEncrypted`（Key 加密） | §11.2 明写"本期不实现"，字段位已留 |
| Prompt 文档 ≤5 MB 与工作区单文件 ≤800 KB 的关系 | 实际按更严的 800 KB 执行，**口径关系未写明** |
| 端点配置 ≤4 MB | 只在**导入**时检查，`saveEndpoints` 本身未查字节上限（界面产出的内容撞不到） |
| 备份只有 5 份、无时间戳、与原文同盘 | 救"改坏了"，救不了"硬盘坏了" |
| **第 7 期的三个方向性决定**（图表画在哪侧 / GIF 用什么编码 / 扫描版 PDF 怎么读进来） | **未裁决**：用户 2026-10-17 明确「留给第 7 期开工时来问」。见 `面对第七期工程的交接.md` §五 —— **开工第一件事就是问这三条** |

### 18.6 怎么用

```powershell
# 界面（推荐）：双击 3-OpenRules.bat → 顶部「规则」
node tools/rules-service.mjs --port 8080     # 等价的手动启动；同端口既发页面又发 /api
node core/rules/cli.mjs prompts              # 9 份 Prompt 的状态（内置 / 已覆盖 / 内置变过）
node core/rules/cli.mjs cleaning             # 生效顺序（3 条锁定在前 + 你的规则）
node core/rules/cli.mjs endpoints            # 端点、Key（打码）、被哪些阶段使用
node core/rules/cli.mjs restore              # 哪些文件有备份（保存时自动留，滚动 5 份）
node core/rules/cli.mjs check                # 体检：有问题逐条指出哪个文件、哪个位置
```

⚠ **必须用 `3-OpenRules.bat`**（或 `node tools/rules-service.mjs`）打开：`2-OpenUI.bat` 是纯静态页，只能看不能改。
服务只绑 `127.0.0.1`，校验 `Origin`（跨源 403），**永不返回明文 Key**，静态文件解析限制在 `web/dist` 内。

### 18.7 给后续期的两条硬约束

1. **别绕开 `core/rules/`**：它是唯一写入口（原子写 + 哈希 + 冲突拒绝 + 备份）。新增任何"可编辑规则"都走它，否则"改坏被拒并指出位置"这条验收会静默失效。
2. **`tools/rules-service.mjs` 是唯一的浏览器 ↔ 磁盘通道**：第 9 步接 SSE 时加在**同一个服务、同一个端口**上。另起端口就要放宽 CORS，而 CORS 一放宽，Origin 校验就白做了。

---

## 十九、第 7 期交付说明：导出 · 联动图表 · 教辅蒸馏简版（§18 期 7 · ✅ 已关闭）

> 交付日期 **2026-10-17**。**验收原文四条**由 ㉚㉛㉜ 一口气钉住（75 + 48 + 53 = **176 条断言**）。
> 交接文件：**`面对第八期工程的交接.md`**（第 8 期开工读它 + 方案 §14 / §15 / §21.3 即可）。
> **本节的 §三（偏离）与 §六（留口）是"别改回去 / 别当遗漏"的清单**，第 8 期很容易在这里翻车。

### 19.1 交付物与落点

| 能力（§18 第 7 行） | 落点 | 门禁 |
|---|---|---|
| **联动图表（M15）**：独立画布 · 动画下方整宽横条 · 可切量 · 可隐藏 · 常数量不画 · 游标与画布同一个 `t` · 步骤分界线 | `template/animation-template.html`（图表面板）· 采样走 Dry-Run 的 `readouts` | **㉚ 75** |
| **导出网页（M17）**：服务端用**构建期同一个打包器**打成单文件页 + 烧录 Provenance + 落 `exports/` | `core/export/page.mjs`（复用 `buildQuestionHtml`） | **㉛ 48** |
| **导出 GIF（M17）**：前端逐帧抓取 · 25 fps / 960×540 · 默认不录曲线图 | `web/src/lib/gif-encode.js`（浏览器与 node 共用）· `window.ODExportHook` | **㉛ 48** |
| **教辅蒸馏（M19 简版）**：图片/文字导入 · 成本预估 · 页级进度可续做 · 候选卡片 · **人工确认才入库** | `core/distill/index.mjs` · `web/src/pages/DistillPage.tsx` · `distill-sessions/` | **㉜ 53** |
| **版式重构（用户追加）**：三栏 → 两栏 + 导读栏选项卡 + 动画联动开关；画布 16:9 且宽度按视口高度封顶 | `template/animation-template.html` · `template/build-template.mjs` | ⑨⑩⑬⑭ |
| **落盘通道（唯一）**：`/api/export/*` · `/api/distill/*` · `/exports/*` | `tools/rules-service.mjs`（**同一个端口、只绑回环**） | **㉘**（HTTP 真打） |

**版本口径**：`contractHash` **未变**（本期没动契约）；`TEMPLATE_VERSION = SDK_VERSION = 1.0.0` 未升。
**新增依赖**：`gifenc@^1.0.3`（用户批准，纯 JS、无原生模块、不走 CDN）；`fdir` 被提为 `devDependencies`（修 rollup 插件缺依赖，非产品依赖）。

### 19.2 五条方案偏离（**本期定案，别改回去**）

| # | 偏离 | 用户原话 / 理由 | 连带影响 |
|---|---|---|---|
| 1 | **删除 §15 的"数据面板"**（步标题 / 本步结论 / 逐步读数卡片 / 脚注） | "这部分'动画说明'删掉不要"，位置让给曲线图 | ⑩ 的必需区域清单已移除 `readouts-grid` / `panel-step-title`；⑳ 里 4 条"读数分级"断言**换成 3 条反向钉子**（面板确实不在 / 不留死代码 / 数字仍走 `RT.format(…, 3)`） |
| 2 | **删除宿主顶部控制条**（播放/上一帧/下一帧/时间轴/倍速/五个开关） | "最上面这一栏删掉，控制面板只要下面演示动画里的" | 播放控制只留模板页自带那套；顺手消掉 §15"不重复主 CTA"的违规 |
| 3 | **三栏 → 两栏 + 选项卡** | 版式重构 | §15 的"三栏"表述作废；`col-problem` / `col-steps` 仍在 DOM 里（变成导读栏两个面板），所以 ⑩ 的"三栏顺序"判据**继续有效、不用改** |
| 4 | **去掉 `position: sticky`** | 右侧现在很高（画布 + 控件 + 图表），粘住会让下半部分永远滚不出来 | — |
| 5 | **不做 WebM、不做 PDF 解析** | 用户砍的（"WebM 不用导出了"） | 蒸馏输入只有"图片页 / 粘贴文字"；**这是裁决，不是遗留** |

⚠ **偏离 1 的代价要知道**：动画页上**不再有"各量的实时数值列表"**，数字只剩**图表游标旁那一个值** + 宿主页下方那张表。

### 19.3 验收原文四条，怎么被证的

| 原文 | 可机检的写法（在哪一步） |
|---|---|
| 拖时间轴时画布与图表同步 | 固定 `t` 值序列 → 断言"图表游标读数 == `readouts(t)`"（**同一函数、同一 `t`**）—— ㉚ |
| 导出 GIF 帧率时长与屏幕一致 | 帧数 == `round(duration × fps)`；延时 == 1/fps；总时长误差 < 1 帧；末帧 == `t=duration` —— ㉛ |
| 导出网页在另一台电脑双击可离线播放 | 产物拷到临时目录、断网加载；断言无外链、`ODRuntime` 就位、能 `seek` 到末帧、Provenance 已烧录 —— ㉛ |
| 扫描版 PDF 有成本预估与页级进度并能产出候选词条 | 假视觉端点跑完整流程；断言进度事件逐页、预估数 == 页数 × 单价、候选输出结构化、**没点确认就一个字节都不写** —— ㉜ |

### 19.4 七条坑（用真金白银换的，第 8 期还会咬人）

1. **PowerShell 不能用来改文本文件**（本期真出事，而且**同一天犯了两次**）。`Get-Content` 按 GBK 读、`Set-Content` 按 UTF-8 写 ⇒ 中文编码被毁：第一次毁掉模板页（1230 个字符不可逆丢失，靠"从成品空壳反推源"救回）；第二次毁掉 `tests/export-selftest.mjs`（整份重写才救回）。
   **纪律：改文本一律用编辑工具；PowerShell 只用来跑 `node xxx.mjs`。**
2. **`gifenc` 是"三副面孔"的包**：`main`/`browser` 指 CJS、`module` 指 ESM。Node 里具名导入抛 `Named export 'GIFEncoder' not found`；浏览器里默认导入又可能拿到空对象（`GIFEncoder is not a function`）。**必须命名空间 + 两路兜底**（见 `web/src/lib/gif-encode.js` 顶部注释）。
3. **`pnpm add` 会把 web 依赖树搞坏**：`@rollup/plugin-commonjs` 的 `fdir` 链接断掉 ⇒ 打包直接挂。修法：`pnpm install --force` + 把 `fdir` 提为 `devDependencies`。
4. **`serveStatic()` 按 `req.url` 自己算相对路径**：给 `/exports/` 挂新根目录时必须先把前缀剥掉，否则它去 `exports/exports/…` 找，表现是"文件明明在、却 404"。
5. **GIF 抓帧必须同步**：`postMessage` + 250 ms 心跳跟不上逐帧，所以模板暴露了 `window.ODExportHook`（`prepare/renderAt/restore`）供同源直接调用。**它不是 §13.2 协议的一部分**，改它不用动协议文档，但要保持"只有这三个方法"。
6. **模型输出里的 LaTeX 会打爆 JSON**：`\mu`（而不是 `\\mu`）不是合法转义，`JSON.parse` 直接炸。`parseDistillOutput` 有"修反斜杠再试一次"的第二遍，**别删**。
7. **`gifenc` 的帧延时只精确到 1/100 秒**：25 fps ⇒ 40 ms ⇒ 正好 4 cs；换非整除帧率会有 ≤1 cs 量化误差。

### 19.5 已知留口（**是留口，不是漏项**）

| 留口 | 说明 |
|---|---|
| **WebM 与 PDF 解析** | 用户明确砍掉（见 19.2 第 5 条）。**方案 §14 的"视频"一项本期不做。** |
| **蒸馏页要先配视觉端点** | 「设置 → 端点」必须有一个 `supportsVision = true` 且 `stageModels.distill` 指过去；否则读图会在**调模型之前**被拦下（报 `distill.needs-vision`）。 |
| **扫描页要手动导出成 PNG/JPG** | 本期不做 PDF 解析（用户裁决）。用法：阅读器里导出图片再拖进来。 |
| **旧手绘曲线只剩 q10 的 p–V 面积图** | 它不是"量对时间"的曲线，模板图表面板替代不了。其余 10 题的手绘曲线已清空，**第 7.1 期**按新方式重画，原件在 `第7期-旧手绘图留档/`。 |
| **GIF 抓帧只有结构级验证** | 帧数 / 延时 / 尺寸 / 编码可机检；"画布真的被抓对"必须**人眼看**（Node 里没有真浏览器，门禁验不到像素）。 |
| **推导箭头 `⇒ → ↓` 的美化** | 用户 2026-10-17："美化不是美化箭头，不必记账" ⇒ **不做**。若要改，多行 tex 需先扩构建期公式提取器，否则会退化成兜底渲染。 |
| **`exports/` 没有自动清理** | 产物会一直堆着，将来可在设置页加"清理导出"。 |
| **门禁只测核心、不测 HTTP 层就等于没测**（本期真实教训） | ㉜ 最初只测蒸馏核心，结果用户第一次点"建会话"就报 `没有这个接口：POST /api/distill/sessions`（真因是**服务进程还是旧代码**），而门禁**毫无反应**。现已补第『I』节：6 条断言真打 `/api/distill/*`（200 / 400 / 403 都要对）。**第 8 期加接口照这个补。** |

### 19.6 §21.3 自查清单（逐条结论）

- [x] **本期交付项全部可用，无占位符、无未完成分支**：联动图表 ✅ / 导出网页 ✅ / 导出 GIF ✅ / 教辅蒸馏（核心 + 接口 + 蒸馏页 UI）✅。唯一"没做"的是 WebM 与 PDF 解析 —— **用户明确砍掉**，不是遗留（19.2 第 5 条）。
- [x] **新增/修改的契约已写入 `contracts/`**：本期**没有改契约**（`contractHash` 未变）。新增的 `window.ODExportHook` 明确**不是** §13.2 协议，已在模板与交接双处注释。
- [x] **C1–C9 中本期涉及项可独立触发**：本期未触碰 §7.2；③ Dry-Run 与 ④ 负向注入仍全绿。
- [x] **回归题集通过率与上一期对比无回退**：15 题 Dry-Run / 渲染路径 / C7 全绿。
- [x] **无新增外部依赖（如有，已列清单并说明）**：新增 **1 个运行时依赖 `gifenc@^1.0.3`**（用户批准，纯 JS、无原生模块、不走 CDN）；`fdir` 提为 devDependency（修 rollup 插件，非产品依赖）。
- [x] **取消、错误、空态、降级四种路径均已手动走通**：取消 = 导出中途失败有红字且画布样式会 `restore`；错误 = 非 GIF 拒绝 / 跨源 403 / 无视觉端点拦截；空态 = 没有题目时导出按钮 `disabled`；降级 = 公式渲染失败退回 ODTex。
- [x] **本轮遗留问题与冲突已写入交付说明**：见 19.2（偏离）、19.5（留口）。

### 19.7 给后续期的三条硬约束

1. **产物与配置只经唯一入口落盘**：规则 → `core/rules/`；导出/GIF → `/api/export/*` → `exports/`；蒸馏 → `distill-sessions/`；词条 → `core/worldbook/editor.mjs`。**任何一条绕开，"唯一入口"的验收就静默失效。**
2. **每个判据都要有负对照**：断言"成功"的同时必须断言"该失败的时候确实失败"（本期 ㉛ 的跨源 403、㉜ 的"没点确认不写盘"就是这一类）。
3. **新加接口必须真打一遍 HTTP**：见 19.5 最后一条 —— **只测被调用的函数等于没测**。

---

> **第 8 期入口**：`面对第八期工程的交接.md`（交付 = M21 安全脱敏 · M22 日志与失败复现包 · M23 历史表与写入接口位（无 UI）· M24 Electron 壳与安装包）。
> **注意**：用户 2026-10-17 在本期收尾时又追加了**产品形态收敛**（前端只留解题/动画/蒸馏、内置知识层封死、字体改宋体+Times、文字避让入 SDK）—— 这与方案 §18 第 8 行**不是同一批活**，工作量已超过原估。

---

## 二十、第 9 期交付说明：提示词与世界书重写 · 判据分级（✅ 已关闭）

> **完整版见 [`第9期交付说明.md`](第9期交付说明.md)**。本节只记**口径变化**——凡与旧节冲突的，以本节为准。

### 20.1 世界书的形态换了（83 条 → 47 条）

| 文件 | 条数 | 槽位 | 来源 |
|---|---|---|---|
| `core/worldbook/source/90-visual.json` | 2 | `scene_code` | 手写（视觉约定 / 阶段表） |
| `core/worldbook/source/92-animation-core.json` | 2 | `scene_code` | **生成** |
| `core/worldbook/source/93-elements.json` | 30 | `scene_code` | **生成**（元件**一件一卡**） |

- **解题槽位已经没有词条了**：10 条公式规范搬进了各阶段自己的指令（`core/prompts/stage-rules.mjs`）。
  理由见 §20.7 与 README §9.6「阶段契约 ≠ 条件知识」——世界书只有两个槽位，生产链却有五个阶段。
- **双槽卡 0 张**（原 11 张）。原 `wb_general_modeling` 的动画半边 → `wb_scene_stages`。
- **三份范文已下线**（用户裁决「不用留，相信大模型的能力」）：结构由提示词里的 8 槽位范例承担、
  单件画法由 30 张元件卡承担、阶段切分由 `wb_scene_stages` 承担。原件在 `_retired-worldbook/` 归档里。
- 正文 175,914 → **23,509** 字；含负向措辞 72 条/194 处 → **2 条/5 处**（都在未改动的元件/约定卡里）。
- 题型级物理讲义卡**按用户目标退役**，原件归档在 `_retired-worldbook/source-2026-10-18/`（本仓库无 git）。

### 20.2 覆盖率台账的口径**作废**（`0/111` 是真相）

`core/worldbook/coverage-target.json` 里 111 个题型的 `entryId` 已清空，并写入
`superseded`（含原因与新形态）。**它不是"待完成"**——`targetFromFile()` 只数 entryId 是否非空、
不校验词条是否存在，不清空就会继续显示 111/111（绿着但没做）。
门禁 ㉒ 的相关断言是推导式（`contentComplete === (covered >= declared)`），无需改动即可保持绿。

### 20.3 生成链多了一条前置（**顺序不能换**）

```bat
node tools/build-animation-cards.mjs      :: 生成 92 与 93（元件卡里嵌的是被 C1 实跑过的代码）
node tools/rewrite-worldbook-entries.mjs --prune   :: source → data（删了源文件就必须 --prune）
node tools/build-builtin-bundle.mjs
node tools/build-worldbook-web.mjs
node tools/web-build.mjs
node tools/verify-all.mjs
```

### 20.4 判据分级（C1–C9 **一条没删**）

| 检查 | 拦住方式 |
|---|---|
| C2 / C3 / C5 / C7 | 硬拦（未变） |
| C1 | 语法、箭头契约、禁用标识符、`stateAt` 内积分、死循环 → 硬拦；**孤立的 `unknown-global` → 告警** |
| C4 / C6 | **降告警**（`status` 照旧报 fail，只是不再让交付判死） |
| C8 / C9 | 告警（未变） |

落点：`contracts/spec/frozen-keys.mjs` 的 `CHECK_SEVERITY` + `core/lint/contract-lint.mjs` 的
`C1_ADVISORY_RULES` + `core/dryrun/dry-run.mjs` 的逐实例 `blocking`。
**降级不放松**：`require`/`eval`/`process.x` 还命中 `banned-identifier`（硬拦）；笔误真被执行到 ⇒ 运行期抛错 ⇒ C2 硬拦。
三条行为钉在门禁 ㊺（15 → 18 条）。

### 20.5 提示词的"唯一范例"是**验过的**

`core/prompts/golden-example.mjs` 里那份 8 槽位程序，提示词与探针 import **同一份字节**；
改完必须跑 `node tools/_golden-probe.mjs`（真切分器 + 真 dryRun 跑 C1–C9）。

### 20.6 已知遗留

1. `scene_code` 常驻地板 **4,746 字**（坐标约定 1,526 + 元件总览 3,220），元件总览是最大单项。
2. `tests/regression-15/` 仍**不可信**（用户原话），只用于机器自检与注入量级判断。

### 20.7 收尾：**阶段重排**与**规范搬家**（同日，用户复核后裁决）

用户读完 `一次提问的全过程-临时.md` 后指出三处问题，逐条处理：

| 用户指出的 | 事实核对 | 处理 |
|---|---|---|
| 速查表说"`label` 与 `symbol` 逐字一致"，范例却是 key 对上、label 写中文 | **规则文案错**（C7 本来就认 `key` 或 `label` 或 `latex`） | 速查表改成"`key` 与 `symbol` 逐字一致，`label` 写给人看的中文" |
| 范例里还在教 `Draw.text` | 范例里**没有** `Draw.text`，但有 `Draw.dimension({text})` 与箭头 `label`；而方案 A 已 `HIDE_CANVAS_TEXT=true`，四处文字全不显示 | 元件总览**删掉 `text` 那一行**，并补一句"方案 A 起画布不写文字" |
| 阶段 3 在没看到 STEPS 时盲填 `at_t` / `step` | **结构错，必然错**：旧顺序是 `answers → steps` | **调序**：`read_problem → solve → steps → answers → scene_code`，`answers` 的输入里带 STEPS |
| 解题/分步/答案里塞了只跟代码有关的规范 | **粒度错**：世界书只有 `solve`/`scene_code` 两个槽位，却有五个阶段 | **规范搬回阶段指令**（`core/prompts/stage-rules.mjs`），世界书只剩条件知识（34 条） |

10 条规范的最终归属（一条不悬空）：**6 条进解题**、**1 条并进动画速查表**（边界连续性）、
**3 条本就重复直接删**（时间轴 / 答案结构 / 命名与读数一致——各自阶段的正文早已写了）。

改完后：单题发送量 **43,779 → 35,165 字**；世界书 **44 → 34 条**。

### 20.8 再做一刀：**前缀按阶段取**（用户发现"第一阶段没必要告诉 SDK 什么"）

一条全局前缀的 3,219 字（模板骨架 333 + SDK 摘要 2,886）**只有动画阶段用得上**，却跟着四段一起发。
改成按阶段分条后：

| 阶段 | 前缀字数 | 含骨架/SDK |
|---|---|---|
| 读题与判定 | 130 | — |
| 解题 | 101 | — |
| 分步解析 | 98 | — |
| 答案抽取 | 82 | — |
| 动画代码 / 自愈修复 | 3,563 | 有 |
| **一道题合计** | **3,974**（原 17,815） | |

落点：`templates.mjs` 的 `STAGE_ROLES` + `fixed-prefix.mjs` 的 `buildStagePrefix(stage)`；
`promptHash` 改为覆盖**六条前缀 + 两个版本号**（值变为 `2a638920…`，溯源会跟着变一次，属预期）。
缓存不受影响：每条前缀仍**跨题逐字节不变**。

**单题发送量 35,165 → 21,324 字（相对本轮开始时 −51%）。**

> 还有一笔同日修掉的浪费：**判定词表里的考点表（1,468 字）与题型标签词表（3,543 字）已下线** ——
> 真库里声明 concepts / 	ags 的词条是 **0 条**（题型卡退役后没人消费它们了），只有元件表还在被 31 张卡用。
> ead_problem 的 user 因此从 **6,344 → 1,329 字**。
**但真正的收益不是字数，是把"必然出错"改成了"结构上不会错"**——答案的时间锚点现在照着 STEPS 填。

### 20.9 版本 1.1 与**离线重打包**（同日）

- 产品版本 **1.0.0 → 1.1.0**（`package.json` / 窗口关于框 / preload / 页面标题）；
  **`TEMPLATE_VERSION` 与 `SDK_VERSION` 保持 1.0.0** —— 它们是**契约版本**（写进 Provenance 与契约哈希），
  跟产品版本不是一回事，一起改会把契约产物与历史记录的语义搅在一起。
- 本环境**离线**：`node_modules/electron` 与 `electron-builder` 都没装，npm registry 不可达，
  所以 `tools/electron-build.mjs`（electron-builder 路线）跑不了。新增
  **`tools/electron-repack.mjs`**：拿 `release/` 里 v1.0 绿色版的 **Electron 33 运行时**做底，
  只替换 `resources/app` 载荷，再打 zip。产物形态与 v1.0 一致（**绿色版 + zip，不是 NSIS 安装包**）。
- 两个坑记在这里：
  ① `fs.cpSync` 复制这份 180 MB 运行时树会让 Node 直接崩（`0xC0000409`，连目标目录都不建）⇒ 改用 `robocopy`；
  ② 一开始按"`_` 前缀是开发期工具、不进包"过滤 tools，**差点漏掉** `_run-bundle-probe.mjs`
     （`tools/web-build.mjs` 会调它）⇒ 现在**整份 tools 都进包**。
- 产物：`release/物理解题动画-v1.1/`（绿色版）· `release/物理解题动画-v1.1-win-x64.zip`（134.9 MB）。
- 冒烟自检：`node _payload-smoke.mjs` —— 直接从**打包出来的载荷**里 import 真模块
  （词条库 34 条 / SDK 55 个导出 / `promptHash 2a638920…` / 干跑内核可加载）。