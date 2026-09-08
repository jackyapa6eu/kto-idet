import { Bot, GrammyError, InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
import { and, eq, lte } from 'drizzle-orm'
import { getDb } from './db/index.js'
import { loginSessions, organizations, users, events } from './db/schema.js'
import { upsertUser } from './users.js'
import { buildDigestText } from './digest.js'

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? 'zdorovya_opg_bot'
// Короткое имя мини-аппа, зарегистрированное в BotFather (/newapp) — именно оно даёт ссылку
// вида t.me/<bot>/<name>, по которой Telegram открывает Mini App из любого чата (в отличие
// от web_app-кнопок в inline-клавиатуре, которые работают только в личных чатах с ботом).
const MINI_APP_SHORT_NAME = process.env.TELEGRAM_MINI_APP_SHORT_NAME ?? 'app'
const LOGIN_PAYLOAD_PREFIX = 'login-'

const BACK_BUTTON_TEXT = '🏠 В начало'

const ONBOARDING_TEXT =
  'Помогаю организовывать мероприятия в вашей Telegram-группе — тренировки, игры, квизы.\n\n' +
  '👉 Добавьте меня в группу и сделайте администратором.'

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
// Тенант — Telegram-чат, поэтому и членство теперь проверяется per-chat, а не в одном
// захардкоженном через env чате (см. organizations.telegramChatId).
export async function isChatMember(chatId: string, telegramId: string): Promise<boolean> {
  try {
    const member = await getBot().api.getChatMember(chatId, Number(telegramId))
    return ACTIVE_MEMBER_STATUSES.has(member.status)
  } catch (e) {
    console.error('Не удалось проверить членство в чате', e)
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

      const from = ctx.from
      if (!from) return

      // Апсертим здесь же (не только при логине через веб) — без строки в users негде
      // хранить lastMenuMessageId, и дедупликация меню ниже просто не будет работать.
      await upsertUser({
        id: from.id,
        first_name: from.first_name,
        last_name: from.last_name,
        username: from.username,
      })

      // /start — явное действие пользователя: не редактируем старое меню (оно могло
      // затеряться где-то в истории чата без уведомления), а удаляем его и шлём новое.
      await restartMenu(from.id, await buildEntryView(from.id))
    })

    // Утилита: узнать chat_id/message_thread_id текущего чата/топика — пригождается при
    // настройке новых мест для сообщений бота (сводка, напоминания и т.п.). Важно звать
    // next() на несовпадении — иначе этот хэндлер (он матчит вообще любой текст) молча
    // проглатывает все последующие текстовые апдейты, включая команды ниже по регистрации.
    _bot.on('message:text', async (ctx, next) => {
      if (ctx.message.text !== 'тест тест тест') return next()
      await ctx.reply(
        `chat_id: ${ctx.chat.id}\nmessage_thread_id: ${ctx.message.message_thread_id ?? 'нет (не топик)'}`,
        { message_thread_id: ctx.message.message_thread_id },
      )
    })

    _bot.command('set_digest_here', (ctx) => handleSetHere(ctx, 'digest'))
    _bot.command('set_reminders_here', (ctx) => handleSetHere(ctx, 'reminders'))

    // Меню в личке — одно редактируемое сообщение с inline-кнопками: любой переход
    // (в начало, в группу, пропустить шаг) правит именно его через showMenu/editMessageText,
    // а не шлёт новое — во всей переписке с ботом должно быть только одно текущее сообщение.
    _bot.callbackQuery(/^menu:(root|add|org:\d+|skip_reminders:\d+)$/, handleMenuCallback)

    // Закрепление сообщения через Bot API всегда добавляет в чат отдельное служебное
    // сообщение "X закрепил(а) сообщение" — чистим его, чтобы /set_digest_here и
    // /set_reminders_here не оставляли в топике ничего, кроме самого закреплённого текста.
    _bot.on('message:pinned_message', async (ctx) => {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id)
      } catch (e) {
        console.error('Не удалось удалить служебное сообщение о закреплении', e)
      }
    })

    _bot.on('my_chat_member', handleMyChatMember)
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

