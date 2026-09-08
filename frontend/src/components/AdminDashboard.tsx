import { useEffect, useState } from 'react'
import { Flex, Spin, Alert, Statistic, Table, Tag } from 'antd'
import dayjs from 'dayjs'
import { apiFetch, extractErrorMessage } from '../api'

interface AdminOrg {
  id: number
  name: string
  telegramChatId: string
  status: string
  createdAt: string
  scheduledDeletionAt: string | null
  eventsCount: number
}

interface AdminStats {
  counts: {
    total: number
    active: number
    setup_pending: number
    disconnected: number
    removed: number
    blocked: number
  }
  organizations: AdminOrg[]
}

const STATUS_LABELS: Record<string, { text: string; color: string }> = {
  active: { text: 'Активен', color: 'green' },
  setup_pending: { text: 'Настройка', color: 'gold' },
  disconnected: { text: 'Отключён', color: 'orange' },
  removed: { text: 'Удаляется', color: 'red' },
  blocked: { text: 'Заблокирован', color: 'red' },
}

// Личный дашборд владельца бота — сколько чатов подключено и на какой они стадии. Доступ
// проверяется на бэкенде по ADMIN_TELEGRAM_ID; сюда попадают через deep-link admin-0
// (t.me/<bot>/app?startapp=admin-0), без отдельной кнопки в самом мини-аппе.
export const AdminDashboard = () => {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/admin/stats')
      .then(async (res) => {
        if (!res.ok) throw new Error(await extractErrorMessage(res))
        return res.json() as Promise<AdminStats>
      })
      .then((data) => {
        if (!cancelled) setStats(data)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <Alert type="error" showIcon message={error} />

  if (!stats) {
    return (
      <Flex justify="center" style={{ padding: 24 }}>
        <Spin />
      </Flex>
    )
  }

  const { counts, organizations } = stats

  return (
    <Flex vertical gap={20}>
      <Flex gap={24} wrap="wrap">
        <Statistic title="Всего чатов" value={counts.total} />
        <Statistic title="Активных" value={counts.active} valueStyle={{ color: '#3f8600' }} />
        {counts.setup_pending > 0 && <Statistic title="В настройке" value={counts.setup_pending} />}
        {counts.disconnected > 0 && (
          <Statistic title="Отключено" value={counts.disconnected} valueStyle={{ color: '#d48806' }} />
        )}
        {counts.removed > 0 && (
          <Statistic title="На удалении" value={counts.removed} valueStyle={{ color: '#cf1322' }} />
        )}
        {counts.blocked > 0 && (
          <Statistic title="Заблокировано" value={counts.blocked} valueStyle={{ color: '#cf1322' }} />
        )}
      </Flex>

      <Table<AdminOrg>
        dataSource={organizations}
        rowKey="id"
        size="small"
        pagination={false}
        scroll={{ x: true }}
        columns={[
          { title: 'Чат', dataIndex: 'name', ellipsis: true },
          {
            title: 'Статус',
            dataIndex: 'status',
            width: 110,
            render: (status: string) => {
              const label = STATUS_LABELS[status] ?? { text: status, color: 'default' }
              return <Tag color={label.color}>{label.text}</Tag>
            },
          },
          {
            title: 'Подключён',
            dataIndex: 'createdAt',
            width: 100,
            render: (value: string) => dayjs(value).format('DD.MM.YY'),
          },
          { title: 'Событий', dataIndex: 'eventsCount', width: 80, align: 'right' },
        ]}
      />
    </Flex>
  )
}
