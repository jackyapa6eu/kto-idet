import { pgTable, serial, text, timestamp, integer, unique, boolean } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  telegramId: text('telegram_id').primaryKey(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  username: text('username'),
  photoUrl: text('photo_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const loginSessions = pgTable('login_sessions', {
  token: text('token').primaryKey(),
  telegramId: text('telegram_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  location: text('location'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  maxParticipants: integer('max_participants'),
  trainer: text('trainer'),
  price: text('price'),
  court: text('court'),
  paymentPhone: text('payment_phone'),
  bank: text('bank'),
  comment: text('comment'),
  createdByTelegramId: text('created_by_telegram_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// Singleton (id всегда 1) — id самого сообщения бота со сводкой мероприятий в топике,
// чтобы редактировать его на месте вместо отправки новых сообщений.
export const channelDigest = pgTable('channel_digest', {
  id: integer('id').primaryKey(),
  messageId: integer('message_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// Отмечает, что напоминание "через час" по этому событию уже отправлено —
// не даёт крону дублировать сообщение при повторных запусках.
export const eventReminders = pgTable('event_reminders', {
  eventId: integer('event_id')
    .primaryKey()
    .references(() => events.id, { onDelete: 'cascade' }),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
})

export const participants = pgTable('participants', {
  id: serial('id').primaryKey(),
  eventId: integer('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  telegramId: text('telegram_id').notNull(),
  paid: boolean('paid').default(false).notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueParticipant: unique().on(table.eventId, table.telegramId),
}))
