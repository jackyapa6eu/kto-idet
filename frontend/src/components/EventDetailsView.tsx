import { useEffect, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { Descriptions, Tag, Avatar, Flex, Typography, Spin, Button, Checkbox, Popconfirm, Alert, Modal, message } from 'antd'
import {
  CalendarOutlined,
  EnvironmentOutlined,
  TeamOutlined,
  UserOutlined,
  DeleteOutlined,
  EditOutlined,
  ShareAltOutlined,
} from '@ant-design/icons'
import { eventsStore } from '../stores/eventsStore'
import { userStore } from '../stores/userStore'
import { modalStore } from '../stores/modalStore'
import { formatEventDate } from '../utils/formatEventDate'
import { CreateEventForm } from './CreateEventForm'
import { TelegramBotLoginButton } from './TelegramBotLoginButton'

function participantName(p: { firstName: string; lastName: string | null }) {
  return [p.firstName, p.lastName].filter(Boolean).join(' ')
}

// tg://user?id=<id> — та же ссылка на профиль, что используется в сообщениях бота
// (см. digest.ts): открывает профиль по id, работает даже без @username.
function ParticipantRow({
  participant,
  isOrganizer,
  onTogglePaid,
}: {
  participant: { telegramId: string; firstName: string; lastName: string | null; photoUrl: string | null; paid: boolean }
  isOrganizer: boolean
  onTogglePaid: (telegramId: string, paid: boolean) => void
}) {
  return (
    <Flex align="center" justify="space-between" gap={8}>
      <a
        href={`tg://user?id=${participant.telegramId}`}
        style={{ color: 'inherit', textDecoration: 'none' }}
      >
        <Flex align="center" gap={8}>
          <Avatar src={participant.photoUrl} icon={<UserOutlined />} size="small" />
          <Typography.Text>
            {participantName(participant)}
            {participant.paid && ' 💰'}
          </Typography.Text>
        </Flex>
      </a>
      {isOrganizer && (
        <Checkbox
          checked={participant.paid}
          onChange={(e) => onTogglePaid(participant.telegramId, e.target.checked)}
        >
          Оплачено
        </Checkbox>
      )}
    </Flex>
  )
}

// Показывает ссылку текстом, чтобы скопировать вручную — сюда попадаем, если Clipboard API
// недоступен (например, в вебвью Telegram он может быть запрещён политикой разрешений).
function showShareLinkModal(url: string) {
  Modal.info({
    title: 'Ссылка на мероприятие',
    content: (
      <Typography.Paragraph copyable style={{ wordBreak: 'break-all' }}>
        {url}
      </Typography.Paragraph>
    ),
  })
}

// Ссылка вида t.me/<bot>/<app>?startapp=event-42 — открывает мини-апп сразу на этом
// мероприятии и авторизует человека как обычного пользователя Telegram, даже если он не
// состоит в группе. Вызываем navigator.share/clipboard прямо в обработчике клика без await
// перед этим: на iOS/Safari и в вебвью Telegram доступ к Web Share/Clipboard API привязан
// к user activation и теряется после асинхронной операции (например, сетевого запроса).
function shareEvent(url: string, title: string) {
  if (navigator.share) {
    navigator.share({ title, url }).catch(() => {
      // Пользователь закрыл системный диалог — ничего не делаем.
    })
    return
  }

  if (!navigator.clipboard?.writeText) {
    showShareLinkModal(url)
    return
  }

  navigator.clipboard.writeText(url).then(
    () => message.success('Ссылка на мероприятие скопирована'),
    () => showShareLinkModal(url),
  )
}

export const EventDetailsView = observer(({ eventId }: { eventId: number }) => {
  const [acting, setActing] = useState(false)

  useEffect(() => {
    eventsStore.fetchEventDetails(eventId)
    return () => eventsStore.clearSelectedEvent()
  }, [eventId])

  const event = eventsStore.selectedEvent

  if (eventsStore.selectedEventError) {
    return <Alert type="error" message={eventsStore.selectedEventError} showIcon />
  }

  if (eventsStore.selectedEventLoading || !event || event.id !== eventId) {
    return (
      <Flex justify="center" style={{ padding: 24 }}>
        <Spin />
      </Flex>
    )
  }

  const isFull =
    event.maxParticipants != null &&
    event.maxParticipants > 0 &&
    event.participants.length >= event.maxParticipants
  const isOrganizer = userStore.telegramId === event.createdByTelegramId
  const isConfirmed = event.participants.some((p) => p.telegramId === userStore.telegramId)
  const isInReserve = event.reserve.some((p) => p.telegramId === userStore.telegramId)
  const isParticipant = isConfirmed || isInReserve

  const handleJoin = async () => {
    setActing(true)
    try {
      await eventsStore.joinEvent(event.id)
    } catch {
      message.error('Не удалось записаться')
    } finally {
      setActing(false)
    }
  }

  const handleLeave = async () => {
    setActing(true)
    try {
      await eventsStore.leaveEvent(event.id)
    } catch {
      message.error('Не удалось отменить участие')
    } finally {
      setActing(false)
    }
  }

  const handleTogglePaid = async (telegramId: string, paid: boolean) => {
    try {
      await eventsStore.setParticipantPaid(event.id, telegramId, paid)
    } catch {
      message.error('Не удалось обновить статус оплаты')
    }
  }

  const handleEdit = () => {
    modalStore.open(<CreateEventForm event={event} />, 'Редактирование мероприятия')
  }

  const handleDelete = async () => {
    setActing(true)
    try {
      await eventsStore.deleteEvent(event.id)
      message.success('Мероприятие удалено')
      modalStore.close()
    } catch {
      message.error('Не удалось удалить мероприятие')
      setActing(false)
    }
  }

  return (
    <Flex vertical gap={16}>
      <Flex justify="end" align="start" gap={8}>
        <Button icon={<ShareAltOutlined />} onClick={() => shareEvent(event.shareUrl, event.title)}>
          Поделиться
        </Button>
      </Flex>

      <Descriptions column={1}>
        <Descriptions.Item
          label={
            <>
              <UserOutlined /> Организатор
            </>
          }
        >
          <Flex align="center" gap={8}>
            <Avatar src={event.organizer.photoUrl} icon={<UserOutlined />} size="small" />
            {participantName(event.organizer)}
          </Flex>
        </Descriptions.Item>
        <Descriptions.Item
          label={
            <>
              <CalendarOutlined /> Дата и время
            </>
          }
        >
          {formatEventDate(event.startsAt)}
        </Descriptions.Item>
        <Descriptions.Item
          label={
            <>
              <EnvironmentOutlined /> Место
            </>
          }
        >
          {event.location}
        </Descriptions.Item>
        {event.trainer && <Descriptions.Item label="Тренер">{event.trainer}</Descriptions.Item>}
        {event.price && <Descriptions.Item label="Стоимость">{event.price}</Descriptions.Item>}
        {event.court && <Descriptions.Item label="Корт">{event.court}</Descriptions.Item>}
        {event.paymentPhone && (
          <Descriptions.Item label="Перевод на номер">{event.paymentPhone}</Descriptions.Item>
        )}
        {event.bank && <Descriptions.Item label="Банк">{event.bank}</Descriptions.Item>}
        {event.comment && (
          <Descriptions.Item label="Комментарий">
            <span style={{ whiteSpace: 'pre-wrap' }}>{event.comment}</span>
          </Descriptions.Item>
        )}
        <Descriptions.Item
          label={
            <>
              <TeamOutlined /> Участники
            </>
          }
        >
          <Tag color={isFull ? 'default' : 'green'}>
            {event.maxParticipants != null && event.maxParticipants > 0
              ? `${event.participants.length}/${event.maxParticipants}`
              : event.participants.length}
          </Tag>
        </Descriptions.Item>
      </Descriptions>

      <Flex vertical gap={8}>
        <Typography.Text strong>Участники</Typography.Text>
        <Flex vertical gap={8}>
          {event.participants.length > 0 ? (
            event.participants.map((p) => (
              <ParticipantRow
                key={p.telegramId}
                participant={p}
                isOrganizer={isOrganizer}
                onTogglePaid={handleTogglePaid}
              />
            ))
          ) : (
            <Typography.Text type="secondary">Пока никого</Typography.Text>
          )}
        </Flex>
      </Flex>

      {event.reserve.length > 0 && (
        <Flex vertical gap={8}>
          <Typography.Text strong>Резерв</Typography.Text>
          <Flex vertical gap={8}>
            {event.reserve.map((p) => (
              <ParticipantRow
                key={p.telegramId}
                participant={p}
                isOrganizer={isOrganizer}
                onTogglePaid={handleTogglePaid}
              />
            ))}
          </Flex>
        </Flex>
      )}

      <Flex vertical gap={8}>
        {!userStore.isAuthenticated ? (
          <Flex vertical align="center" gap={8} style={{ textAlign: 'center' }}>
            <Typography.Text type="secondary">
              Войдите через Telegram, чтобы записаться на мероприятие
            </Typography.Text>
            <TelegramBotLoginButton />
          </Flex>
        ) : isOrganizer ? (
          <Typography.Text type="secondary">Вы организатор этого мероприятия</Typography.Text>
        ) : isParticipant ? (
          <Button danger block loading={acting} onClick={handleLeave}>
            {isInReserve ? 'Покинуть резерв' : 'Не участвовать'}
          </Button>
        ) : (
          <Button type="primary" block loading={acting} onClick={handleJoin}>
            {isFull ? 'Записаться в резерв' : 'Участвовать'}
          </Button>
        )}
      </Flex>

      {userStore.isAuthenticated && isOrganizer && (
        <Flex vertical gap={8}>
          <Button icon={<EditOutlined />} block onClick={handleEdit}>
            Редактировать
          </Button>
          <Popconfirm
            title="Удалить мероприятие?"
            description="Это действие необратимо."
            okText="Удалить"
            okButtonProps={{ danger: true }}
            cancelText="Отмена"
            onConfirm={handleDelete}
          >
            <Button danger icon={<DeleteOutlined />} loading={acting} block>
              Удалить мероприятие
            </Button>
          </Popconfirm>
        </Flex>
      )}
    </Flex>
  )
})
