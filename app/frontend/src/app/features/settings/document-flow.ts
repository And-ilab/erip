import { FormBuilder, FormControl, FormGroup } from '@angular/forms';

/** Подписи полей счёта. Та же карта, что в apps/nsi/services/form_sheet.py. */
export const FIELD_LABELS: Record<string, string> = {
  fio: 'Должник',
  account: 'Лицевой счёт',
  amount: 'Задолженность',
  principal: 'Основной долг',
  penalty: 'Пеня',
  address: 'Адрес',
  services: 'Услуги',
  last_payment: 'Последняя оплата',
  organization: 'Организация',
  due_days: 'Срок, дней',
  tariff: 'Нотариальный тариф',
  debt_group: 'Группа задолженности',
  rating: 'Рейтинг',
  months_debt: 'Месяцев долга',
  personal_id: 'Идентификационный номер',
  unp: 'УНП',
  warning_date: 'Дата вручения',
  debt_started: 'Начало долга',
  period_from: 'Период с',
  period_to: 'Период по',
  date: 'Дата документа',
  doc_number: 'Номер документа',
  phone: 'Телефон',
  area: 'Площадь',
  rooms: 'Комнат',
  residents_count: 'Проживает',
  ownership: 'Тип собственности',
  note: 'Примечание',
  representative: 'Представитель',
};

export const KNOWN_TOKENS = Object.keys(FIELD_LABELS);

export const FONT_FAMILIES = [
  { id: 'Times New Roman', label: 'Times New Roman', css: '"Times New Roman", Times, "Liberation Serif", "DejaVu Serif", serif' },
  { id: 'Arial', label: 'Arial', css: 'Arial, "Helvetica Neue", "Liberation Sans", "DejaVu Sans", sans-serif' },
  { id: 'Calibri', label: 'Calibri', css: 'Calibri, "Segoe UI", Arial, "Liberation Sans", "DejaVu Sans", sans-serif' },
  { id: 'Georgia', label: 'Georgia', css: 'Georgia, "Times New Roman", "Liberation Serif", "DejaVu Serif", serif' },
  { id: 'Verdana', label: 'Verdana', css: 'Verdana, Geneva, "DejaVu Sans", sans-serif' },
  { id: 'Tahoma', label: 'Tahoma', css: 'Tahoma, Geneva, "DejaVu Sans", sans-serif' },
  { id: 'Courier New', label: 'Courier New', css: '"Courier New", Courier, "Liberation Mono", "DejaVu Sans Mono", monospace' },
  { id: 'DejaVu Serif', label: 'DejaVu Serif', css: '"DejaVu Serif", "Liberation Serif", "Times New Roman", serif' },
  { id: 'DejaVu Sans', label: 'DejaVu Sans', css: '"DejaVu Sans", "Liberation Sans", Arial, sans-serif' },
];

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36];

export function fontCss(family?: string): string {
  const found = FONT_FAMILIES.find((item) => item.id === family);
  return found ? found.css : FONT_FAMILIES[0].css;
}

const CYR_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function slugifyCode(raw: string, fallbackName = ''): string {
  const source = (raw || fallbackName || '').trim().toLowerCase();
  const translit = Array.from(source).map((ch) => CYR_MAP[ch] ?? ch).join('');
  const slug = translit.replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 72);
  return slug || `tpl-${Date.now().toString().slice(-6)}`;
}

const LABEL_TOKENS: Record<string, string> = {
  'должник': 'fio',
  'ответчик': 'fio',
  'заявитель': 'organization',
  'истец': 'organization',
  'организация': 'organization',
  'лицевой счёт': 'account',
  'лицевой счет': 'account',
  'адрес': 'address',
  'идентификационный номер': 'personal_id',
  'унп': 'unp',
  'услуги': 'services',
  'задолженность': 'amount',
  'исходящее сальдо': 'amount',
  'исходящее сальдо по данным аис «расчет-жку»': 'amount',
  'исходящее сальдо с пенями': 'amount',
  'пеня': 'penalty',
  'исходящие пени': 'penalty',
  'пеня по данным аис «расчет-жку»': 'penalty',
  'нотариальный тариф': 'tariff',
  'дата вручения предупреждения': 'warning_date',
  'группа задолженности': 'debt_group',
  'рейтинг': 'rating',
  'месяцев долга': 'months_debt',
  'наиболее ранний период': 'debt_started',
};

