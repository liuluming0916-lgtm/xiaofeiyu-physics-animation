/**
 * ⚠ **本文件由 `tools/build-worldbook-web.mjs` 自动生成，请勿手改。**
 *
 * 来源（唯一事实来源）：
 *   · 内置词条：`core/worldbook/data/*.json`（由 `tools/rewrite-worldbook-entries.mjs` 写出）
 *   · 覆盖率：`core/worldbook/coverage.mjs`
 * 生成时机：`node tools/web-build.mjs` 的 ⓪ 段（前端打包之前）。
 *
 * ── 说明（v1.1.9 改）
 *
 * 这里是**构建期内置快照**：发行版的内置层读的是编译常量（`builtin-bundle.generated.mjs`）。
 * **用户层**（`ai-rules/worldbook/`）不在这个文件里 —— 设置页通过 `/api/worldbook/*` 读写它。
 * 本快照只用于"内置有哪些卡"的初始显示与覆盖关系判断。
 * 预览器的**触发与组装逻辑是真的**（用的是 `core/worldbook/engine.mjs` 的逐字节副本）。
 */
/**
 * ⚠ 这里**不要**写 `as const`：它会把 `insertion_slot` 变成 `readonly ["solve", …]`，
 *   而 `readonly string[]` **不能**赋给 `string[]`（引擎的类型声明里是可变的），
 *   一处 `as const` 就能让整个设置页的 `tsc` 报一串看不出原因的错。
 */
