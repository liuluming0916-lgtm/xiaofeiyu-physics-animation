# 参与贡献

感谢你愿意帮忙。提交之前，请先读下面三件事。

## 1. 先签 CLA

**提 PR 前**，在 PR 描述里加一行：

```text
I have read docs/CLA.md and agree to it.
```

原因很简单：本项目是 **AGPL-3.0 + 商业授权**双轨，没有这项授权，维护者就没法向企业发放商业许可。
详见 [docs/CLA.md](docs/CLA.md)。

## 2. 内容边界

**不要提交第三方教辅的题目、解析、插图。** 本仓库不收录这些内容，
带进来会让整个仓库的许可失效。

自己原创的题目、示例动画，欢迎。

## 3. 提交前自检

```powershell
npm run typecheck          # 类型检查
npm run m0                 # 沙盒自检（会启动无头浏览器）
node scripts/check.ts examples/incline-ball.html   # 给现成动画跑质检
```

## 代码风格

- 文本文件统一 **UTF-8 无 BOM + LF**（见 `.editorconfig` / `.gitattributes`）；
- **不要用 PowerShell 写文件内容**（历史上有中文被写成 GBK 的事故，见 `AGENTS.md`）；
- 提交信息用中文，一次提交只做一件事。

## 提 PR

1. 从 `main` 拉分支；
2. 改动尽量小而聚焦；
3. PR 描述里写清：改了什么、为什么、怎么验证的；
4. 涉及动画效果的，附一张关键帧截图。
