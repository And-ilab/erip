import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map, of, switchMap, tap } from 'rxjs';

import { Me } from './models';

const ACCESS_KEY = 'erip.access';
const REFRESH_KEY = 'erip.refresh';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly me = signal<Me | null>(null);
  readonly isSuperadmin = computed(() => this.me()?.role === 'superadmin');
  readonly canManageTemplates = computed(() => ['superadmin', 'local_admin'].includes(this.me()?.role ?? ''));

  get accessToken(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  }

  login(username: string, password: string): Observable<Me> {
    return this.http
      .post<{ access: string; refresh: string }>('/api/v1/auth/token/', { username, password })
      .pipe(
        tap((tokens) => {
          localStorage.setItem(ACCESS_KEY, tokens.access);
          localStorage.setItem(REFRESH_KEY, tokens.refresh);
        }),
        switchMap(() => this.loadMe()),
      );
  }

  refresh(): Observable<string> {
    const refresh = localStorage.getItem(REFRESH_KEY);
    return this.http.post<{ access: string }>('/api/v1/auth/token/refresh/', { refresh }).pipe(
      map((r) => r.access),
      tap((access) => localStorage.setItem(ACCESS_KEY, access)),
    );
  }

  loadMe(): Observable<Me> {
    return this.http.get<Me>('/api/v1/auth/me/').pipe(tap((me) => this.me.set(me)));
  }

  ensureLoaded(): Observable<boolean> {
    if (!this.accessToken) return of(false);
    if (this.me()) return of(true);
    return this.loadMe().pipe(map(() => true));
  }

  logout(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    this.me.set(null);
    this.router.navigate(['/login']);
  }
}
