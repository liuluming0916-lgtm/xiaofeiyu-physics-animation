# scripts 说明

这里放的是开发期脚本，不是程序运行时的一部分。按用途分三类。

## 日常会用

| 脚本 | 用途 |
|---|---|
| `regress.ts` | **回归自检**：改播放器/导出逻辑后先跑它（`npm run regress`，`--fast` 只查 4 份） |
| `build-app.ts` | 构建桌面运行时（`npm run build:app`），产出 `dist/app` |
| `pack-portable.ts` | 组装免安装版并写图标/版本信息（`npm run app:portable`） |
| `rewrap.ts` | 把已有产物重新套一层播放器外壳，不调用模型 |
| `run-problem.ts` | 命令行跑一道题（`npm run run`） |
| `check.ts` | 给一个现成 html 跑质检 |
| `batch.ts` | 批量跑题，产出 `开源日志/batch` |
| `make-icon.py` | 生成 `build-resources/icon.ico`（多尺寸） |
| `img2webp.py` | 把 `apps/web/assets/fish/*.jpg` 批量转成 webp |

## 排查用（偶尔）

| 脚本 | 用途 |
|---|---|
| `m0-demo.ts` | 沙盒冒烟测试，验证虚拟时钟与探针 |
| `launch.ts` | 启动教师界面（`启动.bat` 调它） |
| `pdf-text.ts` | 从 PDF 抽题面文字 |
| `probe-api.ts` / `probe-tools.ts` / `probe-image.ts` | 单独验证模型接口、工具调用、图片输入 |

## 课件素材

| 脚本 | 用途 |
|---|---|
| `extract-catalog.py` | 把考点 docx 抽成 markdown，便于改写 |
| `build-catalog-docx.py` | 把 `开源日志/_check/catalog-part*.md` 合成一份考点 docx |
| `check-catalog-docx.py` | 校验生成的 docx：表格数、考点数、有没有空行、有没有残留英文 |

## 一次性探针（留着备查，别当正式入口）

`shoot.ts`（早期截图）、`build-player-demo.ts`、`run-problem.ts` 的调试分支等。

> 新增脚本请顺手在上表补一行，不然半年后没人知道它还要不要。
