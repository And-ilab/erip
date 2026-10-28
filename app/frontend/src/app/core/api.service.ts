import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import {
  AccountDetail,
  AccountRow,
  ActivityBoard,
  DebtShare,
  DebtCharts,
  AccountService,
  ContractDossier,
  ContractPerson,
  ContractSummary,
  DialSettings,
  ApiError,
  AttachmentRow,
  ScenarioBoard,
  WritDraft,
  BalanceRow,
  CalendarEvent,
  ContactRow,
  DebtorCategory,
  DisconnectCandidate,
  ErrorLogEntry,
  ImportJob,
  OrganizationOption,
  DirectoryUser,
  ServiceOrganizationOption,
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

function detailText(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return summarize(value);
  if (typeof value === 'object') return objectText(value as Record<string, unknown>);
  return String(value);
}

function objectText(row: Record<string, unknown>): string {
  if (typeof row['reason'] === 'string') {
    return row['client_account'] ? `ЛС ${row['client_account']}: ${row['reason']}` : row['reason'];
  }
  return Object.entries(row).map(([key, item]) => `${key}: ${detailText(item)}`).join(', ');
}

/** Одинаковые причины пропуска сворачиваются: «Нет номера +375 (27)». */
function summarize(values: unknown[]): string {
  const reasons = new Map<string, number>();
  for (const item of values) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return values.map(detailText).join(', ');
    const reason = (item as Record<string, unknown>)['reason'];
    if (typeof reason !== 'string') return values.map(detailText).join(', ');
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  return [...reasons.entries()]
    .map(([reason, count]) => (count > 1 ? `${reason} (${count})` : reason))
    .join('; ');
}

function fieldErrors(details: unknown): string {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return '';
  return Object.entries(details as Record<string, unknown>)
    .map(([field, value]) => `${field}: ${detailText(value)}`)
    .join('; ');
}

export interface ColumnPrefs {
  columns: string[];
  available: string[];
  order?: string[];
  board?: string;
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

/** Закрытый переход воронки: что сделать и на какую вкладку карточки вести. */
export interface FunnelGateInfo {
  message: string;
  actions: string[];
  tab: string;
  tabLabel: string;
  accountId: number | null;
  claimId: number | null;
  measureId: number | null;
  focus: string;
}

const CLAIM_TABS = new Set(['pack', 'notary', 'court', 'opi', 'writeoff']);

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function funnelGate(error: unknown): FunnelGateInfo | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  const body = error.error as ApiError | undefined;
  if (body?.error?.code !== 'funnel_gate') return null;
  const details = body.error.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const row = details as Record<string, unknown>;
  const actions = Array.isArray(row['actions'])
    ? row['actions'].filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
  return {
    message: body.error.message,
    actions,
    tab: typeof row['tab'] === 'string' && row['tab'] ? row['tab'] : 'activities',
    tabLabel: typeof row['tab_label'] === 'string' && row['tab_label'] ? row['tab_label'] : 'Активности',
    accountId: positiveId(row['account_id']),
    claimId: positiveId(row['claim_id']),
    measureId: positiveId(row['measure_id']),
    focus: typeof row['focus'] === 'string' ? row['focus'] : '',
  };
}

/** Куда ведёт кнопка окна: карточка дела, счёта или мероприятия. */
export function gateTarget(gate: FunnelGateInfo): { path: (string | number)[]; query: Record<string, string> } | null {
  if (gate.claimId && CLAIM_TABS.has(gate.tab)) {
    const query: Record<string, string> = { tab: gate.tab };
    if (gate.focus) query['slot'] = gate.focus;
    return { path: ['/claims', gate.claimId], query };
  }
  if (gate.accountId) {
    const query: Record<string, string> = { tab: gate.tab || 'activities' };
    if (gate.focus && (gate.tab === 'activities' || !gate.tab)) query['activity'] = gate.focus;
    if (gate.measureId) query['measure'] = String(gate.measureId);
    return { path: ['/accounts', gate.accountId], query };
  }
  if (gate.measureId) return { path: ['/measures', gate.measureId], query: {} };
  return null;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1';

  accounts(params: Params): Observable<Page<AccountRow>> {
    return this.http.get<Page<AccountRow>>(`${this.base}/accounts/`, { params: toParams(params) });
  }

  charts(scope = '', extra: Params = {}): Observable<DebtCharts> {
    return this.http.get<DebtCharts>(`${this.base}/accounts/charts/`, { params: toParams({ ...extra, scope }) });
  }

  account(id: number): Observable<AccountDetail> {
    return this.http.get<AccountDetail>(`${this.base}/accounts/${id}/`);
  }

  debtShares(id: number): Observable<DebtShare[]> {
    return this.http.get<DebtShare[]>(`${this.base}/accounts/${id}/debt-shares/`);
  }

  updateAccount(id: number, body: Partial<AccountDetail> & { funnel_reason?: string; parallel_stage?: string }): Observable<AccountDetail> {
    return this.http.patch<AccountDetail>(`${this.base}/accounts/${id}/`, body);
  }

  accountActivities(id: number): Observable<ActivityBoard> {
    return this.http.get<ActivityBoard>(`${this.base}/accounts/${id}/activities/`);
  }

  actOnActivity(id: number, activityId: number, note = '', file?: File): Observable<ActivityBoard> {
    if (file) {
      const body = new FormData();
      body.append('id', String(activityId));
      if (note) body.append('note', note);
      body.append('file', file);
      return this.http.post<ActivityBoard>(`${this.base}/accounts/${id}/activities/`, body);
    }
    return this.http.post<ActivityBoard>(`${this.base}/accounts/${id}/activities/`, { id: activityId, note });
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

  stopMeasure(accountId: number, measureId: number): Observable<{ finished_on: string | null }> {
    return this.http.post<{ finished_on: string | null }>(`${this.base}/accounts/${accountId}/stop-measure/`, { measure_id: measureId });
  }

  startScenarios(body: Record<string, unknown>): Observable<{ started: number }> {
    return this.http.post<{ started: number }>(`${this.base}/accounts/start-scenario/`, body);
  }

  changeScenarios(body: Record<string, unknown>): Observable<{ changed: number }> {
    return this.http.post<{ changed: number }>(`${this.base}/accounts/change-scenario/`, body);
  }

  assignLegal(body: Record<string, unknown>): Observable<{ assigned: number }> {
    return this.http.post<{ assigned: number }>(`${this.base}/accounts/assign-legal/`, body);
  }

  saveCalendarNote(day: string, text: string): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${this.base}/accounts/calendar-notes/`, { day, text });
  }

  accountScenario(id: number): Observable<ScenarioBoard> {
    return this.http.get<ScenarioBoard>(`${this.base}/accounts/${id}/scenario/`);
  }

  writDraft(id: number, params?: Record<string, string>): Observable<WritDraft> {
    let httpParams = new HttpParams();
    if (params) {
      for (const [key, value] of Object.entries(params)) httpParams = httpParams.set(key, value ?? '');
    }
    return this.http.get<WritDraft>(`${this.base}/accounts/${id}/writ-draft/`, { params: httpParams });
  }

  createWrit(id: number, body: object): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${this.base}/accounts/${id}/writ-draft/`, body);
  }

  deleteAttachment(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/attachments/${id}/`);
  }

  downloadAttachment(id: number): Observable<Blob> {
    return this.http.get(`${this.base}/attachments/${id}/download/`, { responseType: 'blob' });
  }

  downloadClaimFile(claimId: number, docId: number): Observable<Blob> {
    return this.http.get(`${this.base}/claims/${claimId}/package/documents/${docId}/pdf/`, { responseType: 'blob' });
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

  calendar(span: { date_from: string; date_to: string }, params: Params): Observable<CalendarEvent[]> {
    return this.http.get<CalendarEvent[]>(`${this.base}/accounts/calendar/`, { params: toParams({ ...params, ...span }) });
  }

  exportAccounts(params: Params): Observable<Blob> {
    return this.http.get(`${this.base}/accounts/export/`, { params: toParams(params), responseType: 'blob' });
  }

  cardColumns(board: 'services' | 'payments' | 'registration'): Observable<ColumnPrefs> {
    return this.http.get<ColumnPrefs>(`${this.base}/accounts/card-columns/`, { params: toParams({ board }) });
  }

  saveCardColumns(board: 'services' | 'payments' | 'registration', columns: string[], order: string[]): Observable<ColumnPrefs> {
    return this.http.put<ColumnPrefs>(`${this.base}/accounts/card-columns/`, { board, columns, order });
  }

  columns(): Observable<ColumnPrefs> {
    return this.http.get<ColumnPrefs>(`${this.base}/accounts/columns/`);
  }

  saveColumns(columns: string[], order: string[]): Observable<ColumnPrefs> {
    return this.http.put<ColumnPrefs>(`${this.base}/accounts/columns/`, { columns, order });
  }

  contractColumns(board: 'persons' | 'services'): Observable<ColumnPrefs> {
    return this.http.get<ColumnPrefs>(`${this.base}/contracts/columns/`, { params: toParams({ board }) });
  }

  saveContractColumns(board: 'persons' | 'services', columns: string[], order: string[]): Observable<ColumnPrefs> {
    return this.http.put<ColumnPrefs>(`${this.base}/contracts/columns/`, { board, columns, order });
  }

  boardWidths(board: string): Observable<Record<string, number>> {
    return this.http.get<{ widths: Record<string, number> }>(`${this.base}/board-widths/${board}/`).pipe(
      map((body) => body.widths ?? {}),
    );
  }

  saveBoardWidths(board: string, widths: Record<string, number>): Observable<Record<string, number>> {
    return this.http.put<{ widths: Record<string, number> }>(`${this.base}/board-widths/${board}/`, { widths }).pipe(
      map((body) => body.widths ?? {}),
    );
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

  contractStage(accountIds: number[], funnelStage: string, reason: string): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${this.base}/contracts/stage/`, {
      account_ids: accountIds,
      funnel_stage: funnelStage,
      funnel_reason: reason,
    });
  }

  contractKanban(params: Params): Observable<{ stage: string; title: string; total: number; cards: ContractPerson[] }[]> {
    return this.http.get<{ stage: string; title: string; total: number; cards: ContractPerson[] }[]>(
      `${this.base}/contracts/kanban/`, { params: toParams(params) },
    );
  }

  contractEvent(body: Record<string, unknown>, params: Params): Observable<{ id: number; kind_display: string }> {
    return this.http.post<{ id: number; kind_display: string }>(`${this.base}/contracts/events/`, body, { params: toParams(params) });
  }

  contractCalendar(span: { date_from: string; date_to: string }, params: Params): Observable<CalendarEvent[]> {
    return this.http.get<CalendarEvent[]>(`${this.base}/contracts/calendar/`, { params: toParams({ ...params, ...span }) });
  }

  contractGrouped(params: Params): Observable<{ value: string; accounts: number; services: number; debt: string | null; penalty: string | null }[]> {
    return this.http.get<{ value: string; accounts: number; services: number; debt: string | null; penalty: string | null }[]>(
      `${this.base}/contracts/grouped/`, { params: toParams(params) },
    );
  }

  contractDossier(id: number): Observable<ContractDossier> {
    return this.http.get<ContractDossier>(`${this.base}/contracts/${id}/dossier/`);
  }

  extraMeasureCatalog(): Observable<Page<{ id: number; name: string; note: string; is_active: boolean }>> {
    return this.http.get<Page<{ id: number; name: string; note: string; is_active: boolean }>>(`${this.base}/nsi/extra-measures/`);
  }

  saveExtraMeasure(body: { id?: number; name: string; note?: string }): Observable<{ id: number; name: string; note: string }> {
    if (body.id) return this.http.patch<{ id: number; name: string; note: string }>(`${this.base}/nsi/extra-measures/${body.id}/`, body);
    return this.http.post<{ id: number; name: string; note: string }>(`${this.base}/nsi/extra-measures/`, body);
  }

  deleteExtraMeasure(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/nsi/extra-measures/${id}/`);
  }

  addExtraMeasures(body: { catalog_id: number; account_ids: number[] }): Observable<{ id: number; name: string }> {
    return this.http.post<{ id: number; name: string }>(`${this.base}/accounts/extra-measures/`, body);
  }

  addContractExtra(id: number, catalogId: number): Observable<{ id: number; name: string }> {
    return this.http.post<{ id: number; name: string }>(`${this.base}/contracts/${id}/extra-measure/`, { catalog_id: catalogId });
  }

  holdMeasure(id: number, until: string, reason: string): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${this.base}/measures/${id}/hold/`, { until, reason });
  }

  releaseMeasure(id: number): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${this.base}/measures/${id}/release/`, {});
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

  dialMeasure(id: number): Observable<MeasureDetail> {
    return this.http.post<MeasureDetail>(`${this.base}/measures/${id}/dial/`, {});
  }

  conductMeasures(ids: number[]): Observable<{ dialed: number; sent: number; skipped: { id: number; reason: string }[] }> {
    return this.http.post<{ dialed: number; sent: number; skipped: { id: number; reason: string }[] }>(
      `${this.base}/measures/conduct/`, { ids },
    );
  }

  addMeasureTask(id: number, title: string, dueOn = ''): Observable<MeasureDetail> {
    return this.http.post<MeasureDetail>(`${this.base}/measures/${id}/tasks/`, { title, due_on: dueOn || null });
  }

  setMeasureTaskStatus(id: number, taskId: number, status: 'open' | 'done'): Observable<MeasureDetail> {
    return this.http.post<MeasureDetail>(`${this.base}/measures/${id}/task-status/`, { task_id: taskId, status });
  }

  addTaskCheck(id: number, taskId: number, title: string): Observable<MeasureDetail> {
    return this.http.post<MeasureDetail>(`${this.base}/measures/${id}/task-checks/`, { task_id: taskId, title });
  }

  setTaskCheck(id: number, checkId: number, done: boolean): Observable<MeasureDetail> {
    return this.http.post<MeasureDetail>(`${this.base}/measures/${id}/task-checks/`, { check_id: checkId, done });
  }

  skipScenarioStep(accountId: number, reason: string): Observable<{ last_skip: string; skipped: number[] }> {
    return this.http.post<{ last_skip: string; skipped: number[] }>(`${this.base}/accounts/${accountId}/skip-step/`, { reason });
  }

  scenarioTimeline(): Observable<{ warning_wait_days: number; warning_wait_custom: number | null; central_warning_wait_days: number; step_waits: Record<string, number> }> {
    return this.http.get<{ warning_wait_days: number; warning_wait_custom: number | null; central_warning_wait_days: number; step_waits: Record<string, number> }>(`${this.base}/nsi/scenarios/timeline/`);
  }

  saveScenarioTimeline(body: { warning_wait_days: number | null; step_waits: Record<string, number> }): Observable<{ warning_wait_days: number; warning_wait_custom: number | null; step_waits: Record<string, number> }> {
    return this.http.patch<{ warning_wait_days: number; warning_wait_custom: number | null; step_waits: Record<string, number> }>(`${this.base}/nsi/scenarios/timeline/`, body);
  }

  measure(id: number): Observable<MeasureDetail> {
    return this.http.get<MeasureDetail>(`${this.base}/measures/${id}/`);
  }

  measureStatus(id: number, status: string): Observable<MeasureDetail> {
    return this.http.post<MeasureDetail>(`${this.base}/measures/${id}/status/`, { status });
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

  specialists(): Observable<{ name: string }[]> {
    return this.http.get<{ name: string }[]>(`${this.base}/accounts/specialists/`);
  }

  grouped(params: Params): Observable<{ value: string; accounts: number; services: number; debt: string | null; penalty: string | null }[]> {
    return this.http.get<{ value: string; accounts: number; services: number; debt: string | null; penalty: string | null }[]>(`${this.base}/accounts/grouped/`, { params: toParams(params) });
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

  notaryOffices(): Observable<Page<NotaryOffice>> {
    return this.http.get<Page<NotaryOffice>>(`${this.base}/nsi/notary-offices/`, { params: { page_size: 500 } });
  }

  opiOffices(): Observable<Page<OpiOffice>> {
    return this.http.get<Page<OpiOffice>>(`${this.base}/nsi/opi-offices/`, { params: { page_size: 500 } });
  }

  saveOpiOffice(body: Partial<OpiOffice>): Observable<OpiOffice> {
    if (body.id) return this.http.patch<OpiOffice>(`${this.base}/nsi/opi-offices/${body.id}/`, body);
    return this.http.post<OpiOffice>(`${this.base}/nsi/opi-offices/`, body);
  }

  deleteOpiOffice(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/nsi/opi-offices/${id}/`);
  }

  categories(): Observable<Page<DebtorCategory>> {
    return this.http.get<Page<DebtorCategory>>(`${this.base}/nsi/debtor-categories/`, {
      params: toParams({ page_size: 100, is_active: true }),
    });
  }

  savedFilters(target: string): Observable<Page<SavedFilter>> {
    return this.http.get<Page<SavedFilter>>(`${this.base}/saved-filters/`, { params: toParams({ target }) });
  }

  saveFilter(body: Partial<SavedFilter>): Observable<SavedFilter> {
    return this.http.post<SavedFilter>(`${this.base}/saved-filters/`, body);
  }

  accountServices(id: number, withDebt = false): Observable<Page<AccountService>> {
    return this.http.get<Page<AccountService>>(`${this.base}/accounts/${id}/services/`, {
      params: toParams({ page_size: 500, with_debt: withDebt ? 1 : null }),
    });
  }

  accountPayments(id: number): Observable<Page<Payment>> {
    return this.http.get<Page<Payment>>(`${this.base}/accounts/${id}/payments/`, { params: toParams({ page_size: 500 }) });
  }

  accountRegistrations(id: number): Observable<Page<Registration>> {
    return this.http.get<Page<Registration>>(`${this.base}/accounts/${id}/registrations/`, { params: toParams({ page_size: 500 }) });
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

  rollbackTemplate(id: number, version: number): Observable<MessageTemplate> {
    return this.http.post<MessageTemplate>(`${this.base}/templates/${id}/rollback/`, { version });
  }

  previewTemplate(id: number, userName: string, body?: string, context: Record<string, unknown> = {}): Observable<{ text: string }> {
    return this.http.post<{ text: string }>(`${this.base}/templates/${id}/preview/`, { user_name: userName, body, context });
  }

  errors(params: Params): Observable<Page<ErrorLogEntry>> {
    return this.http.get<Page<ErrorLogEntry>>(`${this.base}/audit/errors/`, { params: toParams(params) });
  }

  claims(): Observable<{ results: ClaimCase[]; stages: Named[]; assigned: AssignedAccount[] }> {
    return this.http.get<{ results: ClaimCase[]; stages: Named[]; assigned: AssignedAccount[] }>(`${this.base}/claims/`);
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

  uploadClaimAct(
    id: number,
    body: { title: string; act_number?: string; act_date?: string | null; reason?: string; attachment_id?: number | null },
    file?: File | null,
  ): Observable<ClaimCase> {
    if (file) {
      const data = new FormData();
      data.append('title', body.title || 'Акт ОПИ');
      if (body.act_number) data.append('act_number', body.act_number);
      if (body.act_date) data.append('act_date', body.act_date);
      if (body.reason) data.append('reason', body.reason);
      data.append('file', file, file.name);
      return this.http.post<ClaimCase>(`${this.base}/claims/${id}/acts/`, data);
    }
    return this.http.post<ClaimCase>(`${this.base}/claims/${id}/acts/`, body);
  }

  deleteClaimAct(id: number, actId: number): Observable<ClaimCase> {
    return this.http.delete<ClaimCase>(`${this.base}/claims/${id}/acts/${actId}/`);
  }

  addOpiMeasure(
    id: number,
    body: { kind?: string; title?: string; date?: string | null; doc_number?: string; note?: string; attachment_id?: number | null; move_stage?: boolean },
    file?: File | null,
  ): Observable<ClaimCase> {
    if (file) {
      const data = new FormData();
      if (body.kind) data.append('kind', body.kind);
      if (body.title) data.append('title', body.title);
      if (body.date) data.append('date', body.date);
      if (body.doc_number) data.append('doc_number', body.doc_number);
      if (body.note) data.append('note', body.note);
      if (body.move_stage) data.append('move_stage', '1');
      data.append('file', file, file.name);
      return this.http.post<ClaimCase>(`${this.base}/claims/${id}/opi-measures/`, data);
    }
    return this.http.post<ClaimCase>(`${this.base}/claims/${id}/opi-measures/`, body);
  }

  deleteOpiMeasure(id: number, measureId: number): Observable<ClaimCase> {
    return this.http.delete<ClaimCase>(`${this.base}/claims/${id}/opi-measures/${measureId}/`);
  }

  prisDictionaries(): Observable<PrisDictionaries> {
    return this.http.get<PrisDictionaries>(`${this.base}/claims/pris-dictionaries/`);
  }

  prisStatus(): Observable<PrisChannelStatus> {
    return this.http.get<PrisChannelStatus>(`${this.base}/claims/pris-status/`);
  }

  autofillPris(id: number): Observable<ClaimCase> {
    return this.http.post<ClaimCase>(`${this.base}/claims/${id}/pris/autofill/`, {});
  }

  organizationPris(id: number): Observable<{ claimant: Record<string, string> }> {
    return this.http.get<{ claimant: Record<string, string> }>(`${this.base}/organizations/${id}/pris-claimant/`);
  }

  saveOrganizationPris(id: number, claimant: Record<string, string>): Observable<{ claimant: Record<string, string> }> {
    return this.http.patch<{ claimant: Record<string, string> }>(`${this.base}/organizations/${id}/pris-claimant/`, claimant);
  }

  uploadClaimDocument(
    id: number, docType: string, pdf: File | null, signature: File | null, kind: string, docId?: number,
  ): Observable<ClaimCase> {
    const data = new FormData();
    data.append('doc_type', docType);
    data.append('signature_kind', kind);
    if (docId) data.append('doc_id', String(docId));
    if (pdf) data.append('pdf', pdf, pdf.name);
    if (signature) data.append('signature', signature, signature.name);
    return this.http.post<ClaimCase>(`${this.base}/claims/${id}/package/documents/`, data);
  }

  deleteClaimDocument(id: number, docId: number): Observable<ClaimCase> {
    return this.http.delete<ClaimCase>(`${this.base}/claims/${id}/package/documents/${docId}/`);
  }

  claimPackageFile(id: number, docId: number, kind: 'pdf' | 'signature', inline = false): Observable<Blob> {
    const params = inline ? { inline: '1' } : undefined;
    return this.http.get(`${this.base}/claims/${id}/package/documents/${docId}/${kind}/`, { params, responseType: 'blob' });
  }

  claimManifest(id: number): Observable<Blob> {
    return this.http.get(`${this.base}/claims/${id}/package/manifest/`, { responseType: 'blob' });
  }

  claimArchive(id: number): Observable<Blob> {
    return this.http.get(`${this.base}/claims/${id}/package/archive/`, { responseType: 'blob' });
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

  assignScenario(id: number, body: object): Observable<ScenarioAssign> {
    return this.http.post<ScenarioAssign>(`${this.base}/nsi/scenarios/${id}/assign/`, body);
  }

  scenarioCalling(): Observable<{
    call_legal: boolean;
    outgoing_numbers: string[];
    call_recording: boolean;
    call_transfer: boolean;
    dial_mobile_from_day: number;
    dial_mobile_weekdays: number[];
  }> {
    return this.http.get<{
      call_legal: boolean;
      outgoing_numbers: string[];
      call_recording: boolean;
      call_transfer: boolean;
      dial_mobile_from_day: number;
      dial_mobile_weekdays: number[];
    }>(`${this.base}/nsi/scenarios/calling/`);
  }

  saveScenarioCalling(body: { call_legal: boolean; outgoing_numbers: string[] }): Observable<{
    call_legal: boolean;
    outgoing_numbers: string[];
  }> {
    return this.http.patch<{ call_legal: boolean; outgoing_numbers: string[] }>(
      `${this.base}/nsi/scenarios/calling/`,
      body,
    );
  }

  scenarioMail(): Observable<{
    mail_from: string;
    mail_from_name: string;
    mail_subject: string;
    mail_signature: string;
  }> {
    return this.http.get<{
      mail_from: string;
      mail_from_name: string;
      mail_subject: string;
      mail_signature: string;
    }>(`${this.base}/nsi/scenarios/mail/`);
  }

  saveScenarioMail(body: {
    mail_from: string;
    mail_from_name: string;
    mail_subject: string;
    mail_signature: string;
  }): Observable<{
    mail_from: string;
    mail_from_name: string;
    mail_subject: string;
    mail_signature: string;
  }> {
    return this.http.patch<{
      mail_from: string;
      mail_from_name: string;
      mail_subject: string;
      mail_signature: string;
    }>(`${this.base}/nsi/scenarios/mail/`, body);
  }

  debtGroups(): Observable<Page<DebtGroupBand>> {
    return this.http.get<Page<DebtGroupBand>>(`${this.base}/nsi/debt-groups/`, { params: { page_size: 20 } });
  }

  saveDebtGroups(bands: DebtGroupBand[]): Observable<DebtGroupBand[]> {
    return this.http.put<DebtGroupBand[]>(`${this.base}/nsi/debt-groups/replace/`, bands);
  }

  scenarioRules(): Observable<Page<ScenarioRuleRow>> {
    return this.http.get<Page<ScenarioRuleRow>>(`${this.base}/nsi/scenario-rules/`, { params: toParams({ page_size: 100 }) });
  }

  saveScenarioRule(row: Partial<ScenarioRuleRow>): Observable<ScenarioRuleRow> {
    return row.id
      ? this.http.patch<ScenarioRuleRow>(`${this.base}/nsi/scenario-rules/${row.id}/`, { name: row.name })
      : this.http.post<ScenarioRuleRow>(`${this.base}/nsi/scenario-rules/`, {
        group: row.group, name: row.name, category: null,
      });
  }

  directoryUsers(params: { organization?: number; search?: string; role?: string } = {}): Observable<Page<DirectoryUser>> {
    return this.http.get<Page<DirectoryUser>>(`${this.base}/users/`, { params: toParams({ page_size: 500, ...params }) });
  }

  saveUser(row: Partial<DirectoryUser> & { password?: string }): Observable<DirectoryUser> {
    return row.id
      ? this.http.patch<DirectoryUser>(`${this.base}/users/${row.id}/`, row)
      : this.http.post<DirectoryUser>(`${this.base}/users/`, row);
  }

  serviceScenarioMode(id: number, body?: { launch?: string; scenario?: number | null }): Observable<{ launch: string; scenario: number | null; scenario_name: string }> {
    const url = `${this.base}/service-organizations/${id}/scenario-mode/`;
    if (body) {
      return this.http.patch<{ launch: string; scenario: number | null; scenario_name: string }>(url, body);
    }
    return this.http.get<{ launch: string; scenario: number | null; scenario_name: string }>(url);
  }

  serviceOrganizations(organization: number): Observable<Page<ServiceOrganizationOption>> {
    return this.http.get<Page<ServiceOrganizationOption>>(`${this.base}/service-organizations/`, {
      params: toParams({ organization, page_size: 200 }),
    });
  }

  debtorCategories(): Observable<Page<DebtorCategory>> {
    return this.http.get<Page<DebtorCategory>>(`${this.base}/nsi/debtor-categories/`, {
      params: toParams({ page_size: 100, is_active: true }),
    });
  }

  previewPrintForm(body: object): Observable<Blob> {
    return this.http.post(`${this.base}/nsi/print-forms/preview/`, body, { responseType: 'blob' });
  }

  blankData(blank: string, account?: number): Observable<BlankData> {
    const params: Record<string, string> = { blank };
    if (account) params['account'] = String(account);
    return this.http.get<BlankData>(`${this.base}/nsi/print-forms/blank-data/`, { params });
  }

  recognizePrintForm(file: File): Observable<{ recognized: boolean; note: string; name: string; blocks: PrintFormBlock[] }> {
    const data = new FormData();
    data.append('file', file, file.name);
    return this.http.post<{ recognized: boolean; note: string; name: string; blocks: PrintFormBlock[] }>(
      `${this.base}/nsi/print-forms/recognize/`, data,
    );
  }

  printForms(): Observable<Page<PrintFormRow>> {
    return this.http.get<Page<PrintFormRow>>(`${this.base}/nsi/print-forms/`, { params: { page_size: 200 } });
  }

  savePrintForm(row: Partial<PrintFormRow>): Observable<PrintFormRow> {
    return row.id
      ? this.http.patch<PrintFormRow>(`${this.base}/nsi/print-forms/${row.id}/`, row)
      : this.http.post<PrintFormRow>(`${this.base}/nsi/print-forms/`, row);
  }

  deletePrintForm(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/nsi/print-forms/${id}/`);
  }

  restorePrintForm(id: number, version: number): Observable<PrintFormRow> {
    return this.http.post<PrintFormRow>(`${this.base}/nsi/print-forms/${id}/restore/`, { version });
  }

  renderPrintForm(id: number, accounts: number[], tariff = ''): Observable<PrintRender> {
    return this.http.post<PrintRender>(`${this.base}/nsi/print-forms/${id}/render/`, {
      account: accounts[0], accounts, tariff,
    });
  }

  printFile(formId: number, path: string): Observable<Blob> {
    return this.http.get(`${this.base}/nsi/print-forms/${formId}/${path}/`, { responseType: 'blob' });
  }

  organizations(): Observable<Page<OrganizationOption>> {
    return this.http.get<Page<OrganizationOption>>(`${this.base}/organizations/`, { params: toParams({ page_size: 200 }) });
  }

  createOrganization(schemaName: string, name: string): Observable<OrganizationOption> {
    return this.http.post<OrganizationOption>(`${this.base}/organizations/`, { schema_name: schemaName, name });
  }

  importJobs(): Observable<Page<ImportJob>> {
    return this.http.get<Page<ImportJob>>(`${this.base}/imports/`, { params: toParams({ page_size: 20 }) });
  }

  uploadImport(entity: string, file: File, organization: number | null): Observable<ImportJob> {
    const data = new FormData();
    data.set('entity', entity);
    data.set('file', file);
    if (organization != null) data.set('organization', String(organization));
    return this.http.post<ImportJob>(`${this.base}/imports/`, data);
  }
}

export interface Named { id: string; label: string }

export interface NotaryOffice {
  code: string;
  name: string;
  district: string;
  address: string;
  phones: string;
}

export interface OpiOffice {
  id: number;
  organization: number | null;
  code: string;
  name: string;
  region: string;
  address: string;
  phones: string;
  email: string;
  is_active: boolean;
}

export interface PrisChannelStatus {
  mode: string;
  system: string;
  sends: boolean;
  ministry: boolean;
  tunnel: boolean;
  base_url?: string;
  missing?: string[];
  detail: string;
}

export interface OpiMeasureTaken {
  id: number;
  kind: string;
  title: string;
  date: string;
  doc_number: string;
  note: string;
  attachment_id?: number | null;
  attachment_name?: string;
}

export interface ClaimActRow {
  id: number;
  title: string;
  act_number?: string;
  act_date?: string | null;
  reason?: string;
  attachment_id?: number | null;
  file_name?: string;
}

export interface AssignedAccount {
  account: number;
  client_account: string;
  short_fio: string;
  debt_group: number | null;
  account_address: string;
  funnel_stage: string;
}

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
  debt_from?: string | null;
  debt_to?: string | null;
  warning_delivered_on: string | null;
  notary_office: string;
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
  opi_department?: string;
  opi_sent_on?: string | null;
  opi_started_on?: string | null;
  opi_ended_on?: string | null;
  opi_bailiff?: string;
  opi_note?: string;
  opi_measures_taken?: OpiMeasureTaken[];
  pris_cl_num?: string;
  pris_response_id?: string;
  pris_process_status?: string;
  pris_process_message?: string;
  pris?: PrisCard;
  tariff_received: boolean;
  ais_debt_cleared: boolean;
  eviction_stage: string;
  skip_reason: string;
  writeoff_status: string;
  writeoff_note: string;
  files: { id: number; doc_type: string; name: string; role: string }[];
  acts: ClaimActRow[];
  acts_count: number;
  approvals: { id: number; approver_id: number; approver_name: string; decision: string; reason: string }[];
  blockers: string[];
  writ_checklist?: WritChecklistItem[];
  events: { old_stage: string; new_stage: string; reason: string; actor: string; at: string }[];
  approver_choices?: { id: number; name: string; role: string }[];
  lawsuit_kinds?: Named[];
  opi_measure_kinds?: Named[];
  opi_statuses?: Named[];
  stages?: Named[];
  package?: ClaimPackage;
}

export interface PrisDictRow { code: string; name: string }

export interface PrisDictionaries {
  mode: string;
  dictionaries: Record<string, { name: string; rows: PrisDictRow[] }>;
}

export interface PrisInquiry {
  applied?: boolean;
  p_ost?: { req_sum?: string; ost_sum?: string; curr_code?: string }[];
  p_status?: { status?: string; date_status?: string; actual?: string }[];
  p_action?: Record<string, string>[];
  p_nachisl?: Record<string, string>[];
  p_repay?: Record<string, string>[];
  p_ispdoc?: { proc_num?: string; doc_num?: string }[];
}

export interface PrisExchangeRow {
  id: number;
  operation: string;
  mode: string;
  process_status: string;
  created_at: string;
  note: string;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
}

export interface PrisCard {
  problems: string[];
  ready: boolean;
  cl_num: string;
  response_id: string;
  process_status: string;
  process_message: string;
  request: Record<string, string | number>;
  claimant: Record<string, string>;
  inquiry?: PrisInquiry;
  exchanges?: PrisExchangeRow[];
}

export interface ClaimPackage {
  persisted: boolean;
  formed_at: string | null;
  service_id: number | null;
  contact_data: string;
  notification_email: string;
  user_message: string;
  debtors: BnpDebtor[];
  debts: BnpDebt[];
  documents: BnpDocument[];
  problems: string[];
  manifest: { applications?: { externalId?: string }[] };
  has_archive?: boolean;
  send_blockers: string[];
  services: BnpServiceOption[];
  debt_types: { id: string; name: string }[];
  doc_types: { id: string; name: string }[];
  required_docs: string[];
}

export interface BnpDebtor {
  personType: string;
  personalId: string;
  secondName: string;
  firstName: string;
  middleName: string;
  unp: string;
  regNumber: string;
  regName: string;
  solidary?: boolean;
}

export interface BnpDebt {
  source: 'balance' | 'penalty';
  typeId: string;
  amount: string;
  currency: string;
  startDate?: string;
  endDate?: string;
  dateAt?: string;
}

export interface BnpDocument {
  id: number;
  doc_type: string;
  doc_type_label: string;
  file_name: string;
  signature_name: string;
  signer: string;
  signer_label: string;
  has_pdf: boolean;
  has_signature: boolean;
  generated: boolean;
  body: string;
  layout?: {
    form?: number;
    version?: number;
    blocks?: PrintFormBlock[];
    blank?: string;
    family?: string;
    copy?: Record<string, string>;
    values?: Record<string, string>;
    pairs?: BlankPeriodPair[];
    residents?: BlankResident[];
    penalty_rows?: BlankPenaltyRow[];
    service_rows?: BlankServiceRow[];
    section_list?: BlankSection[];
    sections?: Record<string, boolean>;
    show_services?: boolean;
  };
  size: number;
}

export interface BnpServiceOption {
  id: number;
  name: string;
  housing: boolean;
  debt_type_ids: string[];
}

export interface WritChecklistItem {
  code: string;
  name: string;
  order: number;
  criteria: string;
  mandatory: boolean;
  locked?: boolean;
  met?: boolean;
  gap?: string;
}

export interface ScenarioStep {
  order: number;
  action: string;
  checklist?: WritChecklistItem[];
  wait_days?: number;
  template?: string;
  template_id?: number | null;
  approval?: boolean;
  branch_group?: number | null;
  groups?: number[];
  party?: string;
  org_kind?: string;
  repeat?: Record<string, { every_days?: number; once?: boolean }>;
  require_phone?: boolean;
  debtor_category?: number | null;
  previous_action?: string;
  require_status?: string;
  exclude_if_paid?: boolean;
  auto_complete?: boolean;
  blocks_next?: boolean;
  terminal?: boolean;
}

export interface ScenarioAssign {
  version: number;
  current_version: number;
  paused: boolean;
  last_skip?: string;
  pauses?: { paused: boolean; reason: string; at: string; actor: string }[];
}

export interface ScenarioRuleRow {
  id?: number;
  group: number;
  name: string;
  category?: number | null;
}

export interface DebtGroupBand {
  id?: number;
  group: number;
  name: string;
  months_from: number;
  months_to: number | null;
}

export interface PrintRender {
  text: string;
  version: number;
  id?: number;
  batch?: string;
  documents: { id: number; account: number; version: number; text: string }[];
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
  call_legal?: boolean | null;
  dial_mobile_from_day?: number | null;
  dial_mobile_weekdays?: number[] | null;
  call_from_day?: number | null;
  weekday_from?: string | null;
  weekday_to?: string | null;
  weekend_from?: string | null;
  weekend_to?: string | null;
  revisions?: VersionRow[];
}

export interface PrintFormBlock {
  key: string;
  title: string;
  enabled: boolean;
  align: 'left' | 'center' | 'right' | 'justify';
  bold: boolean;
  italic: boolean;
  font_size: number;
  font_family?: string;
  text: string;
  columns: { title: string; width: number }[];
  rows: string[][];
  x: number;
  y: number;
  w: number;
}

export interface BlankPeriodPair {
  left_label: string;
  right_label: string;
  rows: {
    name: string;
    l_principal: string;
    l_penalty: string;
    l_total: string;
    r_principal: string;
    r_penalty: string;
    r_total: string;
  }[];
  l_principal: string;
  l_penalty: string;
  l_total: string;
  r_principal: string;
  r_penalty: string;
  r_total: string;
}

export interface BlankResident {
  arrived: string;
  left: string;
  registered: string;
  ended: string;
  fio: string;
  birthday: string;
  relation: string;
}

export interface BlankPenaltyRow {
  month: string;
  principal: string;
  penalty: string;
}

export interface BlankServiceRow {
  id: string;
  name: string;
  selected: boolean;
}

export interface BlankSection {
  id: string;
  title: string;
}

export interface BlankData {
  blank: string;
  family: string;
  copy: Record<string, string>;
  values: Record<string, string>;
  pairs: BlankPeriodPair[];
  residents: BlankResident[];
  penalty_rows: BlankPenaltyRow[];
  service_rows: BlankServiceRow[];
  section_list: BlankSection[];
  sections: Record<string, boolean>;
  show_services: boolean;
  blocks?: PrintFormBlock[];
}

export interface PrintFormRow {
  id: number;
  code: string;
  name: string;
  doc_kind: string;
  addressee?: string;
  body: string;
  font_size?: number;
  indent_mm?: number;
  outdent_mm?: number;
  block_order?: string[];
  logo_text?: string;
  requisites?: string;
  signatory?: string;
  blocks?: PrintFormBlock[];
  blank?: string;
  version: number;
  organization: number | null;
  revisions?: VersionRow[];
}
