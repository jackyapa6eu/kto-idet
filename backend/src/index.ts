import { randomBytes } from 'node:crypto'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { cors } from 'hono/cors'
import { sign, verify } from 'hono/jwt'
import { webhookCallback } from 'grammy'
import { and, asc, count, eq } from 'drizzle-orm'
import { getDb } from './db/index.js'
import { events, participants, users, loginSessions, organizations } from './db/schema.js'
import { getBot, getBotUsername, buildMiniAppLink, isChatMember, isChatAdmin, purgeExpiredOrganizations } from './bot.js'
import { upsertUser } from './users.js'
import { validateInitData } from './telegramAuth.js'
import { syncChannelDigest, sendEventCreatedNotification, updateEventNotification } from './digest.js'
import { sendDueReminders } from './reminders.js'

// Обновление сводки в топике не должно ронять основной запрос, если Telegram недоступен.
// organizationId может быть null у мероприятий, созданных до перехода на мультитенантность —
// для них синхронизировать нечего (они не привязаны ни к одной организации).
async function notifyDigest(organizationId: number | null) {
  if (organizationId == null) return
  try {
    await syncChannelDigest(organizationId)
  } catch (e) {
    console.error('Не удалось обновить сводку мероприятий в топике', e)
  }
}

// Возвращает id отправленного сообщения (или undefined при ошибке/если анонс не настроен) —
// вызывающий код сохраняет его на событие, чтобы updateEventNotification знал, что редактировать.
async function notifyEventCreated(event: typeof events.$inferSelect): Promise<number | undefined> {
  try {
    return await sendEventCreatedNotification(event)
  } catch (e) {
    console.error('Не удалось отправить оповещение о новом мероприятии', e)
    return undefined
  }
}

async function notifyEventUpdated(event: typeof events.$inferSelect) {
  try {
    await updateEventNotification(event)
  } catch (e) {
    console.error('Не удалось обновить сообщение-анонс мероприятия', e)
  }
}

const JWT_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 дней — веб-сессия после логина через бота
const LOGIN_SESSION_TTL_SECONDS = 10 * 60 // 10 минут на переход в Telegram и подтверждение

const app = new Hono<{ Variables: { tgUser: { id: number } } }>()

app.use('/api/*', cors())

// Пускает запрос, если он либо пришёл из мини-аппа (подписанный initData в заголовке),
// либо от веб-сессии, залогиненной через бота (JWT в Authorization). В обоих случаях
// telegramId клиент подделать не может — он берётся из проверенных данных.
async function telegramAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const jwtSecret = process.env.JWT_SECRET
    if (!jwtSecret) return c.json({ error: 'JWT-авторизация не настроена' }, 500)

    try {
      const payload = await verify(authHeader.slice('Bearer '.length), jwtSecret, 'HS256')
      c.set('tgUser', { id: Number(payload.sub) })
      return next()
    } catch {
      return c.json({ error: 'Невалидный или истёкший токен' }, 401)
    }
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) return c.json({ error: 'Telegram-авторизация не настроена' }, 500)

  const initData = c.req.header('X-Telegram-Init-Data')
  if (!initData) {
    return c.json({ error: 'Требуется заголовок X-Telegram-Init-Data или Authorization: Bearer' }, 401)
  }

  const tgUser = validateInitData(initData, botToken)
  if (!tgUser) return c.json({ error: 'Невалидные данные Telegram' }, 401)

  c.set('tgUser', { id: tgUser.id })
  await next()
}

// Тенант = организация (Telegram-группа тренера). Список и создание событий — per-org,
// поэтому вместо одной глобальной проверки членства (как было в однотенантном коде)
// смотрим на конкретную organizationId из запроса: она должна существовать, быть активной
// (не setup_pending/disconnected/blocked) и вызывающий должен реально состоять в её чате —
// то, что подпись initData/JWT валидна, говорит лишь о том, что перед нами реальный
// Telegram-пользователь, а не о том, что он состоит в этой конкретной группе.
async function getActiveOrgForMember(organizationId: number, telegramId: string) {
  const db = getDb()
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId))
  if (!org || org.status !== 'active') return null
  if (!(await isChatMember(org.telegramChatId, telegramId))) return null
  return org
}

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

if (process.env.TELEGRAM_BOT_TOKEN) {
  app.post('/api/telegram/webhook', webhookCallback(getBot(), 'hono'))
} else {
  console.warn('TELEGRAM_BOT_TOKEN не задан — Telegram-вебхук отключён')
}

app.post('/api/auth/telegram', async (c) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) return c.json({ error: 'Telegram-авторизация не настроена' }, 500)

  const initData = c.req.header('X-Telegram-Init-Data')
  if (!initData) return c.json({ error: 'Заголовок X-Telegram-Init-Data обязателен' }, 401)

  const tgUser = validateInitData(initData, botToken)
  if (!tgUser) return c.json({ error: 'Невалидные данные Telegram' }, 401)

  const user = await upsertUser(tgUser)
  return c.json(user)
})

