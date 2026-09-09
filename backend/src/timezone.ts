// Единая таймзона для всего, что связано с календарными границами события (сегодня/месяц) —
// выбрана Красноярском, потому что там сейчас развивают продукт (см. digest.ts). Фиксированный
// +07:00 без DST — Россия её не соблюдает, поэтому это стабильно, а не приближение.
export const EVENTS_TIME_ZONE = 'Asia/Krasnoyarsk'

export function startOfTodayInEventsTimeZone(): Date {
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: EVENTS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return new Date(`${todayStr}T00:00:00+07:00`)
}

export function startOfMonthInEventsTimeZone(): Date {
  const [year, month] = new Intl.DateTimeFormat('en-CA', {
    timeZone: EVENTS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date())
    .split('-')
  return new Date(`${year}-${month}-01T00:00:00+07:00`)
}
