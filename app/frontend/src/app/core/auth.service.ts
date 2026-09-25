import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, switchMap, tap } from 'rxjs';

import { Me } from './models';

const ACCESS_KEY = 'erip.access';
const LEGACY_REFRESH_KEY = 'erip.refresh';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly me = signal<Me | null>(null);
  readonly isSuperadmin = computed(() => this.me()?.role === 'superadmin');
  readonly canManageTemplates = computed(() => ['superadmin', 'local_admin'].includes(this.me()?.role ?? ''));

  /** Access живёт только в памяти процесса. После перезагрузки страницы его восстанавливает refresh-cookie. */
  private access: string | null = null;

  get accessToken(): string | null {
    return this.access;
  }

  login(username: string, password: string): Observable<Me> {
    return this.http.post<{ access: string }>('/api/v1/auth/token/', { username, password }).pipe(
      tap((tokens) => this.storeAccess(tokens.access)),
      switchMap(() => this.loadMe()),
    );
  }

  refresh(): Observable<string> {
    return this.http.post<{ access: string }>('/api/v1/auth/token/refresh/', {}).pipe(
      map((response) => response.access),
      tap((access) => this.storeAccess(access)),
    );
  }

  loadMe(): Observable<Me> {
    return this.http.get<Me>('/api/v1/auth/me/').pipe(tap((me) => this.me.set(me)));
  }

  ensureLoaded(): Observable<boolean> {
    if (this.me()) return of(true);
    const ready = this.accessToken
      ? of(true)
      : this.refresh().pipe(
          map(() => true),
          catchError(() => of(false)),
        );
    return ready.pipe(
      switchMap((ok) => (ok ? this.loadMe().pipe(map(() => true), catchError(() => of(false))) : of(false))),
    );
  }

  changePassword(oldPassword: string, newPassword: string): Observable<void> {
    return this.http.post('/api/v1/auth/password/', { old_password: oldPassword, new_password: newPassword }, {
      responseType: 'text',
    }).pipe(map(() => undefined));
  }

  logout(): void {
    this.http.post('/api/v1/auth/logout/', {}).subscribe({ error: () => undefined });
    this.access = null;
    this.clearStoredTokens();
    this.me.set(null);
    this.router.navigate(['/login']);
  }

  private storeAccess(access: string): void {
    this.access = access;
    this.clearStoredTokens();
  }

  private clearStoredTokens(): void {
    sessionStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(LEGACY_REFRESH_KEY);
  }
}
