import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ApiService, IntegrationRow, errorMessage } from '../../core/api.service';

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

  protected readonly row = signal<IntegrationRow | null>(null);
  protected readonly failed = signal('');

  ngOnInit(): void {
    this.reload();
  }

  protected modeLabel(mode: string): string {
    if (mode === 'stub') return 'Заглушка';
    if (mode === 'unknown') return 'Нет связи';
    if (mode === 'smtp' || mode === 'ami' || mode === 'http' || mode === 'channel') return 'Включён';
    return mode;
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
