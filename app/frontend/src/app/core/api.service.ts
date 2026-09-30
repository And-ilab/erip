import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  AccountDetail,
  AccountRow,
  DebtCharts,
  AccountService,
  ContractDossier,
  ContractPerson,
  ContractSummary,
  DialSettings,
  ApiError,
  AttachmentRow,
  BalanceRow,
  CalendarEvent,
  ContactRow,
  DebtorCategory,
  DisconnectCandidate,
  ErrorLogEntry,
  HistoryRow,
  KanbanColumn,
  MapLevel,
  MeasureDetail,
  MeasureGroup,
  MeasureMatrix,
  MeasureRow,
  MessageTemplate,
  ServiceChoice,
  Notification,
  Page,
  Payment,
  Registration,
  SavedFilter,
  WorkItem,
} from './models';

type Params = Record<string, string | number | boolean | null | undefined>;

function toParams(params: Params = {}): HttpParams {
  let result = new HttpParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') result = result.set(key, String(value));
  }
  return result;
}

function fieldErrors(details: unknown): string {
  if (!details || typeof details !== 'object') return '';
  return Object.entries(details as Record<string, unknown>)
    .map(([field, value]) => {
      const text = Array.isArray(value) ? value.join(', ') : String(value);
      return `${field}: ${text}`;
    })
    .join('; ');
}

