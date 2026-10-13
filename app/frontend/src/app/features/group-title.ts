/** Подпись шапки группировки. Группы 1–6 — шкалы ТЗ, не четыре колонки слайда. */
export const BLANK_BUCKET = '__blank__';

const GROUP_HINT: Record<string, string> = {
  '1': 'менее 2 месяцев',
  '2': 'от 2 до 3 месяцев',
  '3': 'от 3 до 6 месяцев',
  '4': 'от 6 до 12 месяцев',
  '5': 'от 12 до 36 месяцев',
  '6': 'свыше 36 месяцев',
};

export function groupSectionTitle(field: string, value: string, fieldLabel: string): string {
  if (field === 'debt_group') {
    if (!value) return 'Без группы';
    const hint = GROUP_HINT[value];
    return hint ? `Группа ${value} · ${hint}` : `Группа ${value}`;
  }
  if (!value) return `Не указано · ${fieldLabel}`;
  if (field === 'rating') return `Рейтинг ${value}`;
  if (field === 'period') return value.slice(0, 7);
  return value;
}

export function bucketParam(value: string): string {
  return value || BLANK_BUCKET;
}

/** В реестре длинный перечень не нужен. Больше двух слов — первое. Полный состав на карточке. */
export function briefText(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean || clean === '—') return clean || '—';
  const words = clean.split(' ').filter(Boolean);
  if (words.length <= 2) return clean;
  return words[0].replace(/[;,]+$/g, '') || '—';
}
