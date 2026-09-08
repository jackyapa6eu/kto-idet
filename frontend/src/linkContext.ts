export interface LinkContext {
  modal: string
  id: string
}

// Ссылка t.me/<bot>/<app>?startapp=event-42 (или org-5 из кнопок бота в группе), по которой
// бот присылает уведомления и по которой шарят мероприятия, передаёт "event-42" в
// Telegram.WebApp.initDataUnsafe.start_param (а не в URL) — путь после короткого имени
// мини-аппа Telegram не прокидывает.
function parseStartParam(startParam: string): LinkContext | null {
  const separatorIndex = startParam.indexOf('-')
  if (separatorIndex === -1) return null
  return { modal: startParam.slice(0, separatorIndex), id: startParam.slice(separatorIndex + 1) }
}

// Любая ссылка/кнопка, которая ведёт в мини-апп "из чата" (сводка, напоминание, шаринг
// мероприятия), обязана нести в себе контекст — event-<id> или org-<id>. Если контекста нет
// вообще (например, мини-апп открыли через постоянную кнопку меню бота, или это холодный
// визит из поисковика/по прямой ссылке), показываем Landing вместо попытки сразу
// авторизовать и открыть список событий — и не грузим ради этого весь antd/mobx-бандл
// (см. main.tsx).
export function getLinkContext(): LinkContext | null {
  const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param
  if (startParam) return parseStartParam(startParam)

  // Вне Telegram (например, при локальной разработке в обычном браузере) то же самое
  // можно передать явными query-параметрами страницы.
  const params = new URLSearchParams(window.location.search)
  const modal = params.get('modal')
  const id = params.get('id')
  return modal != null && id != null ? { modal, id } : null
}

export function cleanUpDevQueryParams() {
  const params = new URLSearchParams(window.location.search)
  if (!params.has('modal') && !params.has('id')) return

  params.delete('modal')
  params.delete('id')
  const query = params.toString()
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
  )
}
