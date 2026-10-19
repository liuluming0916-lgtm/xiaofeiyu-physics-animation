# 交接书 · v1.1.5（UI 改造）

> **新会话第一件事：读完这份文件，然后只做「下一步」那一节。**
> 不要从 ROADMAP 重推需求，也不要重读大文件——需要的锚点这里都写了。

---

## 一、当前状态（2026-10-19）

| 项 | 值 |
|---|---|
| 产品版本 | `package.json` = **1.1.2**（v1.1.5 的号还没打） |
| 门禁 | `node tools/verify-all.mjs` → **57 步 / 0 ✗**（上一轮验证时全绿） |
| 打包 | **没有打 v1.1.5 的包**（用户明确：做完再打）。现有包是 `release/物理解题动画-v1.1.2/` + 同名 zip |
| git | 有仓库；分支 `master`；tag `v1.1.2-baseline` |
| 最近提交 | `960e1a4` 日志下移+GIF 留边 · `d6cfe54` 导出移导航 · `e120580` 拆两个折叠面板 · `b2cca3e` 解题页改造 |

## 二、v1.1.5 已完成（别重做）

1. **副标题**：`v{版本} · 解题 → 动画 → 教辅蒸馏` → 版本号 + **「开源的物理动画平台」**（`web/src/App.tsx`）
2. **七阶段台词**：`STAGE_SAY`（小肥鱼正在看题/解题/把答案切块/料理答案/努力画画/检查/完善…），
   **只在 `running` 时出现**，独占步骤条下一行（`web/src/pages/SolvePage.tsx` 的 `StageProgress`）
3. **两个折叠面板**（默认收起）：「解题过程」/「判据 · 世界书依据 · 自愈过程」。
   ⚠ 错误提示与告警横幅**在折叠面板之外**（绝不静默交付，不许收起来）
4. **表情包区** `FishStage`：按阶段换图，未运行显示 idle。
   资产在 `web/public/fish/{idle,stage1..7}.webp`（8 张，17–49 KB，来自「表情包参考」）；
   构建时由 `tools/web-build.mjs` 末尾拷进 `dist/`，**不塞进 app.js**
5. **去掉界面上字面显示的 `**`**（三处文案）
6. **导出变成导航栏的键**：「蒸馏」右边 `导出 ▾`，点开选网页/GIF，点完自动切到动画页。
   机制：`web/src/lib/export-bus.ts`（导航栏只发请求，导出实现在动画页——那里才有 iframe 画布句柄）。
   动画页顶部那 81 行工具栏**已删除**，导出状态行移到页面最下面
7. **通信日志**（宿主 ↔ 模板）下移到动画页最下面；「卡住自动展开」逻辑保留
8. **GIF 抓帧**：新增 `letterboxTo()`，等比缩放 + 留白，不再直接拉伸到 960×540

## 三、下一步（唯一要做的）

**画布放大（用户选定的方案 B：比例尺优先，GIF 让步）。**

尝试过：把 `template/animation-template.html` 里的
`width: min(100%, max(320px, calc((100vh - var(--chrome-h)) * 16 / 9)));` 改成 `width: 100%;`，
并去掉 `aspect-ratio: 16 / 9;` 换成 `height: calc(100vh - var(--chrome-h)); max-height: 100%;`
⇒ **门禁红 23 条**（形如 `✗ build/animation-template.html … data-od-id 40 个 · 内联脚本 4 段`）。
**已 `git checkout -- template/animation-template.html` 还原**，现在门禁是绿的。

要做的事，**按这个顺序，不要跳**：

1. 重新施加那两个 CSS 改动（内容同上，注释已想好：不锁 16:9、GIF 靠前端 `letterboxTo` 留白）；
2. 跑 `node tools/verify-all.mjs`，把 23 条失败**逐条抄出来**；
3. 把每条分成两类：
   - **(a) 只是记录/比较比例数值的断言**（如"画布 16:9"、"宽度按视口高度封顶"）⇒ 属于**产品决定变了**，
     改断言并写清理由（用户 2026-10-19 定了方案 B）；
   - **(b) 真的依赖 16:9 才能成立的**（导出页版式、GIF 尺寸、模板页布局约束）⇒ **保留**，
     并说明"为什么这条不能跟着改"；
4. 只改 (a)。改完必须 57 步全绿；然后报告"改了哪几条、为什么、哪几条没改、为什么"。

⚠ **红线**：不许为了让门禁变绿而放宽判据口径。改断言必须能说清是"产品决定变了"还是"断言过时了"。

## 四、汇报与打包

- 用户明确：**做完先别打包**，等他确认再打。
- 打包命令与顺序（**不能换**）：
  `build-animation-cards` → `rewrite-worldbook-entries --prune` → `build-builtin-bundle`
  → `build-worldbook-web` → `web-build` → `verify-all`，最后 `node tools/electron-repack.mjs`，再 `tar -a -c -f` 打 zip。
- 版本号要改 5 处：`package.json` 的 version / description / copyright、`web/index.html` 标题、
  `electron/main.cjs` 关于框、`electron/preload.cjs`。
  ⚠ **`TEMPLATE_VERSION` / `SDK_VERSION` 不动**（是契约版本，不是产品版本）。
- 发布产物断言（㊷）：**必须有 SettingsPage、不能有 RulesPage**。

## 五、环境坑（都踩过，别再踩）

| 坑 | 做法 |
|---|---|
| PowerShell 管道会吃退出码（明明绿却报 exit 1） | 一律 `node xxx *> _log` 然后读 `$LASTEXITCODE` |
| `.gitignore` **行内注释无效**（`path  # 说明` 会被当模式） | 注释必须独占一行；曾因此把 `ai-rules/keys.json` 放进了索引 |
| `git rm -r --cached . -q` | `-q` 会被当 pathspec，索引清不掉 ⇒ 用 `git reset` |
| `fs.cpSync` 拷 180 MB Electron 运行时树 | 会让 Node 崩（`0xC0000409`）⇒ 用 `robocopy` |
| 模板 `aspect-ratio` 配 `max-height` | 会让盒子变扁、比例失真（模板里有旧警告） |
| 中文路径 / 编码 | 写文件用 UTF-8 无 BOM；换行由 `.gitattributes` 统一 LF（有"逐字节相等"断言） |

## 六、以后的版本（不要现在做）

- **v1.2**：半开源 + 肥鱼帮写小助手 + 教师反馈重绘（只重绘不重解，仍过 C1–C9）
- **v1.2.5**：本地对轨迹求导画 v/a 箭头（`bodies/phases/forces` 契约改动）+ 导出页批注
- **更远**：改名「小肥鱼物理动画」、场景卡（分层不接管）、表情包每阶段多图轮换

细节全在 `ROADMAP.md`。
