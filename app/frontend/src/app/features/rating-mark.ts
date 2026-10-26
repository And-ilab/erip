/** Один овал на карточке канбана: рейтинг и группа, например A/1-1. */
export function ratingMark(rating: string | null | undefined, group: number | null | undefined): string {
  const letter = (rating || '').trim();
  const band = group ? String(group) : '';
  if (letter && band) return `${letter}-${band}`;
  return letter || band;
}

export function ratingMarkClass(rating: string | null | undefined, group: number | null | undefined): string {
  const letter = (rating || '').trim();
  if (letter) return `rating-badge pair r${letter[0]}`;
  if (group) return `group-badge pair g${group}`;
  return 'rating-badge pair';
}

export function ratingMarkTitle(rating: string | null | undefined, group: number | null | undefined): string {
  const letter = (rating || '').trim();
  if (letter && group) return `Рейтинг ${letter}, группа задолженности ${group}`;
  if (letter) return 'Рейтинг должника';
  if (group) return `Группа задолженности ${group}`;
  return '';
}
