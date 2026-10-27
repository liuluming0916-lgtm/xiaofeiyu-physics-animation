# XFY-2.0

本项目的工作仓库（初始化阶段，尚无业务代码）。

## 开始之前

**任何 agent 或协作者进入本仓库，先读 [AGENTS.md](AGENTS.md)。**

其中最重要的硬性规则：**禁止使用 PowerShell 写或修改文件内容**。
历史事故：用 PowerShell 落盘时中文被按 GBK / 带 BOM 写坏，只能回退版本。
所有文件内容一律用编辑工具（UTF-8 无 BOM）创建与修改。

## 仓库结构

```
AGENTS.md        协作规则（含编码红线）
README.md        本文件
.editorconfig    编码 / 换行 / 缩进约定
.gitattributes   仓库内统一 LF，二进制文件不做转换
.gitignore       忽略规则
```

## 环境

- Git 2.55 / Windows
- 主分支 `main`