/** 构建期快照：内置词条（`origin: builtin`） */
export const WORLDBOOK_BUILTIN = [
    {
        "id": "wb_visual_conventions",
        "title": "画面视觉约定（坐标 / 颜色 / 一屏画完）",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "世界坐标",
            "坐标系",
            "正方向",
            "像素",
            "比例尺",
            "颜色"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 200,
        "priority": "high",
        "content": "# 画面视觉约定\n\n## 判据\n任何生成动画的题都适用（动画槽的通用约定）。\n\n## 约定\n- 世界坐标：x 向右、y 向上，单位米；用米量，不用像素、不用屏幕尺寸。\n- 一屏画完：主体居中，关键标注留出余量；视口交给 AutoView 自动定。\n- 颜色由系统按 category 决定（速度绿、加速度蓝、受力红、辅助紫），不用自己指定。\n- 元素名用 Draw.text 放在旁边，画面中央留给运动和几何关系。\n- 虚线统一写 `dash: true`（如 `Draw.line(a, b, { dash: true })`）；实线不写或写 `dash: false`。只有要自定义虚线间距时才写数字数组（如 `[4, 3]`）；不要写字符串。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] 所有坐标都是米，没有像素量与像素比例。\n- [ ] 箭头给 category 与 mag，不写 color 与 scale。\n- [ ] 画面元素都在可视范围内，没有被裁掉。",
        "code_examples": [
            "setup: `\n  const SCALE = 1.0;   // 1 世界单位 = 1 米，不做像素换算\n`",
            "drawFrame: `\n  // 虚线：true；实线：不写或 false\n  Draw.line([0, 0.4], [2, 0.4], { dash: true });\n  Draw.line([0, 0], [2, 0], { width: 2 });\n`"
        ]
    },
    {
        "id": "wb_scene_stages",
        "title": "阶段表与状态组织（多段过程的骨架）",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "阶段表",
            "阶段",
            "转折点",
            "边界",
            "多过程"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 201,
        "priority": "high",
        "content": "# 阶段表与状态组织\n\n## 判据\n过程被切成多段、要与\"上一步/下一步\"对齐，或同时有多个物体在动。\n\n## 约定\n- 阶段表就是 STAGES = [{ t0, t1, label }]：每段边界对准一个真实事件，末段 t1 等于 SIM.duration。\n- 边界时刻在 setup() 里先算好（Phys.roots 或解析式），用 RETURN 导出，stateAt 读同一个数。\n- 每个会动的物体一个 state 字段（如 xBlock、xBoard），箭头从各自中心出发。\n- 相邻两段在边界处位置相等；速度只在有冲量时跳变。\n- 边界在画面上要有可见标记（细虚线或短标注），让人对得上步骤跳转。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] STEPS 的 t0/t1 与 STAGES 一一对应，末段 t1 = SIM.duration（C5）。\n- [ ] 每个边界在 drawFrame 里画出来，画面不凭空变向。\n- [ ] stateAt 全程有定义且 O(1)：查表或解析式。",
        "code_examples": [
            "setup: `\n  const STAGES = [{ t0: 0, t1: 1.0 }, { t0: 1.0, t1: 2.0 }];\n  RETURN('STAGES', STAGES);\n`"
        ]
    },
    {
        "id": "wb_anim_conventions",
        "title": "动画常驻·坐标与正方向（世界坐标 / 单位 / 时间 / 读数口径）",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": true,
        "recursive": false,
        "keys": [],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 1,
        "priority": "high",
        "content": "# 动画基本约定（常驻 · 任何题都适用）\n\n这段代码由机器播放、机器量、机器对答案，所以\"坐标、正方向、单位\"必须**全片一套**。\n\n## 坐标与尺寸\n- **世界坐标**：x 向右、y 向上、单位米；视口由系统算，**不许写像素**（`pixels_per_meter`、`canvas.width`、`getContext` 一律判失败）。\n- 长度就是题面的米数（板长 3 m 就画 3 m）；天文/微观用示意比例，并在图注写\"示意图，未按比例\"。\n- 位置一律由物理量算出来（`Draw.box([state.x, 0.15], …)`），不要写死一屏坐标。\n\n## 正方向（最容易翻车）\n- 解析里定了哪个方向为正，代码里就同一个：向右为正 ⇒ 向左的速度写负值，`state.v` 可以是负数。\n- **v/a 箭头不在这里画**（v1.1.9）：在 `VIEW` 里声明 `SIM.bodies = [{ id, at: (state) => [x, y] }]`，\n  运行时会自动画 v（绿）与 a（蓝）—— 箭头永远等于画面里物体的实际运动。\n- 只有 `force`（红）与 `aux`（紫：传送带速度、电流、分量）才用 `Draw.arrow`；`vec` 只给方向，\n  **长度由 `mag` 决定**（真实量级）：`state.v = -2` 时写 `vec: [-1, 0]` + `mag: 2`。\n- 角度：代码里用**弧度**；但 `Draw.incline` 的 `angleDeg`、`Draw.arc` 的 `a0/a1` 是**角度制**，两套别混。\n\n## 单位、常量与时间\n- 一律 SI（m、s、kg、N、J、A、V、T）；cm、km/h、eV、cmHg 在 `setup()` 里换算一次并写注释。\n- 题面给的数（`g`、`mu`、`L`、`R`）在 `setup()` 里以**同名常量**出现；没给 `g` 就取 10 并写注释。**不许中途换值**（C7 要拿读数对答案）。\n- `t` 单位秒，范围 `[0, SIM.duration]`；`stateAt(t)` 全程有定义、且 O(1)（解析式或查表，不在里面积分）。\n- `STEPS` 的 `t0/t1` 首尾相接、不重叠，**末步 t1 = SIM.duration**（C5）；这个数写成一个字面量，注释给出算法。\n- **槽位正文从第一行代码开始**：`setup` 的第一行就是 `const …`、`readouts` 的第一行就是 `return [`（函数头与收尾括号由装配器提供）。\n\n## 读数（readouts）\n- 每项 `{ label, value, unit }`；`label` 与 `ANSWERS.symbol` **逐字一致**（C7 就靠它）。\n- 键集合与单位**全时段不变**（C8）；数值必须有限（C3：NaN / Infinity 直接判失败）。\n- 画面上显示数值用 `Phys.format(value, unit)`；中文说明放数据面板，不挂在箭头上。\n- **符号题（`value: null`）照样要画图**：图表数据取 `setup()` 里的示意取值，并在图注写\"示意\"；不要因为没有数值就把图省掉。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] 全片没有像素量；**会动的物体都在 `SIM.bodies` 里声明了**，没有手写 v/a 箭头。\n- [ ] 还能画的箭头（force / aux）都带 `category` 与 `mag`，且没有 `color` / `scale`。\n- [ ] `SIM.duration` 与 `STEPS` 末步 `t1` 是同一个数（C5）。\n- [ ] `readouts` 的每个 `label` 都能在 `ANSWERS.symbol` 里找到（C7）。\n- [ ] 角度在代码里是弧度；`incline` / `arc` 的角度制参数单独换算，两套单位没有混用。",
        "code_examples": [
            "// v1.1.9 的正确写法：v/a 不画箭头，只声明刚体\nVIEW: `\n  SIM = { duration: 2, bodies: [{ id: 'block', at: (s) => [s.x, 0.15] }] };\n`\nsetup: `\n  const v0 = 2;\n  RETURN('v0', v0);\n`\nstateAt: `\n  const v0 = context.v0;\n  return { x: -v0 * t, v: -v0 };            // 向左运动 ⇒ 速度与位移都为负\n`\ndrawFrame: `\n  const p = [state.x, 0.15];\n  Draw.ground(-2.4, 0.6);\n  Draw.box(p, 0.4, 0.3);\n  // v 箭头由 bodies 自动生成（绿色、朝左），这里不用写\n`"
        ]
    },
    {
        "id": "wb_anim_elements_overview",
        "title": "动画常驻·元件总览（30 个元件的最小画法，全部实测过）",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": true,
        "recursive": false,
        "keys": [],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "block",
            "board",
            "incline",
            "ball",
            "arc_track",
            "ground",
            "spring",
            "pulley",
            "rope",
            "rod",
            "stand",
            "belt",
            "circuit",
            "plates",
            "ray",
            "lens",
            "field_region",
            "vector",
            "trace_path",
            "paper_tape",
            "ghosts",
            "axis_box",
            "chart",
            "graph_wave",
            "orbit",
            "cylinder_piston",
            "gas_tube",
            "light_spot",
            "measuring_tool",
            "raw_composite"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 2,
        "priority": "high",
        "content": "# 动画元件总览（常驻）：每个元件怎么画\n\n用法：认出元件（题面有传送带就是 `belt`），位置来自 `state.*` 或 `setup` 算好的量。\n下面每行都在校验器里真跑过（C1 + 实跑）。`state` 是 `stateAt(t)` 的返回值；读别的时刻用 `context.at(tt)`，\n但它只能在 `drawFrame` / `readouts` 里用（写在 `stateAt` 里会无限递归）。\n\n> 每个元件的「最常错的地方」在它自己的那张卡里（一行一个元件，按需注入）——这里只留画法，不重复。\n> ⚠ 方案 A 起**画布上不写任何文字**（`Draw.text` / `Draw.latex` / 箭头标签 / 尺寸文字都不显示），标注由画布外的图例承担。\n> 虚线统一写 `{ dash: true }`；实线不写；只有自定义间距才写 `[n, m]`。`Draw.trace` 默认就是虚线。\n\n## 力学器材\n- `block` 物块 / 滑块：`Draw.box([state.x, 0.15], 0.4, 0.3)`\n- `board` 长木板 / 小车：`Draw.box([state.xBoard, 0.05], 3.0, 0.1)`\n- `incline` 斜面 / 斜坡：`Draw.incline([0, 0.6], { angleDeg: 30, length: 1.2 })`\n- `ground` 地面 / 墙面（斜线阴影）：`Draw.ground(-1.5, 2.5)`\n- `ball` 小球 / 质点：`Draw.circle([state.x, state.y], 0.08)`\n- `arc_track` 圆弧轨道 / 拱桥：`Draw.arc([0, 0], 0.8, -90, 90)`\n- `spring` 弹簧：`Draw.spring([0, 2.0], [0, state.yTop], { coils: 12 })`\n- `pulley` 滑轮：`Draw.pulley([0, 2.4], 0.2)`\n- `rope` 绳 / 细线：`Draw.line([-0.2, 2.4], [-0.2, state.yA])`\n- `rod` 导体棒 / 轻杆：`Draw.line([state.xr, 0], [state.xr, 0.5], { width: 3 })`\n- `stand` 铁架台 / 支架：`Draw.line([-1.2, 0], [-1.2, 2.2], { width: 2 })  Draw.ground(-1.6, 2.4)`\n- `belt` 传送带 / 履带：`Draw.belt([0, 0.2], [4, 0.2], { ticks: 16 })`\n\n## 场与电\n- `circuit` 电路 / 导线 / 电表：`Draw.line([0, 0], [2, 0])  Draw.line([2, 0], [2, 1])  Draw.line([2, 1], [0, 1])  Draw.line([0, 1], [0, 0])  Draw.arrow([1.0, 0], [1, 0], { category: 'aux', mag: Math.abs(state.I), label: 'I', unit: 'A' })`\n- `plates` 平行板 / 极板：`Draw.line([-1, 1.6], [3, 1.6], { width: 3 })  Draw.line([-1, 0.4], [3, 0.4], { width: 3 })`\n- `field_region` 匀强场区（× / · 阵列）：`Draw.fieldDots({ x: 0, y: 0, w: 2, h: 1.5 }, { symbol: 'cross', nx: 10, ny: 8 })`\n- `ray` 光线：`Draw.ray([-1, 0.8], [0, 0.8])`\n- `lens` 透镜：`Draw.lens([1, 0.8], { height: 1.2, focal: 0.5 })`\n- `light_spot` 光斑 / 照射区域：`Draw.polygon([[1.4, 0.2], [1.6, 0.26], [1.6, 0.14]], { fill: 'rgba(90,150,255,0.25)' })`\n\n## 矢量与标注\n- `vector` 矢量箭头（受力 / 辅助）：`Draw.arrow([state.x, state.y], [1, 0], { category: 'force', mag: state.f, label: 'F', unit: 'N' })`\n- `trace_path` 轨迹：`Draw.trace([[0, 0], [state.x, state.y]])`\n- `paper_tape` 纸带 / 点迹：`Draw.box([0.5, -0.6], 2.0, 0.12)  Draw.circle([state.d1, -0.6], 0.01)`\n- `ghosts` 频闪残影：`Draw.ghosts([[0, 0.2], [0.5, 0.2], [1.0, 0.2]])`\n- `measuring_tool` 尺寸/角度标注（刻度尺）：`Draw.dimension([0, 0.4], [1, 0.4], { kind: 'linear', text: 'L = 1.0 m' })`\n\n## 图示\n- `axis_box` 坐标轴框（v–t / p–V）：`Draw.axisBox([-0.2, -0.2], 2.4, 4.4, { xLabel: 't', xUnit: 's', yLabel: 'v', yUnit: 'm/s' })`\n- `graph_wave` 波形 / 连续曲线：`Draw.curve([[0, 0], [0.5, 0.3], [1, 0], [1.5, -0.3]])`\n- `chart` 图线 + 面积着色：`Draw.chart([[0, 0], [1, 2], [2, 4]], { fill: true, baseline: 0 })`\n- `orbit` 卫星 / 天体轨道：`Draw.arc([0, 0], 1.2, 0, 360)  Draw.circle([state.px, state.py], 0.05)`\n- `cylinder_piston` 气缸 / 活塞：`Draw.box([0, 0.4], 0.24, 0.8)  Draw.box([0, state.xp], 0.2, 0.04)`\n- `gas_tube` 玻璃管 / 水银柱：`Draw.line([0, 0], [0, 1.2])  Draw.line([0.1, 0], [0.1, 1.2])  Draw.box([0.05, state.yh], 0.1, 0.2)`\n- `raw_composite` 复合图形（碰撞/爆炸/火柴人）：`Draw.polygon([[-0.1, 0], [0.1, 0], [0.1, 0.2], [-0.1, 0.2]])`\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] 每个元件的位置都来自 `state.*` 或 `setup` 导出的量，没有写死一屏坐标。\n- [ ] 会动的物体在 `SIM.bodies` 里声明了（v/a 由运行时自动画）；`Draw.arrow` 只画 force/aux，且都带 `mag`。\n- [ ] 跨槽位取值只用 `RETURN` + `context.X`，没有裸引用别的槽位的局部变量。\n",
        "code_examples": [
            "// 三个最常用元件的最小画法（完整清单见正文）\nstateAt: `\n  return { x: 0.6, yTop: 1.6 };\n`\ndrawFrame: `\n  Draw.incline([0, 0.6], { angleDeg: 30, length: 1.2 });\n  Draw.box([state.x, 0.15], 0.4, 0.3);\n  Draw.spring([0, 2.0], [0, state.yTop], { coils: 12 });\n`"
        ]
    },
    {
        "id": "wb_el_block",
        "title": "元件·物块 / 滑块",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "物块",
            "滑块"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "block"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 900,
        "priority": "high",
        "content": "# 元件·物块 / 滑块（力学器材）\n\n## 判据\n题面或配图里出现「物块」「滑块」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return { x: 0.6 };\n- drawFrame 里写：Draw.box([state.x, 0.15], 0.4, 0.3);\n\n## 这条元件最常错的地方\n宽高写成像素；块心算到板外（穿模）\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.box([state.x, 0.15], 0.4, 0.3);\n`"
        ]
    },
    {
        "id": "wb_el_board",
        "title": "元件·长木板 / 小车",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "长木板",
            "小车"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "board"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 901,
        "priority": "high",
        "content": "# 元件·长木板 / 小车（力学器材）\n\n## 判据\n题面或配图里出现「长木板」「小车」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return { xBoard: 1.0 };\n- drawFrame 里写：Draw.box([state.xBoard, 0.05], 3.0, 0.1);\n\n## 这条元件最常错的地方\n板长取\"看起来合适\"的数，而不是题面给的 L\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.box([state.xBoard, 0.05], 3.0, 0.1);\n`"
        ]
    },
    {
        "id": "wb_el_incline",
        "title": "元件·斜面 / 斜坡",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "斜面",
            "斜坡"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "incline"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 902,
        "priority": "high",
        "content": "# 元件·斜面 / 斜坡（力学器材）\n\n## 判据\n题面或配图里出现「斜面」「斜坡」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return {};\n- drawFrame 里写：Draw.incline([0, 0.6], { angleDeg: 30, length: 1.2 });\n\n## 这条元件最常错的地方\n`angleDeg` 正负决定坡脚在右下还是左下；顶点是**最高**那端\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.incline([0, 0.6], { angleDeg: 30, length: 1.2 });\n`"
        ]
    },
    {
        "id": "wb_el_ground",
        "title": "元件·地面 / 墙面（斜线阴影）",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "地面",
            "墙面"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "ground"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 903,
        "priority": "high",
        "content": "# 元件·地面 / 墙面（斜线阴影）（力学器材）\n\n## 判据\n题面或配图里出现「地面」「墙面」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return {};\n- drawFrame 里写：Draw.ground(-1.5, 2.5);\n\n## 这条元件最常错的地方\n`Draw.incline` 自带阴影底面，再叠一层 ground 会出现双阴影\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.ground(-1.5, 2.5);\n`"
        ]
    },
    {
        "id": "wb_el_ball",
        "title": "元件·小球 / 质点",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "小球",
            "质点"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "ball"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 904,
        "priority": "high",
        "content": "# 元件·小球 / 质点（力学器材）\n\n## 判据\n题面或配图里出现「小球」「质点」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return { x: 0.6, y: 0.8 };\n- drawFrame 里写：Draw.circle([state.x, state.y], 0.08);\n\n## 这条元件最常错的地方\n用 `Draw.ball`（SDK 里没有这个名字 ⇒ C1 直接判未声明的名字）\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.circle([state.x, state.y], 0.08);\n`"
        ]
    },
    {
        "id": "wb_el_arc_track",
        "title": "元件·圆弧轨道 / 拱桥",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "圆弧轨道",
            "拱桥"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "arc_track"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 905,
        "priority": "high",
        "content": "# 元件·圆弧轨道 / 拱桥（力学器材）\n\n## 判据\n题面或配图里出现「圆弧轨道」「拱桥」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return {};\n- drawFrame 里写：Draw.arc([0, 0], 0.8, -90, 90);\n\n## 这条元件最常错的地方\n`Draw.arc` 的角度是**角度制、逆时针为正**，别塞弧度\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.arc([0, 0], 0.8, -90, 90);\n`"
        ]
    },
    {
        "id": "wb_el_spring",
        "title": "元件·弹簧",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "弹簧"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "spring"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 906,
        "priority": "high",
        "content": "# 元件·弹簧（力学器材）\n\n## 判据\n题面或配图里出现「弹簧」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return { yTop: 1.6 };\n- drawFrame 里写：Draw.spring([0, 2.0], [0, state.yTop], { coils: 12 });\n\n## 这条元件最常错的地方\n两端锚点必须同一个来源；只更新一端，弹簧会\"斜穿\"物体\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.spring([0, 2.0], [0, state.yTop], { coils: 12 });\n`"
        ]
    },
    {
        "id": "wb_el_pulley",
        "title": "元件·滑轮",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "滑轮"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "pulley"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 907,
        "priority": "high",
        "content": "# 元件·滑轮（力学器材）\n\n## 判据\n题面或配图里出现「滑轮」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return {};\n- drawFrame 里写：Draw.pulley([0, 2.4], 0.2);\n\n## 这条元件最常错的地方\n过滑轮的绳要画成**两段**，切点离圆心距离 = r\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.pulley([0, 2.4], 0.2);\n`"
        ]
    },
    {
        "id": "wb_el_rope",
        "title": "元件·绳 / 细线",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "绳",
            "细线"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "rope"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 908,
        "priority": "high",
        "content": "# 元件·绳 / 细线（力学器材）\n\n## 判据\n题面或配图里出现「绳」「细线」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return { yA: 1.2 };\n- drawFrame 里写：Draw.line([-0.2, 2.4], [-0.2, state.yA]);\n\n## 这条元件最常错的地方\n绳松弛时仍画成直线（物理状态被画没了）\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.line([-0.2, 2.4], [-0.2, state.yA]);\n`"
        ]
    },
    {
        "id": "wb_el_rod",
        "title": "元件·导体棒 / 轻杆",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "导体棒",
            "轻杆"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "rod"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 909,
        "priority": "high",
        "content": "# 元件·导体棒 / 轻杆（力学器材）\n\n## 判据\n题面或配图里出现「导体棒」「轻杆」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return { xr: 0.8 };\n- drawFrame 里写：Draw.line([state.xr, 0], [state.xr, 0.5], { width: 3 });\n\n## 这条元件最常错的地方\n杆的弹力方向当成\"沿杆\"（轻杆可以推，方向要解出来）\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.line([state.xr, 0], [state.xr, 0.5], { width: 3 });\n`"
        ]
    },
    {
        "id": "wb_el_stand",
        "title": "元件·铁架台 / 支架",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "铁架台",
            "支架"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "stand"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 910,
        "priority": "high",
        "content": "# 元件·铁架台 / 支架（力学器材）\n\n## 判据\n题面或配图里出现「铁架台」「支架」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return {};\n- drawFrame 里写：Draw.line([-1.2, 0], [-1.2, 2.2], { width: 2 });\nDraw.ground(-1.6, 2.4);\n\n## 这条元件最常错的地方\n支架每帧重算坐标（静态几何应当在 `setup()` 里算一次）\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.line([-1.2, 0], [-1.2, 2.2], { width: 2 });\nDraw.ground(-1.6, 2.4);\n`"
        ]
    },
    {
        "id": "wb_el_belt",
        "title": "元件·传送带 / 履带",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "传送带",
            "履带"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "belt"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 911,
        "priority": "high",
        "content": "# 元件·传送带 / 履带（力学器材）\n\n## 判据\n题面或配图里出现「传送带」「履带」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return {};\n- drawFrame 里写：Draw.belt([0, 0.2], [4, 0.2], { ticks: 16 });\n\n## 这条元件最常错的地方\n刻度数 < 8，看不出带在动；刻度相位不用 `v·t` 取模\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.belt([0, 0.2], [4, 0.2], { ticks: 16 });\n`"
        ]
    },
    {
        "id": "wb_el_circuit",
        "title": "元件·电路 / 导线 / 电表",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "电路",
            "导线",
            "电表"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "circuit"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 912,
        "priority": "high",
        "content": "# 元件·电路 / 导线 / 电表（场与电）\n\n## 判据\n题面或配图里出现「电路」「导线」「电表」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return { I: 0.5 };\n- drawFrame 里写：Draw.line([0, 0], [2, 0]);\nDraw.line([2, 0], [2, 1]);\nDraw.line([2, 1], [0, 1]);\nDraw.line([0, 1], [0, 0]);\nDraw.arrow([1.0, 0], [1, 0], { category: 'aux', mag: Math.abs(state.I), label: 'I', unit: 'A' });\n\n## 这条元件最常错的地方\n接线柱坐标每帧重算；箭头方向画成电压方向（应为**电流**方向）\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.line([0, 0], [2, 0]);\nDraw.line([2, 0], [2, 1]);\nDraw.line([2, 1], [0, 1]);\nDraw.line([0, 1], [0, 0]);\nDraw.arrow([1.0, 0], [1, 0], { category: 'aux', mag: Math.abs(state.I), label: 'I', unit: 'A' });\n`"
        ]
    },
    {
        "id": "wb_el_plates",
        "title": "元件·平行板 / 极板",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "平行板",
            "极板"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "plates"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 913,
        "priority": "high",
        "content": "# 元件·平行板 / 极板（场与电）\n\n## 判据\n题面或配图里出现「平行板」「极板」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return {};\n- drawFrame 里写：Draw.line([-1, 1.6], [3, 1.6], { width: 3 });\nDraw.line([-1, 0.4], [3, 0.4], { width: 3 });\n\n## 这条元件最常错的地方\n板间有场、板外没场：板外那段必须换回直线运动\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.line([-1, 1.6], [3, 1.6], { width: 3 });\nDraw.line([-1, 0.4], [3, 0.4], { width: 3 });\n`"
        ]
    },
    {
        "id": "wb_el_field_region",
        "title": "元件·匀强场区（× / · 阵列）",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "匀强场区"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "field_region"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 914,
        "priority": "high",
        "content": "# 元件·匀强场区（× / · 阵列）（场与电）\n\n## 判据\n题面或配图里出现「匀强场区」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return {};\n- drawFrame 里写：Draw.fieldDots({ x: 0, y: 0, w: 2, h: 1.5 }, { symbol: 'cross', nx: 10, ny: 8 });\n\n## 这条元件最常错的地方\n`rect` 必须是 `{x,y,w,h}`（写成两个点会直接抛错）；阵列溢出场区\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.fieldDots({ x: 0, y: 0, w: 2, h: 1.5 }, { symbol: 'cross', nx: 10, ny: 8 });\n`"
        ]
    },
    {
        "id": "wb_el_ray",
        "title": "元件·光线",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "光线"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "ray"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 915,
        "priority": "high",
        "content": "# 元件·光线（场与电）\n\n## 判据\n题面或配图里出现「光线」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return {};\n- drawFrame 里写：Draw.ray([-1, 0.8], [0, 0.8]);\n\n## 这条元件最常错的地方\n全反射时仍画一条\"淡淡的折射光\"（超过临界角就没有折射段）\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.ray([-1, 0.8], [0, 0.8]);\n`"
        ]
    },
    {
        "id": "wb_el_lens",
        "title": "元件·透镜",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "透镜"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "lens"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 916,
        "priority": "high",
        "content": "# 元件·透镜（场与电）\n\n## 判据\n题面或配图里出现「透镜」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return {};\n- drawFrame 里写：Draw.lens([1, 0.8], { height: 1.2, focal: 0.5 });\n\n## 这条元件最常错的地方\n`height` 与 `focal` 是必填（都是几何量），缺一个直接抛错\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.lens([1, 0.8], { height: 1.2, focal: 0.5 });\n`"
        ]
    },
    {
        "id": "wb_el_light_spot",
        "title": "元件·光斑 / 照射区域",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "光斑",
            "照射区域"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "light_spot"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 917,
        "priority": "high",
        "content": "# 元件·光斑 / 照射区域（场与电）\n\n## 判据\n题面或配图里出现「光斑」「照射区域」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return {};\n- drawFrame 里写：Draw.polygon([[1.4, 0.2], [1.6, 0.26], [1.6, 0.14]], { fill: 'rgba(90,150,255,0.25)' });\n\n## 这条元件最常错的地方\n`polygon` 的 `fill` 是**颜色字符串**（`chart` 的 `fill` 才是开关 `true`）\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.polygon([[1.4, 0.2], [1.6, 0.26], [1.6, 0.14]], { fill: 'rgba(90,150,255,0.25)' });\n`"
        ]
    },
    {
        "id": "wb_el_vector",
        "title": "元件·矢量箭头（受力 / 辅助）",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "矢量箭头"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "vector"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 918,
        "priority": "high",
        "content": "# 元件·矢量箭头（受力 / 辅助）（矢量与标注）\n\n## 判据\n题面或配图里出现「矢量箭头」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return { x: 0.6, y: 0.6, f: 3 };\n- drawFrame 里写：Draw.arrow([state.x, state.y], [1, 0], { category: 'force', mag: state.f, label: 'F', unit: 'N' });\n\n## 这条元件最常错的地方\n还想自己画 v/a（已改由 `SIM.bodies` 自动生成，C1 会直接打回）；缺 `mag`；起点不锚在实体中心、还手写偏移\n\n## 速度 / 加速度箭头\n**v/a 不再由模型画**。在 `VIEW` 里声明刚体位置：`SIM.bodies = [{ id, at: (state) => [x, y] }]`，运行时会自动画 v（绿）与 a（蓝），并保证箭头与画面里的运动一致。\n· 物体在动就必须声明 `bodies`；静止的题不用。\n· 相变点不在 `STEPS` 边界上时（碰撞、圆弧切平抛），用 `SIM.phases = [{t0,t1}]` 补上。\n· `Draw.arrow` 只留给 `force`（红）与 `aux`（紫：传送带速度、电流、速度分量）。\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.arrow([state.x, state.y], [1, 0], { category: 'force', mag: state.f, label: 'F', unit: 'N' });\n`"
        ]
    },
    {
        "id": "wb_el_trace_path",
        "title": "元件·轨迹",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "轨迹"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "trace_path"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 919,
        "priority": "high",
        "content": "# 元件·轨迹（矢量与标注）\n\n## 判据\n题面或配图里出现「轨迹」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return { x: 0.6, y: 0.4 };\n- drawFrame 里写：Draw.trace([[0, 0], [state.x, state.y]]);\n\n## 这条元件最常错的地方\n另写一条解析曲线当轨迹（与实体位置不一致）；画\"还没发生\"的时段\n\n## 虚线约定\n`Draw.trace` 默认就是虚线；要显式画一条虚线用 `Draw.line(a, b, { dash: true })`；实线不写或 `dash: false`。只有自定义间距才写 `[n, m]`。\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.trace([[0, 0], [state.x, state.y]]);\n`"
        ]
    },
    {
        "id": "wb_el_paper_tape",
        "title": "元件·纸带 / 点迹",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "纸带",
            "点迹"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "paper_tape"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 920,
        "priority": "high",
        "content": "# 元件·纸带 / 点迹（矢量与标注）\n\n## 判据\n题面或配图里出现「纸带」「点迹」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return { d1: 0.2 };\n- drawFrame 里写：Draw.box([0.5, -0.6], 2.0, 0.12);\nDraw.circle([state.d1, -0.6], 0.01);\n\n## 这条元件最常错的地方\n点间隔不等（相邻时刻差必须是打点周期 T）\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.box([0.5, -0.6], 2.0, 0.12);\nDraw.circle([state.d1, -0.6], 0.01);\n`"
        ]
    },
    {
        "id": "wb_el_ghosts",
        "title": "元件·频闪残影",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "频闪残影"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "ghosts"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 921,
        "priority": "high",
        "content": "# 元件·频闪残影（矢量与标注）\n\n## 判据\n题面或配图里出现「频闪残影」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return {};\n- drawFrame 里写：Draw.ghosts([[0, 0.2], [0.5, 0.2], [1.0, 0.2]]);\n\n## 这条元件最常错的地方\n残影时刻不等距；把残影和纸带点迹混用\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.ghosts([[0, 0.2], [0.5, 0.2], [1.0, 0.2]]);\n`"
        ]
    },
    {
        "id": "wb_el_measuring_tool",
        "title": "元件·尺寸/角度标注（刻度尺）",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "尺寸",
            "角度标注"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "measuring_tool"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 922,
        "priority": "high",
        "content": "# 元件·尺寸/角度标注（刻度尺）（矢量与标注）\n\n## 判据\n题面或配图里出现「尺寸」「角度标注」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return {};\n- drawFrame 里写：Draw.dimension([0, 0.4], [1, 0.4], { kind: 'linear', text: 'L = 1.0 m' });\n\n## 这条元件最常错的地方\n`kind` 只能是 `linear` | `angle`；把读数写成答案文本而不是由几何算出\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.dimension([0, 0.4], [1, 0.4], { kind: 'linear', text: 'L = 1.0 m' });\n`"
        ]
    },
    {
        "id": "wb_el_axis_box",
        "title": "元件·坐标轴框（v–t / p–V）",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "坐标轴框"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "axis_box"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 923,
        "priority": "high",
        "content": "# 元件·坐标轴框（v–t / p–V）（图示）\n\n## 判据\n题面或配图里出现「坐标轴框」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return {};\n- drawFrame 里写：Draw.axisBox([-0.2, -0.2], 2.4, 4.4, { xLabel: 't', xUnit: 's', yLabel: 'v', yUnit: 'm/s' });\n\n## 这条元件最常错的地方\n只写字母不写单位；量程盖不住数据（点跑出框外）\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.axisBox([-0.2, -0.2], 2.4, 4.4, { xLabel: 't', xUnit: 's', yLabel: 'v', yUnit: 'm/s' });\n`"
        ]
    },
    {
        "id": "wb_el_graph_wave",
        "title": "元件·波形 / 连续曲线",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "波形",
            "连续曲线"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "graph_wave"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 924,
        "priority": "high",
        "content": "# 元件·波形 / 连续曲线（图示）\n\n## 判据\n题面或配图里出现「波形」「连续曲线」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return {};\n- drawFrame 里写：Draw.curve([[0, 0], [0.5, 0.3], [1, 0], [1.5, -0.3]]);\n\n## 这条元件最常错的地方\n采样点太少（折线感）；波形平移用重画新线而不是整条平移\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.curve([[0, 0], [0.5, 0.3], [1, 0], [1.5, -0.3]]);\n`"
        ]
    },
    {
        "id": "wb_el_chart",
        "title": "元件·图线 + 面积着色",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "图线 + 面积着色"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "chart"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 925,
        "priority": "high",
        "content": "# 元件·图线 + 面积着色（图示）\n\n## 判据\n题面或配图里出现「图线 + 面积着色」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return {};\n- drawFrame 里写：Draw.chart([[0, 0], [1, 2], [2, 4]], { fill: true, baseline: 0 });\n\n## 这条元件最常错的地方\n面积全时段都填；符号题（readouts 无数值）就干脆不画图（应当用 setup 的示意值画，并在图注写\"示意\"）\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.chart([[0, 0], [1, 2], [2, 4]], { fill: true, baseline: 0 });\n`"
        ]
    },
    {
        "id": "wb_el_orbit",
        "title": "元件·卫星 / 天体轨道",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "卫星",
            "天体轨道"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "orbit"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 926,
        "priority": "high",
        "content": "# 元件·卫星 / 天体轨道（图示）\n\n## 判据\n题面或配图里出现「卫星」「天体轨道」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return { px: 1.2, py: 0 };\n- drawFrame 里写：Draw.arc([0, 0], 1.2, 0, 360);\nDraw.circle([state.px, state.py], 0.05);\n\n## 这条元件最常错的地方\n椭圆轨道用匀角速度（应满足\"相同时间扫过相同面积\"）\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.arc([0, 0], 1.2, 0, 360);\nDraw.circle([state.px, state.py], 0.05);\n`"
        ]
    },
    {
        "id": "wb_el_cylinder_piston",
        "title": "元件·气缸 / 活塞",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "气缸",
            "活塞"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "cylinder_piston"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 927,
        "priority": "high",
        "content": "# 元件·气缸 / 活塞（图示）\n\n## 判据\n题面或配图里出现「气缸」「活塞」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return { xp: 0.5 };\n- drawFrame 里写：Draw.box([0, 0.4], 0.24, 0.8);\nDraw.box([0, state.xp], 0.2, 0.04);\n\n## 这条元件最常错的地方\n气体长度与活塞位置两处各算一次（必须同一个变量驱动）\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.box([0, 0.4], 0.24, 0.8);\nDraw.box([0, state.xp], 0.2, 0.04);\n`"
        ]
    },
    {
        "id": "wb_el_gas_tube",
        "title": "元件·玻璃管 / 水银柱",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "玻璃管",
            "水银柱"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "gas_tube"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 928,
        "priority": "high",
        "content": "# 元件·玻璃管 / 水银柱（图示）\n\n## 判据\n题面或配图里出现「玻璃管」「水银柱」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return { yh: 0.3 };\n- drawFrame 里写：Draw.line([0, 0], [0, 1.2]);\nDraw.line([0.1, 0], [0.1, 1.2]);\nDraw.box([0.05, state.yh], 0.1, 0.2);\n\n## 这条元件最常错的地方\n管口开/闭没区分；水银柱长度与气体长度不联动\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.line([0, 0], [0, 1.2]);\nDraw.line([0.1, 0], [0.1, 1.2]);\nDraw.box([0.05, state.yh], 0.1, 0.2);\n`"
        ]
    },
    {
        "id": "wb_el_raw_composite",
        "title": "元件·复合图形（碰撞/爆炸/火柴人）",
        "origin": "builtin",
        "category": "scene_modeling",
        "enabled": true,
        "constant": false,
        "recursive": false,
        "keys": [
            "复合图形"
        ],
        "secondary_keys": {
            "logic": "AND_ANY",
            "list": []
        },
        "concepts": [],
        "tags": [],
        "elements": [
            "raw_composite"
        ],
        "insertion_slot": [
            "scene_code"
        ],
        "order": 929,
        "priority": "high",
        "content": "# 元件·复合图形（碰撞/爆炸/火柴人）（图示）\n\n## 判据\n题面或配图里出现「复合图形」这类东西时画这一件。\n\n## 状态与画法\n- stateAt 里写：return {};\n- drawFrame 里写：Draw.polygon([[-0.1, 0], [0.1, 0], [0.1, 0.2], [-0.1, 0.2]]);\n\n## 这条元件最常错的地方\n把物理分支塞进 `Draw.raw` 的回调里（逃生门只画形状，Dry-Run 也验不到它）\n\n## 两条铁律（所有元件都适用）\n- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。\n- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。\n- [ ] 坐标是米，没有像素量与像素比例。\n- [ ] 静态几何在 setup() 里算一次，不逐帧重算。",
        "code_examples": [
            "drawFrame: `\n  Draw.polygon([[-0.1, 0], [0.1, 0], [0.1, 0.2], [-0.1, 0.2]]);\n`"
        ]
    }
];
/**
 * 构建期快照：用户词条（`origin: user`）。
 *
 * 本期恒为空数组：用户区的真实内容在 `ai-rules/worldbook/` 里，浏览器读不到文件系统。
 * 页面里新写的词条只存在内存中（见文件头的诚实声明）。
 */
