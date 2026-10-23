/** Этапы основной ветви E0–E14. Короткая подпись — на ленте, полное имя — в колонке и в подсказке. */
export interface FunnelStage {
  id: string;
  title: string;
  short: string;
  mark: string;
}

export const FUNNEL_STAGES: FunnelStage[] = [
  { id: 'new', title: 'Новый должник', short: 'Новый должник', mark: 'E0' },
  { id: 'call', title: 'Автообзвон', short: 'Автообзвон', mark: 'E1' },
  { id: 'notice', title: 'Уведомление/Предупреждение', short: 'Уведомление', mark: 'E2' },
  { id: 'disconnect', title: 'Отключение услуг', short: 'Отключение', mark: 'E3' },
  { id: 'prep', title: 'Подготовка пакета на исполнительную надпись', short: 'Пакет на ИН', mark: 'E4' },
  { id: 'notary', title: 'Направлено нотариусу', short: 'У нотариуса', mark: 'E5' },
  { id: 'writ_done', title: 'Исполнительная надпись совершена', short: 'ИН совершена', mark: 'E6' },
  { id: 'refused', title: 'Отказ нотариуса', short: 'Отказ нотариуса', mark: 'E7' },
  { id: 'lawsuit', title: 'Исковое заявление в суд', short: 'Иск в суд', mark: 'E8' },
  { id: 'judgment', title: 'Судебное решение получено', short: 'Решение суда', mark: 'E9' },
  { id: 'opi', title: 'Направлено в ОПИ', short: 'В ОПИ', mark: 'E10' },
  { id: 'opi_measures', title: 'Меры ОПИ приняты', short: 'Меры ОПИ', mark: 'E11' },
  { id: 'recovered', title: 'Взыскано', short: 'Взыскано', mark: 'E12' },
  { id: 'impossible', title: 'Невозможность взыскания', short: 'Невозможность взыскания', mark: 'E13' },
  { id: 'writeoff', title: 'Подготовка документов о списании безнадежной задолженности', short: 'Списание', mark: 'E14' },
];

export const FUNNEL_CHAIN = FUNNEL_STAGES.filter((stage) => stage.id !== 'impossible' && stage.id !== 'writeoff');
export const FUNNEL_TERMINAL = FUNNEL_STAGES.filter((stage) => stage.id === 'impossible' || stage.id === 'writeoff');

const ALIASES: Record<string, string> = {
  prevention: 'call',
  warning: 'notice',
  enforcement: 'prep',
  court: 'opi',
  closed: 'recovered',
};

export function funnelId(raw: string | null | undefined): string {
  const code = (raw || '').trim();
  if (!code) return 'new';
  return ALIASES[code] || code;
}

export function funnelTitle(raw: string | null | undefined): string {
  const id = funnelId(raw);
  if (id === 'p0') return 'не начата';
  if (id === 'p1') return 'Уведомление о выселении';
  if (id === 'p2') return 'Выселение / продажа';
  return FUNNEL_STAGES.find((stage) => stage.id === id)?.title || raw || '—';
}

export function funnelShort(raw: string | null | undefined): string {
  const id = funnelId(raw);
  return FUNNEL_STAGES.find((stage) => stage.id === id)?.short || funnelTitle(raw);
}
