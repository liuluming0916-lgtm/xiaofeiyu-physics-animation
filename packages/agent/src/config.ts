import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** 读 .env（不引第三方依赖）。已存在的环境变量优先。 */
export function loadEnv(file = '.env'): void {
  if (!existsSync(file)) return;
  try {
    process.loadEnvFile(file);
    return;
  } catch (_) {
    // 老版本 Node 兜底
  }
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

const get = (k: string, d = '') => process.env[k] ?? d;

/** 界面里可以改的配置存这里（不入库），优先于 .env */
const CONFIG_PATH = process.env.XFY_CONFIG_PATH || 'xfy.config.json';

export function applyConfigFile(file = CONFIG_PATH): void {
  if (!existsSync(file)) return;
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof j.apiBase === 'string' && j.apiBase) process.env.XFY_API_BASE = j.apiBase;
    if (typeof j.model === 'string' && j.model) process.env.XFY_MODEL = j.model;
    if (typeof j.thinking === 'string' && j.thinking) process.env.XFY_THINKING = j.thinking;
    if (typeof j.apiKey === 'string' && j.apiKey) process.env.XFY_API_KEY = j.apiKey;
  } catch (_) {}
}

export function saveConfigFile(patch: Record<string, string>, file = CONFIG_PATH): void {
  let cur: Record<string, string> = {};
  try {
    cur = JSON.parse(readFileSync(file, 'utf8'));
  } catch (_) {}
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === 'string' && v.trim()) next[k] = v.trim();
  }
  writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  applyConfigFile(file);
}

export const cfg = {
  get apiBase(): string {
    return get('XFY_API_BASE', 'https://api.deepseek.com').replace(/\/+$/, '');
  },
  get apiKey(): string {
    return get('XFY_API_KEY');
  },
  get model(): string {
    return get('XFY_MODEL', 'deepseek-chat');
  },
  /** 推理强度：high / medium / low / off */
  get thinking(): string {
    return get('XFY_THINKING', 'high');
  },
  /** auto | on | off —— 模型是否收图片 */
  get vision(): string {
    return get('XFY_VISION', 'auto');
  },
};

/** 拼出接口地址：base 已带 /v1 就直接用，否则补上 */
export function apiUrl(path: string): string {
  const base = cfg.apiBase;
  const p = path.replace(/^\/+/, '');
  return /\/v\d+$/i.test(base) ? `${base}/${p}` : `${base}/v1/${p}`;
}

export function configSummary() {
  return {
    apiBase: cfg.apiBase,
    model: cfg.model,
    thinking: cfg.thinking,
    hasKey: Boolean(cfg.apiKey),
    keyHint: cfg.apiKey ? `${cfg.apiKey.slice(0, 4)}…${cfg.apiKey.slice(-4)}` : '',
  };
}

// 模块加载时自动读一次（.env 与界面配置），脚本里再调 loadEnv 也不会重复覆盖
loadEnv();
applyConfigFile();
