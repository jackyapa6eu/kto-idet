import { makeAutoObservable, runInAction } from 'mobx'
import { apiFetch, extractErrorMessage } from '../api'

export interface OrganizationSettings {
  id: number
  name: string
  notificationsEnabled: boolean
  membersCanCreateEvents: boolean
  isOwner: boolean
  canManage: boolean
  canCreateEvents: boolean
}

export type OrganizationSettingsPatch = Partial<
  Pick<OrganizationSettings, 'name' | 'notificationsEnabled' | 'membersCanCreateEvents'>
>

class OrgStore {
  organizationId: number | null = null
  org: OrganizationSettings | null = null
  loading = false
  error: string | null = null
  saving = false

  constructor() {
    makeAutoObservable(this)
  }

  async fetchOrganization(organizationId: number) {
    // Уже грузим/загрузили именно эту организацию — не дёргаем API повторно на каждый
    // ре-рендер (EventsList и OrgSettingsForm могут вызвать это независимо друг от друга).
    if (this.organizationId === organizationId && (this.org || this.loading)) return

    this.organizationId = organizationId
    this.loading = true
    this.error = null
    try {
      const res = await apiFetch(`/api/organizations/${organizationId}`)
      if (!res.ok) throw new Error(await extractErrorMessage(res))
      const data: OrganizationSettings = await res.json()
      runInAction(() => {
        this.org = data
      })
    } catch (e) {
      runInAction(() => {
        this.error = e instanceof Error ? e.message : 'Не удалось загрузить организацию'
      })
    } finally {
      runInAction(() => {
        this.loading = false
      })
    }
  }

  async updateSettings(patch: OrganizationSettingsPatch) {
    if (this.organizationId == null) throw new Error('organizationId не задан')
    this.saving = true
    try {
      const res = await apiFetch(`/api/organizations/${this.organizationId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(await extractErrorMessage(res))
      const data: OrganizationSettings = await res.json()
      runInAction(() => {
        this.org = data
      })
    } finally {
      runInAction(() => {
        this.saving = false
      })
    }
  }
}

export const orgStore = new OrgStore()