// Ловит добавление бота в группу, повышение до администратора, разжалование и удаление —
// единственный способ узнать об этом, Bot API не даёт списка групп, где состоит бот. Каждое
// из этих событий продвигает (или откатывает) визард в личке владельца на шаг вперёд/назад.
async function handleMyChatMember(ctx: Context) {
  const update = ctx.myChatMember
  if (!update) return

  const chat = update.chat
  if (chat.type !== 'group' && chat.type !== 'supergroup') return

  const chatId = String(chat.id)
  const oldStatus = update.old_chat_member.status
  const newStatus = update.new_chat_member.status

  const wasGone = oldStatus === 'left' || oldStatus === 'kicked'
  const isGone = newStatus === 'left' || newStatus === 'kicked'
  const wasAdmin = oldStatus === 'administrator'
  const isAdmin = newStatus === 'administrator'

  if (isGone) {
    // Бота выгнали/он вышел — soft delete: ставим таймер на +14 дней (purgeExpiredOrganizations
    // сотрёт всё насовсем, если не восстановят) и предупреждаем владельца в личке сразу.
    await scheduleOrganizationDeletion(chatId)
    return
  }
  if (wasAdmin && !isAdmin) {
    // Ещё в группе, просто без прав администратора — это обратимо без потери данных
    // (сводка/события никуда не делись), поэтому только помечаем disconnected.
    await markOrganizationDisconnected(chatId)
    return
  }

  if (wasGone) {
    // Заново (или впервые) добавлен в группу.
    await createOrganizationDraft(chatId, chat.title, update.from)
    return
  }

  if (!wasAdmin && isAdmin) {
    // Уже был в группе обычным участником и только что получил права администратора —
    // визард должен сам продвинуться на следующий шаг, без участия пользователя.
    await refreshWizardForChat(chatId)
  }
}

async function createOrganizationDraft(
  chatId: string,
  chatTitle: string,
  addedBy: { id: number; first_name: string },
) {
  const db = getDb()
  // onConflictDoUpdate специально не трогает status/digestChatId/reminderChatId и т.п.:
  // если это восстановление после soft delete (org.ts помнил про неё все 14 дней), настройки
  // и события должны вернуться как были, а не потребовать настройки с нуля.
  const [inserted] = await db
    .insert(organizations)
    .values({ name: chatTitle, telegramChatId: chatId, ownerTelegramId: String(addedBy.id) })
    .onConflictDoUpdate({
      target: organizations.telegramChatId,
      set: { ownerTelegramId: String(addedBy.id), scheduledDeletionAt: null, updatedAt: new Date() },
    })
    .returning()

  // Статус выставляем отдельно (не через onConflictDoUpdate) по факту: если расписание и
  // оповещения уже привязаны (пережили soft delete) — сразу active, иначе — заново с нуля.
  const nextStatus = inserted.digestChatId && inserted.reminderChatId ? 'active' : 'setup_pending'
  const org =
    inserted.status === nextStatus
      ? inserted
      : (
          await db
            .update(organizations)
            .set({ status: nextStatus, updatedAt: new Date() })
            .where(eq(organizations.id, inserted.id))
            .returning()
        )[0]

  const view = await computeOrgWizardView(org)
  const delivered = await showMenu(addedBy.id, view)
  if (!delivered) {
    // В личку не достучаться (пользователь ни разу не жал Start) — хотя бы предупредим
    // прямо в группе, коротко, без дублирования шагов из визарда.
    const mention = `<a href="tg://user?id=${addedBy.id}">${escapeHtml(addedBy.first_name)}</a>`
    await getBot().api.sendMessage(
      chatId,
      `${mention}, напишите мне /start в личке, чтобы продолжить настройку.`,
      { parse_mode: 'HTML' },
    )
  }
}

