import { createHmac } from 'node:crypto'

export interface TelegramProfile {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
}

export type TelegramInitDataUser = TelegramProfile

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60

// Проверка подписи initData по алгоритму Telegram (Mini App):
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export function validateInitData(initData: string, botToken: string): TelegramInitDataUser | null {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  if (computedHash !== hash) return null

  const authDate = Number(params.get('auth_date'))
  if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SECONDS) return null

  const userRaw = params.get('user')
  if (!userRaw) return null

  return JSON.parse(userRaw) as TelegramInitDataUser
}