export const WORLDBOOK_USER = [];
/** 内置库的稳定哈希（`provenance.worldbookHash` 用的同一个算法） */
export const WORLDBOOK_HASH = "91dffa2676662593cb1486c5969eaf0ba009f0473f96c828fdbcf50efc3e4ab2";
/**
 * 导出包的格式标识与版本（**从 `core/worldbook/store.mjs` 派生**，不是抄录）。
 *
 * ⚠ 浏览器拿不到 Node 侧的契约文件，所以这两个值必须由构建期写进产物；
 *   `tools/web-build.mjs` 会断言它们等于 `contracts/worldbook-pack.schema.json` 的
 *   `format.const` / `version.const` —— 抄错会让构建失败，而不是让 UI 悄悄导出错格式。
 */
export const WORLDBOOK_PACK_FORMAT = "od-worldbook";
export const WORLDBOOK_PACK_VERSION = 1;
/** 内置库的载入来源（文件名 + SHA256 + 条数），供设置页显示"这批词条是哪来的" */
export const WORLDBOOK_SOURCES = [
    {
        "name": "90-visual.json",
        "kind": "builtin",
        "count": 2,
        "sha256": "e7c65d2cc9593e8bb461c3d086ab6dc108d68080e96e6b8e486115472fed9c8a"
    },
    {
        "name": "92-animation-core.json",
        "kind": "builtin",
        "count": 2,
        "sha256": "69553f8cdf6f6366005d2eb62f99cdf74709490be06791521f3b380cf3967db6"
    },
    {
        "name": "93-elements.json",
        "kind": "builtin",
        "count": 30,
        "sha256": "076db3547cabab6ce6e0f4aa7399702b87cf645c9028d251772c2afed7e21a42"
    }
];
/** 覆盖率报告（第 5 期只交付**机制**；内容覆盖由第 5.5 期完成） */
export const WORLDBOOK_COVERAGE = {
    "total": 34,
    "structuralRate": 1,
    "selfCheckCoverage": 1,
    "exampleCoverage": 1,
    "missingSelfCheck": [],
    "missingExamples": [],
    "contentComplete": false,
    "reason": "题型覆盖台账已退役（第 9 期开源版：不再按第三方教辅的题型记账）——只剩结构合规率这一个口径",
    "nonCompliant": []
};
/**
 * 解题页「世界书依据」面板的数据（第 5 期 · §15）。
 *
 * 它是**构建期用真引擎在真题题面上跑出来的**（不是编的）：世界书的命中与组装只取决于
 * 题面与词条集合，与模型无关，所以演示源也能显示真结果。
 * 类型不写在这里 —— 让 TS 从字面量推断，再在 `run-stream.ts` 里按 `WorldbookEvidence` 校验，
 * 这样"生成物"与"消费端的类型"之间不会出现第二份手写接口。
 */