// Общая логика для /set_digest_here и /set_reminders_here: обе привязывают чат+топик из
// контекста входящего сообщения к организации, отличаются только тем, какие поля пишут.
async function handleSetHere(ctx: Context, kind: 'digest' | 'reminders') {
  const chat = ctx.chat
  const from = ctx.from
  const message = ctx.message
  if (!chat || !from || !message) return

  if (chat.type !== 'group' && chat.type !== 'supergroup') {
    // Это уже личка (иначе chat.type был бы group/supergroup) — отвечаем прямо тут же.
    await ctx.reply('Эту команду нужно выполнять в топике настраиваемой группы, а не в личке.')
    return
  }

  // В группе эта команда — чисто служебная: независимо от исхода, ей нечего делать в
  // топике — ни ответом бота, ни собственным текстом. Сообщение с командой удаляем в
  // finally, а обо всём остальном (успех, отказ, ошибка) обновляем визард в личке.
  try {
    const chatId = String(chat.id)
    const db = getDb()
    const [org] = await db.select().from(organizations).where(eq(organizations.telegramChatId, chatId))
    if (!org) {
      await showMenu(from.id, {
        text: 'Не нашёл эту группу — попробуйте удалить и заново добавить бота.',
        keyboard: new InlineKeyboard().text(BACK_BUTTON_TEXT, 'menu:root'),
      })
      return
    }

    if (!(await isChatAdmin(chatId, from.id, org.ownerTelegramId))) {
      await showMenu(from.id, {
        text: 'Выполнить эту команду может только администратор группы.',
        keyboard: new InlineKeyboard().text(BACK_BUTTON_TEXT, 'menu:root'),
      })
      return
    }

    // Без прав администратора у самого бота команда не должна ничего менять — просто
    // показываем текущий (тот же, что и был) шаг визарда: "сделайте меня админом".
    if (!(await isBotAdminInChat(chatId))) {
      await showMenu(from.id, await computeOrgWizardView(org))
      return
    }

    const threadId = message.message_thread_id
    const isDigest = kind === 'digest'

    // Только у сводки есть смысл в видимом сообщении в чате — она редактируется на месте,
    // поэтому обязана быть отправлена и закреплена. Напоминания — это разовые уведомления
    // в будущем, самой команде /set_reminders_here нечего показывать в топике: она просто
    // запоминает место, ничего туда не отправляя.
    let digestMessageId: number | undefined
    if (isDigest) {
      // org-<id> — обязательный контекст для мини-аппа: по нему Landing отличает "открыли
      // из чата" от холодного захода и понимает, для какой группы показывать события.
      const keyboard = new InlineKeyboard().url('Открыть / Записаться', buildMiniAppLink(`org-${org.id}`))
      try {
        const sent = await ctx.api.sendMessage(chatId, await buildDigestText(org.id), {
          message_thread_id: threadId,
          parse_mode: 'HTML',
          reply_markup: keyboard,
        })
        digestMessageId = sent.message_id
        // disable_notification только глушит пуш; служебное "закрепил сообщение" всё равно
        // появляется в чате отдельным сообщением — его чистит handler на message:pinned_message.
        await ctx.api.pinChatMessage(chatId, digestMessageId, { disable_notification: true })
      } catch (e) {
        console.error('Не удалось отправить/закрепить сообщение сводки', e)
        const title = escapeHtml(await getChatTitle(chatId, org.name))
        await showMenu(from.id, {
          text: `«${title}»\n\n⚠️ Не хватает прав закреплять сообщения. Выдайте мне это ` +
            'право и повторите команду.',
          keyboard: new InlineKeyboard().text(BACK_BUTTON_TEXT, 'menu:root'),
        })
        return
      }
    }

    const placeUpdate = isDigest
      ? { digestChatId: chatId, digestThreadId: threadId, digestMessageId }
      : { reminderChatId: chatId, reminderThreadId: threadId }
    const digestChatIdAfter = isDigest ? chatId : org.digestChatId
    const reminderChatIdAfter = isDigest ? org.reminderChatId : chatId
    const isFullySetUp = digestChatIdAfter != null && reminderChatIdAfter != null

    const [updatedOrg] = await db
      .update(organizations)
      .set({ ...placeUpdate, status: isFullySetUp ? 'active' : 'setup_pending', updatedAt: new Date() })
      .where(eq(organizations.telegramChatId, chatId))
      .returning()

    await showMenu(from.id, await computeOrgWizardView(updatedOrg))
  } finally {
    try {
      await ctx.api.deleteMessage(chat.id, message.message_id)
    } catch (e) {
      console.error('Не удалось удалить сообщение с командой (не хватает прав на удаление?)', e)
    }
  }
}

// Организации, которые может администрировать этот пользователь (владелец или админ чата) —
// одному человеку ничего не мешает вести сразу несколько групп разных тренировок/чатов.
// Полного списка чатов бота Bot API не даёт, поэтому единственный источник правды — пройтись
// по всем organizations и проверить каждую; isChatAdmin не делает лишний вызов к Telegram
// для тех, где пользователь и так значится ownerTelegramId, так что цена этого приемлема,
// пока организаций не тысячи.
async function getManagedOrganizations(telegramId: number): Promise<(typeof organizations.$inferSelect)[]> {
  const db = getDb()
  const allOrgs = await db.select().from(organizations)
  const managed: (typeof organizations.$inferSelect)[] = []
  for (const org of allOrgs) {
    if (await isChatAdmin(org.telegramChatId, telegramId, org.ownerTelegramId)) managed.push(org)
  }
  return managed
}

