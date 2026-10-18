import json, os

C102 = """# 实验：探究弹簧弹力与弹簧伸长量的关系

## 适用判据
用**悬挂钩码**（或斜面上滑入钢球、用橡皮筋代替弹簧）探究**弹力与伸长量的关系**、求**劲度系数 `k`**；
图线**不过原点**、**末端弯曲**、或要用 `F-x` 图的**斜率/截距**反求物理量。

## 建模步骤
1. **实验原理**：平衡时**弹簧对钩码的弹力与钩码的重力大小相等** ⇒ `F = m g`；改变钩码个数即可改变 `F`，测对应伸长量 `x`。\n   ⇒ 于是"探究关系"变成"作 `F-x` 图"。
2. **器材**：铁架台、弹簧、钩码、**刻度尺**、坐标纸。\n   ⚠ 刻度尺要**竖直且靠近弹簧**；测长度必须在弹簧**竖直且静止**时读。
3. **操作规范（选择题的常考点）**：
   - 钩码要**逐一增挂**（不要随意增减）—— 这样作图方便，也不易超出弹性限度；
   - 钩码**不宜太多**，避免**超过弹性限度**；
   - 用**轻质**弹簧；**多测几组**数据。
4. **数据处理两条路**：\n   - **列表法**：算 `F/x`，在误差范围内为常数 ⇒ 说明 `F ∝ x`；\n   - **图像法**：以 `x` 为横轴、`F` 为纵轴描点、**作拟合直线**（让尽量多的点落线上、其余均分两侧）⇒ 过原点的直线，**斜率就是劲度系数 `k`**。
5. **图线"不过原点"的两种情况（最高频，务必分清）**：
   - **横轴截距为正**（`F = 0` 时已有伸长）⇒ **弹簧自身重力**的影响（横放在桌面上测原长、竖直悬挂时因自重先伸长）；
   - **末端向上弯曲/偏离直线**（`AB` 段偏离 `OA`）⇒ **超过了弹性限度**。
   ⇒ 判据一句话：**看偏离发生在原点端还是远端**。
6. **创新变式（换器材不换原理）**：
   - **斜面上滑入钢球**：平衡条件是 `n m g sin(theta) = k dL`（沿斜面方向），且**用逐差法**处理（`dL_i = L_{i+3} - L_i`）来求压缩量 ⇒ 平均压缩量对应"增加 `m` 个钢球"；\n   - **橡皮筋**：拉力由**竖直方向分力**等于钩码重力给出 `F cos(alpha) = m g` ⇒ `F = m g / cos(alpha)`；由胡克定律 `F = k (l - l_0)` 得\n     `1/cos(alpha) = (k/(m g)) l - k l_0/(m g)` ⇒ **作 `1/cos(alpha) - l` 图**：**斜率 = `k/(m g)`**、**纵轴截距 = `-k l_0/(m g)`** ⇒ 可同时求出 `k` 与 `l_0`；\n   - **弹性势能**：弹簧压缩 `dx` 推出小球，小球做**平抛** ⇒ `E_k = (1/2) m v_0^2 = m g s^2/(4h)`（`s` 水平位移、`h` 桌面高）；\n     由 `E_p = E_k` 且 `s` 与 `dx` 成**直线**关系 ⇒ **`E_p ∝ dx^2`**（因为 `E_p = (1/2) k dx^2` 而 `s ∝ dx`）。
     斜率随 `m`/`h` 的变化：`s = dx x sqrt(k/(2m)) x sqrt(2h/g)` 之类整理后 ⇒ `m` 增则斜率**减小**、`h` 增则斜率**增大**。
7. **误差分析两分**：
   - **偶然误差**：读数与作图不准 ⇒ 减小办法是**多测几组**；
   - **系统误差**：**弹簧自身重力**、弹簧老旧使 `k` 变化、钩码标值不准 ⇒ 减小办法是**用轻质弹簧**、校准钩码。
8. **求 `k` 的规范写法**：`k = (F_2 - F_1)/(x_2 - x_1)`（取图上**相距较远**的两点，不要用单个数据点），并注意单位换算（`cm -> m`）。

## 参考公式
- 平衡条件：`F = m g`（悬挂钩码）；斜面上 `F = n m g sin(theta)`
- 胡克定律：`F = k x`（`x` 为**伸长量/压缩量**，不是总长）
- 伸长量：`x = L - L_0`（`L` 为总长、`L_0` 为原长）
- 图线斜率：`k = (F_2 - F_1)/(x_2 - x_1)`
- 图线不过原点（横轴截距）⇒ **弹簧自身重力**；末端弯曲 ⇒ **超过弹性限度**
- 橡皮筋变式：`1/cos(alpha) = (k/(m g)) l - k l_0/(m g)` ⇒ 斜率 `k/(m g)`、纵截距 `-k l_0/(m g)`
- 斜面变式（逐差）：`dL_i = L_{i+m} - L_i`，平均值对应"增加 `m` 个钢球"，`k = m_球 g sin(theta) x m / dL`
- 弹性势能变式（平抛测 `v_0`）：`E_k = m g s^2/(4h)`；`E_p = E_k` ⇒ **`E_p ∝ dx^2`**
- 斜率随参数变化：`s = sqrt(k/(2m)) x sqrt(2h/g) x dx` ⇒ `m` 增 ⇒ 斜率**减**；`h` 增 ⇒ 斜率**增**
- 弹力与伸长量的比值：`F/x = k = 常数`（列表法的判据）

## 验算
- **量纲**：`k = F/x` 得 `N/m`；`m g s^2/(4h)` 得 `J`。
- 数量级：中学弹簧 `k` 常见 `10 ~ 10^2 N/m`；钩码质量常取 `50 g`（则每个钩码约 `0.49 N`）。
- 单位自检：坐标纸上的 `x` 常以 `cm` 给出，代入 `k = F/x` 前**必须化成 `m`**（否则 `k` 差 100 倍，是本题型最常见的计算错）。
- 原点自检：若图线**不过原点**，先判断是"横轴截距"还是"末端弯曲"，再对应"自重"或"超弹性限度"。
- 线性自检：`F/x` 在各组数据里是否为常数（在误差范围内）。
- 长度自检：`x = L - L_0` 用的是**伸长量**；若图线横轴是总长 `L`，则斜率仍是 `k`，但**横截距 = `L_0`**（别弄混）。
- 极限：`F -> 0` 时 `x -> 0`（理想情况下过原点）；`x` 很大时 `F-x` 图**偏离直线**（超弹性限度）。

## 常见错误
- 把**总长 `L`** 当成**伸长量 `x`** 代入胡克定律。
- 求 `k` 时只取**单个数据点**的 `F/x`（应取图上相距较远的两点求斜率）。
- 把"**横轴截距不为零**"的原因说成"超过弹性限度"（应为**弹簧自身重力**）。
- 把"**末端弯曲**"的原因说成"自身重力"（应为**超过弹性限度**）。
- 随意增减钩码（应**逐一增挂**）。
- 长度单位不统一（`cm` 与 `m` 混用）。
- 认为"弹簧越重越好"（应**轻质**，否则自身重力带来系统误差）。
- 橡皮筋变式里忘记"拉力沿橡皮筋方向、其竖直分力等于钩码重力"`F cos(alpha) = m g`。
- 弹性势能变式里认为"`s` 与 `dx` 成正比 ⇒ `E_p` 与 `dx` 成正比"（应为 **`dx^2`**）。
- 忘记"作图要用**拟合直线**"（用折线连点会掩盖规律）。

## 生成后自检（必须逐条在代码中体现）
- [ ] 代码里 `x = L - L0`（**伸长量**）显式写出，并在注释中标注单位换算（`cm -> m`）。
- [ ] 用**两组相距较远**的数据点算 `k = (F2-F1)/(x2-x1)`，并与"对全部点做最小二乘拟合"的斜率比对（断言二者接近）。
- [ ] **不过原点**的两种情形在代码里是两个分支：`interceptX > 0`（自重）与 `nonlinearTail`（超弹性限度），并断言分别触发对应结论。
- [ ] 由理想数据 `F = k*x` 叠加噪声生成"实验数据"，验证拟合斜率能还原 `k`（使自检可执行）。
- [ ] 橡皮筋变式：代码里实现 `1/cos(alpha)` 对 `l` 的**线性拟合**，并断言斜率 `= k/(m*g)` 而不只是"看起来是直线"。
- [ ] 弹性势能变式：代码里由 `s`、`h` 算 `v0` 与 `Ek`，并断言 `Ep ∝ dx^2`（取两组 `dx` 验证比值）。
- [ ] `stateAt` 保持 **O(1)**（实验是静态几何 + 解析式，不随时间演化）。
- [ ] `readouts` 给出 `k`、`x`（或 `L`、`L0`）、`F`；键与单位全时段不变（C8），数值有限（C3）。
- [ ] 画面上把**弹簧、钩码与刻度尺**画出来（`Draw.spring` 的长度随 `F` 变化），并在 `F-x` 图上用 `Draw.chart` 画出**数据点 + 拟合直线**，同时把**斜率三角形**标出来 —— \"斜率就是 k\"必须一眼可见。"""

