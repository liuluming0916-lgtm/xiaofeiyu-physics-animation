export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextBox extends Rect {
  text: string;
  size: number;
}

export interface PageError {
  where: string;
  message: string;
  stack: string | null;
}

export interface CanvasInfo {
  w: number;
  h: number;
  cssW: number;
  cssH: number;
}

export interface PixelInfo {
  cssW: number;
  cssH: number;
  w: number;
  h: number;
  nonBlankRatio: number;
  colors: number;
  centroid: { x: number; y: number } | null;
  error?: string;
}

export interface Capture {
  t: number;
  frames: number;
  canvas: CanvasInfo | null;
  texts: TextBox[];
  shapes: Rect[];
  nonBlank: PixelInfo | null;
  errors: PageError[];
  xfy: { acts?: { index: number; title: string; physical: number }[] } | null;
  act?: number;
  actTitle?: string;
  physical?: number;
}

export interface Checkpoint {
  /** 物理时间（秒） */
  t: number;
  /** 期望值：字段名 → 数值，支持 a.b 形式的前缀路径 */
  expect: Record<string, number>;
  tol?: number;
}

export type IssueLevel = 'error' | 'warn' | 'info';

export interface Issue {
  id: string;
  level: IssueLevel;
  /** 直接喂给大模型的人话报错 */
  message: string;
  /** 建议怎么改（可选） */
  hint?: string;
}

export interface SandboxReport {
  htmlPath: string;
  durationMs: number;
  issues: Issue[];
  captures: Capture[];
  checks: CheckpointResult[];
  digest: string;
}

export interface CheckpointResult {
  checkpoint: Checkpoint;
  playback: number;
  actual: Record<string, number> | null;
  ok: boolean;
  diffs: { key: string; expected: number; actual: number | null }[];
}
