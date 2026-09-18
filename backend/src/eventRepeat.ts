import { and, eq, isNotNull, lte } from 'drizzle-orm'
import { getDb } from './db/index.js'
import { events, participants } from './db/schema.js'
import { syncChannelDigest, sendEventCreatedNotification } from './digest.js'

// Обновление сводки/отправка анонса не должны ронять генерацию следующего звена цепочки,
// если Telegram недоступен — то же соглашение, что и у notifyDigest/notifyEventCreated в index.ts.
async function notifyDigest(organizationId: number | null) {
  if (organizationId == null) return
  try {
    await syncChannelDigest(organizationId)
  } catch (e) {
    console.error('Не удалось обновить сводку мероприятий в топике', e)
  }
}

async function notifyEventCreated(event: typeof events.$inferSelect): Promise<number | undefined> {
  try {
    return await sendEventCreatedNotification(event)
  } catch (e) {
    console.error('Не удалось отправить оповещение о новом мероприятии', e)
    return undefined
  }
}

// Дёргается тем же внешним кроном, что и sendDueReminders (раз в 30 минут, см.
// /api/cron/reminders в index.ts) — отдельный таск на cron-job.org не заводим. Для каждого
// начавшегося события с активным повтором, у которого ещё не создано следующее звено цепочки,
// создаёт следующее (startsAt + repeatEveryDays дней) и помечает исходное nextEventCreated.
// "Остановить повтор" — это просто снять repeatEveryDays через обычное редактирование события
// (PUT /api/events/:id), тогда WHERE ниже его больше не найдёт.
export async function generateNextRepeatingEvents(): Promise<number> {
  const db = getDb()
  const now = new Date()

  const due = await db
    .select()
    .from(events)
    .where(and(isNotNull(events.repeatEveryDays), eq(events.nextEventCreated, false), lte(events.startsAt, now)))

  let generatedCount = 0

  for (const event of due) {
    const repeatEveryDays = event.repeatEveryDays
    if (repeatEveryDays == null) continue // не должно случиться из-за isNotNull выше, но типам так спокойнее

    const nextStartsAt = new Date(event.startsAt.getTime() + repeatEveryDays * 24 * 60 * 60 * 1000)

    const [created] = await db
      .insert(events)
      .values({
        organizationId: event.organizationId,
        title: event.title,
        location: event.location,
        startsAt: nextStartsAt,
        durationMinutes: event.durationMinutes,
        maxParticipants: event.maxParticipants,
        trainer: event.trainer,
        price: event.price,
        court: event.court,
        paymentPhone: event.paymentPhone,
        bank: event.bank,
        comment: event.comment,
        createdByTelegramId: event.createdByTelegramId,
        repeatEveryDays,
      })
      .returning()

    // Организатор автоматически становится участником своего мероприятия — как и при обычном
    // создании через POST /api/events.
    await db.insert(participants).values({ eventId: created.id, telegramId: created.createdByTelegramId })
    await notifyDigest(created.organizationId)
    const notificationMessageId = await notifyEventCreated(created)
    if (notificationMessageId != null) {
      await db.update(events).set({ notificationMessageId }).where(eq(events.id, created.id))
    }

    await db.update(events).set({ nextEventCreated: true }).where(eq(events.id, event.id))
    generatedCount++
  }

  return generatedCount
}
