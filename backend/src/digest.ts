import { GrammyError, InlineKeyboard } from 'grammy'
import { and, asc, eq, gte } from 'drizzle-orm'
import { getDb } from './db/index.js'
import { events, participants, users, organizations } from './db/schema.js'
import { getBot, buildMiniAppLink } from './bot.js'
import { splitParticipants } from './eventParticipants.js'

const EVENTS_TIME_ZONE = 'Asia/Krasnoyarsk'

function startOfTodayInEventsTimeZone(): Date {
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: EVENTS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return new Date(`${todayStr}T00:00:00+07:00`)
}

function formatEventDate(date: Date): string {
  const weekdayRaw = new Intl.DateTimeFormat('ru-RU', { timeZone: EVENTS_TIME_ZONE, weekday: 'long' }).format(date)
  const weekday = weekdayRaw.charAt(0).toUpperCase() + weekdayRaw.slice(1)
  const dayMonth = new Intl.DateTimeFormat('ru-RU', {
    timeZone: EVENTS_TIME_ZONE,
    day: 'numeric',
    month: 'long',
  }).format(date)
  return `${weekday}, ${dayMonth}`
}

function formatEventTime(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: EVENTS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// tg://user?id=<id> — официальная HTML-ссылка Telegram для упоминания пользователя по id
// без юзернейма (Bot API создаёт из неё text_mention-сущность): нажатие открывает профиль,
// работает даже у тех, кто не задал себе @username. telegramId — всегда числовая строка из
// нашей же БД (Telegram user id), экранировать её как пользовательский ввод не нужно.
function formatParticipantLink(p: { telegramId: string; firstName: string; lastName: string | null; paid: boolean }): string {
  const name = escapeHtml([p.firstName, p.lastName].filter(Boolean).join(' '))
  const label = p.paid ? `${name} 💰` : name
  return `<a href="tg://user?id=${p.telegramId}">${label}</a>`
}

export async function buildDigestText(organizationId: number): Promise<string> {
  const db = getDb()

  const upcoming = await db
    .select()
    .from(events)
    .where(and(eq(events.organizationId, organizationId), gte(events.startsAt, startOfTodayInEventsTimeZone())))
    .orderBy(asc(events.startsAt))

  if (upcoming.length === 0) {
    return '📋 <b>Мероприятия</b>\n\nПока нет запланированных мероприятий.'
  }

  const lines = ['📋 <b>Мероприятия</b>', '']

  for (const event of upcoming) {
    const eventParticipants = await db
      .select({
        telegramId: users.telegramId,
        firstName: users.firstName,
        lastName: users.lastName,
        paid: participants.paid,
      })
      .from(participants)
      .innerJoin(users, eq(users.telegramId, participants.telegramId))
      .where(eq(participants.eventId, event.id))
      .orderBy(asc(participants.joinedAt))

    lines.push(`🏐 <b>${escapeHtml(event.title)}</b>`)
    lines.push(`📅 ${formatEventDate(event.startsAt)}`)
    lines.push(`🕐 ${formatEventTime(event.startsAt)}`)
    lines.push(`📍 ${escapeHtml(event.location ?? '')}`)
    if (event.trainer) lines.push(`🎓 Тренер: ${escapeHtml(event.trainer)}`)
    if (event.price) lines.push(`💰 Стоимость: ${escapeHtml(event.price)}`)
    if (event.court) lines.push(`🎾 Корт: ${escapeHtml(event.court)}`)
    if (event.paymentPhone) lines.push(`💳 Перевод на номер: ${escapeHtml(event.paymentPhone)}`)
    if (event.bank) lines.push(`🏦 Банк: ${escapeHtml(event.bank)}`)
    if (event.comment) lines.push(`📝 Комментарий: ${escapeHtml(event.comment)}`)

    const { confirmed, reserve } = splitParticipants(eventParticipants, event.maxParticipants)
    const hasLimit = event.maxParticipants != null && event.maxParticipants > 0
    const countLabel = hasLimit ? `${confirmed.length}/${event.maxParticipants}` : `${confirmed.length}`
    lines.push(`👥 Участники (${countLabel}):`)

    if (confirmed.length > 0) {
      for (const p of confirmed) lines.push(formatParticipantLink(p))
    } else {
      lines.push('пока никого')
    }

    if (reserve.length > 0) {
      lines.push('')
      lines.push(`⏳ Резерв (${reserve.length}):`)
      for (const p of reserve) lines.push(formatParticipantLink(p))
    }

    lines.push('')
    lines.push('──────────')
    lines.push('')
  }

  return lines.join('\n').trim()
}

function buildEventNotificationText(event: typeof events.$inferSelect): string {
  const lines = [
    '🆕 <b>Новое мероприятие!</b>',
    '',
    `🏐 <b>${escapeHtml(event.title)}</b>`,
    `📅 ${formatEventDate(event.startsAt)}`,
    `🕐 ${formatEventTime(event.startsAt)}`,
    `📍 ${escapeHtml(event.location ?? '')}`,
  ]
  if (event.trainer) lines.push(`🎓 Тренер: ${escapeHtml(event.trainer)}`)
  if (event.price) lines.push(`💰 Стоимость: ${escapeHtml(event.price)}`)
  if (event.court) lines.push(`🎾 Корт: ${escapeHtml(event.court)}`)
  if (event.paymentPhone) lines.push(`💳 Перевод на номер: ${escapeHtml(event.paymentPhone)}`)
  if (event.bank) lines.push(`🏦 Банк: ${escapeHtml(event.bank)}`)
  if (event.comment) lines.push(`📝 Комментарий: ${escapeHtml(event.comment)}`)
  if (event.maxParticipants != null) lines.push(`👥 Мест: ${event.maxParticipants}`)
  return lines.join('\n')
}

// Ссылка вида t.me/<bot>/<app> — Telegram открывает её как Mini App в любом чате
// (в отличие от web_app-кнопок, которые работают только в личных чатах с ботом).
function buildEventNotificationKeyboard(eventId: number): InlineKeyboard {
  return new InlineKeyboard().url('Открыть мероприятие', buildMiniAppLink(`event-${eventId}`))
}

// Отдельное сообщение (не путать с саморедактирующейся сводкой ниже) о том, что появилось
// новое мероприятие. Уходит в топик напоминаний организации: топик со сводкой бывает закрыт
// для новых сообщений (там можно только редактировать уже существующее сообщение сводки), а
// сюда новые сообщения всегда доходят. Возвращает id отправленного сообщения — вызывающий
// код сохраняет его в events.notificationMessageId, чтобы потом редактировать это же
// сообщение при изменении события (см. updateEventNotification), а не слать новое.
export async function sendEventCreatedNotification(
  event: typeof events.$inferSelect,
): Promise<number | undefined> {
  if (event.organizationId == null) return undefined

  const db = getDb()
  const [org] = await db.select().from(organizations).where(eq(organizations.id, event.organizationId))
  if (!org?.reminderChatId || !org.notificationsEnabled) return undefined

  const sent = await getBot().api.sendMessage(org.reminderChatId, buildEventNotificationText(event), {
    parse_mode: 'HTML',
    message_thread_id: org.reminderThreadId ?? undefined,
    reply_markup: buildEventNotificationKeyboard(event.id),
  })
  return sent.message_id
}

// Правит на месте уже отправленное sendEventCreatedNotification сообщение — вызывается при
// редактировании события, чтобы анонс в топике напоминаний не расходился с актуальными
// данными (дата/место/цена и т.п.), а не оставался снимком на момент создания.
export async function updateEventNotification(event: typeof events.$inferSelect): Promise<void> {
  if (event.organizationId == null || event.notificationMessageId == null) return

  const db = getDb()
  const [org] = await db.select().from(organizations).where(eq(organizations.id, event.organizationId))
  if (!org?.reminderChatId || !org.notificationsEnabled) return

  try {
    await getBot().api.editMessageText(
      org.reminderChatId,
      event.notificationMessageId,
      buildEventNotificationText(event),
      { parse_mode: 'HTML', reply_markup: buildEventNotificationKeyboard(event.id) },
    )
  } catch (e) {
    if (e instanceof GrammyError && e.description.includes('message is not modified')) return
    // Сообщение недоступно для редактирования (удалено вручную и т.п.) — молча смиряемся,
    // повторно слать новый анонс при каждом редактировании было бы более навязчивым, чем
    // просто оставить анонс устаревшим (сводка при этом обновляется независимо).
    console.error('Не удалось отредактировать сообщение-анонс мероприятия', e)
  }
}

// Держит одно сообщение бота в топике со сводкой мероприятий организации актуальным:
// редактирует его на месте при любом изменении (создание/удаление события, запись/отмена
// участия) вместо того, чтобы слать новые. messageId организации — тот же, что записывает
// /set_digest_here при первой настройке (bot.ts) — если его нет или редактирование не
// удалось (сообщение удалили руками и т.п.), шлём новое и запоминаем его id взамен.
export async function syncChannelDigest(organizationId: number): Promise<void> {
  const db = getDb()
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId))
  if (!org?.digestChatId || org.digestThreadId == null || !org.notificationsEnabled) return

  const text = await buildDigestText(organizationId)
  const bot = getBot()
  const keyboard = new InlineKeyboard().url('Открыть / Записаться', buildMiniAppLink(`org-${org.id}`))

  if (org.digestMessageId) {
    try {
      await bot.api.editMessageText(org.digestChatId, org.digestMessageId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      })
      return
    } catch (e) {
      if (e instanceof GrammyError && e.description.includes('message is not modified')) return
      // Сообщение недоступно для редактирования (удалено вручную и т.п.) — пошлём новое ниже.
    }
  }

  const sent = await bot.api.sendMessage(org.digestChatId, text, {
    message_thread_id: org.digestThreadId,
    parse_mode: 'HTML',
    reply_markup: keyboard,
  })
  await bot.api.pinChatMessage(org.digestChatId, sent.message_id, { disable_notification: true })

  await db
    .update(organizations)
    .set({ digestMessageId: sent.message_id, updatedAt: new Date() })
    .where(eq(organizations.id, organizationId))
}
