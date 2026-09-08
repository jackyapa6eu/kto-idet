import { makeAutoObservable, runInAction } from 'mobx'
import { apiFetch, AUTH_TOKEN_STORAGE_KEY } from '../api'

export interface SyncedUser {
  telegramId: string
  firstName: string
  lastName: string | null
  photoUrl: string | null
}

const isInTelegram = !!window.Telegram?.WebApp?.initData

class UserStore {
  telegramId = ''
  firstName = ''
  lastName = ''
  avatarUrl: string | null = null
  authToken: string | null = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
  authLoading = isInTelegram || !!this.authToken

  constructor() {
    makeAutoObservable(this)

    if (isInTelegram) {
      this.loadFromTelegram()
      this.syncWithBackend()
    } else if (this.authToken) {
      this.fetchProfile()
    }
  }

  get isAuthenticated() {
    return isInTelegram || !!this.authToken
  }

  loadFromTelegram() {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe.user
    if (!tgUser) return

    this.telegramId = String(tgUser.id)
    this.firstName = tgUser.first_name
    this.lastName = tgUser.last_name ?? ''
    this.avatarUrl = tgUser.photo_url ?? null
  }

  private applySyncedUser(user: SyncedUser) {
    this.telegramId = user.telegramId
    this.firstName = user.firstName
    this.lastName = user.lastName ?? ''
    this.avatarUrl = user.photoUrl
  }

  async syncWithBackend() {
    try {
      const res = await apiFetch('/api/auth/telegram', { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const user: SyncedUser = await res.json()
      runInAction(() => this.applySyncedUser(user))
    } catch (e) {
      console.error('Не удалось синхронизировать пользователя с бэкендом', e)
    } finally {
      runInAction(() => {
        this.authLoading = false
      })
    }
  }

  async fetchProfile() {
    try {
      const res = await apiFetch('/api/auth/me')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const user: SyncedUser = await res.json()
      runInAction(() => this.applySyncedUser(user))
    } catch (e) {
      console.error('Не удалось загрузить профиль', e)
      this.logout()
    } finally {
      runInAction(() => {
        this.authLoading = false
      })
    }
  }

  applyLoginSession(token: string, user: SyncedUser) {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token)
    runInAction(() => {
      this.authToken = token
      this.applySyncedUser(user)
    })
  }

  logout() {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
    this.authToken = null
    this.telegramId = ''
    this.firstName = ''
    this.lastName = ''
    this.avatarUrl = null
  }

  get fullName() {
    return [this.firstName, this.lastName].filter(Boolean).join(' ')
  }

  get initials() {
    return [this.firstName, this.lastName]
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .toUpperCase()
  }
}

export const userStore = new UserStore()