// Вход вне мини-аппа через бота (без SMS/номера телефона): фронт создаёт сессию,
// открывает пользователю t.me/<bot>?start=login-<token>, пользователь жмёт Start —
// бот подтверждает сессию его telegramId, — а фронт всё это время поллит статус.
app.post('/api/auth/session', async (c) => {
  const token = randomBytes(16).toString('base64url')
  const expiresAt = new Date(Date.now() + LOGIN_SESSION_TTL_SECONDS * 1000)

  const db = getDb()
  await db.insert(loginSessions).values({ token, expiresAt })

  const botUsername = getBotUsername()
  return c.json({ token, deepLink: `https://t.me/${botUsername}?start=login-${token}` })
})

app.get('/api/auth/session/:token', async (c) => {
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) return c.json({ error: 'JWT-авторизация не настроена' }, 500)

  const token = c.req.param('token')
  const db = getDb()
  const [session] = await db.select().from(loginSessions).where(eq(loginSessions.token, token))

  if (!session || session.expiresAt.getTime() < Date.now()) {
    return c.json({ status: 'expired' }, 410)
  }
  if (!session.telegramId) {
    return c.json({ status: 'pending' })
  }

  const [user] = await db.select().from(users).where(eq(users.telegramId, session.telegramId))
  await db.delete(loginSessions).where(eq(loginSessions.token, token))

  const jwt = await sign(
    { sub: session.telegramId, exp: Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS },
    jwtSecret,
    'HS256',
  )

  return c.json({ status: 'confirmed', token: jwt, user })
})

app.get('/api/auth/me', telegramAuth, async (c) => {
  const tgUser = c.get('tgUser')
  const db = getDb()
  const [user] = await db.select().from(users).where(eq(users.telegramId, String(tgUser.id)))
  if (!user) return c.json({ error: 'Пользователь не найден' }, 404)

  return c.json(user)
})

// Настройки организации живут в мини-аппе (не в SQL-запросах вручную) — читать может любой
// участник чата (чтобы, например, узнать canCreateEvents и решить, показывать ли "Создать"),
// менять — только владелец или админ чата.
function organizationSettingsResponse(
  org: typeof organizations.$inferSelect,
  isOwner: boolean,
  canManage: boolean,
) {
  return {
    id: org.id,
    name: org.name,
    notificationsEnabled: org.notificationsEnabled,
    membersCanCreateEvents: org.membersCanCreateEvents,
    isOwner,
    canManage,
    canCreateEvents: org.membersCanCreateEvents || canManage,
  }
}

app.get('/api/organizations/:id', telegramAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const tgUser = c.get('tgUser')
  const telegramId = String(tgUser.id)
  const db = getDb()

  const [org] = await db.select().from(organizations).where(eq(organizations.id, id))
  if (!org) return c.json({ error: 'Организация не найдена' }, 404)
  if (!(await isChatMember(org.telegramChatId, telegramId))) {
    return c.json({ error: 'Доступно только участникам группы' }, 403)
  }

  const isOwner = org.ownerTelegramId === telegramId
  const canManage = isOwner || (await isChatAdmin(org.telegramChatId, tgUser.id, org.ownerTelegramId))
  return c.json(organizationSettingsResponse(org, isOwner, canManage))
})

app.patch('/api/organizations/:id', telegramAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const tgUser = c.get('tgUser')
  const telegramId = String(tgUser.id)
  const db = getDb()

  const [org] = await db.select().from(organizations).where(eq(organizations.id, id))
  if (!org) return c.json({ error: 'Организация не найдена' }, 404)

  const isOwner = org.ownerTelegramId === telegramId
  const canManage = isOwner || (await isChatAdmin(org.telegramChatId, tgUser.id, org.ownerTelegramId))
  if (!canManage) return c.json({ error: 'Изменять настройки может только администратор группы' }, 403)

  const body = await c.req.json<{
    name?: string
    notificationsEnabled?: boolean
    membersCanCreateEvents?: boolean
  }>()

  const update: Partial<typeof organizations.$inferInsert> = { updatedAt: new Date() }
  if (body.name != null) update.name = body.name
  if (body.notificationsEnabled != null) update.notificationsEnabled = body.notificationsEnabled
  if (body.membersCanCreateEvents != null) update.membersCanCreateEvents = body.membersCanCreateEvents

  const [updated] = await db.update(organizations).set(update).where(eq(organizations.id, id)).returning()

  return c.json(organizationSettingsResponse(updated, isOwner, canManage))
})

const participantProfileColumns = {
  telegramId: users.telegramId,
  firstName: users.firstName,
  lastName: users.lastName,
  photoUrl: users.photoUrl,
}