export const WORLDBOOK_DEMO_EVENT = {
    "hash": "91dffa2676662593cb1486c5969eaf0ba009f0473f96c828fdbcf50efc3e4ab2",
    "libraryCount": 34,
    "matched": 4,
    "entries": [
        {
            "entry_id": "wb_anim_conventions",
            "title": "动画常驻·坐标与正方向（世界坐标 / 单位 / 时间 / 读数口径）",
            "via": "constant",
            "from": null,
            "depth": 0,
            "key": null,
            "matched": {
                "concepts": [],
                "tags": [],
                "elements": []
            },
            "origin": "builtin",
            "category": "scene_modeling",
            "priority": "high",
            "order": 1,
            "constant": true,
            "recursive": false,
            "declaredSlots": [
                "scene_code"
            ],
            "injectedSlots": [
                "scene_code"
            ],
            "charsBySlot": {
                "scene_code": 1752
            },
            "unmounted": false,
            "truncated": false,
            "stages": [
                "scene_code",
                "solve"
            ]
        },
        {
            "entry_id": "wb_anim_elements_overview",
            "title": "动画常驻·元件总览（30 个元件的最小画法，全部实测过）",
            "via": "constant",
            "from": null,
            "depth": 0,
            "key": null,
            "matched": {
                "concepts": [],
                "tags": [],
                "elements": []
            },
            "origin": "builtin",
            "category": "scene_modeling",
            "priority": "high",
            "order": 2,
            "constant": true,
            "recursive": false,
            "declaredSlots": [
                "scene_code"
            ],
            "injectedSlots": [
                "scene_code"
            ],
            "charsBySlot": {
                "scene_code": 3300
            },
            "unmounted": false,
            "truncated": false,
            "stages": [
                "scene_code",
                "solve"
            ]
        },
        {
            "entry_id": "wb_el_block",
            "title": "元件·物块 / 滑块",
            "via": "key",
            "from": null,
            "depth": 0,
            "key": "物块",
            "matched": {
                "concepts": [],
                "tags": [],
                "elements": []
            },
            "origin": "builtin",
            "category": "scene_modeling",
            "priority": "high",
            "order": 900,
            "constant": false,
            "recursive": false,
            "declaredSlots": [
                "scene_code"
            ],
            "injectedSlots": [
                "scene_code"
            ],
            "charsBySlot": {
                "scene_code": 478
            },
            "unmounted": false,
            "truncated": false,
            "stages": [
                "scene_code",
                "solve"
            ]
        },
        {
            "entry_id": "wb_el_belt",
            "title": "元件·传送带 / 履带",
            "via": "key",
            "from": null,
            "depth": 0,
            "key": "传送带",
            "matched": {
                "concepts": [],
                "tags": [],
                "elements": []
            },
            "origin": "builtin",
            "category": "scene_modeling",
            "priority": "high",
            "order": 911,
            "constant": false,
            "recursive": false,
            "declaredSlots": [
                "scene_code"
            ],
            "injectedSlots": [
                "scene_code"
            ],
            "charsBySlot": {
                "scene_code": 495
            },
            "unmounted": false,
            "truncated": false,
            "stages": [
                "scene_code",
                "solve"
            ]
        }
    ],
    "emptySlots": [
        "solve"
    ],
    "truncatedSlots": [],
    "warnings": [],
    "charsBySlot": {
        "solve": 0,
        "scene_code": 6025
    },
    "injectedBySlot": {
        "solve": 0,
        "scene_code": 4
    }
};
