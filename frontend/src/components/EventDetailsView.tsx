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
  UserDeleteOutlined,
} from '@ant-design/icons'
import { eventsStore } from '../stores/eventsStore'
import { userStore } from '../stores/userStore'
import { modalStore } from '../stores/modalStore'
import { orgStore } from '../stores/orgStore'
import { formatEventDate } from '../utils/formatEventDate'
import { CreateEventForm } from './CreateEventForm'
import { TelegramBotLoginButton } from './TelegramBotLoginButton'

function participantName(p: { firstName: string; lastName: string | null }) {
  return [p.firstName, p.lastName].filter(Boolean).join(' ')
}

// tg://user?id=<id> — та же ссылка на профиль, что используется в сообщениях бота
// (см. digest.ts): открывает профиль по id, работает даже без @username.
//
// observer() обязателен: participant приходит как поле observable-массива eventsStore.selectedEvent,
// и без него мутация participant.paid (оптимистичное обновление в setParticipantPaid) не
// перерисовывает эту строку — родитель EventDetailsView не читает .paid в своём рендере, поэтому
// без собственной подписки чекбокс визуально не отвечал на клик до следующего refetch.
const ParticipantRow = observer(function ParticipantRow({
  participant,
  isOrganizer,
  isEventOrganizer,
  onTogglePaid,
  onKick,
}: {
  participant: { telegramId: string; firstName: string; lastName: string | null; photoUrl: string | null; paid: boolean }
  isOrganizer: boolean
  // Организатор мероприятия сам числится участником (см. index.ts при создании), но у него
  // нет пути вернуться через UI, если его исключить — бэкенд это запрещает, а кнопку прячем
  // здесь же, чтобы не предлагать действие, которое всё равно закончится ошибкой.
  isEventOrganizer: boolean
  onTogglePaid: (telegramId: string, paid: boolean) => void
  onKick: (telegramId: string, name: string) => void
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
        <Flex align="center" gap={4}>
          <Checkbox
            checked={participant.paid}
            onChange={(e) => onTogglePaid(participant.telegramId, e.target.checked)}
          >
            Оплачено
          </Checkbox>
          {!isEventOrganizer && (
            <Popconfirm
              title="Исключить участника?"
              description={`${participantName(participant)} не будет числиться в записавшихся.`}
              okText="Не придёт"
              okButtonProps={{ danger: true }}
              cancelText="Отмена"
              onConfirm={() => onKick(participant.telegramId, participantName(participant))}
            >
              <Button
                type="text"
                danger
                size="small"
                icon={<UserDeleteOutlined />}
                title="Не придёт"
              />
            </Popconfirm>
          )}
        </Flex>
      )}
    </Flex>
  )
})

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

  // Нужен orgStore.org.isPaid для тумблера "повторять" в форме редактирования (см.
  // CreateEventForm) — EventsList грузит его сам, но сюда можно попасть и напрямую по
  // shared-ссылке на мероприятие, минуя список.
  useEffect(() => {
    if (event?.organizationId != null) orgStore.fetchOrganization(event.organizationId)
  }, [event?.organizationId])

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
  // Держим в синхроне с LEAVE_CUTOFF_MS на бэкенде (index.ts) — чтобы не давать нажать кнопку
  // впустую и получить ошибку с сервера.
  const isPastLeaveCutoff = new Date(event.startsAt).getTime() - Date.now() < 6 * 60 * 60 * 1000

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
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Не удалось отменить участие')
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

  const handleKick = async (telegramId: string, name: string) => {
    try {
      await eventsStore.kickParticipant(event.id, telegramId)
      message.success(`${name} исключён(а) из мероприятия`)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Не удалось исключить участника')
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
                isEventOrganizer={p.telegramId === event.createdByTelegramId}
                onTogglePaid={handleTogglePaid}
                onKick={handleKick}
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
                isEventOrganizer={p.telegramId === event.createdByTelegramId}
                onTogglePaid={handleTogglePaid}
                onKick={handleKick}
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
          <Flex vertical gap={4}>
            <Button
              danger
              block
              loading={acting}
              disabled={isPastLeaveCutoff}
              onClick={handleLeave}
            >
              {isInReserve ? 'Покинуть резерв' : 'Не участвовать'}
            </Button>
            {isPastLeaveCutoff && (
              <Typography.Text type="secondary" style={{ textAlign: 'center' }}>
                Отменить участие можно не позднее чем за 6 часов до начала
              </Typography.Text>
            )}
          </Flex>
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
