import { useEffect, type ReactNode } from 'react'
import { ConfigProvider, Flex, Typography, Spin, Alert, theme as antdTheme } from 'antd'
import ruRU from 'antd/locale/ru_RU'
import { observer } from 'mobx-react-lite'
import { Header } from './components/Header'
import { EventsList } from './components/EventsList'
import { AppModal } from './components/AppModal'
import { TelegramBotLoginButton } from './components/TelegramBotLoginButton'
import { EventDetailsModalContent } from './components/EventDetailsModalContent'
import { userStore } from './stores/userStore'
import { themeStore } from './stores/themeStore'
import { modalStore } from './stores/modalStore'

function openModal(modal: string, id: string): boolean {
  switch (modal) {
    case 'event':
      modalStore.open(<EventDetailsModalContent eventId={Number(id)} />)
      return true
    default:
      return false
  }
}

// Ссылка t.me/<bot>/<app>?startapp=event-42, по которой бот присылает уведомления и по
// которой шарят мероприятия, передаёт "event-42" в Telegram.WebApp.initDataUnsafe.start_param
// (а не в URL) — путь после короткого имени мини-аппа Telegram не прокидывает.
function parseStartParam(startParam: string): { modal: string; id: string } | null {
  const separatorIndex = startParam.indexOf('-')
  if (separatorIndex === -1) return null
  return { modal: startParam.slice(0, separatorIndex), id: startParam.slice(separatorIndex + 1) }
}

function openModalFromDeepLink() {
  const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param
  const parsed = startParam ? parseStartParam(startParam) : null
  if (parsed) {
    openModal(parsed.modal, parsed.id)
    return
  }

  // Вне Telegram (например, при локальной разработке в обычном браузере) то же самое
  // можно передать явными query-параметрами страницы.
  const params = new URLSearchParams(window.location.search)
  const modal = params.get('modal')
  const id = params.get('id')
  if (modal == null || id == null || !openModal(modal, id)) return

  params.delete('modal')
  params.delete('id')
  const query = params.toString()
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
  )
}

const AppContent = observer(() => {
  // Открытие мероприятия по ссылке-шарингу не должно зависеть от того, участник ли человек
  // группы (GET /api/events/:id доступен всем авторизованным через Telegram) — поэтому эффект
  // висит здесь, а не внутри EventsList, которая для не-участников вообще не рендерится.
  useEffect(() => {
    openModalFromDeepLink()
  }, [])

  if (userStore.authLoading) {
    return (
      <Flex justify="center" style={{ marginTop: 64 }}>
        <Spin size="large" />
      </Flex>
    )
  }

  if (!userStore.isAuthenticated) {
    return (
      <Flex
        vertical
        align="center"
        gap={16}
        style={{ maxWidth: 480, margin: '0 auto', padding: 16, textAlign: 'center' }}
      >
        <Typography.Title level={3}>ОПГ Здоровья</Typography.Title>
        <Typography.Text type="secondary">
          Войдите через Telegram, чтобы смотреть и создавать мероприятия
        </Typography.Text>
        <TelegramBotLoginButton />
      </Flex>
    )
  }

  return (
    <Flex vertical gap={16} style={{ maxWidth: 480, margin: '0 auto', padding: 16 }}>
      <Header />
      <Typography.Text type="secondary">
        Организованная пляжная группа здоровья
      </Typography.Text>
      {userStore.isGroupMember ? (
        <EventsList />
      ) : (
        <Alert type="info" showIcon message="Доступно только участникам группы «ОПГ Здоровья»" />
      )}
    </Flex>
  )
})

const ThemedBackground = ({ children }: { children: ReactNode }) => {
  const { token } = antdTheme.useToken()
  return (
    <div style={{ minHeight: '100svh', background: token.colorBgLayout }}>{children}</div>
  )
}

const App = observer(() => {
  return (
    <ConfigProvider
      locale={ruRU}
      theme={{ algorithm: themeStore.isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm }}
    >
      <ThemedBackground>
        <AppContent />
        <AppModal />
      </ThemedBackground>
    </ConfigProvider>
  )
})

export default App
