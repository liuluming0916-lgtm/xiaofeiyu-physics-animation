# 交接书 · v1.1.9（本地解算 v/a 矢量）

> **新会话第一件事：读完这份文件，然后只做「下一步」那一节。**

---

## 一、当前状态（2026-10-19 16:20）

| 项 | 值 |
|---|---|
| 产品版本 | `package.json` = **1.1.9**（5 处版本号已同步） |
| 门禁 | `node tools/verify-all.mjs` → **48 步 / 0 ✗** |
| 打包 | `release/物理解题动画-v1.1.9/` + `物理解题动画-v1.1.9-win-x64.zip`（135.3 MB） |
| git | 有仓库；**1.1.7 与 1.1.9 的改动都还没提交**（工作区有 M/??） |
| 新取证 | `tests/kinematic-vectors-selftest.mjs`（26 条，门禁 ㊽） |

## 二、v1.1.9 改了什么（别重做）

1. **v/a 箭头不再由模型画**。模型在 `VIEW` 里写：
   ```js
   SIM = { duration, bodies: [{ id: 'block', at: (s) => [s.x, 0.34] }], phases?: [...] }
   ```
   运行时对每个刚体的位置求导，`sampleFrame` / `createPlayer.render` / Worker 后端**共用**
   `emitKinematicArrows()`；模型手写的 v/a 记录在运行时被过滤，C1 同步硬拦
   （`arrow-kinematic-forbidden`）。
2. **边界集** = `{0, duration} ∪ STEPS 全部 t0/t1 ∪ SIM.phases`；`phases` 可写成函数
   （q02 的 `tArc` 由 setup 算出，VIEW 里拿不到值）。
3. **间断点**：v 取**碰后**（t ≥ 边界）；v 跳变处 a 画点（0）；平滑边界用二阶单侧。
4. **数值底座**：`Phys.integrate` 每个采样点存 `dy`；`Phys.interp` 有斜率走 C¹ Hermite
   （PCHIP 限幅），没斜率退回线性。步长 v=1 ms、a=2 ms。
5. **`aux` 白名单保留**：传送带速度、电流、分量仍归模型画（紫）。受力箭头**没有撤**。
6. **曲线图未改源**：仍读 `readouts`（C7 依赖），留到 1.2.x。

## 三、下一步（1.2.0 公测）

按 `ROADMAP.md` 的 v1.2 三件事，**先只做第 1 件**：

1. **半开源版上线**：开放引擎/契约/判据/元件卡/门禁，私有写卡助手提示词与部分词条内容；
   在 `docs/贡献指南.md` 写明「开放范围」。
2. （随后）写卡助手闭环、教师反馈重绘。

⚠ 1.2.0 是公测，**不要再动 v/a 的数值口径**；本版已经够用。若教师反馈"箭头不对"，
先看是不是 `SIM.bodies` 声明错了（中心位置 ≠ 画出来的位置），而不是改求导公式。

## 四、已知残留（都是有意留的）

| 残留 | 影响 | 什么时候处理 |
|---|---|---|
| 手写查表（不走 `Phys.interp`）仍可能二阶差分不稳 | 可能闪一下 | 词条已要求"查表一律用 Phys.interp"；无静态判据 |
| 同刚体的 v/a 用 ±4px 错开，可能压住 force 箭头 | 观感 | 有人抱怨再说 |
| 图表仍是 `readouts`（模型值），与画布本地箭头可能有细微出入 | 读数与箭头不完全同源 | 1.2.x 一起改 |

## 五、环境坑（都踩过，别再踩）

| 坑 | 做法 |
|---|---|
| PowerShell 管道会吃退出码 | `node xxx *> _log`，再读 `$LASTEXITCODE` |
| `verify-all` 会重建 `template/build/*.html` 与 `web/dist` | 改运行时后**必须**跑它，否则成品页还是旧的 |
| 改 `tools/build-animation-cards.mjs` 后 | 跑 `node tools/build-animation-cards.mjs`（别手改 JSON），再 `rewrite-worldbook-entries --prune` + `build-builtin-bundle` |
| `package-lock.json` 的版本号也要跟着改 | 否则 `electron-repack` 的载荷校验会红 |
| `release/` 的 zip 要单独打 | `electron-repack` 只生成目录；zip 用 `tar -a -c -f`（或加 `--zip` 重跑，会重建） |

## 六、验证命令（按顺序）

```bash
node tools/build-animation-cards.mjs          # 卡片 + 元卡
node tools/rewrite-worldbook-entries.mjs --prune
node tools/build-builtin-bundle.mjs
node tools/verify-all.mjs                     # 48 步
node tools/electron-repack.mjs                # 绿色版目录
tar -a -c -f release/物理解题动画-v1.1.9-win-x64.zip -C release 物理解题动画-v1.1.9
```

细节全在 `ROADMAP.md` 与 `备忘录-1.1.9.md`。
