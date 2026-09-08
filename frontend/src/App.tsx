import { useEffect, useState, type ReactNode } from 'react'
import { ConfigProvider, Flex, Typography, Spin, Alert, theme as antdTheme } from 'antd'
import ruRU from 'antd/locale/ru_RU'
import { observer } from 'mobx-react-lite'
import { Header } from './components/Header'
import { EventsList } from './components/EventsList'
import { AppModal } from './components/AppModal'
import { Landing } from './components/Landing'
import './components/Landing.css'
import { TelegramBotLoginButton } from './components/TelegramBotLoginButton'
import { EventDetailsModalContent } from './components/EventDetailsModalContent'
import { OrgSettingsForm, OrgSettingsButton } from './components/OrgSettingsForm'
import { userStore } from './stores/userStore'
import { themeStore } from './stores/themeStore'
import { modalStore } from './stores/modalStore'
import { eventsStore } from './stores/eventsStore'

interface LinkContext {
  modal: string
  id: string
}

function openModal(modal: string, id: string) {
  switch (modal) {
    case 'event':
      modalStore.open(<EventDetailsModalContent eventId={Number(id)} />)
      return
    case 'settings':
      modalStore.open(<OrgSettingsForm organizationId={Number(id)} />, 'Настройки группы')
      return
  }
}

function openSettings(organizationId: number) {
  modalStore.open(<OrgSettingsForm organizationId={organizationId} />, 'Настройки группы')
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
// вообще (например, мини-апп открыли через постоянную кнопку меню бота или напрямую по
// ссылке без параметров), это не "чат", а холодный визит — показываем Landing вместо
// попытки сразу авторизовать и открыть список событий.
function getLinkContext(): LinkContext | null {
  const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param
  if (startParam) return parseStartParam(startParam)

  // Вне Telegram (например, при локальной разработке в обычном браузере) то же самое
  // можно передать явными query-параметрами страницы.
  const params = new URLSearchParams(window.location.search)
  const modal = params.get('modal')
  const id = params.get('id')
  return modal != null && id != null ? { modal, id } : null
}

function cleanUpDevQueryParams() {
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

const AppContent = observer(() => {
  const [linkContext] = useState(getLinkContext)

  // Открытие мероприятия по ссылке-шарингу не должно зависеть от того, участник ли человек
  // группы (GET /api/events/:id доступен всем авторизованным через Telegram) — поэтому эффект
  // висит здесь, а не внутри EventsList, которая для не-участников вообще не рендерится.
  useEffect(() => {
    if (linkContext) openModal(linkContext.modal, linkContext.id)
    cleanUpDevQueryParams()
  }, [linkContext])

  if (!linkContext) {
    return <Landing />
  }

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
        <Typography.Title level={3}>Кто идёт</Typography.Title>
        <Typography.Text type="secondary">
          Войдите через Telegram, чтобы смотреть и создавать мероприятия
        </Typography.Text>
        <TelegramBotLoginButton />
      </Flex>
    )
  }

  // Список мероприятий — per-org. Контекст org-<id>/settings-<id> называет организацию
  // напрямую. Контекст event-<id> её не несёт в самой ссылке, но GET /api/events/:id (тот же
  // запрос, что и так загружает модалку мероприятия по этой ссылке) отдаёт organizationId в
  // ответе — переиспользуем его вместо того, чтобы прятать список от участников группы.
  const requestedEventId = linkContext.modal === 'event' ? Number(linkContext.id) : null
  const eventResolved = requestedEventId != null && eventsStore.selectedEvent?.id === requestedEventId
  const eventFailed = requestedEventId != null && eventsStore.selectedEventError != null

  const organizationId =
    linkContext.modal === 'org' || linkContext.modal === 'settings'
      ? Number(linkContext.id)
      : eventResolved
        ? eventsStore.selectedEvent!.organizationId
        : null

  // Пока грузится мероприятие по ссылке, ещё не знаем его организацию — показываем спиннер
  // вместо преждевременного "список недоступен".
  const resolvingOrganization = requestedEventId != null && !eventResolved && !eventFailed

  return (
    <Flex vertical gap={16} style={{ maxWidth: 480, margin: '0 auto', padding: 16 }}>
      <Header
        extra={
          organizationId != null && <OrgSettingsButton onOpen={() => openSettings(organizationId)} />
        }
      />
      {organizationId != null ? (
        <EventsList organizationId={organizationId} />
      ) : resolvingOrganization ? (
        <Flex justify="center" style={{ padding: 24 }}>
          <Spin />
        </Flex>
      ) : (
        <Alert type="info" showIcon message="Список мероприятий группы для этой ссылки недоступен" />
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
