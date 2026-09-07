import dayjs from 'dayjs'

export function formatEventDate(startsAt: string): string {
  const formatted = dayjs(startsAt).format('dddd, D MMMM, HH:mm')
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}
