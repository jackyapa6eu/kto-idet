import { makeAutoObservable, runInAction } from 'mobx'
import dayjs from 'dayjs'
import { apiFetch } from '../api'

export interface EventItem {
  id: number
  title: string
  location: string
  startsAt: string
  participantsCount: number
  maxParticipants: number | null
}

export interface EventParticipant {
  telegramId: string
  firstName: string
  lastName: string | null
  photoUrl: string | null
  paid: boolean
}

export interface EventDetails {
  id: number
  title: string
  location: string
  startsAt: string
  maxParticipants: number | null
  trainer: string | null
  price: string | null
  court: string | null
  paymentPhone: string | null
  bank: string | null
  comment: string | null
  createdByTelegramId: string
  organizer: EventParticipant
  participants: EventParticipant[]
  shareUrl: string
}

export interface CreateEventInput {
  title: string
  location: string
  startsAt: string
  maxParticipants?: number
  trainer?: string
  price?: string
  court?: string
  paymentPhone?: string
  bank?: string
  comment?: string
}

export type UpdateEventInput = CreateEventInput

class EventsStore {
  events: EventItem[] = []
  loading = false
  error: string | null = null
  creating = false
  updating = false

  selectedEvent: EventDetails | null = null
  selectedEventLoading = false
  selectedEventError: string | null = null

  constructor() {
    makeAutoObservable(this)
  }

  async fetchEvents() {
    this.loading = true
    this.error = null
    try {
      const res = await apiFetch('/api/events')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: EventItem[] = await res.json()
      const startOfToday = dayjs().startOf('day')
      runInAction(() => {
        this.events = data.filter((event) => !dayjs(event.startsAt).isBefore(startOfToday))
      })
    } catch (e) {
      runInAction(() => {
        this.error = e instanceof Error ? e.message : 'Не удалось загрузить события'
      })
    } finally {
      runInAction(() => {
        this.loading = false
      })
    }
  }

  async createEvent(input: CreateEventInput) {
    this.creating = true
    try {
      const res = await apiFetch('/api/events', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await this.fetchEvents()
    } finally {
      runInAction(() => {
        this.creating = false
      })
    }
  }

  async updateEvent(id: number, input: UpdateEventInput) {
    this.updating = true
    try {
      const res = await apiFetch(`/api/events/${id}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await Promise.all([this.fetchEventDetails(id), this.fetchEvents()])
    } finally {
      runInAction(() => {
        this.updating = false
      })
    }
  }

  async fetchEventDetails(id: number) {
    this.selectedEventLoading = true
    this.selectedEventError = null
    try {
      const res = await apiFetch(`/api/events/${id}`)
      if (!res.ok) {
        throw new Error(res.status === 404 ? 'Мероприятие не найдено' : `HTTP ${res.status}`)
      }
      const data: EventDetails = await res.json()
      runInAction(() => {
        this.selectedEvent = data
      })
    } catch (e) {
      runInAction(() => {
        this.selectedEventError = e instanceof Error ? e.message : 'Не удалось загрузить мероприятие'
      })
    } finally {
      runInAction(() => {
        this.selectedEventLoading = false
      })
    }
  }

  clearSelectedEvent() {
    this.selectedEvent = null
    this.selectedEventError = null
  }

  async joinEvent(id: number) {
    const res = await apiFetch(`/api/events/${id}/participants`, { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await Promise.all([this.fetchEventDetails(id), this.fetchEvents()])
  }

  async leaveEvent(id: number) {
    const res = await apiFetch(`/api/events/${id}/participants`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await Promise.all([this.fetchEventDetails(id), this.fetchEvents()])
  }

  // Оптимистично меняем локально — полный refetch дёрнул бы selectedEventLoading и мигнул
  // бы спиннером поверх всего списка участников ради одного чекбокса.
  async setParticipantPaid(eventId: number, telegramId: string, paid: boolean) {
    const participant = this.selectedEvent?.participants.find((p) => p.telegramId === telegramId)
    const previous = participant?.paid
    if (participant) {
      runInAction(() => {
        participant.paid = paid
      })
    }
    try {
      const res = await apiFetch(`/api/events/${eventId}/participants/${telegramId}`, {
        method: 'PATCH',
        body: JSON.stringify({ paid }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (e) {
      if (participant && previous !== undefined) {
        runInAction(() => {
          participant.paid = previous
        })
      }
      throw e
    }
  }

  async deleteEvent(id: number) {
    const res = await apiFetch(`/api/events/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await this.fetchEvents()
  }
}

export const eventsStore = new EventsStore()