interface MenuView {
  text: string
  keyboard: InlineKeyboard
}

// Точка входа для /start и "В начало": ноль групп — общая инструкция без кнопок (некуда ещё
// возвращаться); одна группа — сразу её текущий шаг визарда; несколько — список для выбора.
async function buildEntryView(telegramId: number): Promise<MenuView> {
  const orgs = await getManagedOrganizations(telegramId)
  if (orgs.length === 0) return { text: ONBOARDING_TEXT, keyboard: new InlineKeyboard() }
  if (orgs.length === 1) return computeOrgWizardView(orgs[0])
  return buildRootMenuView(orgs)
}

async function buildRootMenuView(orgs: (typeof organizations.$inferSelect)[]): Promise<MenuView> {
  const keyboard = new InlineKeyboard()
  for (const org of orgs) {
    const title = await getChatTitle(org.telegramChatId, org.name)
    const label = org.status === 'active' ? title : `${title} ⚠️`
    keyboard.text(label, `menu:org:${org.id}`).row()
  }
  keyboard.text('➕ Добавить ещё одну группу', 'menu:add')
  return { text: 'Выберите группу:', keyboard }
}

// Один шаг визарда за раз, минимум текста — статус проверяется живьём (не хранится), чтобы
// после повышения до администратора или после /set_..._here шаг сразу оказался верным.
async function computeOrgWizardView(org: typeof organizations.$inferSelect): Promise<MenuView> {
  const name = escapeHtml(await getChatTitle(org.telegramChatId, org.name))

  if (org.status === 'disconnected') {
    return {
      text: `«${name}»\n\n⚠️ Бот отключён от группы. Верните права администратора, чтобы продолжить.`,
      keyboard: new InlineKeyboard().text(BACK_BUTTON_TEXT, 'menu:root'),
    }
  }
  if (org.status === 'removed') {
    const deadline = org.scheduledDeletionAt ? formatDeletionDate(org.scheduledDeletionAt) : null
    return {
      text:
        `«${name}»\n\n🗑 Бот удалён из группы.` +
        (deadline ? ` Добавьте меня обратно до ${deadline}, иначе настройки и мероприятия удалятся навсегда.` : ''),
      keyboard: new InlineKeyboard().text(BACK_BUTTON_TEXT, 'menu:root'),
    }
  }
  if (org.status === 'blocked') {
    return {
      text: `«${name}»\n\n⛔ Группа заблокирована.`,
      keyboard: new InlineKeyboard().text(BACK_BUTTON_TEXT, 'menu:root'),
    }
  }

  if (!(await isBotAdminInChat(org.telegramChatId))) {
    return {
      text: `«${name}»\n\n👉 Сделайте меня администратором группы.`,
      keyboard: new InlineKeyboard().text(BACK_BUTTON_TEXT, 'menu:root'),
    }
  }

  if (!org.digestChatId) {
    return {
      text:
        `«${name}» — я администратор ✅\n\n👉 В топике для расписания выполните:\n<code>/set_digest_here</code>` +
        '\n\n💡 Лучше в отдельном закрытом топике, но подойдёт и обычный чат.',
      keyboard: new InlineKeyboard().text(BACK_BUTTON_TEXT, 'menu:root'),
    }
  }

  if (!org.reminderChatId) {
    return {
      text:
        `«${name}» — расписание подключено ✅\n\n👉 В топике для оповещений выполните ` +
        '<code>/set_reminders_here</code>, или пропустите — будем слать туда же, где расписание.',
      keyboard: new InlineKeyboard()
        .text('Пропустить', `menu:skip_reminders:${org.id}`)
        .row()
        .text(BACK_BUTTON_TEXT, 'menu:root'),
    }
  }

  return {
    text: `«${name}» — всё готово ✅`,
    keyboard: new InlineKeyboard()
      .url('⚙️ Настройки', buildMiniAppLink(`settings-${org.id}`))
      .row()
      .text(BACK_BUTTON_TEXT, 'menu:root'),
  }
}

async function refreshWizardForChat(chatId: string) {
  const db = getDb()
  const [org] = await db.select().from(organizations).where(eq(organizations.telegramChatId, chatId))
  if (!org) return
  await showMenu(Number(org.ownerTelegramId), await computeOrgWizardView(org))
}