app.get('/api/events', telegramAuth, async (c) => {
  const organizationId = Number(c.req.query('organizationId'))
  if (!Number.isInteger(organizationId)) {
    return c.json({ error: 'Параметр organizationId обязателен' }, 400)
  }

  const tgUser = c.get('tgUser')
  const org = await getActiveOrgForMember(organizationId, String(tgUser.id))
  if (!org) return c.json({ error: 'Доступно только участникам группы' }, 403)

  const db = getDb()
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      location: events.location,
      startsAt: events.startsAt,
      maxParticipants: events.maxParticipants,
      participantsCount: count(participants.id),
    })
    .from(events)
    .leftJoin(participants, eq(participants.eventId, events.id))
    .where(eq(events.organizationId, organizationId))
    .groupBy(events.id)
    .orderBy(asc(events.startsAt))

  return c.json(rows)
})

app.post('/api/events', telegramAuth, async (c) => {
  const body = await c.req.json<{
    organizationId?: number
    title?: string
    location?: string
    startsAt?: string
    maxParticipants?: number
    trainer?: string
    price?: string
    court?: string
    paymentPhone?: string
    bank?: string
    comment?: string
  }>()

  if (!body.organizationId || !body.title || !body.location || !body.startsAt) {
    return c.json({ error: 'organizationId, title, location и startsAt обязательны' }, 400)
  }

  const tgUser = c.get('tgUser')
  const telegramId = String(tgUser.id)
  const org = await getActiveOrgForMember(body.organizationId, telegramId)
  if (!org) return c.json({ error: 'Доступно только участникам группы' }, 403)
  if (!org.membersCanCreateEvents && !(await isChatAdmin(org.telegramChatId, tgUser.id, org.ownerTelegramId))) {
    return c.json({ error: 'В этой группе создавать мероприятия может только администратор' }, 403)
  }

  const db = getDb()
  const [created] = await db
    .insert(events)
    .values({
      organizationId: org.id,
      title: body.title,
      location: body.location,
      startsAt: new Date(body.startsAt),
      maxParticipants: body.maxParticipants ?? null,
      trainer: body.trainer ?? null,
      price: body.price ?? null,
      court: body.court ?? null,
      paymentPhone: body.paymentPhone ?? null,
      bank: body.bank ?? null,
      comment: body.comment ?? null,
      createdByTelegramId: telegramId,
    })
    .returning()

  // Организатор автоматически становится участником своего мероприятия.
  await db.insert(participants).values({ eventId: created.id, telegramId })
  await notifyDigest(created.organizationId)
  const notificationMessageId = await notifyEventCreated(created)
  if (notificationMessageId != null) {
    await db.update(events).set({ notificationMessageId }).where(eq(events.id, created.id))
  }

  return c.json({ ...created, participantsCount: 1 }, 201)
})

app.get('/api/events/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const db = getDb()

  const [event] = await db.select().from(events).where(eq(events.id, id))
  if (!event) return c.json({ error: 'Мероприятие не найдено' }, 404)

  const [organizer] = await db
    .select(participantProfileColumns)
    .from(users)
    .where(eq(users.telegramId, event.createdByTelegramId))

  const eventParticipants = await db
    .select({ ...participantProfileColumns, paid: participants.paid })
    .from(participants)
    .innerJoin(users, eq(users.telegramId, participants.telegramId))
    .where(eq(participants.eventId, id))
    .orderBy(asc(participants.joinedAt))

  return c.json({
    ...event,
    organizer: organizer ?? {
      telegramId: event.createdByTelegramId,
      firstName: 'Неизвестно',
      lastName: null,
      photoUrl: null,
    },
    participants: eventParticipants,
    // Ссылка на мини-апп, открытый сразу на этом мероприятии (та же схема ?startapp=, что и в
    // уведомлениях бота — путь после короткого имени мини-аппа Telegram не прокидывает).
    // Отдаём вместе с деталями (а не отдельной ручкой), чтобы кнопка "Поделиться" срабатывала
    // синхронно в обработчике клика, без await перед ней — на iOS/Safari и в вебвью Telegram
    // доступ к Web Share/Clipboard API привязан к user activation и теряется, если между
    // кликом и вызовом был асинхронный сетевой запрос.
    shareUrl: buildMiniAppLink(`event-${id}`),
  })
})

