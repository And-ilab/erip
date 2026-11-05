import { Registration } from '../core/models';

/** Колонки вкладки «Регистрация» — один набор для карточки ЛС и карточки договора. */
export const REGISTRATION_COLUMNS = [
  'payer', 'registered', 'beneficiary', 'fam', 'im', 'ot', 'check_in_date', 'check_out_date',
  'date_registration', 'passport_out', 'move_reason', 'reg_type_name', 'relation', 'family',
  'birthday', 'death', 'sex', 'doc', 'doc_num', 'doc_date', 'doc_organ', 'doc_basis', 'doc_code',
  'personal_num', 'citizenship', 'nationality', 'address', 'work', 'position', 'tab_number', 'salary',
  'account_id', 'person_id', 'registration_id', 'legal', 'unp', 'parent_id', 'parent_name',
  'social_note', 'marital', 'rent', 'social_category', 'unemployed', 'left_country',
  'bank_code', 'bank_name', 'bank_account', 'payer_reg_id', 'payer_name', 'payer_share', 'payer_type',
  'tenant_free', 'doc1', 'share1', 'doc2', 'share2', 'doc3', 'share3', 'heritage',
  'heritage_accept', 'heritage_open', 'heritage_close', 'phone', 'email', 'joint_owner',
  'cnt_benefit', 'cnt_rent', 'cnt_minor', 'cnt_temp', 'cnt_unreg', 'cnt_absent',
  'cnt_distant', 'cnt_close', 'cnt_people', 'cnt_payers', 'cnt_pets',
];

const LABELS: Record<string, string> = {
  payer: 'Плательщик', registered: 'Зарегистрирован', beneficiary: 'Льготник',
  fam: 'Фамилия', im: 'Имя', ot: 'Отчество', check_in_date: 'Дата прибытия', check_out_date: 'Дата убытия',
  date_registration: 'Дата регистрации по паспорту', passport_out: 'Дата снятия с учёта по паспорту',
  move_reason: 'Причина прибытия/выбытия', reg_type_name: 'Тип регистрации', relation: 'Родственные отношения',
  family: 'Является членом семьи', birthday: 'Дата рождения', death: 'Дата смерти', sex: 'Пол',
  doc: 'Осн. документ', doc_num: 'Серия и номер', doc_date: 'Дата выдачи', doc_organ: 'Кем выдан',
  doc_basis: 'Основание выдачи паспорта', doc_code: 'Цифровой код органа', personal_num: 'Идентификационный номер паспорта (ИДН)',
  citizenship: 'Гражданство', nationality: 'Национальность', address: 'Адрес местожительства',
  work: 'Наименование предприятия', position: 'Должность', tab_number: 'Табельный номер', salary: 'Зачислять оплату из зарплаты',
  account_id: 'ID ЛС', person_id: 'ID лица', registration_id: 'ID регистрации лица', legal: 'Юр.лицо', unp: 'УНП',
  parent_id: 'ID родителя', parent_name: 'ФИО родителя', social_note: 'Социальное примечание', marital: 'Семейное положение',
  rent: 'Наличие договора найма', social_category: 'Социальная категория граждан', unemployed: 'Незанятые в экономике',
  left_country: 'Незанятые, выехавшие за пределы РБ', bank_code: 'Код банка', bank_name: 'Наименование банка',
  bank_account: 'Расчетный счет', payer_reg_id: 'Код регистрации плательщика', payer_name: 'ФИО плательщика',
  payer_share: 'Доля плательщика', payer_type: 'Наименование типа плательщика', tenant_free: 'Является нанимателем без оплаты ЖКУ',
  doc1: 'Наименование документа 1', share1: 'Доля по документу 1', doc2: 'Наименование документа 2', share2: 'Доля по документу 2',
  doc3: 'Наименование документа 3', share3: 'Доля по документу 3', heritage: 'Способ перехода прав',
  heritage_accept: 'Дата принятия наследства', heritage_open: 'Дата начала открытия наследства',
  heritage_close: 'Дата окончания открытия наследства', phone: 'Контактный телефон', email: 'E-mail',
  joint_owner: 'ФИО участника совместной собственности', cnt_benefit: 'Кол-во льготников',
  cnt_rent: 'Кол-во проживающих по договору найма', cnt_minor: 'Кол-во несовершеннолетних',
  cnt_temp: 'Кол-во зарег. по месту пребывания', cnt_unreg: 'Кол-во проживающих без регистрации',
  cnt_absent: 'Кол-во временно отсутствующих', cnt_distant: 'Кол-во зарег. неблизких родственников',
  cnt_close: 'Кол-во зарег. близких родственников', cnt_people: 'Кол-во человек (всех)',
  cnt_payers: 'Кол-во плательщиков', cnt_pets: 'Кол-во домашних питомцев',
};