async function markOrganizationDisconnected(chatId: string) {
  const db = getDb()
  const [org] = await db
    .update(organizations)
    .set({ status: 'disconnected', updatedAt: new Date() })
    .where(eq(organizations.telegramChatId, chatId))
    .returning()

  if (!org) return
  await showMenu(Number(org.ownerTelegramId), await computeOrgWizardView(org))
}

const DELETION_GRACE_PERIOD_MS = 14 * 24 * 60 * 60 * 1000

function formatDeletionDate(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date)
}

// Бота выгнали из группы (или он вышел) — soft delete: organizations и её события пока не
// трогаем, только ставим таймер. Если за 14 дней бота не добавят обратно, purgeExpiredOrganizations
// сотрёт всё насовсем; если добавят — createOrganizationDraft сбросит таймер и восстановит
// как было (см. её комментарий).
async function scheduleOrganizationDeletion(chatId: string) {
  const db = getDb()
  const deletionAt = new Date(Date.now() + DELETION_GRACE_PERIOD_MS)
  const [org] = await db
    .update(organizations)
    .set({ status: 'removed', scheduledDeletionAt: deletionAt, updatedAt: new Date() })
    .where(eq(organizations.telegramChatId, chatId))
    .returning()

  if (!org) return
  await showMenu(Number(org.ownerTelegramId), await computeOrgWizardView(org))
}

// Дёргается внешним кроном (см. /api/cron/purge-organizations в index.ts) — находит все
// организации, у которых истёк 14-дневный срок на восстановление, и стирает их насовсем:
// события (каскадом — их участников и eventReminders, см. schema.ts), затем саму запись.
// Уведомление владелец уже получил в момент scheduleOrganizationDeletion — здесь молча, без
// повторного сообщения, чтобы не дублировать то, что и так было объявлено заранее.
export async function purgeExpiredOrganizations(): Promise<number> {
  const db = getDb()
  const expired = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.status, 'removed'), lte(organizations.scheduledDeletionAt, new Date())))

  for (const { id } of expired) {
    await db.delete(events).where(eq(events.organizationId, id))
    await db.delete(organizations).where(eq(organizations.id, id))
  }

  return expired.length
}

// Шлёт новое меню-сообщение с нуля, запоминает его id и закрепляет баннером наверху личного
// чата — редактирование не создаёт уведомления и не поднимает сообщение наверх (платформенное
// ограничение Telegram), закрепление — единственная защита от "потерялось где-то в истории".
async function sendFreshMenu(telegramId: number, view: MenuView): Promise<boolean> {
  const db = getDb()
  try {
    const sent = await getBot().api.sendMessage(telegramId, view.text, {
      parse_mode: 'HTML',
      reply_markup: view.keyboard,
    })
    await db.update(users).set({ lastMenuMessageId: sent.message_id }).where(eq(users.telegramId, String(telegramId)))
    try {
      await getBot().api.pinChatMessage(telegramId, sent.message_id, { disable_notification: true })
    } catch (e) {
      console.error('Не удалось закрепить меню в личке', e)
    }
    return true
  } catch (e) {
    console.error('Не удалось отправить меню в личке', e)
    return false
  }
}

// Используется при прогрессе визарда/навигации (my_chat_member, /set_..._here, callback-кнопки):
// правит текущее меню-сообщение на месте, а не шлёт новое — пользователь в этот момент, как
// правило, уже смотрит именно на него. Если редактировать нечего или не получилось (сообщение
// удалили руками, устарело и т.п.) — переключается на sendFreshMenu. Возвращает false, если не
// получилось доставить вообще ничего (например, в личку не достучаться).
async function showMenu(telegramId: number, view: MenuView): Promise<boolean> {
  const db = getDb()
  const [user] = await db.select().from(users).where(eq(users.telegramId, String(telegramId)))

  if (user?.lastMenuMessageId) {
    try {
      await getBot().api.editMessageText(telegramId, user.lastMenuMessageId, view.text, {
        parse_mode: 'HTML',
        reply_markup: view.keyboard,
      })
      return true
    } catch (e) {
      if (e instanceof GrammyError && e.description.includes('message is not modified')) return true
      // Старое меню недоступно (удалено вручную, устарело) — пошлём новое ниже.
    }
  }

  return sendFreshMenu(telegramId, view)
}

