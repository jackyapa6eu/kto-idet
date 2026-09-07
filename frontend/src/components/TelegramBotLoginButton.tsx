import { useEffect, useRef, useState } from 'react'
import { Button, Typography, Spin } from 'antd'
import { TelegramFilled } from '@ant-design/icons'
import { apiFetch } from '../api'
import { userStore, type SyncedUser } from '../stores/userStore'

const POLL_INTERVAL_MS = 2000

type SessionStatus = 'idle' | 'waiting' | 'expired' | 'error'

export const TelegramBotLoginButton = () => {
  const [status, setStatus] = useState<SessionStatus>('idle')
  const [deepLink, setDeepLink] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
  }

  const startSession = async () => {
    stopPolling()
    setStatus('idle')
    setDeepLink(null)

    try {
      const res = await apiFetch('/api/auth/session', { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { token, deepLink }: { token: string; deepLink: string } = await res.json()

      setDeepLink(deepLink)
      setStatus('waiting')
      window.open(deepLink, '_blank', 'noopener')

      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await apiFetch(`/api/auth/session/${token}`)
          if (pollRes.status === 410) {
            stopPolling()
            setStatus('expired')
            return
          }
          if (!pollRes.ok) throw new Error(`HTTP ${pollRes.status}`)

          const data: { status: string; token?: string; user?: SyncedUser } = await pollRes.json()
          if (data.status === 'confirmed' && data.token && data.user) {
            stopPolling()
            userStore.applyLoginSession(data.token, data.user)
          }
        } catch {
          stopPolling()
          setStatus('error')
        }
      }, POLL_INTERVAL_MS)
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => stopPolling, [])

  if (status === 'waiting' && deepLink) {
    return (
      <>
        <Spin />
        <Typography.Text type="secondary">
          Открылась вкладка с Telegram — нажмите Start в чате с ботом, вход подтвердится
          автоматически.
        </Typography.Text>
        <Typography.Link href={deepLink} target="_blank" rel="noopener">
          Открыть чат с ботом ещё раз
        </Typography.Link>
      </>
    )
  }

  return (
    <>
      {status === 'expired' && (
        <Typography.Text type="warning">Ссылка для входа устарела, попробуйте ещё раз</Typography.Text>
      )}
      {status === 'error' && (
        <Typography.Text type="danger">Не удалось начать вход, попробуйте ещё раз</Typography.Text>
      )}
      <Button type="primary" icon={<TelegramFilled />} onClick={startSession}>
        Войти через Telegram
      </Button>
    </>
  )
}
