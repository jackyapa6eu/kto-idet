import { makeAutoObservable, runInAction } from 'mobx'
import { apiFetch, extractErrorMessage } from '../api'

export interface EventTemplate {
  id: number
  name: string
  title: string
  location: string | null
  maxParticipants: number | null
  trainer: string | null
  price: string | null
  court: string | null
  paymentPhone: string | null
  bank: string | null
  comment: string | null
}

class TemplatesStore {
  organizationId: number | null = null
  templates: EventTemplate[] = []
  loading = false
  error: string | null = null
  deletingId: number | null = null

  constructor() {
    makeAutoObservable(this)
  }

  async fetchTemplates(organizationId: number) {
    this.organizationId = organizationId
    this.loading = true
    this.error = null
    try {
      const res = await apiFetch(`/api/event-templates?organizationId=${organizationId}`)
      if (!res.ok) throw new Error(await extractErrorMessage(res))
      const data: EventTemplate[] = await res.json()
      runInAction(() => {
        this.templates = data
      })
    } catch (e) {
      runInAction(() => {
        this.error = e instanceof Error ? e.message : 'Не удалось загрузить шаблоны'
      })
    } finally {
      runInAction(() => {
        this.loading = false
      })
    }
  }

  async deleteTemplate(id: number) {
    this.deletingId = id
    try {
      const res = await apiFetch(`/api/event-templates/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await extractErrorMessage(res))
      runInAction(() => {
        this.templates = this.templates.filter((t) => t.id !== id)
      })
    } finally {
      runInAction(() => {
        this.deletingId = null
      })
    }
  }
}

export const templatesStore = new TemplatesStore()