const FIELD_LINE = /^([^:{]{1,80}):\s*\{([a-z0-9_]+)\}\s*$/;
const BARE_LINE = /^\{([a-z0-9_]+)\}\s*$/;
const FILLED_LINE = /^([^:{]{1,80}):\s*(.*?)\s*$/;

export interface SheetBlock {
  key: string;
  title: string;
  enabled: boolean;
  align: 'left' | 'center' | 'right' | 'justify';
  bold: boolean;
  italic: boolean;
  font_size: number;
  font_family: string;
  text: string;
  columns: { title: string; width: number }[];
  rows: string[][];
  x: number;
  y: number;
  w: number;
}

export interface TextPart { kind: 'text'; text: string; control: string }
export interface FieldPart { kind: 'field'; token: string }
export interface TitleNode { kind: 'title'; control: string; text: string }
export interface GapNode { kind: 'gap' }
export interface FieldItem {
  label: string;
  token: string;
  bare: boolean;
  literal: boolean;
  value: string;
  labelControl: string;
}
export interface FieldsNode { kind: 'fields'; framed: boolean; items: FieldItem[] }
export interface ParagraphNode { kind: 'paragraph'; parts: Array<TextPart | FieldPart> }
export type FlowNode = TitleNode | GapNode | FieldsNode | ParagraphNode;
export interface FlowBlock { key: string; nodes: FlowNode[] }
export type SheetMode = 'template' | 'filled';

export function normalizeBlock(block: Partial<SheetBlock> & { key: string }, index = 0): SheetBlock {
  const align = block.align === 'center' || block.align === 'right' || block.align === 'justify' ? block.align : 'left';
  const size = Number(block.font_size);
  const family = FONT_FAMILIES.some((item) => item.id === block.font_family)
    ? String(block.font_family)
    : 'Times New Roman';
  const cols = (block.columns || []).map((col) => ({
    title: String(col.title || '').slice(0, 60),
    width: Math.min(100, Math.max(5, Number(col.width) || 20)),
  }));
  const rows = (block.rows || []).map((row) => {
    const copy = [...row];
    while (copy.length < cols.length) copy.push('');
    return cols.length ? copy.slice(0, cols.length) : copy;
  });
  return {
    key: block.key,
    title: block.title || 'Блок',
    enabled: block.enabled !== false,
    align,
    bold: !!block.bold,
    italic: !!block.italic,
    font_size: size >= 8 && size <= 36 ? size : 12,
    font_family: family,
    text: block.text || '',
    columns: cols,
    rows: cols.length && !rows.length ? [cols.map(() => '')] : rows,
    x: block.x ?? 4,
    y: block.y ?? 12 + index * 96,
    w: Math.min(100, Math.max(20, Number(block.w) || 92)),
  };
}

export function bodyBlock(text: string): SheetBlock {
  return normalizeBlock({ key: 'body', title: 'Текст', text, enabled: true }, 0);
}

export function blankToBlocks(blank: string): SheetBlock[] {
  const mk = (b: Partial<SheetBlock> & { key: string }, idx: number) => normalizeBlock(b, idx);
  if (blank === 'warning') {
    return [
      mk({ key: 'logo', title: 'Шапка', align: 'center', bold: true, x: 4, y: 12, w: 46, text: 'Республика Беларусь\n{organization}\n{locality}\n{date}, № {doc_number}' }, 0),
      mk({ key: 'requisites', title: 'Адресат', align: 'right', x: 52, y: 12, w: 44, text: 'гр. {fio},\nпроживающему по адресу\n{address}' }, 1),
      mk({ key: 'block-title', title: 'Заголовок', align: 'center', bold: true, font_size: 14, y: 90, text: 'ПРЕДУПРЕЖДЕНИЕ' }, 2),
      mk({
        key: 'body', title: 'Текст', align: 'justify', y: 150,
        text: 'В связи с наличием у Вас задолженности по жилищно-коммунальным услугам в размере {amount} руб. и в случае неоплаты данной суммы в течение {due_days} дней после получения данного предупреждения Вам будут отключены коммунальные услуги {services} в соответствии с пунктом 7 Положения о порядке перерасчета платы за некоторые виды коммунальных услуг и приостановления (возобновления) оказания коммунальных услуг, утвержденного постановлением Совета Министров Республики Беларусь от 27.08.2025 № 465.\n\nОбращаем Ваше внимание, что в соответствии с пунктом 9 названного Положения затраты, связанные с возобновлением предоставления коммунальных услуг, возмещаются гражданином, проживающим в жилом помещении. Предоставление коммунальных услуг будет возобновлено в течение не более двух суток после представления в {organization} документов о погашении имеющейся задолженности и оплате затрат, связанных с возобновлением предоставления коммунальных услуг.\n\nПо имеющимся вопросам обращайтесь по тел. {phone}',
      }, 3),
      mk({
        key: 'signatory', title: 'Подписи', y: 340, font_size: 11, text: 'Печать',
        columns: [{ title: 'Предупреждение вручил', width: 50 }, { title: 'Предупреждение получил', width: 50 }],
        rows: [['Ф.И.О. (подпись)', '(подпись) {fio}']],
      }, 4),
    ];
  }
  if (blank.startsWith('notice')) {
    const extra = blank === 'notice-137'
      ? '\n\nВ случае наличия у Вас без уважительных причин шестимесячной задолженности по плате за жилищно-коммунальные услуги на Вас может быть подан иск в суд о понуждении Вас к отчуждению жилого помещения (статья 137 Жилищного кодекса Республики Беларусь).'
      : blank === 'notice-80'
        ? '\n\nВ случае наличия у Вас без уважительных причин шестимесячной задолженности по плате за жилищно-коммунальные услуги и плате за пользование жилым помещением на Вас может быть подан иск в суд на выселение из жилого помещения (статьи 80, 87 Жилищного кодекса Республики Беларусь).'
        : blank === 'notice-86'
          ? '\n\nВ случае наличия без уважительных причин задолженности по внесению платы за пользование арендным жильем и (или) жилищно-коммунальные услуги в размере шестимесячной платы Вы будете выселены без предоставления других жилых помещений (статья 86 Жилищного кодекса Республики Беларусь).'
          : '';
    return [
      mk({ key: 'requisites', title: 'Адресат', align: 'right', y: 12, text: '{fio}\n{address}' }, 0),
      mk({ key: 'block-title', title: 'Заголовок', align: 'center', bold: true, font_size: 14, y: 70, text: 'УВЕДОМЛЕНИЕ' }, 1),
      mk({
        key: 'body', title: 'Текст', align: 'justify', y: 120,
        text: `В связи с наличием у Вас задолженности по {services} в сумме {amount} рублей уведомляем Вас, что в случае неоплаты данной суммы, задолженность будет взыскана в бесспорном порядке на основании исполнительной надписи.${extra}\n\nПо имеющимся вопросам обращаться в {organization} по адресу: {address_org} время работы {hours}, телефон {phone}.`,
      }, 2),
      mk({ key: 'logo', title: 'Шапка', y: 280, text: 'Республика Беларусь\n{organization}\n{locality}\n{date}, исх. № {doc_number}' }, 3),
      mk({ key: 'signatory', title: 'Подписи', y: 360, text: 'М.П.' }, 4),
    ];
  }
  if (blank === 'reminder') {
    return [
      mk({ key: 'logo', title: 'Куда и кому', y: 12, text: 'Дата, время выдачи: {date}\nКуда: {address}\nКому: {fio}\nЛицевой счет {account}   Общая площадь {area} м.кв.   Проживает {residents_count} чел.\nИндекс предприятия связи и адрес отправителя: {address_org}' }, 0),
      mk({ key: 'body', title: 'Текст', align: 'center', bold: true, y: 100, text: 'НАПОМИНАНИЕ\n\nНа {as_of} за Вами числится задолженность за коммунальные услуги, количество месяцев долга: {months_debt}' }, 1),
      mk({
        key: 'table', title: 'Долг и пени', y: 180, font_size: 11, text: 'Расчет пени',
        columns: [{ title: 'Месяц год', width: 40 }, { title: 'Долг', width: 30 }, { title: 'Пени', width: 30 }],
        rows: [['{debt_started}', '{principal}', '{penalty}'], ['ИТОГО', '{principal}', '{penalty}']],
      }, 2),
      mk({ key: 'signatory', title: 'Адрес отправителя', y: 300, text: 'Вам надлежит до {due_date} погасить задолженность, иначе удержание оплаты будет передано в суд.\nтел. {phone}\n{address_org}' }, 3),
    ];
  }
  if (blank === 'calculation') {
    return [
      mk({ key: 'logo', title: 'Заголовок и шапка', align: 'center', bold: true, y: 12, text: 'Расчёт задолженности по лицевому счету № {account} по состоянию на {as_of}\nРеспублика Беларусь\n{organization}\n{locality}' }, 0),
      mk({ key: 'requisites', title: 'Реквизиты', font_size: 10, y: 80, text: 'Организация, осуществляющая перечисление платы Исполнителям услуг: ОАО «НКФО «ЕРИП»\nБанк: {bank}   БИК банка: {bik}   Счет: {bank_account}\nУНП бенефициара: {unp}   РЕГ. № {doc_number}' }, 1),
      mk({
        key: 'block-payer', title: 'Плательщик', font_size: 10, y: 150,
        text: 'Обязанность по внесению платы за жилищно-коммунальные услуги возникла с {duty_from}',
        columns: [{ title: 'Плательщик ЖКУ', width: 30 }, { title: 'Адрес', width: 30 }, { title: 'Тип собственности', width: 20 }, { title: 'Площадь / комнат', width: 20 }],
        rows: [['{fio}', '{address}', '{ownership}', '{area} / {rooms}']],
      }, 2),
      mk({
        key: 'table', title: 'Таблица услуг', font_size: 10, y: 240,
        text: 'Всего к оплате: {amount} белорусских рублей (основной долг {principal}, пеня {penalty}).',
        columns: [{ title: 'Наименование услуги', width: 36 }, { title: 'Период', width: 22 }, { title: 'Долг по услуге', width: 14 }, { title: 'Долг по пени', width: 14 }, { title: 'Всего с пеней', width: 14 }],
        rows: [['{services}', '{debt_started}', '{principal}', '{penalty}', '{amount}'], ['Итого', '', '{principal}', '{penalty}', '{amount}']],
      }, 3),
      mk({
        key: 'block-people', title: 'Зарегистрированные', font_size: 10, y: 340,
        text: 'Сведения о совершеннолетних гражданах, зарегистрированных по месту жительства',
        columns: [{ title: 'Фамилия, имя, отчество', width: 36 }, { title: 'Дата регистрации', width: 22 }, { title: 'Дата рождения', width: 20 }, { title: 'Отношение', width: 22 }],
        rows: [['{fio}', '{duty_from}', '', 'Плательщик']],
      }, 4),
      mk({ key: 'body', title: 'Оговорка', align: 'justify', font_size: 10, y: 430, text: 'После вручения {warning_date} письменного предупреждения о необходимости погашения задолженности в течение 7 дней и намерением обратиться за совершением исполнительной надписи в случае неоплаты задолженность не погашена. Судебного спора нет.' }, 5),
      mk({
        key: 'signatory', title: 'Подписи', font_size: 10, y: 520, text: '',
        columns: [{ title: 'Руководитель', width: 50 }, { title: 'Главный бухгалтер', width: 50 }],
        rows: [['(должность) (подпись) (И.О.Фамилия)', '(должность) (подпись) (И.О.Фамилия)']],
      }, 6),
    ];
  }
  if (blank === 'proxy') {
    return [
      mk({
        key: 'logo', title: 'Шапка организации', align: 'center', bold: true, x: 4, y: 12, w: 46,
        text: 'Республика Беларусь\n{organization}\n{locality}\n{date}, № {doc_number}',
      }, 0),
      mk({ key: 'block-title', title: 'Заголовок', align: 'center', bold: true, font_size: 14, y: 90, text: 'ДОВЕРЕННОСТЬ' }, 1),
      mk({
        key: 'body', title: 'Текст доверенности', align: 'justify', y: 140,
        text: '{organization}, УНП {unp}, в лице руководителя, действующего на основании Устава (Положения), настоящей доверенностью уполномочивает представителя {representative} представлять интересы организации в нотариальных конторах и нотариальных бюро Республики Беларусь по вопросам обращения за совершением исполнительных надписей о взыскании задолженности по плате за жилищно-коммунальные услуги и пени, подписывать заявления о совершении исполнительных надписей и расчёты суммы задолженности.',
      }, 2),
      mk({
        key: 'requisites', title: 'Сведения по лицевому счёту', y: 260,
        text: 'Должник: {fio}\nЛицевой счёт: {account}\nАдрес: {address}\nПериод задолженности: с {period_from} по {period_to}\nЗадолженность: {amount} бел. руб., в том числе пеня {penalty} бел. руб.',
      }, 3),
      mk({
        key: 'signatory', title: 'Подпись', y: 380,
        text: 'Руководитель _______________________ {organization}\nМ.П.',
      }, 4),
    ];
  }
  if (blank === 'writ') {
    return [
      mk({
        key: 'logo', title: 'Шапка организации', align: 'center', bold: true, x: 4, y: 12, w: 46,
        text: 'Республика Беларусь\n{organization}\n{locality}\nУНП {unp}\n{date}, исх. № {doc_number}',
      }, 0),
      mk({
        key: 'requisites', title: 'Адресат и стороны', align: 'right', x: 52, y: 12, w: 44,
        text: 'В нотариальную контору / нотариальное бюро\nВзыскатель: {organization}\nДолжник: {fio}\nИдентификационный номер: {personal_id}\nАдрес: {address}\nЛицевой счёт № {account}',
      }, 1),
      mk({
        key: 'block-title', title: 'Заголовок', align: 'center', bold: true, font_size: 14, y: 96,
        text: 'ЗАЯВЛЕНИЕ\nо совершении исполнительной надписи',
      }, 2),
      mk({
        key: 'body', title: 'Текст заявления', align: 'justify', y: 156,
        text: 'Прошу совершить исполнительную надпись о взыскании с должника {fio}, проживающего по адресу: {address} (лицевой счёт № {account}), задолженности по плате за жилищно-коммунальные услуги ({services}) за период с {period_from} по {period_to} и пени в связи с просрочкой внесения платы.\n\nПисьменное предупреждение о необходимости погашения задолженности вручено должнику {warning_date} (срок для погашения — {due_days} дней). В установленный срок задолженность не погашена, судебного спора не имеется.',
      }, 3),
      mk({
        key: 'table', title: 'Расчёт требований', font_size: 11, y: 270, text: '',
        columns: [
          { title: 'Наименование требования', width: 46 },
          { title: 'Период задолженности', width: 30 },
          { title: 'Сумма, бел. руб.', width: 24 },
        ],
        rows: [
          ['Основной долг ({services})', '{period_from} – {period_to}', '{principal}'],
          ['Пеня за просрочку платы', '{period_from} – {period_to}', '{penalty}'],
          ['Нотариальный тариф', '', '{tariff}'],
          ['ИТОГО', '', '{amount}'],
        ],
      }, 4),
      mk({
        key: 'signatory', title: 'Подпись', y: 400,
        text: 'Подпись уполномоченного _______________________ {representative}\nМ.П.',
      }, 5),
    ];
  }
  const claimTitles: Record<string, string> = {
    lawsuit: 'На взыскание задолженности',
    eviction: 'На выселение в соответствии со ст. 80 ЖК',
    alienation: 'Понуждение к отчуждению жилого помещения (ст. 137 ЖК)',
  };
  return [
    mk({
      key: 'requisites', title: 'В суд и стороны', align: 'right', x: 40, y: 12, w: 56,
      text: 'В суд по месту нахождения жилого помещения\nИстец: {organization}, УНП {unp}\nАдрес истца: {address_org}\nФИО ответчика: {fio}\nИдентификационный номер: {personal_id}\nАдрес: {address}\nЛицевой счёт: {account}\nЦена иска: {amount} бел. руб.   Госпошлина: {duty} бел. руб.',
    }, 0),
    mk({
      key: 'block-title', title: 'Заголовок', align: 'center', bold: true, font_size: 14, y: 100,
      text: `ИСКОВОЕ ЗАЯВЛЕНИЕ\n(${claimTitles[blank] || 'На взыскание задолженности'})`,
    }, 1),
    mk({
      key: 'body', title: 'Текст иска', align: 'justify', y: 160,
      text: 'Ответчик {fio}, проживающий по адресу: {address} (лицевой счёт № {account}), имеет задолженность по плате за жилищно-коммунальные услуги ({services}) за период с {period_from} по {period_to} в общей сумме {amount} бел. руб., в том числе основной долг {principal} бел. руб. и пеня {penalty} бел. руб.\n\nПредупреждение о необходимости погашения задолженности вручено {warning_date} (срок погашения — {due_days} дней). В добровольном порядке задолженность не погашена.\n\nНа основании изложенного и руководствуясь жилищным и гражданским процессуальным законодательством Республики Беларусь, прошу суд удовлетворить заявленные исковые требования и взыскать с ответчика задолженность и судебные расходы.',
    }, 2),
    mk({
      key: 'table', title: 'Суммы задолженности', font_size: 11, y: 290, text: '',
      columns: [
        { title: 'Услуга', width: 44 },
        { title: 'Период долга', width: 26 },
        { title: 'Долг по услугам', width: 15 },
        { title: 'Долг по пене', width: 15 },
      ],
      rows: [['{services}', '{period_from} – {period_to}', '{principal}', '{penalty}']],
    }, 3),
    mk({
      key: 'signatory', title: 'Подпись и дата', y: 400,
      text: '{date}, исх. № {doc_number}\nПримечание: {note}\n\nПодпись уполномоченного _______________________ {organization}',
    }, 4),
  ];
}

export function bareToken(cell: string): string | null {
  const match = BARE_LINE.exec((cell || '').trim());
  return match ? match[1] : null;
}

export function cellKey(blockKey: string, row: number, col: number): string {
  return `c_${safe(blockKey)}_${row}_${col}`;
}

export function parseFlow(blockKey: string, text: string, asTitle: boolean): FlowNode[] {
  const id = safe(blockKey);
  const lines = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length === 1 && lines[0] === '') {
    return [{ kind: 'paragraph', parts: [{ kind: 'text', text: '', control: `${id}_text_0` }] }];
  }
  const nodes: FlowNode[] = [];
  let cursor = 0;
  let index = 0;
  if (asTitle && lines.length && isTitle(lines[0])) {
    nodes.push({ kind: 'title', control: `${id}_title`, text: lines[0] });
    cursor = 1;
  }
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line === '') {
      nodes.push({ kind: 'gap' });
      cursor += 1;
      continue;
    }
    if (classify(line) === 'text') {
      nodes.push({ kind: 'paragraph', parts: splitParts(line, `${id}_p${index}`) });
      index += 1;
      cursor += 1;
      continue;
    }
    const items: FieldItem[] = [];
    while (cursor < lines.length && lines[cursor] !== '' && classify(lines[cursor]) !== 'text') {
      items.push(fieldItem(lines[cursor], id, index));
      index += 1;
      cursor += 1;
    }
    nodes.push({ kind: 'fields', framed: isFramed(items), items });
  }
  return nodes;
}

