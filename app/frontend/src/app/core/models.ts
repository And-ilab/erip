export interface Page<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface ApiError {
  error: { code: string; message: string; details: unknown; request_id: string };
}

export type Role = 'superadmin' | 'local_admin' | 'specialist' | 'observer';

export interface Me {
  id: number;
  username: string;
  display_name: string;
  email: string;
  role: Role;
  contour: 'billing' | 'supplier';
  organization: number | null;
  organization_name: string | null;
}

export interface AccountRow {
  id: number;
  account_id: number;
  client_account: string;
  unified_account: number | null;
  provider_short_name: string;
  account_address: string;
  short_fio: string;
  payer_identifier: string;
  payer_unp: string;
  balance_out: string | null;
  debt_group: number | null;
  effective_group: number | null;
  rating_label: string;
  debt_started_on: string | null;
  scenario_name: string;
  assigned_name: string;
  ownership_type_name: string;
  months_debt: number | null;
  subj_count: number | null;
  funnel_stage: string;
  services_count: number;
  debt_total: string | null;
  mulct_total: string | null;
  warning_due: string | null;
  claim_due: string | null;
  updated_at: string;
  ais_updated_at: string | null;
  operational_date: string | null;
  inheritance_case: boolean;
}

export interface AccountDetail extends AccountRow {
  schema_name: string;
  house_address: string;
  flat_number: string;
  acc_total_space: string | null;
  room_count: number | null;
  category_name: string;
  phone: string;
  contact_phone: string;
  start_date: string | null;
  stop_date: string | null;
  balance_in: string | null;
  total_calc_sum: string | null;
  pay_sum: string | null;
  debt_group_manual: number | null;
  debt_group_manual_reason: string;
  group_name: string;
  assigned_to: number | null;
  contact_source_mode: string;
  debtor_category: number | null;
  inheritance_until: string | null;
  residence_note: string;
  bankruptcy: boolean;
}

export interface AccountService {
  id: number;
  account: number;
  service_list_id: number;
  service_name: string;
  shot_name: string;
  full_name: string;
  provider_id: number | null;
  balance_in: string | null;
  balance_out: string | null;
  balance_mulct_out: string | null;
  overdue_debt: string | null;
  debt_period: number | null;
  debt_group: number | null;
  effective_group: number | null;
  debt_started_on: string | null;
  scenario_name: string;
  initial_principal: string | null;
  initial_penalty: string | null;
  last_payment_date: string | null;
  start_date: string | null;
  account_number: string;
  address: string;
  payer: string;
  payer_identifier: string;
  category_name: string;
  rating_label: string;
}

export interface ContactRow {
  id: number;
  kind: string;
  value: string;
  priority: number;
  source: string;
  ais_updated_at: string | null;
}

export interface HistoryRow {
  id: number;
  kind: string;
  old_value: string;
  new_value: string;
  reason: string;
  author_name: string;
  service_name: string;
  created_at: string;
}

export interface BalanceRow {
  id: number;
  service_name: string;
  period: string;
  principal: string | null;
  penalty: string | null;
}

export interface WorkItem {
  id: number;
  kind: string;
  kind_display: string;
  title: string;
  started_on: string | null;
  ended_on: string | null;
  principal: string | null;
  penalty: string | null;
  paid_principal: string | null;
  paid_penalty: string | null;
  note: string;
}

export interface AttachmentRow {
  id: number;
  doc_type: string;
  original_name: string;
  created_at: string;
}

export interface MeasureRow {
  id: number;
  kind: string;
  kind_display: string;
  status: string;
  status_display: string;
  due_on: string | null;
  accounts_count: number;
  artifact?: string;
  skipped_inheritance?: number[];
}

export interface DebtorCategory {
  id: number;
  code: string;
  name: string;
  note: string;
}

export interface SavedFilter {
  id: number;
  name: string;
  target: string;
  query: Record<string, string | number | boolean | null>;
}

export interface CalendarEvent {
  date: string;
  kind: string;
  title: string;
  account_id: number | null;
}

export interface KanbanColumn {
  stage: string;
  title: string;
  total: number;
  cards: AccountRow[];
}

export interface Payment {
  id: number;
  receipt_id: number;
  pay_date: string | null;
  service_name: string;
  pay_service_summ: string | null;
  pay_mulct_summ: string | null;
  bank_name: string;
  payment_type_display: string;
}

export interface Registration {
  id: number;
  full_name: string;
  birthday: string | null;
  relation_degree_name: string;
  reg_type_name: string;
  subj_is_main: boolean;
  debtor_role: string;
  contact_phone: string;
  email: string;
  subj_death_date: string | null;
}

export type Channel = 'inbox' | 'email' | 'sms' | 'voice';

export interface MessageTemplate {
  id: number;
  organization: number | null;
  is_central: boolean;
  code: string;
  name: string;
  channel: Channel;
  channel_display: string;
  subject: string;
  body: string;
  debt_group: number | null;
  is_active: boolean;
}

export interface Notification {
  id: number;
  channel: Channel;
  channel_display: string;
  template: number | null;
  body: string;
  recipient_name: string;
  recipient_address: string;
  status: 'new' | 'queued' | 'sent' | 'failed';
  status_display: string;
  rendered_text: string;
  error: string;
  request_id: string;
  is_read: boolean;
  created_at: string;
}

export interface ErrorLogEntry {
  id: number;
  service: string;
  request_id: string;
  path: string;
  error_type: string;
  message: string;
  traceback: string;
  created_at: string;
}
