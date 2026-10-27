# AGENTS.md — 本项目的协作规则

本文件对任何在此仓库工作的 agent / 协作者都有效。**规则 1 是硬性约束，不得绕过。**

## 规则 1：禁止使用 PowerShell 写或修改文件内容

**原因**：本机上一个项目用 PowerShell 写文件时，中文内容被按本地代码页（GBK）或带 BOM 的方式写坏，
导致文件编码损坏、只能靠回退版本恢复。为杜绝此类事故，文件内容的写入一律不走 PowerShell。

### 禁止（写文件内容）

- `Set-Content` / `Add-Content` / `Out-File` / `Tee-Object`
- 重定向写入：`>`、`>>`、`*>`，以及 `pwsh -Command "... > file"`
- here-string（`@"..."@`）、`New-Item -Value`、`[IO.File]::WriteAllText`
- `Get-Content` 读出再写回（`-Raw` 往返同样会改编码）
- `Invoke-WebRequest -OutFile`、`Invoke-RestMethod` 存文件、`git config --global` 之外的批量写配置
- 任何脚本里"顺便"用 PowerShell 落盘生成源码、文档、配置、数据文件

### 正确做法

- **所有文件内容用编辑工具（write / edit 工具）创建和修改**，它们固定写 UTF-8（无 BOM）。
- 需要批量生成文件时：先用编辑工具写一个脚本源文件（Python / Node / bash 等），再执行该脚本，
  而不是用 PowerShell 内联生成。
- 需要从命令输出落盘时，让命令自己写（如 `git <cmd> --output=<file>`、工具的 `-o` 参数），
  或把输出回传到对话里、再用编辑工具写入文件。

### 允许（不涉及文件内容写入）

- 用终端执行 git、构建、测试、格式化、包管理等命令。
- 目录操作（`New-Item -ItemType Directory`、`Remove-Item` 删文件、`Move-Item` 移动等）
  不改变文本编码，可以使用；但**不要**顺手用它改写文件内容。
- 只读探查（`git status`、`Get-ChildItem`、`Get-Content` 仅用于查看）可以使用。

## 规则 2：编码与换行

- 文本文件统一 **UTF-8 无 BOM**、**LF**（`\r\n` 只允许出现在 `.bat` / `.cmd` / `.ps1` 里）。
- 由 `.editorconfig` 与 `.gitattributes` 保证；不要提交 GBK、UTF-16 或带 BOM 的文件。
- 发现文件乱码时**不要**就地"转码修复"，先 `git diff` 确认，必要时回退到上一版再重做。

## 规则 3：提交约定

- 提交信息优先用中文，但**不要**通过命令行参数传中文（PowerShell 会按本地代码页转码）。
  做法：用编辑工具把信息写进临时文件（UTF-8），再 `git commit -F <该文件>`，提交后删除该文件。
- 提交前跑 `git status` / `git diff --stat` 自查；不要提交 `.env`、密钥、构建产物、个人 IDE 配置。
- 不要做破坏性回退（`git reset --hard`、`git checkout -- .`、`git clean -fd`）除非用户明确要求。

## 规则 4：分支与历史

- 主分支：`main`。
- 一次提交只做一件事；同一提交内不要混入无关的格式化改动。
