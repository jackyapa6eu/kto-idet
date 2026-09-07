import { GrammyError, InlineKeyboard } from 'grammy'
import { asc, eq, gte } from 'drizzle-orm'
import { getDb } from './db/index.js'
import { events, participants, users, channelDigest } from './db/schema.js'
import { getBot, buildMiniAppLink } from './bot.js'

const DIGEST_ROW_ID = 1
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

function formatName(p: { firstName: string; lastName: string | null; paid: boolean }): string {
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ')
  return p.paid ? `${name} 💰` : name
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function buildDigestText(): Promise<string> {
  const db = getDb()

  const upcoming = await db
    .select()
    .from(events)
    .where(gte(events.startsAt, startOfTodayInEventsTimeZone()))
    .orderBy(asc(events.startsAt))

  if (upcoming.length === 0) {
    return '📋 <b>Мероприятия ОПГ Здоровья</b>\n\nПока нет запланированных мероприятий.'
  }

  const lines = ['📋 <b>Мероприятия ОПГ Здоровья</b>', '']

  for (const event of upcoming) {
    const eventParticipants = await db
      .select({ firstName: users.firstName, lastName: users.lastName, paid: participants.paid })
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

    const countLabel =
      event.maxParticipants != null
        ? `${eventParticipants.length}/${event.maxParticipants}`
        : `${eventParticipants.length}`
    lines.push(`👥 Участники (${countLabel}):`)

    if (eventParticipants.length > 0) {
      const names = eventParticipants.map((p) => escapeHtml(formatName(p))).join('\n')
      lines.push(`<blockquote expandable>${names}</blockquote>`)
    } else {
      lines.push('пока никого')
    }

    lines.push('')
    lines.push('──────────')
    lines.push('')
  }

  return lines.join('\n').trim()
}

// Отдельное разовое сообщение (не путать с саморедактирующейся сводкой выше) о том, что
// появилось новое мероприятие — со ссылкой, которая открывает мини-апп сразу на нём.
// Уходит в тот же чат/топик, что и напоминания за час до начала (TELEGRAM_REMINDER_*):
// топик со сводкой (TELEGRAM_DIGEST_*) бывает закрыт для новых сообщений (там можно только
// редактировать уже существующее сообщение сводки), а сюда новые сообщения всегда доходят.
export async function sendEventCreatedNotification(event: typeof events.$inferSelect): Promise<void> {
  const chatId = process.env.TELEGRAM_REMINDER_CHAT_ID
  const threadIdRaw = process.env.TELEGRAM_REMINDER_THREAD_ID
  if (!chatId) return

  const messageThreadId = threadIdRaw ? Number(threadIdRaw) : undefined

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

  // Ссылка вида t.me/<bot>/<app> — Telegram открывает её как Mini App в любом чате
  // (в отличие от web_app-кнопок, которые работают только в личных чатах с ботом).
  const keyboard = new InlineKeyboard().url('Открыть мероприятие', buildMiniAppLink(`event-${event.id}`))

  await getBot().api.sendMessage(chatId, lines.join('\n'), {
    parse_mode: 'HTML',
    message_thread_id: messageThreadId,
    reply_markup: keyboard,
  })
}

// Держит одно сообщение бота в топике со сводкой мероприятий актуальным: редактирует его
// на месте при любом изменении (создание/удаление события, запись/отмена участия).
export async function syncChannelDigest(): Promise<void> {
  const chatId = process.env.TELEGRAM_DIGEST_CHAT_ID
  const threadIdRaw = process.env.TELEGRAM_DIGEST_THREAD_ID
  if (!chatId || !threadIdRaw) return

  const messageThreadId = Number(threadIdRaw)
  const db = getDb()
  const text = await buildDigestText()
  const bot = getBot()
  const keyboard = new InlineKeyboard().url('Присоединиться / Создать', buildMiniAppLink())

  const [existing] = await db.select().from(channelDigest).where(eq(channelDigest.id, DIGEST_ROW_ID))

  if (existing?.messageId) {
    try {
      await bot.api.editMessageText(chatId, existing.messageId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      })
      return
    } catch (e) {
      if (e instanceof GrammyError && e.description.includes('message is not modified')) return
      // Сообщение недоступно для редактирования (удалено вручную и т.п.) — пошлём новое ниже.
    }
  }

  const sent = await bot.api.sendMessage(chatId, text, {
    message_thread_id: messageThreadId,
    parse_mode: 'HTML',
    reply_markup: keyboard,
  })

  await db
    .insert(channelDigest)
    .values({ id: DIGEST_ROW_ID, messageId: sent.message_id })
    .onConflictDoUpdate({
      target: channelDigest.id,
      set: { messageId: sent.message_id, updatedAt: new Date() },
    })
}
