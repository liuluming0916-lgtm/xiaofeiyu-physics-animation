/**
 * 宿主 ⇄ 模板页 控制协议（宿主侧 TS 类型与收发封装）。
 *
 * **唯一依据是 `contracts/host-protocol.md`**（第 3 期定稿）。
 * 改协议要先改那份文档；这里的类型必须跟着它走（§21.1 第 1 条）。
 */
/** §3.2 的 8 个冻结键名（顺序即冻结键序） */
export const SLOT_KEYS = [
    'PROBLEM',
    'STEPS',
    'ANSWERS',
    'VIEW',
    'setup',
    'stateAt',
    'drawFrame',
    'readouts',
];
/** 倍速档位（§13.2 / §13.3 至少覆盖这些） */
export const PLAYBACK_RATES = [0.25, 0.5, 1, 1.5, 2, 4];
/* ────────────────────────────── 消息常量 ────────────────────────────── */
export const HOST_SOURCE = 'od-host';
export const TEMPLATE_SOURCE = 'od-template';
export const HOST_TO_TEMPLATE = [
    'play',
    'pause',
    'toggle',
    'seek',
    'setRate',
    'showStep',
    'setVectorMask',
    'setTheme',
    'program',
];
export const TEMPLATE_TO_HOST = ['ready', 'state', 'error'];
/* ────────────────────────────── 收发封装 ────────────────────────────── */
/** 协议 §2：接受 od-host；缺 source 也接受（向后兼容 §13.2 草案）；其余忽略 */
export function isHostMessage(data) {
    if (!data || typeof data !== 'object')
        return false;
    const src = data.source;
    return src === undefined || src === HOST_SOURCE;
}
/** 协议 §2 的对称规则：接受 od-template；缺 source 也接受 */
export function isTemplateMessage(data) {
    if (!data || typeof data !== 'object')
        return false;
    const src = data.source;
    return src === undefined || src === TEMPLATE_SOURCE;
}
/** 宿主 → 模板。iframe 未就绪时静默丢弃（由调用方决定是否排队重发）。 */
export function postToTemplate(win, type, payload = {}) {
    if (!win)
        return false;
    try {
        win.postMessage({ source: HOST_SOURCE, type, ...payload }, '*');
        return true;
    }
    catch {
        // 跨源或 iframe 已销毁
        return false;
    }
}
/**
 * 从一条原始消息里解析出模板事件。
 * 返回 `null` 表示"不是给宿主的消息"或"类型不认识"。
 */
export function parseTemplateMessage(data) {
    if (!isTemplateMessage(data))
        return null;
    const type = data.type;
    if (typeof type !== 'string')
        return null;
    if (!TEMPLATE_TO_HOST.includes(type))
        return null;
    const { source: _s, type: _t, ...payload } = data;
    return { type: type, payload };
}
/** 默认开关状态（§13.3：三类矢量 + 轨迹 + 网格各自独立） */
export const DEFAULT_MASK = {
    velocity: true,
    acceleration: true,
    force: true,
    trace: true,
    grid: true,
};
/** 校验一份载荷是否满足 §3.2（宿主侧先自检，别把坏数据发给模板） */
export function validateProgramPayload(payload) {
    const slots = payload?.slots;
    if (!slots || typeof slots !== 'object')
        return 'program.slots 缺失';
    const keys = Object.keys(slots);
    if (keys.length !== SLOT_KEYS.length) {
        return `program.slots 必须恰好含 ${SLOT_KEYS.length} 个键，实际 ${keys.length} 个`;
    }
    for (const k of SLOT_KEYS) {
        const v = slots[k];
        if (typeof v !== 'string' || v.length === 0)
            return `槽位 ${k} 缺失或为空（§3.2 审计 2）`;
    }
    if (payload.mode !== 'BOTH' && payload.mode !== 'NUMERIC' && payload.mode !== 'SYMBOLIC') {
        return `未知的 mode：${String(payload.mode)}`;
    }
    return null;
}
