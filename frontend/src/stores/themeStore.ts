import { makeAutoObservable, runInAction } from 'mobx'

const isInTelegram = !!window.Telegram?.WebApp?.initData

function getInitialColorScheme(): 'light' | 'dark' {
  if (isInTelegram) return window.Telegram!.WebApp!.colorScheme
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

class ThemeStore {
  colorScheme: 'light' | 'dark' = getInitialColorScheme()

  constructor() {
    makeAutoObservable(this)

    if (isInTelegram) {
      const tg = window.Telegram!.WebApp!
      tg.onEvent('themeChanged', () => {
        runInAction(() => {
          this.colorScheme = tg.colorScheme
        })
      })
    } else {
      window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        runInAction(() => {
          this.colorScheme = e.matches ? 'dark' : 'light'
        })
      })
    }
  }

  get isDark() {
    return this.colorScheme === 'dark'
  }
}

export const themeStore = new ThemeStore()
