# 小肥鱼物理解题动画

把一道物理题（文字或拍照）变成**能动、能量化讲**的动画，再导出成单文件网页或 GIF。

- 面向**物理老师**的 Windows 桌面应用（Electron），不做在线服务。
- 全程本地运行：题目、模型 Key、导出文件都留在你自己的电脑上。
- 生成链：`read_problem → solve → breakdown ∥ analysis → scene_code → dry_run → repair → couple`。
  模型只负责“怎么画”，位置、速度、曲线由本地物理分析生成。

---

## 许可（先看这个）

| 部分 | 协议 | 能商用吗 |
|---|---|---|
| 程序源码 | **[AGPL-3.0-only](LICENSE)** | 能，但必须开源回流 |
| 文档 / 知识卡 / 提示词 | **[CC BY-NC-SA 4.0](LICENSE-DOCS)** | **不能** |
| 名称与 Logo | 保留（[TRADEMARK](TRADEMARK.md)） | 需授权 |
| **你用本软件导出的动画** | **归你**（[NOTICE §四](NOTICE)） | **能，随便用** |

> **一句话**：自己用、教学用、改着玩——随便。拿去卖、闭源集成——先看[商业授权](COMMERCIAL.md)。

许可范围的完整定义只有一处：[**NOTICE**](NOTICE)。两份协议原文是 `LICENSE` 与 `LICENSE-DOCS`，
它们不含适用范围，不要从文件名猜。

### 我能这么用吗

| 场景 | 算商用吗 |
|---|---|
| 老师备课、课堂播放 | 否 |
| 学生个人学习 | 否 |
| 学校 / 教研组内部使用（非营利） | 否 |
| 写论文、做课题 | 否 |
| 培训机构上课使用 | **是** |
| 公司内部培训 | **是** |
| 二次开发后闭源分发 | **是**，且违反 AGPL |
| 做成在线服务收费 | **是**，除非按 AGPL §13 公开源码 |
| 把知识卡 / 提示词用于商业产品 | **是** |
| 把导出的动画放进付费课件 / 网课 | **否**——导出物归你 |

判断口径的细节见 [帮助 · 许可](docs/帮助.md#五我能这么用吗)。

---

## 快速开始

环境：Node.js ≥ 20，Windows x64。

```bat
:: 1) 依赖
npm install
cd web && npm install && cd ..

:: 2) 构建前端
node tools\web-build.mjs

:: 3) 总门禁（56 步，必须全绿再动手）
node tools\verify-all.mjs
```

看到 `✓ 全部门禁通过` 才算环境对了。红了先别改代码，对照 [门禁都盯什么](docs/门禁都盯什么.md)。

> 依赖缓存必须落在项目目录内（`.npm-cache/`、`.pnpm-store/`），已写在 `.npmrc` 与 `web/.npmrc` 里，别改成全局缓存。

启动开发形态：`node tools\electron-build.mjs --dev`（即 `npm run app:start`）。

---

## 文档

| 你关心的事 | 看这里 |
|---|---|
| 怎么用（老师视角） | [docs/index.md](docs/index.md) |
| 许可、商用边界、导出物归属 | [NOTICE](NOTICE) |
| 想闭源商用 | [COMMERCIAL.md](COMMERCIAL.md) |
| 名称与 Logo 能不能用 | [TRADEMARK.md](TRADEMARK.md) |
| 软件里“关于”页写什么 | [docs/关于.md](docs/关于.md) |
| 软件里“帮助”页写什么 | [docs/帮助.md](docs/帮助.md) |
| 想提 PR | [docs/贡献指南.md](docs/贡献指南.md) + [docs/CLA.md](docs/CLA.md) |
| 项目做到哪了（唯一权威） | [项目现状与路线.md](项目现状与路线.md) |

---

## 贡献

欢迎提 issue 和 PR，但有两件事先说清楚：

1. **判据（C1–C9）、门禁、生成链的口径不欢迎“顺手改”**——它们是这个项目的信誉所在。
   想放宽一条检查，先在 issue 里说清它误报了什么题、证据是什么。
2. **提交前要签 [CLA](docs/CLA.md)**。这不是形式：本项目采用 AGPL + 商业授权双轨，
   没有贡献者授权，就无法向企业发放商业许可。

提交规矩、编码要求、常见错误见 [docs/贡献指南.md](docs/贡献指南.md)。

---

## 免责

- 生成结果由大模型产出，**物理过程与结论可能有错**，以教材与任课教师判断为准。
- 软件按“现状”提供，不提供任何明示或默示担保。
- 第三方组件按其自身协议授权，清单见 [NOTICE §五](NOTICE)。

---

## 联系

- 一般问题 / bug：https://github.com/liuluming0916-lgtm/xiaofeiyu-physics-animation 的 Issues
- 商业授权：1241640869@qq.com
