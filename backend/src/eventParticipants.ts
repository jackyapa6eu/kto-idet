// Резерв не хранится отдельным полем в БД — считается на лету по позиции в списке,
// отсортированном по joinedAt: первые maxParticipants — подтверждённые, остальные — резерв.
// Из этого бесплатно следует автопродвижение: когда кто-то из подтверждённых уходит, при
// следующем же чтении первый из резерва окажется в пределах лимита без отдельного кода на
// DELETE. maxParticipants <= 0 (или не задан) — лимита нет, резерва не бывает.
export function splitParticipants<T>(
  orderedByJoinedAt: T[],
  maxParticipants: number | null,
): { confirmed: T[]; reserve: T[] } {
  if (maxParticipants == null || maxParticipants <= 0) {
    return { confirmed: orderedByJoinedAt, reserve: [] }
  }
  return {
    confirmed: orderedByJoinedAt.slice(0, maxParticipants),
    reserve: orderedByJoinedAt.slice(maxParticipants),
  }
}
