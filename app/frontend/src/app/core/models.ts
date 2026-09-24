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
  balance_out: string | null;
  debt_group: number | null;
  effective_group: number | null;
  services_count: number;
  debt_total: string | null;
  updated_at: string;
}

export interface AccountDetail extends AccountRow {
  schema_name: string;
  house_address: string;
  flat_number: string;
  acc_total_space: string | null;
  room_count: number | null;
  subj_count: number | null;
  ownership_type_name: string;
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
}

export interface AccountService {
  id: number;
  service_name: string;
  shot_name: string;
  balance_in: string | null;
  balance_out: string | null;
  balance_mulct_out: string | null;
  overdue_debt: string | null;
  debt_period: number | null;
  debt_group: number | null;
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
