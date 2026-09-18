import { makeAutoObservable, runInAction } from 'mobx'
import dayjs from 'dayjs'
import { apiFetch, extractErrorMessage } from '../api'

export interface EventItem {
  id: number
  title: string
  location: string
  startsAt: string
  durationMinutes: number | null
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
  // null у мероприятий, созданных до перехода на мультитенантность. По этому полю App.tsx
  // узнаёт, для какой организации показать список под ссылкой на конкретное мероприятие.
  organizationId: number | null
  title: string
  location: string
  startsAt: string
  durationMinutes: number | null
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
  reserve: EventParticipant[]
  shareUrl: string
  // null — разовое мероприятие; число — раз в сколько дней создаётся следующее в цепочке
  // (сейчас всегда 7). Платная фича, см. CreateEventForm.
  repeatEveryDays: number | null
}

export interface CreateEventInput {
  title: string
  location: string
  startsAt: string
  durationMinutes?: number
  maxParticipants?: number
  trainer?: string
  price?: string
  court?: string
  paymentPhone?: string
  bank?: string
  comment?: string
  repeatWeekly?: boolean
  saveAsTemplate?: boolean
  templateName?: string
}

// PUT /api/events/:id не принимает saveAsTemplate/templateName — сохранение шаблона доступно
// только при создании нового мероприятия, не при редактировании существующего.
export type UpdateEventInput = Omit<CreateEventInput, 'saveAsTemplate' | 'templateName'>

class EventsStore {
  // Список — per-org: запоминаем, для какой организации он загружен, чтобы create/update/
  // join/leave/delete могли обновить его же, не прося organizationId заново у вызывающего.
  organizationId: number | null = null
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

  async fetchEvents(organizationId: number) {
    this.organizationId = organizationId
    this.loading = true
    this.error = null
    try {
      const res = await apiFetch(`/api/events?organizationId=${organizationId}`)
      if (!res.ok) throw new Error(await extractErrorMessage(res))
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

  private async refetchEvents() {
    if (this.organizationId != null) await this.fetchEvents(this.organizationId)
  }

  async createEvent(input: CreateEventInput) {
    if (this.organizationId == null) throw new Error('Неизвестна организация для создания мероприятия')
    this.creating = true
    try {
      const res = await apiFetch('/api/events', {
        method: 'POST',
        body: JSON.stringify({ ...input, organizationId: this.organizationId }),
      })
      if (!res.ok) throw new Error(await extractErrorMessage(res))
      await this.refetchEvents()
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
      if (!res.ok) throw new Error(await extractErrorMessage(res))
      await Promise.all([this.fetchEventDetails(id), this.refetchEvents()])
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
    if (!res.ok) throw new Error(await extractErrorMessage(res))
    await Promise.all([this.fetchEventDetails(id), this.refetchEvents()])
  }

  async leaveEvent(id: number) {
    const res = await apiFetch(`/api/events/${id}/participants`, { method: 'DELETE' })
    if (!res.ok) throw new Error(await extractErrorMessage(res))
    await Promise.all([this.fetchEventDetails(id), this.refetchEvents()])
  }

  // Оптимистично меняем локально — полный refetch дёрнул бы selectedEventLoading и мигнул
  // бы спиннером поверх всего списка участников ради одного чекбокса.
  async setParticipantPaid(eventId: number, telegramId: string, paid: boolean) {
    const participant = [
      ...(this.selectedEvent?.participants ?? []),
      ...(this.selectedEvent?.reserve ?? []),
    ].find((p) => p.telegramId === telegramId)
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

  // Организатор исключает участника ("не придёт") — в отличие от setParticipantPaid, полный
  // refetch тут уместен: список может измениться сильнее одного поля (кто-то из резерва
  // поднимается в основной состав).
  async kickParticipant(eventId: number, telegramId: string) {
    const res = await apiFetch(`/api/events/${eventId}/participants/${telegramId}`, {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error(await extractErrorMessage(res))
    await Promise.all([this.fetchEventDetails(eventId), this.refetchEvents()])
  }

  async deleteEvent(id: number) {
    const res = await apiFetch(`/api/events/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(await extractErrorMessage(res))
    await this.refetchEvents()
  }
}

export const eventsStore = new EventsStore()
