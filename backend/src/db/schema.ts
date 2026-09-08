import { pgTable, serial, text, timestamp, integer, unique, boolean } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  telegramId: text('telegram_id').primaryKey(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  username: text('username'),
  photoUrl: text('photo_url'),
  // id последнего меню-сообщения бота в личке (см. bot.ts, sendMenu) — новый /start
  // удаляет его перед отправкой нового, чтобы в чате было только одно текущее меню.
  lastMenuMessageId: integer('last_menu_message_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const loginSessions = pgTable('login_sessions', {
  token: text('token').primaryKey(),
  telegramId: text('telegram_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

// Тенант = Telegram-группа тренера. status: setup_pending (бот добавлен в группу, но
// топики для сводки/напоминаний ещё не привязаны через /set_..._here) | active |
// disconnected (бота разжаловали из админов, но он ещё в группе — обратимо без потерь) |
// removed (бота выгнали из группы/он вышел — soft delete: scheduledDeletionAt ставится на
// +14 дней, см. scheduleOrganizationDeletion в bot.ts; если за это время бота добавят
// обратно — createOrganizationDraft сбрасывает таймер и восстанавливает всё как было; если
// нет — periodic purgeExpiredOrganizations стирает организацию и её события насовсем) |
// blocked (мы заблокировали организацию вручную — неоплата/злоупотребление).
export const organizations = pgTable('organizations', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  telegramChatId: text('telegram_chat_id').notNull().unique(),
  ownerTelegramId: text('owner_telegram_id').notNull(),
  digestChatId: text('digest_chat_id'),
  digestThreadId: integer('digest_thread_id'),
  // id закреплённого в топике сообщения со сводкой — редактируется на месте при каждом
  // изменении событий, а не пересылается заново (см. /set_digest_here в bot.ts).
  digestMessageId: integer('digest_message_id'),
  reminderChatId: text('reminder_chat_id'),
  reminderThreadId: integer('reminder_thread_id'),
  notificationsEnabled: boolean('notifications_enabled').default(true).notNull(),
  // По умолчанию — только владелец/админы чата (см. isChatAdmin), чтобы не заваливать
  // группу случайными мероприятиями от кого попало; включается в настройках в мини-аппе.
  membersCanCreateEvents: boolean('members_can_create_events').default(false).notNull(),
  status: text('status').notNull().default('setup_pending'),
  // Не null только при status = 'removed' — момент, когда организацию и её события
  // окончательно удалит purgeExpiredOrganizations, если бота не добавят обратно раньше.
  scheduledDeletionAt: timestamp('scheduled_deletion_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  // Nullable из-за мероприятий, созданных до перехода на мультитенантность (у них FK
  // проставить некому) — POST /api/events всегда задаёт его для новых.
  organizationId: integer('organization_id').references(() => organizations.id),
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
  // id сообщения "🆕 Новое мероприятие!" в топике напоминаний — редактируется на месте при
  // изменении события (см. digest.ts), а не рассылается заново.
  notificationMessageId: integer('notification_message_id'),
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
