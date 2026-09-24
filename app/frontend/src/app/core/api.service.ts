import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  AccountDetail,
  AccountRow,
  AccountService,
  ApiError,
  ErrorLogEntry,
  MessageTemplate,
  Notification,
  Page,
  Payment,
  Registration,
} from './models';

type Params = Record<string, string | number | boolean | null | undefined>;

function toParams(params: Params = {}): HttpParams {
  let result = new HttpParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') result = result.set(key, String(value));
  }
  return result;
}

export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as ApiError | undefined;
    if (body?.error) return `${body.error.message} (запрос ${body.error.request_id})`;
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

  account(id: number): Observable<AccountDetail> {
    return this.http.get<AccountDetail>(`${this.base}/accounts/${id}/`);
  }

  updateAccountGroup(id: number, group: number | null, reason: string): Observable<AccountDetail> {
    return this.http.patch<AccountDetail>(`${this.base}/accounts/${id}/`, {
      debt_group_manual: group,
      debt_group_manual_reason: reason,
    });
  }

  accountServices(id: number): Observable<Page<AccountService>> {
    return this.http.get<Page<AccountService>>(`${this.base}/accounts/${id}/services/`, { params: toParams({ page_size: 200 }) });
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

  previewTemplate(id: number, userName: string, body?: string, context: Record<string, unknown> = {}): Observable<{ text: string }> {
    return this.http.post<{ text: string }>(`${this.base}/templates/${id}/preview/`, { user_name: userName, body, context });
  }

  errors(params: Params): Observable<Page<ErrorLogEntry>> {
    return this.http.get<Page<ErrorLogEntry>>(`${this.base}/audit/errors/`, { params: toParams(params) });
  }
}
