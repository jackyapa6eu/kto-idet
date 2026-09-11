import { and, asc, eq, gt, isNull, lte } from 'drizzle-orm'
import { getDb } from './db/index.js'
import { events, participants, users, eventReminders, organizations } from './db/schema.js'
import { getBot } from './bot.js'
import { splitParticipants } from './eventParticipants.js'

const REMINDER_LEAD_MIN_MS = 30 * 60 * 1000
const REMINDER_LEAD_MAX_MS = 90 * 60 * 1000

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// https://t.me/<username> работает для любого зрителя (глобальный публичный юзернейм),
// tg://user?id=<id> — только если клиент зрителя уже знает этого пользователя (общий
// чат/контакты) — см. подробное обоснование в digest.ts::formatParticipantLink.
function mention(p: { telegramId: string; username: string | null; firstName: string; lastName: string | null }): string {
  const name = escapeHtml([p.firstName, p.lastName].filter(Boolean).join(' '))
  const href = p.username ? `https://t.me/${p.username}` : `tg://user?id=${p.telegramId}`
  return `<a href="${href}">${name}</a>`
}

// Внешний крон дёргает /api/cron/reminders раз в 30 минут и проверяет, какие события попали
// в окно "от 30 до 90 минут до начала" — окно шире шага крона, поэтому даже пропуск одного
// запуска крона не даст событию проскочить незамеченным. Дубли исключает eventReminders.
// Чат/топик для напоминания берём per-org из organizations (аналогично digest.ts) — событие
// без organizationId или организации без настроенного reminderChatId просто пропускаем, не
// прерывая обработку остальных событий.
export async function sendDueReminders(): Promise<number> {
  const db = getDb()
  const now = new Date()

  const due = await db
    .select({
      id: events.id,
      title: events.title,
      location: events.location,
      court: events.court,
      maxParticipants: events.maxParticipants,
      reminderChatId: organizations.reminderChatId,
      reminderThreadId: organizations.reminderThreadId,
      notificationsEnabled: organizations.notificationsEnabled,
    })
    .from(events)
    .leftJoin(eventReminders, eq(eventReminders.eventId, events.id))
    .innerJoin(organizations, eq(organizations.id, events.organizationId))
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
  let sentCount = 0

  for (const event of due) {
    if (!event.reminderChatId || !event.notificationsEnabled) continue

    const eventParticipants = await db
      .select({
        telegramId: users.telegramId,
        username: users.username,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(participants)
      .innerJoin(users, eq(users.telegramId, participants.telegramId))
      .where(eq(participants.eventId, event.id))
      .orderBy(asc(participants.joinedAt))

    // Резервисты не тегаются — у них нет гарантированного места, звать их «вы придёте?»
    // было бы вводящим в заблуждение.
    const { confirmed } = splitParticipants(eventParticipants, event.maxParticipants)
    const mentions = confirmed.map(mention).join(' ')
    const text = [
      `⏰ Скоро <b>${escapeHtml(event.title)}</b>!`,
      `Место: ${escapeHtml(event.location ?? '')}`,
      ...(event.court ? [`Корт: ${escapeHtml(event.court)}`] : []),
      `${mentions} вы придёте?`,
      'Ставьте реакции на сообщении 👇',
    ].join('\n')

    await bot.api.sendMessage(event.reminderChatId, text, {
      parse_mode: 'HTML',
      message_thread_id: event.reminderThreadId ?? undefined,
    })

    await db.insert(eventReminders).values({ eventId: event.id }).onConflictDoNothing()
    sentCount++
  }

  return sentCount
}
