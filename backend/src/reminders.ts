import { and, asc, eq, gt, isNull, lte } from 'drizzle-orm'
import { getDb } from './db/index.js'
import { events, participants, users, eventReminders } from './db/schema.js'
import { getBot } from './bot.js'

const REMINDER_LEAD_MIN_MS = 30 * 60 * 1000
const REMINDER_LEAD_MAX_MS = 90 * 60 * 1000

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function mention(p: { telegramId: string; firstName: string; lastName: string | null }): string {
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ')
  return `<a href="tg://user?id=${p.telegramId}">${escapeHtml(name)}</a>`
}

// Внешний крон дёргает /api/cron/reminders раз в 30 минут и проверяет, какие события попали
// в окно "от 30 до 90 минут до начала" — окно шире шага крона, поэтому даже пропуск одного
// запуска крона не даст событию проскочить незамеченным. Дубли исключает eventReminders.
export async function sendDueReminders(): Promise<number> {
  const chatId = process.env.TELEGRAM_REMINDER_CHAT_ID
  if (!chatId) return 0

  const threadIdRaw = process.env.TELEGRAM_REMINDER_THREAD_ID
  const messageThreadId = threadIdRaw ? Number(threadIdRaw) : undefined

  const db = getDb()
  const now = new Date()

  const due = await db
    .select({ id: events.id, title: events.title, location: events.location, court: events.court })
    .from(events)
    .leftJoin(eventReminders, eq(eventReminders.eventId, events.id))
    .where(
      and(
        gt(events.startsAt, new Date(now.getTime() + REMINDER_LEAD_MIN_MS)),
        lte(events.startsAt, new Date(now.getTime() + REMINDER_LEAD_MAX_MS)),
        isNull(eventReminders.eventId),
      ),
    )
    .orderBy(asc(events.startsAt))

  if (due.length === 0) return 0

  const bot = getBot()

  for (const event of due) {
    const eventParticipants = await db
      .select({ telegramId: users.telegramId, firstName: users.firstName, lastName: users.lastName })
      .from(participants)
      .innerJoin(users, eq(users.telegramId, participants.telegramId))
      .where(eq(participants.eventId, event.id))
      .orderBy(asc(participants.joinedAt))

    const mentions = eventParticipants.map(mention).join(' ')
    const text = [
      `⏰ Скоро <b>${escapeHtml(event.title)}</b>!`,
      `Место: ${escapeHtml(event.location ?? '')}`,
      ...(event.court ? [`Корт: ${escapeHtml(event.court)}`] : []),
      `${mentions} вы придёте?`,
      'Ставьте реакции на сообщении 👇',
    ].join('\n')

    await bot.api.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      message_thread_id: messageThreadId,
    })

    await db.insert(eventReminders).values({ eventId: event.id }).onConflictDoNothing()
  }

  return due.length
}
