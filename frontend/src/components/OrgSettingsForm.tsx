import { useEffect } from 'react'
import { observer } from 'mobx-react-lite'
import { Flex, Spin, Alert, Input, Button, Switch, Typography, message } from 'antd'
import { orgStore } from '../stores/orgStore'

const { Text } = Typography

function SettingRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <Flex justify="space-between" align="center" gap={16}>
      <Flex vertical>
        <Text strong>{title}</Text>
        <Text type="secondary">{description}</Text>
      </Flex>
      <Switch checked={checked} disabled={disabled} onChange={onChange} />
    </Flex>
  )
}

export const OrgSettingsForm = observer(({ organizationId }: { organizationId: number }) => {
  useEffect(() => {
    orgStore.fetchOrganization(organizationId)
  }, [organizationId])

  const { org, loading, error, saving } = orgStore

  if (loading && !org) {
    return (
      <Flex justify="center" style={{ padding: 24 }}>
        <Spin />
      </Flex>
    )
  }

  if (error) {
    return <Alert type="error" showIcon message={error} />
  }

  if (!org) return null

  if (!org.canManage) {
    return (
      <Alert
        type="info"
        showIcon
        message="Настройки доступны только владельцу или администратору группы"
      />
    )
  }

  const handleNameSave = async (name: string) => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === org.name) return
    try {
      await orgStore.updateSettings({ name: trimmed })
      message.success('Название обновлено')
    } catch {
      message.error('Не удалось обновить название')
    }
  }

  const handleToggle = async (field: 'notificationsEnabled' | 'membersCanCreateEvents', checked: boolean) => {
    try {
      await orgStore.updateSettings({ [field]: checked })
    } catch {
      message.error('Не удалось сохранить')
    }
  }

  return (
    <Flex vertical gap={24}>
      <Flex vertical gap={8}>
        <Text strong>Название группы</Text>
        <Input.Search
          defaultValue={org.name}
          enterButton="Сохранить"
          loading={saving}
          onSearch={handleNameSave}
        />
      </Flex>

      <SettingRow
        title="Участники могут создавать мероприятия"
        description="Если выключено — только владелец или администратор группы"
        checked={org.membersCanCreateEvents}
        disabled={saving}
        onChange={(checked) => handleToggle('membersCanCreateEvents', checked)}
      />

      <SettingRow
        title="Оповещения включены"
        description="Сводка в закреплённом сообщении и уведомления о новых мероприятиях"
        checked={org.notificationsEnabled}
        disabled={saving}
        onChange={(checked) => handleToggle('notificationsEnabled', checked)}
      />
    </Flex>
  )
})

// Кнопка-триггер для открытия настроек — показывается только тем, кто может ими управлять,
// чтобы не путать обычных участников бесполезной для них шестерёнкой.
export const OrgSettingsButton = observer(({ onOpen }: { onOpen: () => void }) => {
  if (!orgStore.org?.canManage) return null
  return (
    <Button size="small" onClick={onOpen}>
      ⚙️ Настройки
    </Button>
  )
})
