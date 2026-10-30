import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildEventNotificationText } from '../src/digest.js'
import type { events } from '../src/db/schema.js'

const event = {
  id: 42,
  organizationId: 7,
  title: 'Тренировка',
  description: null,
  location: 'Зал',
  startsAt: new Date('2026-11-01T12:00:00.000Z'),
  durationMinutes: 90,
  maxParticipants: 2,
  trainer: null,
  price: null,
  court: null,
  paymentPhone: null,
  bank: null,
  comment: null,
  createdByTelegramId: '1',
  notificationMessageId: null,
  repeatEveryDays: null,
  nextEventCreated: false,
  createdAt: new Date('2026-10-30T00:00:00.000Z'),
} satisfies typeof events.$inferSelect

const participants = [
  { telegramId: '1', username: 'organizer', firstName: 'Анна', lastName: null, paid: true },
  { telegramId: '2', username: null, firstName: 'Борис', lastName: 'Иванов', paid: false },
  { telegramId: '3', username: 'third_player', firstName: 'Вера', lastName: null, paid: false },
]

test('event announcement includes confirmed participants and reserve in join order', () => {
  const text = buildEventNotificationText(event, participants)

  assert.match(text, /Участники \(2\/2\)/)
  assert.match(text, /<a href="https:\/\/t\.me\/organizer">Анна 💰<\/a>/)
  assert.match(text, /<a href="tg:\/\/user\?id=2">Борис Иванов<\/a>/)
  assert.match(text, /Резерв \(1\)/)
  assert.match(text, /<a href="https:\/\/t\.me\/third_player">Вера<\/a>/)
})

test('event announcement reports when nobody is signed up', () => {
  const text = buildEventNotificationText({ ...event, maxParticipants: null }, [])

  assert.match(text, /Участники \(0\):\nпока никого/)
})
