import { Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

/** Субвкладки каналов. Новый канал — пункт здесь и маршрут в app.routes. */
export const INTEGRATION_TABS: { path: string; label: string }[] = [
  { path: 'smtp', label: 'SMTP' },
  { path: 'asterisk', label: 'Asterisk AMI' },
  { path: 'sms', label: 'SMS' },
  { path: 'messengers', label: 'Мессенджеры' },
  { path: 'belpochta', label: 'Белпочта' },
  { path: 'pris', label: 'АИС ПРИС' },
  { path: 'bnp', label: 'ЛК БНП' },
  { path: 'ais', label: 'АИС «Расчет-ЖКУ»' },
];

@Component({
  selector: 'app-settings-integrations',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatButtonModule, MatFormFieldModule, MatInputModule, MatSnackBarModule],
  template: `
    <p class="lead">Настройки каналов доставки и внешних систем. Секреты шлюза задаются в окружении сервера; здесь — статус и параметры схемы.</p>
    <section class="poll">
      <h3>Автоопрос АИС ПРИС</h3>
      <p class="muted">Пустое поле опрос не запускает: в регламенте периода нет. Судебный исполнитель принимает задолженность вручную, поэтому дело, переданное сегодня, служба спросит только на следующий день. Погашение уходит тогда же. В пакете уходит остаток на момент передачи; отдельное погашение в ту же секунду контур не примет.</p>
      <div class="period">
        <mat-form-field>
          <mat-label>Период, минуты</mat-label>
          <input matInput type="number" min="1" max="1440" inputmode="numeric"
            [value]="pollMinutes()" (input)="onPollInput($event)" [disabled]="!canEditPoll()" />
        </mat-form-field>
        @if (canEditPoll()) {
          <button mat-flat-button color="primary" type="button" (click)="savePoll()">Сохранить период</button>
        } @else {
          <p class="muted">Период меняет специалист, юрист или администратор.</p>
        }
      </div>
      @if (pollNote()) {
        <p class="muted">{{ pollNote() }}</p>
      }
    </section>
    <nav class="nested" aria-label="Интеграции">
      @for (tab of tabs; track tab.path) {
        <a [routerLink]="tab.path" routerLinkActive="on">{{ tab.label }}</a>
      }
    </nav>
    <router-outlet />
  `,
  styles: `
    .lead { margin: 0 0 12px; max-width: 72ch; color: var(--erip-muted); }
    .poll {
      background: #fff; border: 1px solid var(--erip-border); border-radius: 12px; padding: 16px;
      margin: 0 0 16px; max-width: 720px;
    }
    .poll h3 { margin: 0 0 8px; color: var(--erip-primary-dark); }
    .muted { color: var(--erip-muted); }
    .period { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
    .period mat-form-field { width: 220px; }
    .nested {
      display: flex; gap: 0; flex-wrap: wrap; border-bottom: 1px solid var(--erip-border); margin: 0 0 16px;
    }
    .nested a {
      padding: 8px 14px; margin-bottom: -1px; text-decoration: none; color: var(--erip-muted);
      font-weight: 600; border: 1px solid transparent; border-bottom: 0; border-radius: 8px 8px 0 0;
    }
    .nested a.on {
      color: var(--erip-primary-dark); background: #fff; border-color: var(--erip-border);
    }
  `,
})
export class SettingsIntegrationsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly snack = inject(MatSnackBar);

  protected readonly tabs = INTEGRATION_TABS;
  protected readonly pollMinutes = signal('');
  protected readonly pollNote = signal('');

  ngOnInit(): void {
    this.api.prisPoll().subscribe({
      next: (row) => {
        this.pollMinutes.set(row.interval_minutes == null ? '' : String(row.interval_minutes));
        this.pollNote.set(this.pollText(row.interval_minutes, row.last_tick_at, row.last_summary));
      },
      error: () => undefined,
    });
  }

  protected canEditPoll(): boolean {
    return ['superadmin', 'local_admin', 'specialist', 'legal'].includes(this.auth.me()?.role ?? '');
  }

  protected onPollInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.pollMinutes.set(input?.value ?? '');
  }

  protected savePoll(): void {
    const raw = this.pollMinutes().trim();
    const minutes = raw === '' ? null : Number(raw);
    if (minutes != null && !Number.isInteger(minutes)) {
      this.snack.open('Период указывают целым числом минут', 'OK');
      return;
    }
    this.api.savePrisPoll(minutes).subscribe({
      next: (row) => {
        this.pollMinutes.set(row.interval_minutes == null ? '' : String(row.interval_minutes));
        this.pollNote.set(this.pollText(row.interval_minutes, row.last_tick_at, row.last_summary));
        this.snack.open(row.interval_minutes == null ? 'Автоопрос выключен' : 'Период сохранён', 'OK');
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private pollText(minutes: number | null, lastTick: string | null, summary: string): string {
    if (minutes == null) return 'Автоопрос не идёт: период не задан.';
    const when = lastTick ? ` Последний опрос: ${lastTick}.` : ' Опрос ещё не выполнялся.';
    return `Период ${minutes} мин.${when} ${summary || ''}`.trim();
  }
}
