# SDK 签名摘要（自动生成，请勿手改）

```
【SDK 签名摘要 · v1.0.0】按名字精确调用；未登记的函数会被静态预检拒绝。
— 绘图原语（只推命令，不接触 ctx）—
· Draw.line(a, b, style?) — 直线段。a/b 为世界坐标 [x,y] 或 {x,y}；style 可选 {width, dash, stroke}
· Draw.arrow(from, vec, opts?) — 分类矢量箭头。vec 只给**方向**（几何矢量）；长度由 opts.mag 决定：长度 = 该类满量程 × (mag ÷ 该类整段最大 mag)，所以**必须给 mag**（真实物理量，如 |v|、|a|、|F|）。opts.category ∈ velocity|acceleration|force|aux 决定颜色（绿=速度/蓝=加速度/红=受力/紫=辅助）；opts.label 标注、opts.unit 单位。**不要给 scale（已废弃）或 color（由 category 决定）**。
· Draw.polygon(points, style?) — 多边形/路径。style.hatch ∈ null|"below"|"belowBase" 画斜线阴影
· Draw.circle(center, r, style?) — 圆：质点、滚轮、场区边界；style.angleDeg 画半径线
· Draw.spring(a, b, opts?) — 随动弹簧：给定两端锚点自动定形，opts.coils 圈数
· Draw.pulley(center, r, opts?) — 滑轮：圆心 + 半径 + 轮轴
· Draw.belt(a, b, opts?) — 传送带/履带：两端滚轮 + 上下带面；opts.ticks 表面刻度数
· Draw.fieldDots(rect, opts?) — 均匀场点/叉阵列。rect={x,y,w,h}；opts.symbol ∈ dot|cross，opts.nx/ny 网格数
· Draw.dimension(from, to, opts?) — 尺寸/角度标注。opts.kind ∈ linear|angle，opts.text 标注文本
· Draw.arc(center, r, a0, a1, opts?) — 弧线：轨迹、圆周、角度弧；角度制，逆时针为正
· Draw.trace(points, opts?) — 轨迹虚线（curve 的实参默认值封装）
· Draw.curve(points, opts?) — 折线/路径；opts.closed 闭合，opts.fill 填充
· Draw.ghosts(positions, opts?) — 残影快照：一组位置画成同形轮廓
· Draw.ray(from, to, opts?) — 光线路，带箭头
· Draw.lens(center, opts?) — 透镜：opts.height 口径、opts.focal 焦距（几何量）
· Draw.axisBox(origin, xLen, yLen, opts?) — 坐标轴框（p–V / v–t 等），opts.xLabel/yLabel/xUnit/yUnit
· Draw.chart(samples, opts?) — 联动图表数据编码。samples=[[x,y],…]；opts.fill 填充（面积即物理量），opts.baseline
· Draw.text(x, y, text, opts?) — 带上下标的标注。opts.sub/opts.sup 下标/上标，opts.leaderTo 引线
· Draw.latex(x, y, tex, opts?) — 公式标注（MathJax 渲染；渲染不可用时降级为原文 §2.2）
· Draw.raw(fn, opts?) — 逃生门（§5.4）：实时渲染给真 ctx；Dry-Run 只跳过该条指令的包络计算且计入使用率
· Draw.ground(x0, x1, y?, opts?) — 斜线阴影地面（组合原语，仍是几何量）
· Draw.incline(apex, opts?) — 斜面三角形体 + 斜线阴影底面。opts.angleDeg 正=坡脚在右下、负=坡脚在左下；opts.length 为沿面长度（几何量）
· Draw.box(center, w, h, opts?) — 方块/滑块：中心 + 宽高 + 可选转角
— 计算辅助 —
· Phys.integrate(state0, deriv, t0, t1, opts?) — 通用 RK 积分，返回 {samples,stateAt}。**只允许在 setup() 内调用**（§7.6）
· Phys.interp(samples, t, key?) — 采样表插值（二分查找，O(log n)），可在 stateAt 内安全使用
· Phys.roots(fn, a, b, opts?) — 区间求根（二分），O(log(1/eps))，可在 stateAt 内使用
· Phys.format(value, unit, sigFig?) — 有效数字格式化（缺省 3 位），用于 readouts 与标注
— 槽位约定 —
· /* @slot:… */ … /* @end */ — 8 个槽位必须逐个用标记包裹；缺标记/重复标记/未知标记名一律 C1 失败（§3.5）
· SIM = { duration } — VIEW 槽位必须定义 SIM.duration（秒）。不得写像素尺寸、相机比例或轨迹表达式
· STEPS = [{title, tex, t0, t1}] — t0/t1 必须无缝、有序、不重叠；末步 t1 = SIM.duration（C5）
· ANSWERS = [{symbol, value, unit, tol, at_t, step, latex?}] — C7 用 at_t 时刻的 readouts 复现 value；纯符号题 value=null 且 latex 必填（§3.3）
· stateAt(t) → 状态对象 — 必须 O(1)：查表或解析式。禁止 Phys.integrate、禁止 O(n) 重算（§7.6）
· drawFrame(t, state) → 只调 Draw.* — 拿不到 ctx。每一帧从空缓冲开始重推命令
· readouts(t, state) → Readout[] — Readout = {label, value, unit, latex?}；键集合与单位全时段不变（C8）
· RETURN(key, value) — 在 setup() 内显式导出派生量/查表，供 stateAt 读取（可选）
· 世界坐标 — x 向右、y 向上、单位米。不要考虑像素
```
