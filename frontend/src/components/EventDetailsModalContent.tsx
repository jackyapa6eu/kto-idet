import { useEffect } from 'react'
import { observer } from 'mobx-react-lite'
import { eventsStore } from '../stores/eventsStore'
import { modalStore } from '../stores/modalStore'
import { EventDetailsView } from './EventDetailsView'

export const EventDetailsModalContent = observer(({ eventId }: { eventId: number }) => {
  const event = eventsStore.selectedEvent

  useEffect(() => {
    if (event && event.id === eventId) {
      modalStore.setTitle(event.title)
    }
  }, [event, eventId])

  return <EventDetailsView eventId={eventId} />
})
