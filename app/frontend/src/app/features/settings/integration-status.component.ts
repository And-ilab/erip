import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ApiService, IntegrationRow, PrisCheckResult, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-integration-status',
  standalone: true,
  imports: [MatButtonModule, MatSnackBarModule],
  template: `
    @if (row(); as item) {
      <section class="card">
        <div class="head">
          <h3>{{ item.title }}</h3>
          <span class="pill" [class.on]="item.status.ready" [class.warn]="item.status.mode === 'unknown'">
            {{ modeLabel(item.status.mode) }}
          </span>
        </div>
        <p class="muted">{{ item.summary }}</p>
        <dl class="meta">
          <div><dt>Режим</dt><dd>{{ item.status.mode }}</dd></div>
          <div><dt>Готовность</dt><dd>{{ item.status.ready ? 'готов к внешней отправке' : 'внешний контур не активен' }}</dd></div>
          <div><dt>Связь</dt><dd>{{ item.status.connected ? 'есть' : 'нет' }}</dd></div>
        </dl>
        <p class="detail">{{ item.status.detail || item.stub_detail }}</p>
        @if (item.stub_detail && item.status.mode === 'stub') {
          <p class="hint">{{ item.stub_detail }}</p>
        }
        <button mat-stroked-button type="button" (click)="reload()">Обновить статус</button>
      </section>
      @if (isPris() && auth.canManageTemplates()) {
        <section class="card checks">
          <h3>Проверочные запросы</h3>
          <p class="hint">
            Те же служебные вызовы, что ответили на тестовом контуре 3–4 ноября.
            Ключ и токен на экран не выводятся. S-05 сам берёт сессию. S-07 закрывает её и сразу открывает новую.
          </p>
          @for (step of prisSteps; track step.id) {
            <div class="check">
              <div class="check-head">
                <button mat-stroked-button type="button" (click)="runCheck(step.id)" [disabled]="busy() === step.id">
                  {{ busy() === step.id ? 'Запрос…' : step.label }}
                </button>
                @if (checks()[step.id]; as result) {
                  <span class="pill" [class.on]="result.matched && result.ministry" [class.warn]="!(result.matched && result.ministry)">
                    {{ checkLabel(result) }}
                  </span>
                }
              </div>
              <p class="hint">{{ step.request }}</p>
              @if (checks()[step.id]; as result) {
                <p class="detail"><b>Ожидание.</b> {{ result.expected }}</p>
                <p class="detail"><b>Ответ.</b> {{ result.summary }}</p>
              }
            </div>
          }
        </section>
      }
    } @else if (failed()) {
      <p class="alert">{{ failed() }}</p>
    } @else {
      <p class="muted">Загрузка…</p>
    }
  `,
  styles: `
    .card {
      background: #fff; border: 1px solid var(--erip-border); border-radius: 12px; padding: 16px; max-width: 720px;
    }
    .checks { margin-top: 16px; max-width: 880px; }
    .check { padding: 12px 0; border-top: 1px solid var(--erip-border); }
    .check-head { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .check .detail { margin: 8px 0 0; }
    .head { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
    h3 { margin: 0; color: var(--erip-primary-dark); }
    .muted, .hint { color: var(--erip-muted); }
    .hint { font-size: 13px; }
    .detail { margin: 12px 0; }
    .meta { display: grid; gap: 8px; margin: 12px 0; }
    .meta > div { display: grid; grid-template-columns: 140px 1fr; gap: 8px; }
    dt { color: var(--erip-muted); }
    dd { margin: 0; }
    .pill {
      display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700;
      background: #eef2f4; color: var(--erip-muted);
    }
    .pill.on { background: #e7f6ee; color: #1b7a45; }
    .pill.warn { background: #fff4e5; color: #9a5b00; }
    .alert { color: #b00020; }
  `,
})
export class IntegrationStatusComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly snack = inject(MatSnackBar);
  protected readonly auth = inject(AuthService);

  protected readonly row = signal<IntegrationRow | null>(null);
  protected readonly failed = signal('');
  protected readonly busy = signal('');
  protected readonly checks = signal<Record<string, PrisCheckResult>>({});
  protected readonly prisSteps = [
    { id: 's06', label: 'S-06 Вход', request: 'POST /core/auth/authorizate' },
    { id: 's01', label: 'S-01 Адрес клиента', request: 'GET /core/service/GetIP' },
    { id: 's02', label: 'S-02 Echo', request: 'GET /core/service/Echo' },
    { id: 's03', label: 'S-03 Версия', request: 'GET /core/service/Version' },
    { id: 's04', label: 'S-04 Метрика', request: 'GET /core/service/getstat' },
    { id: 's05', label: 'S-05 Справочники', request: 'POST /core/BI/NSI/GetNSIData' },
    { id: 's07', label: 'S-07 Выход', request: 'POST /core/auth/logout' },
  ];

  ngOnInit(): void {
    this.reload();
  }

  protected modeLabel(mode: string): string {
    if (mode === 'stub') return 'Заглушка';
    if (mode === 'unknown') return 'Нет связи';
    if (mode === 'smtp' || mode === 'ami' || mode === 'http' || mode === 'channel') return 'Включён';
    return mode;
  }

  protected isPris(): boolean {
    return (this.route.snapshot.data['code'] || '') === 'pris';
  }

  protected checkLabel(result: PrisCheckResult): string {
    if (!result.ministry && result.http_status == null) return 'Не отправлялся';
    if (result.matched && result.ministry) return 'Совпало';
    if (result.matched) return 'Форма совпала';
    return 'Ответ другой';
  }

  protected runCheck(step: string): void {
    this.busy.set(step);
    this.api.prisCheck(step).subscribe({
      next: (result) => {
        this.checks.update((row) => ({ ...row, [step]: result }));
        this.busy.set('');
      },
      error: (err) => {
        const detail = (err?.error && typeof err.error.detail === 'string') ? err.error.detail : errorMessage(err);
        this.checks.update((row) => ({
          ...row,
          [step]: {
            step,
            title: step,
            request: '',
            expected: '',
            mode: '',
            http_status: err?.status ?? null,
            matched: false,
            ministry: false,
            summary: detail,
          },
        }));
        this.busy.set('');
        this.snack.open(detail, 'OK');
      },
    });
  }

  protected reload(): void {
    const code = this.route.snapshot.data['code'] || this.route.snapshot.paramMap.get('code') || '';
    this.api.integration(code).subscribe({
      next: (row) => {
        this.row.set(row);
        this.failed.set('');
      },
      error: (err) => {
        this.row.set(null);
        this.failed.set(errorMessage(err));
        this.snack.open(errorMessage(err), 'OK');
      },
    });
  }
}