export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as ApiError | undefined;
    if (body?.error) {
      const details = fieldErrors(body.error.details);
      const text = details ? `${body.error.message}: ${details}` : body.error.message;
      return `${text} (запрос ${body.error.request_id})`;
    }
    return `Ошибка ${error.status}`;
  }
  return 'Неизвестная ошибка';
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1';

  accounts(params: Params): Observable<Page<AccountRow>> {
    return this.http.get<Page<AccountRow>>(`${this.base}/accounts/`, { params: toParams(params) });
  }

  charts(): Observable<DebtCharts> {
    return this.http.get<DebtCharts>(`${this.base}/accounts/charts/`);
  }

  account(id: number): Observable<AccountDetail> {
    return this.http.get<AccountDetail>(`${this.base}/accounts/${id}/`);
  }

  updateAccount(id: number, body: Partial<AccountDetail>): Observable<AccountDetail> {
    return this.http.patch<AccountDetail>(`${this.base}/accounts/${id}/`, body);
  }

  updateAccountGroup(id: number, group: number | null, reason: string): Observable<AccountDetail> {
    return this.updateAccount(id, { debt_group_manual: group, debt_group_manual_reason: reason });
  }

  accountContacts(id: number): Observable<Page<ContactRow>> {
    return this.http.get<Page<ContactRow>>(`${this.base}/accounts/${id}/contacts/`, { params: toParams({ page_size: 200 }) });
  }

  accountHistory(id: number): Observable<Page<HistoryRow>> {
    return this.http.get<Page<HistoryRow>>(`${this.base}/accounts/${id}/status-history/`, { params: toParams({ page_size: 200 }) });
  }

  accountBalances(id: number): Observable<Page<BalanceRow>> {
    return this.http.get<Page<BalanceRow>>(`${this.base}/accounts/${id}/balance-history/`, { params: toParams({ page_size: 200 }) });
  }

  accountWork(id: number, params: Params = {}): Observable<Page<WorkItem>> {
    return this.http.get<Page<WorkItem>>(`${this.base}/accounts/${id}/work-items/`, { params: toParams({ page_size: 200, ...params }) });
  }

  accountFiles(id: number): Observable<Page<AttachmentRow>> {
    return this.http.get<Page<AttachmentRow>>(`${this.base}/accounts/${id}/attachments/`, { params: toParams({ page_size: 200 }) });
  }

  refreshAccount(id: number): Observable<{ id: number; status: string }> {
    return this.http.post<{ id: number; status: string }>(`${this.base}/accounts/${id}/refresh/`, {});
  }

  kanban(params: Params): Observable<KanbanColumn[]> {
    return this.http.get<KanbanColumn[]>(`${this.base}/accounts/kanban/`, { params: toParams(params) });
  }

  accountMap(params: Params): Observable<MapLevel> {
    return this.http.get<MapLevel>(`${this.base}/accounts/map/`, { params: toParams(params) });
  }

  calendar(month: string, params: Params): Observable<CalendarEvent[]> {
    return this.http.get<CalendarEvent[]>(`${this.base}/accounts/calendar/`, { params: toParams({ ...params, month }) });
  }

  exportAccounts(params: Params): Observable<Blob> {
    return this.http.get(`${this.base}/accounts/export/`, { params: toParams(params), responseType: 'blob' });
  }

  columns(): Observable<{ columns: string[]; available: string[] }> {
    return this.http.get<{ columns: string[]; available: string[] }>(`${this.base}/accounts/columns/`);
  }

  saveColumns(columns: string[]): Observable<{ columns: string[]; available: string[] }> {
    return this.http.put<{ columns: string[]; available: string[] }>(`${this.base}/accounts/columns/`, { columns });
  }

  contracts(params: Params): Observable<Page<AccountService>> {
    return this.http.get<Page<AccountService>>(`${this.base}/contracts/`, { params: toParams(params) });
  }

  contract(id: number): Observable<AccountService> {
    return this.http.get<AccountService>(`${this.base}/contracts/${id}/`);
  }

  contractSummary(params: Params): Observable<ContractSummary> {
    return this.http.get<ContractSummary>(`${this.base}/contracts/summary/`, { params: toParams(params) });
  }

  contractPersons(params: Params): Observable<Page<ContractPerson>> {
    return this.http.get<Page<ContractPerson>>(`${this.base}/contracts/persons/`, { params: toParams(params) });
  }

  contractKanban(params: Params): Observable<{ stage: string; title: string; total: number; cards: ContractPerson[] }[]> {
    return this.http.get<{ stage: string; title: string; total: number; cards: ContractPerson[] }[]>(
      `${this.base}/contracts/kanban/`, { params: toParams(params) },
    );
  }

  contractCalendar(month: string, params: Params): Observable<CalendarEvent[]> {
    return this.http.get<CalendarEvent[]>(`${this.base}/contracts/calendar/`, { params: toParams({ ...params, month }) });
  }

  contractGrouped(params: Params): Observable<{ value: string; accounts: number; debt: string | null; penalty: string | null }[]> {
    return this.http.get<{ value: string; accounts: number; debt: string | null; penalty: string | null }[]>(
      `${this.base}/contracts/grouped/`, { params: toParams(params) },
    );
  }

  contractDossier(id: number): Observable<ContractDossier> {
    return this.http.get<ContractDossier>(`${this.base}/contracts/${id}/dossier/`);
  }

  saveRegistration(id: number, body: Partial<Registration>): Observable<Registration> {
    return this.http.patch<Registration>(`${this.base}/registrations/${id}/`, body);
  }

  confirmMeasure(id: number, action: 'suspend' | 'resume', source: 'pm' | 'ais'): Observable<MeasureRow> {
    return this.http.post<MeasureRow>(`${this.base}/measures/${id}/confirm/`, { action, source });
  }

  dialSettings(): Observable<DialSettings> {
    return this.http.get<DialSettings>(`${this.base}/nsi/calculation-settings/`);
  }

  saveDialSettings(body: Partial<DialSettings>): Observable<DialSettings> {
    return this.http.patch<DialSettings>(`${this.base}/nsi/calculation-settings/current/`, body);
  }

  httpPatchContract(id: number, group: number | null, reason: string): Observable<AccountService> {
    return this.http.patch<AccountService>(`${this.base}/contracts/${id}/`, {
      debt_group_manual: group,
      debt_group_manual_reason: reason,
    });
  }

  saveContact(body: Partial<ContactRow> & { account?: number }): Observable<ContactRow> {
    return body.id
      ? this.http.patch<ContactRow>(`${this.base}/contacts/${body.id}/`, body)
      : this.http.post<ContactRow>(`${this.base}/contacts/`, body);
  }

  deleteContact(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/contacts/${id}/`);
  }

  saveWork(body: Partial<WorkItem> & { account: number }): Observable<WorkItem> {
    return this.http.post<WorkItem>(`${this.base}/work-items/`, body);
  }

  uploadFile(account: number, docType: string, file: File): Observable<AttachmentRow> {
    const data = new FormData();
    data.set('account', String(account));
    data.set('doc_type', docType);
    data.set('file', file);
    return this.http.post<AttachmentRow>(`${this.base}/attachments/`, data);
  }

  measures(): Observable<Page<MeasureRow>> {
    return this.http.get<Page<MeasureRow>>(`${this.base}/measures/`, { params: toParams({ page_size: 200 }) });
  }

  measureRegistry(params: Params = {}): Observable<{ groups: MeasureGroup[]; total: number }> {
    return this.http.get<{ groups: MeasureGroup[]; total: number }>(`${this.base}/measures/registry/`, { params: toParams(params) });
  }

  measureMatrix(params: Params = {}): Observable<MeasureMatrix> {
    return this.http.get<MeasureMatrix>(`${this.base}/measures/matrix/`, { params: toParams(params) });
  }

  createMeasure(body: Record<string, unknown>): Observable<MeasureRow> {
    return this.http.post<MeasureRow>(`${this.base}/measures/`, body);
  }

  measure(id: number): Observable<MeasureDetail> {
    return this.http.get<MeasureDetail>(`${this.base}/measures/${id}/`);
  }

  /** Результат по одному ЛС: обзвон передаёт call_result, остальные виды — status. */
  recordMeasureItem(id: number, body: Record<string, unknown>): Observable<MeasureDetail> {
    return this.http.post<MeasureDetail>(`${this.base}/measures/${id}/result/`, body);
  }

  deliverWarning(id: number, body: Record<string, unknown>): Observable<MeasureDetail> {
    return this.http.post<MeasureDetail>(`${this.base}/measures/${id}/deliver/`, body);
  }

  sendNotices(id: number, itemIds: number[]): Observable<MeasureDetail> {
    return this.http.post<MeasureDetail>(`${this.base}/measures/${id}/send/`, { item_ids: itemIds });
  }

  acceptMeasure(id: number): Observable<MeasureDetail> {
    return this.http.post<MeasureDetail>(`${this.base}/measures/${id}/accept/`, {});
  }

  approveMeasure(id: number, note: string): Observable<MeasureDetail> {
    return this.http.post<MeasureDetail>(`${this.base}/measures/${id}/approve/`, { note });
  }

  rejectMeasure(id: number, note: string): Observable<MeasureDetail> {
    return this.http.post<MeasureDetail>(`${this.base}/measures/${id}/reject/`, { note });
  }

  cancelMeasure(id: number, reason: string): Observable<MeasureDetail> {
    return this.http.post<MeasureDetail>(`${this.base}/measures/${id}/cancel/`, { reason });
  }

  readyToDisconnect(): Observable<{ results: DisconnectCandidate[] }> {
    return this.http.get<{ results: DisconnectCandidate[] }>(`${this.base}/measures/ready-to-disconnect/`);
  }

  grouped(params: Params): Observable<{ value: string; accounts: number; debt: string | null }[]> {
    return this.http.get<{ value: string; accounts: number; debt: string | null }[]>(`${this.base}/accounts/grouped/`, { params: toParams(params) });
  }

  accountMeasures(id: number): Observable<Page<MeasureRow>> {
    return this.http.get<Page<MeasureRow>>(`${this.base}/accounts/${id}/measures/`, { params: toParams({ page_size: 200 }) });
  }

  writChecks(id: number): Observable<{ code: string; title: string; done: boolean }[]> {
    return this.http.get<{ code: string; title: string; done: boolean }[]>(`${this.base}/accounts/${id}/writ-checks/`);
  }

  saveWritCheck(id: number, code: string, done: boolean): Observable<{ code: string; title: string; done: boolean }[]> {
    return this.http.post<{ code: string; title: string; done: boolean }[]>(`${this.base}/accounts/${id}/writ-checks/`, { code, done });
  }

  saveCategory(body: { code: string; name: string }): Observable<DebtorCategory> {
    return this.http.post<DebtorCategory>(`${this.base}/nsi/debtor-categories/`, body);
  }

  deleteCategory(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/nsi/debtor-categories/${id}/`);
  }

  categories(): Observable<Page<DebtorCategory>> {
    return this.http.get<Page<DebtorCategory>>(`${this.base}/nsi/debtor-categories/`, { params: toParams({ page_size: 100 }) });
  }

  savedFilters(target: string): Observable<Page<SavedFilter>> {
    return this.http.get<Page<SavedFilter>>(`${this.base}/saved-filters/`, { params: toParams({ target }) });
  }

  saveFilter(body: Partial<SavedFilter>): Observable<SavedFilter> {
    return this.http.post<SavedFilter>(`${this.base}/saved-filters/`, body);
  }

  accountServices(id: number, withDebt = false): Observable<Page<AccountService>> {
    return this.http.get<Page<AccountService>>(`${this.base}/accounts/${id}/services/`, {
      params: toParams({ page_size: 200, with_debt: withDebt ? 1 : null }),
    });
  }

  accountPayments(id: number): Observable<Page<Payment>> {
    return this.http.get<Page<Payment>>(`${this.base}/accounts/${id}/payments/`, { params: toParams({ page_size: 200 }) });
  }

  accountRegistrations(id: number): Observable<Page<Registration>> {
    return this.http.get<Page<Registration>>(`${this.base}/accounts/${id}/registrations/`, { params: toParams({ page_size: 200 }) });
  }

  notifications(params: Params): Observable<Page<Notification>> {
    return this.http.get<Page<Notification>>(`${this.base}/notifications/`, { params: toParams(params) });
  }

  unreadCount(): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(`${this.base}/notifications/unread-count/`);
  }

  markRead(id: number): Observable<Notification> {
    return this.http.post<Notification>(`${this.base}/notifications/${id}/mark-read/`, {});
  }

  createNotification(body: Partial<Notification> & { account?: number; context?: Record<string, unknown> }): Observable<Notification> {
    return this.http.post<Notification>(`${this.base}/notifications/`, body);
  }

  serviceChoices(): Observable<{ results: ServiceChoice[] }> {
    return this.http.get<{ results: ServiceChoice[] }>(`${this.base}/services/choices/`);
  }

  templates(params: Params = {}): Observable<Page<MessageTemplate>> {
    return this.http.get<Page<MessageTemplate>>(`${this.base}/templates/`, { params: toParams(params) });
  }

  saveTemplate(template: Partial<MessageTemplate>): Observable<MessageTemplate> {
    return template.id
      ? this.http.patch<MessageTemplate>(`${this.base}/templates/${template.id}/`, template)
      : this.http.post<MessageTemplate>(`${this.base}/templates/`, template);
  }

  deleteTemplate(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/templates/${id}/`);
  }

  restoreTemplate(id: number): Observable<MessageTemplate> {
    return this.http.post<MessageTemplate>(`${this.base}/templates/${id}/restore/`, {});
  }

  previewTemplate(id: number, userName: string, body?: string, context: Record<string, unknown> = {}): Observable<{ text: string }> {
    return this.http.post<{ text: string }>(`${this.base}/templates/${id}/preview/`, { user_name: userName, body, context });
  }

  errors(params: Params): Observable<Page<ErrorLogEntry>> {
    return this.http.get<Page<ErrorLogEntry>>(`${this.base}/audit/errors/`, { params: toParams(params) });
  }

  claims(): Observable<{ results: ClaimCase[]; stages: Named[] }> {
    return this.http.get<{ results: ClaimCase[]; stages: Named[] }>(`${this.base}/claims/`);
  }

  claim(id: number): Observable<ClaimCase> {
    return this.http.get<ClaimCase>(`${this.base}/claims/${id}/`);
  }

  openClaim(account: number): Observable<ClaimCase> {
    return this.http.post<ClaimCase>(`${this.base}/claims/`, { account });
  }

  patchClaim(id: number, body: Partial<ClaimCase>): Observable<ClaimCase> {
    return this.http.patch<ClaimCase>(`${this.base}/claims/${id}/`, body);
  }

  claimAction(id: number, action: string, body: object = {}): Observable<ClaimCase> {
    return this.http.post<ClaimCase>(`${this.base}/claims/${id}/${action}/`, body);
  }

  scenarios(): Observable<Page<ScenarioRow>> {
    return this.http.get<Page<ScenarioRow>>(`${this.base}/nsi/scenarios/`);
  }

  saveScenario(row: Partial<ScenarioRow>): Observable<ScenarioRow> {
    return row.id
      ? this.http.patch<ScenarioRow>(`${this.base}/nsi/scenarios/${row.id}/`, row)
      : this.http.post<ScenarioRow>(`${this.base}/nsi/scenarios/`, row);
  }

  publishScenario(id: number, applyToRunning = false): Observable<{ version: number; warnings: string[]; moved: number }> {
    return this.http.post<{ version: number; warnings: string[]; moved: number }>(
      `${this.base}/nsi/scenarios/${id}/publish/`, { apply_to_running: applyToRunning },
    );
  }

  restoreScenario(id: number, version: number, applyToRunning = false): Observable<ScenarioRow & { warnings: string[]; moved: number }> {
    return this.http.post<ScenarioRow & { warnings: string[]; moved: number }>(
      `${this.base}/nsi/scenarios/${id}/restore/`, { version, apply_to_running: applyToRunning },
    );
  }

  copyScenario(id: number): Observable<ScenarioRow> {
    return this.http.post<ScenarioRow>(`${this.base}/nsi/scenarios/${id}/copy/`, {});
  }

  assignScenario(id: number, body: object): Observable<{ version: number; current_version: number; paused: boolean }> {
    return this.http.post<{ version: number; current_version: number; paused: boolean }>(
      `${this.base}/nsi/scenarios/${id}/assign/`, body,
    );
  }

  printForms(): Observable<Page<PrintFormRow>> {
    return this.http.get<Page<PrintFormRow>>(`${this.base}/nsi/print-forms/`);
  }

  savePrintForm(row: Partial<PrintFormRow>): Observable<PrintFormRow> {
    return row.id
      ? this.http.patch<PrintFormRow>(`${this.base}/nsi/print-forms/${row.id}/`, row)
      : this.http.post<PrintFormRow>(`${this.base}/nsi/print-forms/`, row);
  }

  restorePrintForm(id: number, version: number): Observable<PrintFormRow> {
    return this.http.post<PrintFormRow>(`${this.base}/nsi/print-forms/${id}/restore/`, { version });
  }

  renderPrintForm(id: number, account: number, tariff = ''): Observable<{ text: string; version: number }> {
    return this.http.post<{ text: string; version: number }>(`${this.base}/nsi/print-forms/${id}/render/`, { account, tariff });
  }
}

export interface Named { id: string; label: string }

export interface ClaimCase {
  id: number;
  account: number;
  client_account: string;
  short_fio: string;
  account_address: string;
  debt_group: number | null;
  rating: string;
  penalty: string | null;
  specialist: string;
  balance_out: string | null;
  stage: string;
  stage_label: string;
  warning_delivered_on: string | null;
  notary_tariff: string | null;
  application_withdrawn: boolean;
  submission_id: string;
  submission_mode: string;
  notary_note: string;
  lawsuit_number: string;
  lawsuit_kind: string;
  lawsuit_filed_on: string | null;
  state_duty: string | null;
  defendant_name: string;
  package_filed_on: string | null;
  lawsuit_note: string;
  court_status: string;
  opi_number: string;
  opi_status: string;
  opi_mode: string;
  tariff_received: boolean;
  ais_debt_cleared: boolean;
  eviction_stage: string;
  skip_reason: string;
  writeoff_status: string;
  writeoff_note: string;
  files: { id: number; doc_type: string; name: string; role: string }[];
  acts: { id: number; title: string }[];
  acts_count: number;
  approvals: { id: number; approver_id: number; approver_name: string; decision: string; reason: string }[];
  blockers: string[];
  events: { old_stage: string; new_stage: string; reason: string; actor: string; at: string }[];
  approver_choices?: { id: number; name: string; role: string }[];
  lawsuit_kinds?: Named[];
  stages?: Named[];
}

export interface ScenarioStep {
  order: number;
  action: string;
  wait_days?: number;
  template?: string;
  approval?: boolean;
  branch_group?: number | null;
  person?: string;
  has_phone?: boolean | null;
  terminal?: boolean;
}

export interface VersionRow {
  version: number;
  at: string;
  author?: string;
}

export interface ScenarioRow {
  id: number;
  name: string;
  status: string;
  version: number;
  steps: ScenarioStep[];
  organization: number | null;
  is_active: boolean;
  revisions?: VersionRow[];
}

export interface PrintFormRow {
  id: number;
  code: string;
  name: string;
  doc_kind: string;
  body: string;
  version: number;
  organization: number | null;
  revisions?: VersionRow[];
}