app.put('/api/events/:id', telegramAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const tgUser = c.get('tgUser')
  const db = getDb()

  const [event] = await db.select().from(events).where(eq(events.id, id))
  if (!event) return c.json({ error: 'Мероприятие не найдено' }, 404)
  if (event.createdByTelegramId !== String(tgUser.id)) {
    return c.json({ error: 'Редактировать мероприятие может только организатор' }, 403)
  }

  const body = await c.req.json<{
    title?: string
    location?: string
    startsAt?: string
    maxParticipants?: number
    trainer?: string
    price?: string
    court?: string
    paymentPhone?: string
    bank?: string
    comment?: string
  }>()

  if (!body.title || !body.location || !body.startsAt) {
    return c.json({ error: 'title, location и startsAt обязательны' }, 400)
  }

  const [updated] = await db
    .update(events)
    .set({
      title: body.title,
      location: body.location,
      startsAt: new Date(body.startsAt),
      maxParticipants: body.maxParticipants ?? null,
      trainer: body.trainer ?? null,
      price: body.price ?? null,
      court: body.court ?? null,
      paymentPhone: body.paymentPhone ?? null,
      bank: body.bank ?? null,
      comment: body.comment ?? null,
    })
    .where(eq(events.id, id))
    .returning()

  await notifyDigest(event.organizationId)
  await notifyEventUpdated(updated)
  return c.json(updated)
})

app.delete('/api/events/:id', telegramAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const tgUser = c.get('tgUser')
  const db = getDb()

  const [event] = await db.select().from(events).where(eq(events.id, id))
  if (!event) return c.json({ error: 'Мероприятие не найдено' }, 404)
  if (event.createdByTelegramId !== String(tgUser.id)) {
    return c.json({ error: 'Удалить мероприятие может только организатор' }, 403)
  }

  await db.delete(events).where(eq(events.id, id))
  await notifyDigest(event.organizationId)
  return c.json({ ok: true })
})

app.post('/api/events/:id/participants', telegramAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const tgUser = c.get('tgUser')
  const db = getDb()

  const [event] = await db.select().from(events).where(eq(events.id, id))
  if (!event) return c.json({ error: 'Мероприятие не найдено' }, 404)

  await db
    .insert(participants)
    .values({ eventId: id, telegramId: String(tgUser.id) })
    .onConflictDoNothing()
  await notifyDigest(event.organizationId)

  return c.json({ ok: true })
})

// Отметка оплаты доступна только организатору — статус участника подделать нельзя,
// в отличие от join/leave, которые участник делает сам за себя.
app.patch('/api/events/:id/participants/:telegramId', telegramAuth, async (c) => {
  const { id: idParam, telegramId: participantTelegramId } = c.req.param()
  const id = Number(idParam)
  const tgUser = c.get('tgUser')
  const db = getDb()

  const [event] = await db.select().from(events).where(eq(events.id, id))
  if (!event) return c.json({ error: 'Мероприятие не найдено' }, 404)
  if (event.createdByTelegramId !== String(tgUser.id)) {
    return c.json({ error: 'Отмечать оплату может только организатор' }, 403)
  }

  const body = await c.req.json<{ paid?: boolean }>()
  if (typeof body.paid !== 'boolean') return c.json({ error: 'paid обязателен' }, 400)

  await db
    .update(participants)
    .set({ paid: body.paid })
    .where(and(eq(participants.eventId, id), eq(participants.telegramId, participantTelegramId)))

  return c.json({ ok: true })
})

app.delete('/api/events/:id/participants', telegramAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const tgUser = c.get('tgUser')
  const telegramId = String(tgUser.id)
  const db = getDb()

  const [event] = await db.select().from(events).where(eq(events.id, id))
  if (!event) return c.json({ error: 'Мероприятие не найдено' }, 404)
  if (event.createdByTelegramId === telegramId) {
    return c.json({ error: 'Организатор не может отменить участие в своём мероприятии' }, 400)
  }

  await db
    .delete(participants)
    .where(and(eq(participants.eventId, id), eq(participants.telegramId, telegramId)))
  await notifyDigest(event.organizationId)

  return c.json({ ok: true })
})

// Дёргается внешним крон-сервисом (cron-job.org, раз в 30 минут — см. окно в reminders.ts) —
// Vercel Hobby не поддерживает такую частоту для встроенных Cron Jobs.
app.post('/api/cron/reminders', async (c) => {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return c.json({ error: 'CRON_SECRET не настроен' }, 500)
  if (c.req.header('Authorization') !== `Bearer ${cronSecret}`) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const sent = await sendDueReminders()
  return c.json({ ok: true, sent })
})

// Дёргается тем же внешним кроном (можно раз в сутки — тут нет чувствительности к частоте,
// в отличие от cron/reminders) — стирает организации, которые выгнали ботом из группы больше
// 14 дней назад и за это время не вернули (см. scheduleOrganizationDeletion в bot.ts).
app.post('/api/cron/purge-organizations', async (c) => {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return c.json({ error: 'CRON_SECRET не настроен' }, 500)
  if (c.req.header('Authorization') !== `Bearer ${cronSecret}`) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const purged = await purgeExpiredOrganizations()
  return c.json({ ok: true, purged })
})
serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
