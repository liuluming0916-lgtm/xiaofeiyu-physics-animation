/**
 * v1.1.18：补充描述可以按阶段注入。
 *
 * 这里只放“界面上让老师选哪几段”的元数据；后端接受的 key 更宽（含 breakdown/couple），
 * 但默认只暴露 5 个主阶段，避免弹窗太长。
 */
export const STAGE_NOTE_META = [
  {
    key: 'read_problem',
    label: '读题',
    hint: '图看不清时，写图里的几何结构（谁在左、斜面朝哪、接触关系）',
  },
  {
    key: 'solve',
    label: '解题',
    hint: '补充题面没写、但解题需要的条件（例如某个力、某个初值）',
  },
  {
    key: 'analysis',
    label: '物理分析',
    hint: '补充运动学/动力学假设（正方向、g 取值、忽略什么）',
  },
  {
    key: 'scene_code',
    label: '画图',
    hint: '补充初始几何/布景（地面在哪、滑轮挂哪、图里有几段轨道）',
  },
  {
    key: 'repair',
    label: '修复',
    hint: '只重画时额外提醒（例如“上次把斜面画反了”）',
  },
] as const;

export type StageNoteKey = (typeof STAGE_NOTE_META)[number]['key'];
export type StageNotes = Partial<Record<StageNoteKey, string>>;
