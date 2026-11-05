import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ApiService, IntegrationRow, PrisCheckResult, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-integration-status',
  standalone: true,
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, MatSnackBarModule],
  template: `
    @if (isPris()) {
      <section class="card poll">
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
    }
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
          <div><dt>Режим</dt><dd>{{ modeLabel(item.status.mode) }}</dd></div>
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
        @if (sessionSummary()) {
          <p class="detail session">{{ sessionSummary() }}</p>
        }
        <section class="card checks">
          <h3>Проверка по методичке</h3>
          <p class="hint">
            Сценарии, которые тестовый контур уже закрыл. Кнопка сценария идёт по шагам по порядку методички.
            Ключ на экран не выводится. Повтор пакета и живое погашение отсюда не отправляются.
          </p>
          @for (scenario of prisScenarios; track scenario.id) {
            <div class="scenario">
              <div class="check-head">
                <h4>{{ scenario.title }}</h4>
                <button mat-flat-button color="primary" type="button" (click)="runScenario(scenario)" [disabled]="!!busy()">
                  {{ chain() === scenario.id ? 'Запрос…' : 'Проверить сценарий' }}
                </button>
              </div>
              <p class="hint">{{ scenario.hint }}</p>
              @for (step of scenario.steps; track step.id) {
                <div class="check">
                  <div class="check-head">
                    <button mat-stroked-button type="button" (click)="runCheck(step.id)" [disabled]="!!busy()">
                      {{ busy() === step.id ? 'Запрос…' : step.label }}
                    </button>
                    @if (checks()[step.id]; as result) {
                      <span class="pill" [class.on]="result.matched && result.ministry" [class.warn]="!(result.matched && result.ministry)">
                        {{ checkLabel(result) }}
                      </span>
                    }
                  </div>
                  @if (checks()[step.id]; as result) {
                    <p class="detail"><b>Ожидание.</b> {{ result.expected }}</p>
                    <p class="detail"><b>Ответ.</b> {{ result.summary }}</p>
                  }
                </div>
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
    .poll { margin-bottom: 16px; }
    .poll h3 { margin: 0 0 8px; }
    .period { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
    .period mat-form-field { width: 220px; }
    .checks { margin-top: 16px; max-width: 880px; }
    .session { margin: 12px 0 0; }
    .scenario { margin-top: 18px; }
    .scenario h4 { margin: 0; color: var(--erip-primary-dark); }
    .check { padding: 12px 0 0 12px; border-top: 1px solid var(--erip-border); }
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
  protected readonly chain = signal('');
  protected readonly checks = signal<Record<string, PrisCheckResult>>({});
  protected readonly sessionSummary = signal('');
  protected readonly pollMinutes = signal('');
  protected readonly pollNote = signal('');
  protected readonly prisScenarios = [
    {
      id: 'entry',
      title: 'Сценарий «Вход»',
      hint: 'Методичка: при входе в обмен с ПРИС модуль сам вызывает вход, затем адрес, Echo, версию, метрику и справочники.',
      steps: [
        { id: 's06', label: 'S-06 Вход' },
        { id: 's01', label: 'S-01 Адрес клиента' },
        { id: 's02', label: 'S-02 Echo' },
        { id: 's03', label: 'S-03 Версия' },
        { id: 's04', label: 'S-04 Метрика' },
        { id: 's05', label: 'S-05 Справочники' },
      ],
    },
    {
      id: 'token',
      title: 'Сценарий «Обновление токена»',
      hint: 'Отдельный выход методичка разрешает, чтобы проверить старый токен. Кнопка закрывает сессию и сразу открывает новую.',
      steps: [
        { id: 's07', label: 'S-07 Выход' },
      ],
    },
    {
      id: 'poll',
      title: 'Сценарий «Подача» — автоопрос',
      hint: 'Кнопки ниже повторяют номера из журнала 3–4 ноября и новое дело не создают. Рабочий опрос карточек — поле «Период, минуты» на этой вкладке.',
      steps: [
        { id: 'q02', label: 'Q-02 Номер задолженности' },
        { id: 'q03', label: 'Q-03 и P-02 После подачи' },
        { id: 'q01', label: 'Q-01 Номер производства' },
      ],
    },
    {
      id: 'negative',
      title: 'Негативы, которые контур закрыл',
      hint: 'Повтор этих двух шагов новую задолженность не создаёт.',
      steps: [
        { id: 'n01', label: 'N-01 Без токена' },
        { id: 'r03', label: 'R-03 Чужой номер' },
      ],
    },
  ];

  ngOnInit(): void {
    this.reload();
    if (this.isPris()) this.loadPoll();
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

  private loadPoll(): void {
    this.api.prisPoll().subscribe({
      next: (row) => {
        this.pollMinutes.set(row.interval_minutes == null ? '' : String(row.interval_minutes));
        this.pollNote.set(this.pollText(row.interval_minutes, row.last_tick_at, row.last_summary));
      },
      error: () => undefined,
    });
  }

  private pollText(minutes: number | null, lastTick: string | null, summary: string): string {
    if (minutes == null) return 'Автоопрос не идёт: период не задан.';
    const when = lastTick ? ` Последний опрос: ${lastTick}.` : ' Опрос ещё не выполнялся.';
    return `Период ${minutes} мин.${when} ${summary || ''}`.trim();
  }

  protected modeLabel(mode: string): string {
    if (mode === 'stub') return 'Не подключено';
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

  protected runScenario(scenario: { id: string; steps: { id: string }[] }): void {
    if (this.busy()) return;
    this.chain.set(scenario.id);
    this.play(scenario.steps.map((step) => step.id), 0);
  }

  protected runCheck(step: string): void {
    if (this.busy()) return;
    this.chain.set('');
    this.play([step], 0);
  }

  private play(steps: string[], index: number): void {
    if (index >= steps.length) {
      this.busy.set('');
      this.chain.set('');
      return;
    }
    const step = steps[index];
    this.busy.set(step);
    this.api.prisCheck(step).subscribe({
      next: (result) => {
        this.checks.update((row) => ({ ...row, [step]: result }));
        this.play(steps, index + 1);
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
        this.snack.open(detail, 'OK');
        this.play(steps, index + 1);
      },
    });
  }

  protected reload(): void {
    const code = this.route.snapshot.data['code'] || this.route.snapshot.paramMap.get('code') || '';
    if (code === 'pris' && this.auth.canManageTemplates()) {
      this.api.openPrisSession().subscribe({
        next: (row) => this.sessionSummary.set(row.summary),
        error: () => this.sessionSummary.set(''),
      });
    }
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