export function serializeFlow(nodes: FlowNode[], form: FormGroup, mode: SheetMode): string {
  const lines: string[] = [];
  for (const node of nodes) {
    if (node.kind === 'gap') {
      lines.push('');
      continue;
    }
    if (node.kind === 'title') {
      lines.push(read(form, 'pieces', node.control));
      continue;
    }
    if (node.kind === 'fields') {
      for (const item of node.items) lines.push(serializeField(item, form, mode));
      continue;
    }
    lines.push(node.parts.map((part) => {
      if (part.kind === 'field') {
        if (mode === 'template') return `{${part.token}}`;
        return read(form, 'values', part.token) || `{${part.token}}`;
      }
      return read(form, 'pieces', part.control);
    }).join(''));
  }
  return lines.join('\n');
}

export class SheetEditor {
  flows: FlowBlock[] = [];
  form: FormGroup;

  constructor(private readonly fb: FormBuilder) {
    this.form = emptyForm(fb);
  }

  load(blocks: SheetBlock[]): void {
    const values: Record<string, string> = {};
    for (const token of KNOWN_TOKENS) values[token] = '';
    const pieces: Record<string, string> = {};
    const cells: Record<string, string> = {};
    this.flows = blocks.map((block) => ({
      key: block.key,
      nodes: parseFlow(block.key, block.text, block.key === 'body'),
    }));
    for (const flow of this.flows) {
      for (const node of flow.nodes) {
        if (node.kind === 'title') pieces[node.control] = node.text;
        if (node.kind === 'fields') {
          for (const item of node.items) {
            if (item.labelControl) pieces[item.labelControl] = item.label;
            if (!(item.token in values)) values[item.token] = '';
            if (item.literal) values[item.token] = item.value;
          }
        }
        if (node.kind === 'paragraph') {
          for (const part of node.parts) {
            if (part.kind === 'text') pieces[part.control] = part.text;
            else if (!(part.token in values)) values[part.token] = '';
          }
        }
      }
    }
    for (const block of blocks) {
      block.rows.forEach((row, rowIndex) => {
        row.forEach((cell, colIndex) => {
          const token = bareToken(cell);
          if (token) {
            if (!(token in values)) values[token] = '';
            return;
          }
          cells[cellKey(block.key, rowIndex, colIndex)] = cell;
        });
      });
      for (const token of tokensIn(block.text)) {
        if (!(token in values)) values[token] = '';
      }
    }
    this.form = this.fb.group({
      values: groupOf(this.fb, values),
      pieces: groupOf(this.fb, pieces),
      cells: groupOf(this.fb, cells),
    });
  }

