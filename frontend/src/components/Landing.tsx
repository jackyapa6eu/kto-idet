const BOT_USERNAME = 'kto_idet_bot'
const BOT_URL = `https://t.me/${BOT_USERNAME}`

const features = [
  {
    icon: '🗓',
    title: 'Расписание в чате',
    text: 'Мероприятия с датой, местом, тренером и ценой — всё видно сразу в закреплённом сообщении.',
  },
  {
    icon: '✅',
    title: 'Запись в один клик',
    text: 'Участники сами записываются и отменяют запись, без лишних сообщений и звонков.',
  },
  {
    icon: '📌',
    title: 'Автосводка',
    text: 'Одно сообщение всегда актуально — бот сам правит его при любом изменении.',
  },
  {
    icon: '💰',
    title: 'Кто оплатил',
    text: 'Организатор отмечает оплату прямо в мини-приложении — видно, кто уже перевёл.',
  },
]

const steps = [
  <>
    Добавьте бота в свою Telegram-группу и выдайте ему права администратора.
  </>,
  <>
    В топике для расписания выполните команду <code>/set_digest_here</code>.
  </>,
  <>
    В топике для напоминаний выполните <code>/set_reminders_here</code> — или пропустите, тогда
    подойдёт тот же топик.
  </>,
]

const faq: { q: string; a: string }[] = [
  {
    q: 'Это бесплатно?',
    a: 'Да, сейчас бот бесплатен для любой группы.',
  },
  {
    q: 'Нужно ли участникам что-то устанавливать?',
    a: 'Нет — всё работает прямо в Telegram, без отдельного приложения и регистрации.',
  },
  {
    q: 'Зачем боту права администратора?',
    a: 'Без них он не сможет закреплять сообщение со сводкой и присылать напоминания в нужные топики.',
  },
  {
    q: 'Можно ограничить, кто создаёт мероприятия?',
    a: 'Да — в настройках группы (открываются кнопкой «⚙️ Настройки» в мини-приложении) можно разрешить это только администраторам или всем участникам.',
  },
]

// <-escaping guards against a literal "</script>" inside the JSON ever closing the tag
// early — none of our current content has it, but data going into dangerouslySetInnerHTML
// should never trust that to stay true.
function jsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

const structuredData = jsonLd({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      name: 'Кто идёт',
      url: 'https://kto-idet.ru/',
    },
    {
      '@type': 'SoftwareApplication',
      name: 'Кто идёт',
      url: 'https://kto-idet.ru/',
      description:
        '«Кто идёт» — Telegram-бот для организации тренировок, игр и других мероприятий в вашей группе: запись участников, автоматическая сводка и напоминания.',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Telegram',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'RUB',
      },
    },
    {
      '@type': 'FAQPage',
      mainEntity: faq.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
  ],
})

function openBotChat() {
  const webApp = window.Telegram?.WebApp
  if (webApp) {
    webApp.openTelegramLink(BOT_URL)
    return
  }
  window.open(BOT_URL, '_blank', 'noopener')
}

function TelegramIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21.5 3.5 2.7 10.9c-1.2.5-1.2 1.2-.2 1.5l4.8 1.5 1.8 5.6c.2.6.4.9.9.9.5 0 .7-.2 1-.5l2.4-2.3 4.9 3.6c.9.5 1.5.2 1.8-.8l3.2-15c.4-1.3-.4-1.9-1.8-1.4Z"
        fill="currentColor"
      />
    </svg>
  )
}

const CtaButton = ({ compact }: { compact?: boolean }) => (
  <button type="button" className="landing__cta" onClick={openBotChat}>
    <TelegramIcon />
    {compact ? 'Добавить бота' : 'Добавить бота в свой чат'}
  </button>
)

// Показывается, когда мини-апп открыт без контекста конкретного чата/мероприятия (например,
// через постоянную кнопку меню бота или напрямую по ссылке) — холодный визит, а не переход из
// чата. Здесь же живёт весь маркетинговый текст, который дублируется статикой в index.html при
// сборке (см. scripts/prerender-landing.tsx) — крауleры видят содержимое без выполнения JS.
export const Landing = () => {
  return (
    <div className="landing">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      <div className="landing__inner">
        <section className="landing__hero">
          <span className="landing__badge">✈️ Для Telegram-групп</span>
          <h1 className="landing__title">
            Бот для записи на <span className="landing__title-accent">мероприятия</span> в вашей
            Telegram-группе
          </h1>
          <p className="landing__subtitle">
            «Кто идёт» — тренировки, игры, квизы и всё остальное, на что собираются вместе.
            Участники записываются сами, бот ведёт расписание и напоминает о начале.
          </p>
          <CtaButton />
          <p className="landing__hint">Подключается за 2 минуты, без установки для участников</p>
          <img
            className="landing__hero-image"
            src="/hero.jpg"
            width={1200}
            height={675}
            alt="Друзья на пляжном волейболе вместе смотрят расписание мероприятий в Telegram"
            fetchPriority="high"
          />
        </section>

        <section className="landing__section">
          <h2 className="landing__section-title">Что умеет бот</h2>
          <p className="landing__section-subtitle">
            Создание мероприятий, запись участников и напоминания — прямо в чате, которым вы уже
            пользуетесь.
          </p>
          <div className="landing__grid">
            {features.map((f) => (
              <div className="landing__card" key={f.title}>
                <span className="landing__card-icon" aria-hidden="true">
                  {f.icon}
                </span>
                <p className="landing__card-title">{f.title}</p>
                <p className="landing__card-text">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="landing__section">
          <h2 className="landing__section-title">Как подключить к своей группе</h2>
          <ol className="landing__steps">
            {steps.map((step, index) => (
              <li className="landing__step" key={index}>
                <span className="landing__step-index">{index + 1}</span>
                <p className="landing__step-text">{step}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing__section">
          <img
            className="landing__faq-icon"
            src="/faq-icon.png"
            width={80}
            height={80}
            alt=""
            aria-hidden="true"
            loading="lazy"
          />
          <h2 className="landing__section-title">Частые вопросы</h2>
          <div className="landing__faq">
            {faq.map(({ q, a }) => (
              <details className="landing__faq-item" key={q}>
                <summary>{q}</summary>
                <p className="landing__faq-answer">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="landing__footer">
          <CtaButton />
          <p className="landing__footer-note">
            Бот{' '}
            <a href={BOT_URL} target="_blank" rel="noopener noreferrer">
              @{BOT_USERNAME}
            </a>{' '}
            · «Кто идёт», {new Date().getFullYear()}
          </p>
        </section>
      </div>
    </div>
  )
}
