import { useEffect } from 'react'
import { observer } from 'mobx-react-lite'
import { Card, Typography, Tag, Flex, Spin, Alert, Button } from 'antd'
import { CalendarOutlined, EnvironmentOutlined, TeamOutlined, PlusOutlined } from '@ant-design/icons'
import { eventsStore, type EventItem } from '../stores/eventsStore'
import { modalStore } from '../stores/modalStore'
import { EventDetailsModalContent } from './EventDetailsModalContent'
import { CreateEventForm } from './CreateEventForm'
import { formatEventDate } from '../utils/formatEventDate'

const { Title, Text } = Typography

function openEventDetails(event: EventItem) {
  modalStore.open(<EventDetailsModalContent eventId={event.id} />, event.title)
}

function openCreateEvent() {
  modalStore.open(<CreateEventForm />, 'Новое мероприятие')
}

export const EventsList = observer(() => {
  useEffect(() => {
    eventsStore.fetchEvents()
  }, [])

  return (
    <>
      <Flex justify="space-between" align="center">
        <Title level={4} style={{ margin: 0 }}>
          Предстоящие мероприятия
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateEvent}>
          Создать
        </Button>
      </Flex>
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
    </>
  )
})