  commit(blocks: SheetBlock[], mode: SheetMode): void {
    const rawValues = (this.form.get('values')?.getRawValue() || {}) as Record<string, string>;
    for (const block of blocks) {
      if (mode === 'filled') {
        block.text = fillTokens(block.text, rawValues);
        block.rows = block.rows.map((row) => row.map((cell) => fillTokens(cell, rawValues)));
      }
    }
  }

  fillEmpty(values: Record<string, string>): void {
    const group = this.form.get('values') as FormGroup | null;
    if (!group) return;
    for (const [key, value] of Object.entries(values)) {
      if (!value) continue;
      let control = group.get(key) as FormControl<string> | null;
      if (!control) {
        control = this.fb.nonNullable.control(value);
        group.addControl(key, control);
      } else if (!control.value) {
        control.setValue(value);
      }
    }
  }
}

function fillTokens(text: string, values: Record<string, string>): string {
  return (text || '').replace(/\{([a-z0-9_]+)\}/g, (full, token: string) => {
    const val = values[token];
    return val && val.trim() ? val : full;
  });
}

function serializeField(item: FieldItem, form: FormGroup, mode: SheetMode): string {
  const value = read(form, 'values', item.token);
  if (item.bare) {
    if (mode === 'template' || !value) return `{${item.token}}`;
    return `${FIELD_LABELS[item.token] || item.label}: ${value}`;
  }
  const label = (item.labelControl ? read(form, 'pieces', item.labelControl) : item.label).trim() || item.label;
  if (!item.literal && (mode === 'template' || !value)) return `${label}: {${item.token}}`;
  return `${label}: ${value}`;
}

