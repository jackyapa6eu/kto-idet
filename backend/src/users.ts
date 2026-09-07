import { sql } from 'drizzle-orm'
import { getDb } from './db/index.js'
import { users } from './db/schema.js'
import type { TelegramProfile } from './telegramAuth.js'

// Апсертит пользователя по telegramId. Поля, которых нет в данном источнике
// (например, ctx.from бота не содержит photo_url), не затирают уже сохранённые
// значения — иначе вход через бота обнулял бы аватар, синхронизированный из мини-аппа.
export async function upsertUser(profile: TelegramProfile) {
  const db = getDb()
  const [user] = await db
    .insert(users)
    .values({
      telegramId: String(profile.id),
      firstName: profile.first_name,
      lastName: profile.last_name ?? null,
      username: profile.username ?? null,
      photoUrl: profile.photo_url ?? null,
    })
    .onConflictDoUpdate({
      target: users.telegramId,
      set: {
        firstName: profile.first_name,
        lastName: profile.last_name ?? sql`${users.lastName}`,
        username: profile.username ?? sql`${users.username}`,
        photoUrl: profile.photo_url ?? sql`${users.photoUrl}`,
        updatedAt: new Date(),
      },
    })
    .returning()

  return user
}
