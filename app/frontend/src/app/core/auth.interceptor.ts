import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';

import { AuthService } from './auth.service';

function newRequestId(): string {
  // randomUUID() есть только в secure context (https или localhost). На http://IP он отсутствует,
  // и тогда не уходит ни один запрос, включая вход.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().replace(/-/g, '');
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return hex;
}

function withHeaders(req: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  const headers: Record<string, string> = { 'X-Request-ID': req.headers.get('X-Request-ID') ?? newRequestId() };
  if (token && !req.url.includes('/auth/token/')) headers['Authorization'] = `Bearer ${token}`;
  return req.clone({ setHeaders: headers, withCredentials: true });
}

/** JWT + X-Request-ID для каждого запроса; при 401 — одна попытка обновить access-токен. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const prepared = withHeaders(req, auth.accessToken);
  return next(prepared).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status !== 401 || req.url.includes('/auth/')) return throwError(() => error);
      return auth.refresh().pipe(
        switchMap((access) => next(withHeaders(prepared, access))),
        catchError((refreshError) => {
          auth.logout();
          return throwError(() => refreshError);
        }),
      );
    }),
  );
};
