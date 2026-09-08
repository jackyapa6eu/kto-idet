import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Landing } from './components/Landing'
import './components/Landing.css'
import { getLinkContext } from './linkContext'

window.Telegram?.WebApp?.ready()
window.Telegram?.WebApp?.expand()

const root = createRoot(document.getElementById('root')!)

// Холодный визит (поисковик, прямая ссылка, кнопка меню бота без контекста) получает только
// Landing — без antd/mobx/остального веса мини-аппа, который такому посетителю не нужен и
// который иначе тянулся бы всем подряд, включая краулеры. Реальный переход из чата (event-/
// org-/settings- в start_param) догружает App отдельным чанком.
const App = getLinkContext() ? lazy(() => import('./App.tsx')) : null

root.render(
  <StrictMode>{App ? (
    <Suspense fallback={null}>
      <App />
    </Suspense>
  ) : (
    <Landing />
  )}</StrictMode>,
)
