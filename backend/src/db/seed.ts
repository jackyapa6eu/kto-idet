import { getDb } from './index.js'
import { events, participants } from './schema.js'

async function seed() {
  const db = getDb()

  const seedEvents = [
    { title: 'Вечерняя тренировка', location: 'Пляж "Ласточка"', startsAt: new Date('2026-08-02T19:00:00'), maxParticipants: 8, participants: 6 },
    { title: 'Товарищеская игра 4x4', location: 'Центральный пляж', startsAt: new Date('2026-08-03T10:00:00'), maxParticipants: 8, participants: 8 },
    { title: 'Утренняя разминка', location: 'Пляж "Ласточка"', startsAt: new Date('2026-08-05T08:30:00'), maxParticipants: 6, participants: 3 },
    { title: 'Игра на вылет', location: 'Спортплощадка у набережной', startsAt: new Date('2026-08-07T18:30:00'), maxParticipants: 12, participants: 5 },
    { title: 'Открытая тренировка для новичков', location: 'Центральный пляж', startsAt: new Date('2026-08-09T17:00:00'), maxParticipants: 10, participants: 2 },
  ]

  for (const seedEvent of seedEvents) {
    const [created] = await db
      .insert(events)
      .values({
        title: seedEvent.title,
        location: seedEvent.location,
        startsAt: seedEvent.startsAt,
        maxParticipants: seedEvent.maxParticipants,
        createdByTelegramId: 'seed',
      })
      .returning()

    for (let i = 1; i <= seedEvent.participants; i++) {
      await db.insert(participants).values({
        eventId: created.id,
        telegramId: `seed-${created.id}-${i}`,
      })
    }
  }

  console.log(`Seeded ${seedEvents.length} events`)
}

seed().then(() => process.exit(0))
