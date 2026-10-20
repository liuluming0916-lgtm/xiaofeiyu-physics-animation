/**
 * 设置页（v2 收口版）。
 *
 * 旧的 v1 知识卡页面已在 Phase 3C-3 前替换为 KnowledgecardV2Panel；
 * 这里只保留四个 tab 的壳：知识卡 v2 / 提示词卡 / 本地规则卡 / AI 帮写（占位）。
 */

import { useState } from 'react'

import { CleaningPanel } from '../components/rules/CleaningPanel'
import { KnowledgecardV2Panel } from '../components/rules/KnowledgecardV2Panel'
import { PromptsPanel } from '../components/rules/PromptsPanel'

type SettingsTab = 'cardsV2' | 'prompts' | 'cleaning' | 'ai'

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; hint: string }> = [
  { id: 'cardsV2', label: '知识卡', hint: '元件 / 场景 / 动画规范；词表开关' },
  { id: 'prompts', label: '提示词卡', hint: '按阶段改模型指令；下一题生效' },
  { id: 'cleaning', label: '本地规则卡', hint: '模型输出后处理；内置 4 条锁定' },
  { id: 'ai', label: 'AI 帮写', hint: '生成卡片草稿；本轮只做占位' },
]

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('cardsV2')

  return (
    <div className="mx-auto max-w-7xl space-y-3 p-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">设置</h2>
          <p className="mt-1 text-xs text-slate-500">
            知识卡、提示词卡与本地规则卡都在这里。改的是 <code className="rounded bg-slate-100 px-1">ai-rules/</code>{' '}
            下的真实文件：原子写入、整批校验、整批生效或整批失败。
          </p>
        </div>
        <p className="text-[11px] text-slate-500">端点与 Key 在右上角「⚙ 连接设置」。</p>
      </header>

      <nav data-od-region="settings-tabs" className="flex flex-wrap gap-1" aria-label="设置分类">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`rounded-md border px-3 py-1.5 text-left text-xs ${
              tab === t.id
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className="block font-medium">{t.label}</span>
            <span className={tab === t.id ? 'text-slate-200' : 'text-slate-400'}>{t.hint}</span>
          </button>
        ))}
      </nav>

      {tab === 'cardsV2' ? (
        <KnowledgecardV2Panel />
      ) : tab === 'prompts' ? (
        <PromptsPanel />
      ) : tab === 'cleaning' ? (
        <CleaningPanel />
      ) : (
        <AiDraftPlaceholder />
      )}
    </div>
  )
}

function AiDraftPlaceholder() {
  return (
    <section data-od-region="settings-ai-draft" className="rounded-md border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">AI 帮写</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600">
            目标流程：描述你要的卡片 → 生成草稿 → 在设置页编辑 → 导入 / 导出。
            <strong>不自动保存、不自动发布</strong>；草稿仍然要走本机校验，保存动作永远由你点。
          </p>
        </div>
        <button
          type="button"
          disabled
          title="本轮只做入口占位，暂不调用模型"
          className="cursor-not-allowed rounded border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs text-slate-400"
        >
          AI 帮写（暂未开放）
        </button>
      </div>
      <div className="mt-4 rounded border border-dashed border-slate-300 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
        <p className="font-medium text-slate-700">这一版为什么先占位</p>
        <p className="mt-1">
          生成草稿需要模型调用、JSON 容错、C1 校验与失败修复；这些不在本期知识卡收口范围内。
          先把入口固定在这里，避免下个版本又在导航栏里多一个入口。
        </p>
        <p className="mt-2">
          现在可用：「知识卡 v2」里新建 / 编辑 / 保存 / 导入导出；「提示词卡」与「本地规则卡」各自有保存按钮。
        </p>
      </div>
    </section>
  )
}
