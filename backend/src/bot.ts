import { Bot, InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
import { eq } from 'drizzle-orm'
import { getDb } from './db/index.js'
import { loginSessions } from './db/schema.js'
import { upsertUser } from './users.js'

export const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://frontend-six-nu-62.vercel.app'
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? 'zdorovya_opg_bot'
// Короткое имя мини-аппа, зарегистрированное в BotFather (/newapp) — именно оно даёт ссылку
// вида t.me/<bot>/<name>, по которой Telegram открывает Mini App из любого чата (в отличие
// от web_app-кнопок в inline-клавиатуре, которые работают только в личных чатах с ботом).
const MINI_APP_SHORT_NAME = process.env.TELEGRAM_MINI_APP_SHORT_NAME ?? 'app'
const LOGIN_PAYLOAD_PREFIX = 'login-'
// Тот же чат, что TELEGRAM_DIGEST_CHAT_ID/TELEGRAM_REMINDER_CHAT_ID (сводка и напоминания —
// это просто разные топики внутри него) — используем как источник правды для проверки
// членства в группе.
const GROUP_CHAT_ID = process.env.TELEGRAM_REMINDER_CHAT_ID

// startParam допускает только [A-Za-z0-9_-], до 64 символов — это ограничение Telegram,
// а не наше; внутри мини-аппа значение приходит через Telegram.WebApp.initDataUnsafe.start_param.
// Без startParam ссылка просто открывает мини-апп на списке мероприятий.
export function buildMiniAppLink(startParam?: string): string {
  const base = `https://t.me/${BOT_USERNAME}/${MINI_APP_SHORT_NAME}`
  return startParam ? `${base}?startapp=${startParam}` : base
}

const ACTIVE_MEMBER_STATUSES = new Set(['creator', 'administrator', 'member', 'restricted'])

// getChatMember официально гарантированно работает только если бот сам — администратор
// чата; полного списка участников Bot API не отдаёт вовсе (приватность), поэтому проверяем
// каждого пользователя по отдельности его же telegramId (он уже проверен через initData/JWT).
export async function isGroupMember(telegramId: string): Promise<boolean> {
  if (!GROUP_CHAT_ID) return false

  try {
    const member = await getBot().api.getChatMember(GROUP_CHAT_ID, Number(telegramId))
    return ACTIVE_MEMBER_STATUSES.has(member.status)
  } catch (e) {
    console.error('Не удалось проверить членство в группе', e)
    return false
  }
}

let _bot: Bot | null = null

export function getBot() {
  if (!_bot) {
    _bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!)
    _bot.command('start', async (ctx) => {
      const payload = ctx.match
      if (typeof payload === 'string' && payload.startsWith(LOGIN_PAYLOAD_PREFIX)) {
        await handleLoginStart(ctx, payload.slice(LOGIN_PAYLOAD_PREFIX.length))
        return
      }

      const keyboard = new InlineKeyboard().webApp('Открыть ОПГ Здоровья', FRONTEND_URL)
      await ctx.reply(
        'Добро пожаловать в ОПГ Здоровья! Открой мини-приложение, чтобы посмотреть предстоящие мероприятия.',
        { reply_markup: keyboard },
      )
    })

    // Утилита: узнать chat_id/message_thread_id текущего чата/топика — пригождается при
    // настройке новых мест для сообщений бота (сводка, напоминания и т.п.).
    _bot.on('message:text', async (ctx) => {
      if (ctx.message.text !== 'тест тест тест') return
      await ctx.reply(
        `chat_id: ${ctx.chat.id}\nmessage_thread_id: ${ctx.message.message_thread_id ?? 'нет (не топик)'}`,
        { message_thread_id: ctx.message.message_thread_id },
      )
    })
  }
  return _bot
}

async function handleLoginStart(ctx: Context, token: string) {
  const from = ctx.from
  if (!from) return

  const db = getDb()
  const [session] = await db.select().from(loginSessions).where(eq(loginSessions.token, token))

  if (!session || session.expiresAt.getTime() < Date.now()) {
    await ctx.reply('Ссылка для входа устарела. Вернитесь на сайт и запросите новую.')
    return
  }

  await upsertUser({
    id: from.id,
    first_name: from.first_name,
    last_name: from.last_name,
    username: from.username,
  })

  await db
    .update(loginSessions)
    .set({ telegramId: String(from.id) })
    .where(eq(loginSessions.token, token))

  await ctx.reply('Вход подтверждён! Вернитесь на сайт — вы уже авторизованы.')
}

export function getBotUsername(): string {
  return BOT_USERNAME
}