function emptyForm(fb: FormBuilder): FormGroup {
  return fb.group({ values: fb.group({}), pieces: fb.group({}), cells: fb.group({}) });
}

function groupOf(fb: FormBuilder, data: Record<string, string>): FormGroup {
  const controls: Record<string, FormControl<string>> = {};
  for (const [key, value] of Object.entries(data)) controls[key] = fb.nonNullable.control(value);
  return fb.group(controls);
}

function read(form: FormGroup, group: string, name: string): string {
  return String(form.get([group, name])?.value ?? '');
}

function splitParts(line: string, prefix: string): Array<TextPart | FieldPart> {
  const parts: Array<TextPart | FieldPart> = [];
  const pattern = /\{([a-z0-9_]+)\}/g;
  let position = 0;
  let index = 0;
  for (const match of line.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > position) {
      parts.push({ kind: 'text', text: line.slice(position, start), control: `${prefix}_t${index}` });
      index += 1;
    }
    parts.push({ kind: 'field', token: match[1] });
    position = start + match[0].length;
  }
  if (position < line.length || !parts.length) {
    parts.push({ kind: 'text', text: line.slice(position), control: `${prefix}_t${index}` });
  }
  return parts;
}

function fieldItem(line: string, id: string, index: number): FieldItem {
  const bare = BARE_LINE.exec(line);
  if (bare) {
    return {
      label: FIELD_LABELS[bare[1]] || bare[1],
      token: bare[1],
      bare: true,
      literal: false,
      value: '',
      labelControl: '',
    };
  }
  const tokenLine = FIELD_LINE.exec(line);
  if (tokenLine) {
    return {
      label: tokenLine[1].trim(),
      token: tokenLine[2],
      bare: false,
      literal: false,
      value: '',
      labelControl: `${id}_label_${index}`,
    };
  }
  const filled = FILLED_LINE.exec(line);
  const label = (filled?.[1] || line).trim();
  const value = (filled?.[2] || '').trim();
  return {
    label,
    token: LABEL_TOKENS[label.toLowerCase()] || `extra_${id}_${index}`,
    bare: false,
    literal: true,
    value,
    labelControl: `${id}_label_${index}`,
  };
}

function isTitle(line: string): boolean {
  return line.length > 0 && line.length <= 90 && !line.includes('{') && classify(line) === 'text';
}

function classify(line: string): 'bare' | 'field' | 'filled' | 'text' {
  if (BARE_LINE.test(line)) return 'bare';
  if (FIELD_LINE.test(line)) return 'field';
  const filled = FILLED_LINE.exec(line);
  if (filled && !filled[2].includes('{') && !filled[2].includes(':')) return 'filled';
  return 'text';
}

function isFramed(items: FieldItem[]): boolean {
  return items.some((item) => {
    const label = item.label.toLowerCase();
    return item.token === 'fio' || item.token === 'address' || label === 'должник' || label === 'ответчик' || label.startsWith('адрес');
  });
}

function tokensIn(text: string): string[] {
  return [...(text || '').matchAll(/\{([a-z0-9_]+)\}/g)].map((match) => match[1]);
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '_') || 'block';
}
