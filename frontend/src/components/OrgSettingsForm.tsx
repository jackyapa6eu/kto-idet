import { useEffect } from 'react'
import { observer } from 'mobx-react-lite'
import { Flex, Spin, Alert, Input, Button, Switch, Typography, Popconfirm, message } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import { orgStore } from '../stores/orgStore'
import { templatesStore } from '../stores/templatesStore'

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
    templatesStore.fetchTemplates(organizationId)
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

      <Flex vertical gap={8}>
        <Text strong>Шаблоны мероприятий</Text>
        {templatesStore.loading ? (
          <Spin size="small" />
        ) : templatesStore.templates.length === 0 ? (
          <Text type="secondary">Пока нет ни одного шаблона</Text>
        ) : (
          <Flex vertical gap={8}>
            {templatesStore.templates.map((t) => {
              const infoParts = [
                t.location,
                t.price,
                t.maxParticipants != null ? `до ${t.maxParticipants} чел.` : null,
              ].filter(Boolean)
              return (
                <Flex key={t.id} justify="space-between" align="center" gap={16}>
                  <Flex vertical>
                    <Text>{t.name}</Text>
                    {infoParts.length > 0 && <Text type="secondary">{infoParts.join(' · ')}</Text>}
                  </Flex>
                  <Popconfirm
                    title="Удалить шаблон?"
                    okText="Удалить"
                    okButtonProps={{ danger: true }}
                    cancelText="Отмена"
                    onConfirm={() => templatesStore.deleteTemplate(t.id)}
                  >
                    <Button
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      loading={templatesStore.deletingId === t.id}
                    />
                  </Popconfirm>
                </Flex>
              )
            })}
          </Flex>
        )}
      </Flex>
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
