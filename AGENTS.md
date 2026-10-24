# AGENTS.md · 本仓库的硬规矩

> 给所有进入这个仓库的 AI / 协作者看的。  
> 当前版本：**v1.1.19 开发中**；事实口径以 [`项目现状与路线.md`](项目现状与路线.md) 为准。  
> 门禁当前是 **56 步**（v1 知识卡退役后从 58 减到 56）；不要把它写成 58。

---

## 1. 文本源码：只用编辑工具，不用 PowerShell 写盘

**必须**用本仓库的 `edit` / `write` 工具，或 VS Code 等编辑器改源码。  
也可以走 Node / Python，但必须**显式 UTF-8**：

```js
fs.writeFileSync(path, text, 'utf8')
```

```python
open(path, 'w', encoding='utf-8', newline='\n')
```

**禁止**用 Windows PowerShell 改任何文本源码：

```powershell
# ❌ 全部禁止（会按 ANSI/GBK 或 UTF-16LE 处理）
Get-Content file.mjs | Set-Content file.mjs
(Get-Content file.mjs) -replace 'a','b' | Set-Content file.mjs
Get-Content file.mjs > file2.mjs
"..." >> file.mjs
Out-File file.mjs
```

原因（真实事故）：Windows PowerShell 5.1 的 `Get-Content` / `Set-Content` 默认按系统 ANSI（中文机器是 GBK）处理；UTF-8 中文会被当成 GBK 读，再写回就变成乱码。`>` / `>>` 还可能写出 UTF-16LE。`core/orchestrator/pipeline.mjs` 已经因此坏过一次。

**如果确实只能用 PowerShell 7**，必须写死编码，且仍然不要用重定向：

```powershell
$text = Get-Content -Raw -Encoding utf8 $path
Set-Content -Path $path -Value $text -Encoding utf8NoBOM
```

---

## 2. 一个文件，同一时间只允许一个写手

多个对话分支 / 多个 agent 同时改同一个文件，是“互相覆盖 + 编码损坏”的温床。  
改 `pipeline.mjs`、`verify-all.mjs`、`package.json` 这类核心文件前：

1. `git status` 看有没有别人的未提交改动；
2. 有冲突就停下来，不要硬写；
3. 一个文件同一时间只让一个 agent 改。

---

## 3. Git：小步提交，先存档再冒险

提交不是发布，只是本机存档点。

**必须提交的时机：**

- 开始一轮工作前（工作区脏就先存一个 checkpoint）；
- 一个 bug 修完、门禁绿；
- 交给另一个 agent / 另一个对话分支前；
- 做危险操作前（批量替换、重构、编码转换、重命名）。

**提交信息示例：**

```text
wip: v1.1.18 B1 坐标改造
fix: 空 ANSWERS 不再被门卫拦
fix: /api/run 带规则快照
checkpoint: 56 步门禁绿
```

**禁止提交：**

- `ai-rules/keys.json`（Key）
- `data/history.db`
- `release/`
- `exports/`
- `开源日志/`
- `.tmp-*`
- `node_modules/`

**禁止未经用户明确要求执行：**

```text
git reset --hard
git checkout -- <file>
git clean -xdf
```

`git clean -xdf` 会删用户 Key、用户卡、`data/history.db`、`release/`——项目文档已明令禁止。

---

## 4. 提交前必须跑编码检查

```bash
node tools/check-encoding.mjs
```

只检查暂存区：

```bash
node tools/check-encoding.mjs --staged
```

pre-commit 钩子用的是不 spawn git 的 stdin 形式（避免沙箱/管道限制）：

```bash
git diff --cached --name-only -z --diff-filter=ACMR \
  | node tools/check-encoding.mjs --stdin
```

启用钩子（一次性，在普通 PowerShell / VS Code 终端里做）：

```bash
git config core.hooksPath .githooks
```

或者双击根目录的 **`4-EnableEncodingGuard.bat`**。
⚠ DSH 沙箱里 Git 钩子起不来（bash 信号管道 EPERM），所以本仓库**默认不设置** `core.hooksPath`；
在沙箱里用 `--stdin` / 全仓库扫描代替，提交请走普通终端或 VS Code。

它会检查：

- 非法 UTF-8；
- NUL 字节 / UTF-16 BOM / UTF-8 BOM；
- 代码文件里高密度的“UTF-8 被当 GBK 读”乱码片段。

**发现可疑就停下来**，不要用 `iconv` 猜着逆转；先找 git / 编辑器本地历史（见第 6 节）。

`1-Check.bat` 也会先跑这个检查，再跑门禁。

---

## 5. 门禁与当前基线

```bash
node tools/verify-all.mjs
```

- 当前 **56 步**（v1 知识卡 / v1 内置封死两项已退役）；
- ⓪ 覆盖自检在 56 步之前先跑；
- 如果输出 56 步但文档写 58，先改文档，不要“把步骤加回去凑数”；
- 通过后打印 `✓ 全部门禁通过`。

---

## 6. 编码已经坏了怎么救

优先级从高到低：

1. `git status` / `git diff` 看有没有未提交改动；
2. `git show HEAD:<file>` 取 HEAD 版本（用 Node 写临时文件，**不要用 `>`**）；
3. VS Code 右键文件 → **Open Timeline / Local History**；
4. `git fsck --lost-found` 找 dangling blob；
5. `git reflog` / `git stash list`；
6. 编辑器撤销历史（如果还没关）。

如果只是“UTF-8 被当 GBK 读了一次”，可以试 `Reopen with Encoding → GBK` 再 `Save with Encoding → UTF-8`；  
**如果已经被重新编码过，字节已经变了，不能简单逆转。**

---

## 7. 仓库里不要做的事（摘自项目文档）

- 不要给每道题新建舞台模板；
- 不要模型写画幅/相机/像素/运动/`stateAt`；**尺寸与示意比例归模型（方案二）**；
- 不要把 `Draw.text/latex` 或 `Phys.interp/roots/format` 引回来；
- 不要把单题返修意见写进链路提示词（要生效就做成闸门）；
- 不要用 PowerShell 的 `Get-Content` / `Set-Content` 改源码。

---

## 8. 快速自检清单

开工前：

- [ ] `git status` 干净，或有明确的 WIP 提交
- [ ] 没有多个人同时改同一个文件
- [ ] 读一遍 `项目现状与路线.md` 的当前口径

提交前：

- [ ] `node tools/check-encoding.mjs`
- [ ] `node tools/verify-all.mjs`（或至少相关测试）
- [ ] 没有提交 Key / history.db / release / tmp

出事后：

- [ ] 先备份现场
- [ ] 找 git / 编辑器历史
- [ ] 不要 `iconv` 猜
- [ ] 修完补一条回归，防止再犯
