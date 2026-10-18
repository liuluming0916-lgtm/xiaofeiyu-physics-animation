/**
 * 第 3 期前端入口。
 *
 * 这一步（第 0 步）只验证**构建链能走通**：React 挂载、TypeScript 通过、
 * Vite 打包、Tailwind 生效。真正的解题页/动画页在第 6 步落地。
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import './styles.css'

const host = document.getElementById('root')
if (!host) {
  // 契约：index.html 必须提供 #root；缺失属于构建配置错误，直接抛错而不是静默白屏
  throw new Error('前端入口缺少 #root 容器（请检查 web/index.html）')
}

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