export function registrationLabel(col: string): string {
  return LABELS[col] || col;
}

export interface RegistrationCellContext {
  accountId: number | string | null | undefined;
  privCount: number | null | undefined;
  subjCount: number | null | undefined;
  payerCount: number;
  showDate: (value: string | null | undefined) => string;
}

export function registrationCell(person: Registration, col: string, ctx: RegistrationCellContext): string {
  const yn = (value: boolean | number | null | undefined) => value ? 'да' : 'нет';
  const sheet = (label: string) => (person.sheet || []).find((field) => field.label.toLowerCase().includes(label.toLowerCase()))?.value || '';
  if (col === 'payer') return yn(person.subj_is_main);
  if (col === 'registered') {
    const removed = person.subj_is_check_out || sheet('снят').startsWith('1') || sheet('снят') === 'да';
    if (removed) return 'нет';
    const status = sheet('статус регистрации');
    if (status === '0' || status === 'нет') return 'нет';
    return 'да';
  }
  if (col === 'beneficiary') return yn(sheet('льгот').startsWith('1') || sheet('льгот') === 'да');
  if (col === 'fam') return person.full_name.split(' ')[0] || sheet('фамилия') || '—';
  if (col === 'im') return person.full_name.split(' ')[1] || '—';
  if (col === 'ot') return person.full_name.split(' ').slice(2).join(' ') || '—';
  if (col === 'relation') return person.relation_degree_name || '—';
  if (col === 'family') return yn(person.is_close_relative);
  if (col === 'birthday') return ctx.showDate(person.birthday) || '—';
  if (col === 'doc') return person.maindoc_type_name || '—';
  if (col === 'account_id') return ctx.accountId == null ? '—' : String(ctx.accountId);
  if (col === 'person_id') return sheet('код лица') || '—';
  if (col === 'registration_id') return sheet('код регистрации') || '—';
  if (col === 'legal') return yn(person.subj_legal_entity);
  if (col === 'unp') return sheet('унп') || sheet('учетный номер') || '—';
  if (col === 'parent_id') return sheet('код родителя') || '—';
  if (col === 'phone') return person.contact_phone || '—';
  if (col === 'email') return person.email || '—';
  if (col === 'cnt_benefit') return ctx.privCount == null ? '—' : String(ctx.privCount);
  if (col === 'cnt_people') return ctx.subjCount == null ? '—' : String(ctx.subjCount);
  if (col === 'cnt_payers') return String(ctx.payerCount);
  if (col === 'cnt_pets') return sheet('питом') || '—';
  const needles: Record<string, string> = {
    check_in_date: 'прибытия', check_out_date: 'убытия', date_registration: 'регистрации по паспорту',
    passport_out: 'снятия с учёта', move_reason: 'причина', death: 'смерти', sex: 'пол',
    doc_num: 'серия', doc_date: 'выдачи', doc_organ: 'кем выдан', doc_basis: 'основание выдачи',
    doc_code: 'цифровой код', personal_num: 'идентификационный', citizenship: 'гражданство',
    nationality: 'национальность', address: 'местожительства', work: 'предприятия', position: 'должность',
    tab_number: 'табельный', salary: 'зарплат', parent_name: 'фио родителя', social_note: 'социальное примечание',
    marital: 'семейное', rent: 'найма', unemployed: 'незанятые в экономике', left_country: 'выехав',
    bank_code: 'код банка', bank_name: 'наименование банка', bank_account: 'расчетный',
    payer_reg_id: 'код регистрации плательщика', payer_name: 'фио плательщика', payer_share: 'доля плательщика',
    payer_type: 'типа плательщика', tenant_free: 'нанимателем', doc1: 'документа 1', share1: 'документу 1',
    doc2: 'документа 2', share2: 'документу 2', doc3: 'документа 3', share3: 'документу 3',
    heritage: 'перехода прав', heritage_accept: 'принятия наследства', heritage_open: 'начала открытия',
    heritage_close: 'окончания открытия', joint_owner: 'совместной', cnt_rent: 'договору найма',
    cnt_minor: 'несовершеннолет', cnt_temp: 'пребывания', cnt_unreg: 'без регистрации',
    cnt_absent: 'отсутств', cnt_distant: 'неблизк', cnt_close: 'близких',
  };
  const found = sheet(needles[col] || registrationLabel(col));
  if (!found) return '—';
  if (found === '1') return 'да';
  if (found === '0') return 'нет';
  return found;
}
