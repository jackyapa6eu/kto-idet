export {}

interface TelegramWebAppUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
}

interface TelegramWebApp {
  ready: () => void
  expand: () => void
  initData: string
  initDataUnsafe: {
    user?: TelegramWebAppUser
    start_param?: string
  }
  colorScheme: 'light' | 'dark'
  onEvent: (eventType: 'themeChanged', callback: () => void) => void
  offEvent: (eventType: 'themeChanged', callback: () => void) => void
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp
    }
  }
}
