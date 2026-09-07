const API_URL = import.meta.env.VITE_API_URL
export const AUTH_TOKEN_STORAGE_KEY = 'tg_auth_token'

export function apiFetch(path: string, init: RequestInit = {}) {
  const initData = window.Telegram?.WebApp?.initData
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')

  if (initData) {
    headers.set('X-Telegram-Init-Data', initData)
  } else {
    const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }

  return fetch(`${API_URL}${path}`, { ...init, headers })
}