E102 = """// 探究弹力与伸长量的关系：两点法 vs 最小二乘；不过原点的两种分支
setup: `
  const k = 50, L0 = 0.0773, g = 9.8;                 // 真值：k = 50 N/m
  const masses = [0.05, 0.10, 0.15, 0.20, 0.25];      // 钩码质量
  const F = masses.map((m) => m * g);
  const L = F.map((f) => L0 + f / k);                 // 理想总长
  const x = L.map((l) => l - L0);                     // 伸长量（注意单位：m）
  // ① 两点法（取相距最远的两点）
  const kTwoPoint = (F[F.length - 1] - F[0]) / (x[x.length - 1] - x[0]);
  // ② 最小二乘拟合斜率
  const n = F.length;
  const mx = x.reduce((s, v) => s + v, 0) / n, mf = F.reduce((s, v) => s + v, 0) / n;
  const kFit = x.reduce((s, v, i) => s + (v - mx) * (F[i] - mf), 0) / x.reduce((s, v) => s + (v - mx) ** 2, 0);
  const twoWaysOk = Math.abs(kTwoPoint - kFit) / k < 1e-9;
  // ③ 不过原点的两种情形（分支判据）
  const interceptX = 0.005;                            // 横轴截距 > 0 ⇒ 弹簧自身重力
  const fromSelfWeight = interceptX > 1e-9;
  const nonlinearTail = false;                         // 末端是否弯曲（示例：否）
  const overElasticLimit = nonlinearTail;
  // ④ 橡皮筋变式：1/cosα 对 l 线性 ⇒ 斜率 = k/(mg)，纵截距 = -k·l0/(mg)
  const mRub = 0.1, kRub = 98, l0Rub = 0.21;
  const slopeRub = kRub / (mRub * g), interceptRub = -(kRub * l0Rub) / (mRub * g);
  const lRub = 0.226;
  const invCos = slopeRub * lRub + interceptRub;       // = 1/cosα
  const cosAlpha = 1 / invCos;
  const checkF = (mRub * g) / cosAlpha;                // 由 1/cosα 反算拉力
  const hookeOk = Math.abs(checkF - kRub * (lRub - l0Rub)) < 1e-9;
  // ⑤ 弹性势能变式：Ep ∝ dx²
  const mBall = 0.02, hDesk = 0.8, kSpring = 200;
  const sOf = (dx) => dx * Math.sqrt(kSpring / (2 * mBall)) * Math.sqrt((2 * hDesk) / g);
  const EkOf = (s) => (mBall * g * s * s) / (4 * hDesk);
  const epQuadratic = Math.abs(EkOf(sOf(0.02)) / EkOf(sOf(0.01)) - 4) < 1e-9;   // dx 加倍 ⇒ Ep 四倍
  const SIM = { duration: 1 };
`,
stateAt: `
  return { kTwoPoint, kFit, twoWaysOk, fromSelfWeight, overElasticLimit, hookeOk, epQuadratic };
`,
drawFrame: `
  Draw.line([0, 0], [1, 0], { width: 2 });                                       // 桌面/刻度基准
  Draw.spring([0.5, 0.9], [0.5, 0.9 - (L[2] - L0) * 5], { coils: 10 });           // 弹簧伸长可见
  Draw.box([0.42, 0.9 - (L[2] - L0) * 5 - 0.08], 0.16, 0.08);                     // 钩码
  Draw.chart(x.map((v, i) => [v * 100, F[i]]), { fill: false, markers: true });   // F-x 数据点
  Draw.text(0.1, 1.1, `k(两点法) = ${Phys.format(kTwoPoint, 'N/m', 3)}`);
`"""

pack = {
    "format": "od-worldbook",
    "version": 1,
    "entries": [
        {
            "id": "wb_exp_hooke",
            "title": "实验：探究弹簧弹力与弹簧伸长量的关系",
            "origin": "builtin", "category": "solution_skill", "enabled": True, "constant": False, "recursive": True,
            "keys": ["探究弹力与伸长量的关系", "劲度系数的测量", "弹簧与钩码", "橡皮筋的伸长量", "斜面上滑入钢球", "图线不过原点"],
            "secondary_keys": {
                "logic": "AND_ANY",
                "list": ["逐一增挂钩码", "弹性限度", "弹簧自身重力", "拟合直线", "横轴截距", "系统误差", "弹性势能的探究"],
            },
            "insertion_slot": ["solve"], "order": 1110, "priority": "normal",
            "content": C102, "code_examples": [E102],
        }
    ],
}

text = json.dumps(pack, ensure_ascii=False, indent=2) + "\n"
json.loads(text)
with open("core/worldbook/source/10-experiments.json", "w", encoding="utf-8") as f:
    f.write(text)
print("已写出 10.2 到 10-experiments.json：", [(e["id"], len(e["content"])) for e in pack["entries"]])
