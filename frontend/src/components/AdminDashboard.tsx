import { useEffect, useState } from 'react'
import { Flex, Spin, Alert, Statistic, Table, Tag, Tabs, Button, Popconfirm, Typography, DatePicker, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { apiFetch, extractErrorMessage } from '../api'

const { Text } = Typography

interface AdminOrg {
  id: number
  name: string
  telegramChatId: string
  status: string
  createdAt: string
  scheduledDeletionAt: string | null
  paidUntil: string | null
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

interface AdminEvent {
  id: number
  title: string
  description: string | null
  startsAt: string
  createdAt: string
  organizationId: number | null
  organizationName: string | null
  creatorFirstName: string | null
  creatorLastName: string | null
  creatorUsername: string | null
  participantsCount: number
}

const STATUS_LABELS: Record<string, { text: string; color: string }> = {
  active: { text: 'Активен', color: 'green' },
  setup_pending: { text: 'Настройка', color: 'gold' },
  disconnected: { text: 'Отключён', color: 'orange' },
  removed: { text: 'Удаляется', color: 'red' },
  blocked: { text: 'Заблокирован', color: 'red' },
}

function OrganizationsTab() {
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

  // Только владелец бота (ADMIN_TELEGRAM_ID) может дойти до этой вкладки вообще — сам
  // PATCH на бэкенде отдельно перепроверяет то же самое, здесь не полагаемся только на
  // то, что до формы никто посторонний не доберётся.
  const handlePaidUntilChange = async (orgId: number, date: Dayjs | null) => {
    const paidUntil = date ? date.endOf('day').toISOString() : null
    try {
      const res = await apiFetch(`/api/admin/organizations/${orgId}`, {
        method: 'PATCH',
        body: JSON.stringify({ paidUntil }),
      })
      if (!res.ok) throw new Error(await extractErrorMessage(res))
      setStats((prev) =>
        prev
          ? { ...prev, organizations: prev.organizations.map((o) => (o.id === orgId ? { ...o, paidUntil } : o)) }
          : prev,
      )
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Не удалось изменить дату оплаты')
    }
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
          {
            title: 'Оплачено до',
            dataIndex: 'paidUntil',
            width: 220,
            render: (value: string | null, row) => (
              <DatePicker
                size="small"
                allowClear
                format="DD.MM.YYYY"
                placeholder="Бесплатный"
                value={value ? dayjs(value) : null}
                onChange={(date) => handlePaidUntilChange(row.id, date)}
              />
            ),
          },
        ]}
      />
    </Flex>
  )
}

// Лента последних мероприятий по всем чатам — чтобы можно было мельком пробежаться глазами
// по заголовкам/описаниям и заметить неподобающий контент, не заходя в каждый чат отдельно.
// Разворачивание строки показывает полное описание; кнопка "Удалить" — сразу модерационное
// действие (использует тот же DELETE /api/events/:id, что и у организатора события).
function EventsTab() {
  const [eventsList, setEventsList] = useState<AdminEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/admin/events')
      .then(async (res) => {
        if (!res.ok) throw new Error(await extractErrorMessage(res))
        return res.json() as Promise<{ events: AdminEvent[] }>
      })
      .then((data) => {
        if (!cancelled) setEventsList(data.events)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <Alert type="error" showIcon message={error} />

  if (!eventsList) {
    return (
      <Flex justify="center" style={{ padding: 24 }}>
        <Spin />
      </Flex>
    )
  }

  const handleDelete = async (id: number) => {
    try {
      const res = await apiFetch(`/api/events/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await extractErrorMessage(res))
      setEventsList((prev) => prev?.filter((e) => e.id !== id) ?? null)
      message.success('Мероприятие удалено')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Не удалось удалить')
    }
  }

  return (
    <Table<AdminEvent>
      dataSource={eventsList}
      rowKey="id"
      size="small"
      pagination={{ pageSize: 20, hideOnSinglePage: true }}
      scroll={{ x: true }}
      expandable={{
        rowExpandable: (row) => !!row.description,
        expandedRowRender: (row) => <Text type="secondary">{row.description}</Text>,
      }}
      columns={[
        { title: 'Чат', dataIndex: 'organizationName', ellipsis: true, render: (v) => v ?? '—' },
        { title: 'Мероприятие', dataIndex: 'title', ellipsis: true },
        {
          title: 'Организатор',
          key: 'creator',
          ellipsis: true,
          render: (_, row) =>
            row.creatorUsername
              ? `@${row.creatorUsername}`
              : [row.creatorFirstName, row.creatorLastName].filter(Boolean).join(' ') || '—',
        },
        {
          title: 'Дата',
          dataIndex: 'startsAt',
          width: 90,
          render: (value: string) => dayjs(value).format('DD.MM.YY'),
        },
        { title: 'Участ.', dataIndex: 'participantsCount', width: 70, align: 'right' },
        {
          title: '',
          key: 'actions',
          width: 90,
          render: (_, row) => (
            <Popconfirm
              title="Удалить мероприятие?"
              okText="Удалить"
              okButtonProps={{ danger: true }}
              cancelText="Отмена"
              onConfirm={() => handleDelete(row.id)}
            >
              <Button size="small" danger>
                Удалить
              </Button>
            </Popconfirm>
          ),
        },
      ]}
    />
  )
}

// Личный дашборд владельца бота — сколько чатов подключено, на какой они стадии, и лента
// последних мероприятий для беглой модерации. Доступ проверяется на бэкенде по
// ADMIN_TELEGRAM_ID; сюда попадают через deep-link admin-0 (t.me/<bot>/app?startapp=admin-0),
// без отдельной кнопки в самом мини-аппе.
export const AdminDashboard = () => {
  return (
    <Tabs
      items={[
        { key: 'orgs', label: 'Чаты', children: <OrganizationsTab /> },
        { key: 'events', label: 'Мероприятия', children: <EventsTab /> },
      ]}
    />
  )
}
