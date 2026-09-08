import { useEffect } from 'react'
import { observer } from 'mobx-react-lite'
import { Card, Typography, Tag, Flex, Spin, Alert, Button } from 'antd'
import { CalendarOutlined, EnvironmentOutlined, TeamOutlined, PlusOutlined } from '@ant-design/icons'
import { eventsStore, type EventItem } from '../stores/eventsStore'
import { orgStore } from '../stores/orgStore'
import { modalStore } from '../stores/modalStore'
import { EventDetailsModalContent } from './EventDetailsModalContent'
import { CreateEventForm } from './CreateEventForm'
import { formatEventDate } from '../utils/formatEventDate'

const { Title, Text, Link } = Typography

const DEVELOPER_USERNAME = 'jackyapa6eu'

function openEventDetails(event: EventItem) {
  modalStore.open(<EventDetailsModalContent eventId={event.id} />, event.title)
}

function openCreateEvent() {
  modalStore.open(<CreateEventForm />, 'Новое мероприятие')
}

export const EventsList = observer(({ organizationId }: { organizationId: number }) => {
  useEffect(() => {
    eventsStore.fetchEvents(organizationId)
    orgStore.fetchOrganization(organizationId)
  }, [organizationId])

  // Пока orgStore ещё не ответил, не показываем кнопку — лучше короткая задержка, чем
  // мелькание "Создать" с последующим исчезновением для тех, кому создавать нельзя.
  const canCreateEvents = orgStore.org?.canCreateEvents ?? false

  return (
    <>
      <Flex justify="space-between" align="center">
        <Flex vertical gap={0}>
          {/* Кастомное название организации задаётся в настройках мини-аппа (OrgSettingsForm) и
              нигде за пределами мини-аппа не используется — сообщения бота показывают только
              реальное название чата из Telegram (см. getChatTitle в bot.ts). */}
          {orgStore.org?.name && (
            <Text type="secondary" style={{ fontSize: 13 }}>
              {orgStore.org.name}
            </Text>
          )}
          <Title level={4} style={{ margin: 0 }}>
            Предстоящие мероприятия
          </Title>
        </Flex>
        {canCreateEvents && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateEvent}>
            Создать
          </Button>
        )}
      </Flex>
      {orgStore.org && !canCreateEvents && (
        <Alert
          type="info"
          showIcon
          message="Создавать мероприятия может только администратор группы"
        />
      )}
      {eventsStore.loading && <Spin />}
      {eventsStore.error && <Alert type="error" message={eventsStore.error} showIcon />}
      <Flex vertical gap={8}>
        {eventsStore.events.map((event) => {
          const isFull =
            event.maxParticipants != null && event.participantsCount >= event.maxParticipants
          return (
            <Card key={event.id} hoverable onClick={() => openEventDetails(event)}>
              <Flex vertical gap={8}>
                <Flex justify="space-between" align="start">
                  <Flex vertical gap={4}>
                    <Text strong>{event.title}</Text>
                    <Text type="secondary">
                      <CalendarOutlined /> {formatEventDate(event.startsAt)}
                    </Text>
                    <Text type="secondary">
                      <EnvironmentOutlined /> {event.location}
                    </Text>
                  </Flex>
                  <Tag icon={<TeamOutlined />} color={isFull ? 'default' : 'green'}>
                    {event.maxParticipants != null
                      ? `${event.participantsCount}/${event.maxParticipants}`
                      : event.participantsCount}
                  </Tag>
                </Flex>
                <Flex justify="end">
                  <Button
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation()
                      openEventDetails(event)
                    }}
                  >
                    Открыть
                  </Button>
                </Flex>
              </Flex>
            </Card>
          )
        })}
      </Flex>
      <Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
        Есть пожелания или предложения? Пишите{' '}
        <Link href={`https://t.me/${DEVELOPER_USERNAME}`} target="_blank">
          @{DEVELOPER_USERNAME}
        </Link>{' '}
        — спасибо, что пользуетесь ботом! 🙏
      </Text>
    </>
  )
})