// /start — явное действие пользователя, а не фоновый прогресс визарда: вместо попытки
// отредактировать старое (потенциально невидимо застрявшее где-то в истории) сообщение,
// сразу удаляет его и шлёт новое — гарантированно видимое внизу чата, с уведомлением.
async function restartMenu(telegramId: number, view: MenuView): Promise<boolean> {
  const db = getDb()
  const [user] = await db.select().from(users).where(eq(users.telegramId, String(telegramId)))
  if (user?.lastMenuMessageId) {
    try {
      await getBot().api.deleteMessage(telegramId, user.lastMenuMessageId)
    } catch (e) {
      // Уже удалено/недоступно — не страшно, всё равно шлём новое.
    }
  }
  return sendFreshMenu(telegramId, view)
}

async function handleMenuCallback(ctx: Context) {
  const from = ctx.from
  const data = ctx.callbackQuery?.data
  if (!from || !data) return

  if (data === 'menu:root') {
    const view = await buildEntryView(from.id)
    await ctx.editMessageText(view.text, { parse_mode: 'HTML', reply_markup: view.keyboard })
    await ctx.answerCallbackQuery()
    return
  }

  if (data === 'menu:add') {
    await ctx.editMessageText(ONBOARDING_TEXT, {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text(BACK_BUTTON_TEXT, 'menu:root'),
    })
    await ctx.answerCallbackQuery()
    return
  }

  const db = getDb()

  if (data.startsWith('menu:skip_reminders:')) {
    const orgId = Number(data.slice('menu:skip_reminders:'.length))
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId))
    if (!org || !(await isChatAdmin(org.telegramChatId, from.id, org.ownerTelegramId))) {
      await ctx.answerCallbackQuery({ text: 'Нет доступа к этой группе', show_alert: true })
      return
    }
    if (!org.digestChatId) {
      // Защитный случай: кнопка "Пропустить" видна только на шаге после привязки расписания,
      // но состояние могло смениться между показом кнопки и нажатием.
      await ctx.answerCallbackQuery()
      return
    }
    const [updated] = await db
      .update(organizations)
      .set({
        reminderChatId: org.digestChatId,
        reminderThreadId: org.digestThreadId,
        status: 'active',
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, orgId))
      .returning()

    const view = await computeOrgWizardView(updated)
    await ctx.editMessageText(view.text, { parse_mode: 'HTML', reply_markup: view.keyboard })
    await ctx.answerCallbackQuery()
    return
  }

  const orgId = Number(data.slice('menu:org:'.length))
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId))
  if (!org || !(await isChatAdmin(org.telegramChatId, from.id, org.ownerTelegramId))) {
    await ctx.answerCallbackQuery({ text: 'Нет доступа к этой группе', show_alert: true })
    return
  }

  const view = await computeOrgWizardView(org)
  await ctx.editMessageText(view.text, { parse_mode: 'HTML', reply_markup: view.keyboard })
  await ctx.answerCallbackQuery()
}

export async function isChatAdmin(chatId: string, telegramId: number, ownerTelegramId: string): Promise<boolean> {
  if (String(telegramId) === ownerTelegramId) return true

  try {
    const member = await getBot().api.getChatMember(chatId, telegramId)
    return member.status === 'creator' || member.status === 'administrator'
  } catch (e) {
    console.error('Не удалось проверить права администратора в группе', e)
    return false
  }
}

async function isBotAdminInChat(chatId: string): Promise<boolean> {
  try {
    const bot = getBot()
    const me = await bot.api.getMe()
    const member = await bot.api.getChatMember(chatId, me.id)
    return member.status === 'creator' || member.status === 'administrator'
  } catch (e) {
    console.error('Не удалось проверить права бота в группе', e)
    return false
  }
}

// organizations.name — это редактируемое в настройках мини-аппа отображаемое имя (может
// разойтись с реальным названием чата, если админ его поменял через настройки) — во всех
// сообщениях/кнопках самого бота показываем актуальное название чата из Telegram, а не его.
// Фолбэк на org.name — на случай, если бот уже потерял доступ к чату (removed/disconnected).
async function getChatTitle(chatId: string, fallback: string): Promise<string> {
  try {
    const chat = await getBot().api.getChat(chatId)
    return 'title' in chat && chat.title ? chat.title : fallback
  } catch (e) {
    console.error('Не удалось получить актуальное название чата', e)
    return fallback
  }
}

export function getBotUsername(): string {
  return BOT_USERNAME
}
