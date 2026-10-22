# SDK 签名摘要（自动生成，请勿手改）

```
【SDK 签名摘要 · v1.0.0】按名字精确调用；未登记的函数会被静态预检拒绝。
— 绘图原语（只推命令，不接触 ctx）—
· Draw.line(a, b, style?) — 直线段。a/b 为世界坐标 [x,y] 或 {x,y}；style 可选 {width, dash, stroke}。**dash: true = 虚线，false/不写 = 实线**；只有要自定义间距时才写数字数组（如 [4, 3]）。
· Draw.arrow(from, vec, opts?) — **v/a 不再由模型画**：运行时按程序里的刚体声明自动求导绘制（绿=v / 蓝=a，间断点取碰后、冲量处画点）。`Draw.arrow` 只用于 `category: "force"`（受力，红）与 `"aux"`（传送带速度、电流、分量…，紫）。长度由 opts.mag 决定：长度 = 该类满量程 × (mag ÷ 该类整段最大 mag)，所以**必须给 mag**（真实量级）。**不要给 scale（已废弃）或 color（由 category 决定）**。
· Draw.polygon(points, style?) — 多边形/路径。style.hatch ∈ null|"below"|"belowBase" 画斜线阴影
· Draw.circle(center, r, style?) — 圆：质点、滚轮、场区边界；style.angleDeg 画半径线
· Draw.spring(a, b, opts?) — 随动弹簧：给定两端锚点自动定形，opts.coils 圈数
· Draw.pulley(center, r, opts?) — 滑轮：圆心 + 半径 + 轮轴
· Draw.belt(a, b, opts?) — 传送带/履带：两端滚轮 + 上下带面；opts.ticks 表面刻度数
· Draw.fieldDots(rect, opts?) — 均匀场点/叉阵列。rect={x,y,w,h}；opts.symbol ∈ dot|cross，opts.nx/ny 网格数
· Draw.dimension(from, to, opts?) — 尺寸/角度标注。opts.kind ∈ linear|angle，opts.text 标注文本
· Draw.arc(center, r, a0, a1, opts?) — 弧线：轨迹、圆周、角度弧；角度制，逆时针为正
· Draw.ellipse(center, rx, ry, opts?) — 椭圆：天体轨道、示意椭圆；rx/ry 是半轴（几何量）
· Draw.trace(points, opts?) — 轨迹虚线（curve 的实参默认值封装；默认就是虚线，不用再给 dash）
· Draw.curve(points, opts?) — 折线/路径；opts.closed 闭合，opts.fill 填充；opts.dash: true=虚线、false/不写=实线、[n,m]=自定义间距
· Draw.ghosts(positions, opts?) — 残影快照：一组位置画成同形轮廓
· Draw.ray(from, to, opts?) — 光线路，带箭头
· Draw.lens(center, opts?) — 透镜：opts.height 口径、opts.focal 焦距（几何量）
· Draw.axisBox(origin, xLen, yLen, opts?) — 坐标轴框（p–V / v–t 等），opts.xLabel/yLabel/xUnit/yUnit
· Draw.chart(samples, opts?) — 联动图表数据编码。samples=[[x,y],…]；opts.fill 填充（面积即物理量），opts.baseline
· Draw.raw(fn, opts?) — 逃生门（§5.4）：实时渲染给真 ctx；Dry-Run 只跳过该条指令的包络计算且计入使用率
· Draw.ground(x0, x1, y?, opts?) — 斜线阴影地面（组合原语，仍是几何量）
· Draw.incline(apex, opts?) — 斜面三角形体 + 斜线阴影底面。opts.angleDeg 正=坡脚在右下、负=坡脚在左下；opts.length 为沿面长度（几何量）
· Draw.box(center, w, h, opts?) — 方块/滑块：中心 + 宽高 + 可选转角
— 绘制约定（你只写 drawFrame 的函数体）—
· 只写 drawFrame 的函数体 — 位置只从 `state.<key>.x / .y` 读；不要重算运动、时间、速度。不要写函数头、槽位标记或解释。
· 不要写这些槽位 — `stateAt / VIEW / setup / readouts / STEPS / ANSWERS` 由程序生成；你只负责“怎么画”。
· 世界坐标 — x 向右、y 向上、单位米；不要写像素、相机比例或 canvas 尺寸。
· 画布上不写字 — 文字/公式标注、箭头 label、尺寸 text 都不显示；说明放画布外图例。
· 颜色与箭头 — 颜色由 `category` 决定，不要写 `color`。不要画 v/a 箭头；`force / aux` 箭头必须给 `category` 与 `mag`。
· 静止几何 — 地面画在 y=0；斜面/轨道穿过运动元件在 t=0 的位置；绳/杆连到实际锚点；不要悬空。
```
