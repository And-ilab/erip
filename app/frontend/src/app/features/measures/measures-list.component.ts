import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DisconnectCandidate, MeasureGroup, MeasureMatrix } from '../../core/models';

const MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

@Component({
  selector: 'app-measures-list',
  standalone: true,
  imports: [
    DatePipe, FormsModule, ReactiveFormsModule, RouterLink, MatFormFieldModule, MatInputModule, MatButtonModule,
    MatIconModule, MatTooltipModule, MatCheckboxModule, MatSnackBarModule,
  ],
  template: `
    <div class="page">
      <div class="toolbar">
        <h2>Реестр мероприятий</h2>
        @if (view() !== 'ready') {
          <label class="searchbar">
            <mat-icon>search</mat-icon>
            @if (period.value) {
              <button type="button" class="period" (click)="period.setValue('')">Период: {{ periodLabel(period.value) }} ×</button>
            }
            <input [formControl]="search" placeholder="Поиск по ЛС, должнику, типу мероприятия..." />
            <input class="month" type="month" [formControl]="period" aria-label="Период" />
          </label>
        } @else {
          <p class="ready-title">Срок предупреждения истёк — можно приостанавливать услуги</p>
        }
        <div class="views">
          <button type="button" [class.on]="view() === 'list'" matTooltip="Список" (click)="show('list')">
            <mat-icon>view_list</mat-icon>
          </button>
          <button type="button" matTooltip="Матрица по типам" (click)="scrollMatrix()">
            <mat-icon>grid_on</mat-icon>
          </button>
          <button type="button" matTooltip="Скачать видимый список" (click)="download()">
            <mat-icon>download</mat-icon>
          </button>
          @if (canOrderDisconnect()) {
            <button type="button" [class.on]="view() === 'ready'" matTooltip="Готовы к отключению" (click)="show('ready')">
              <mat-icon>power_off</mat-icon>
            </button>
          }
        </div>
      </div>

      @if (view() === 'list') {
        <p class="guide">
          Группа 2: предупреждение, затем {{ waitDays() }} календарных дней на оплату (постановление № 465).
          Если долг остался — приостановление выбранных услуг.
          @if (canOrderDisconnect()) {
            <button type="button" (click)="show('ready')">К отключению</button>
          }
          Группы 3–6 ведутся во вкладке
          <a routerLink="/claims">претензионно-исковая работа</a>.
        </p>
      }

      @if (error()) { <p class="status-failed">{{ error() }}</p> }

      @if (view() === 'list') {
        @if (loaded() && !groups().length && !error()) {
          <p class="muted">За выбранные условия мероприятий нет.</p>
        }
        @if (groups().length) {
          <section class="surface registry">
            <table>
              <thead>
                <tr>
                  <th class="tick"></th>
                  <th>Мероприятие</th>
                  <th>Должник</th>
                  <th>Исполнитель</th>
                  <th>Следующее действие</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                @for (group of groups(); track group.status) {
                  <tr class="band">
                    <td colspan="6">
                      <button type="button" (click)="toggle(group.status)">
                        <mat-icon>{{ collapsed().has(group.status) ? 'chevron_right' : 'expand_more' }}</mat-icon>
                        {{ group.label }} ({{ group.total }})
                      </button>
                    </td>
                  </tr>
                  @if (!collapsed().has(group.status)) {
                    @for (row of group.results; track row.id) {
                      <tr>
                        <td class="tick">
                          <mat-checkbox [checked]="marked().has(row.id)" (change)="mark(row.id)" />
                        </td>
                        <td>
                          <a class="title" [routerLink]="['/measures', row.id]">{{ row.title }}</a>
                          @if (row.progress && row.progress.total > 1) {
                            <div class="mini">
                              <span class="track"><span [style.width.%]="share(row)"></span></span>
                              <span class="muted">{{ row.progress.done }} / {{ row.progress.total }} ЛС</span>
                            </div>
                          }
                          @if (row.artifact) { <a [href]="row.artifact">Файл</a> }
                        </td>
                        <td>
                          @if (row.debtor_id) {
                            <a [routerLink]="['/accounts', row.debtor_id]">{{ row.debtor_name || 'ЛС' }}</a>
                          } @else {
                            <span>{{ row.debtor_name || '—' }}</span>
                          }
                          @if (row.debtor_account) { <div class="muted">ЛС {{ row.debtor_account }}</div> }
                          @if (row.accounts_count > 1) {
                            <div class="muted">ещё {{ row.accounts_count - 1 }} ЛС</div>
                          }
                        </td>
                        <td>
                          @if (row.assignee_name) {
                            <span class="person" [matTooltip]="row.assignee_name">
                              <span class="face t{{ tone(row.assignee_name) }}">{{ initials(row.assignee_name) }}</span>
                            </span>
                          } @else {
                            <span class="dash">—</span>
                          }
                        </td>
                        <td><span class="action-dot {{ row.status }}"></span>{{ row.next_action }}</td>
                        <td><span class="status-pill {{ row.status }}">{{ row.status_display }}</span></td>
                      </tr>
                    }
                    @if (group.results.length < group.total) {
                      <tr class="more-row">
                        <td colspan="6">
                          <span class="muted">Показаны {{ group.results.length }} из {{ group.total }}</span>
                          <button mat-stroked-button type="button" (click)="more(group)">Показать ещё</button>
                        </td>
                      </tr>
                    }
                  }
                }
              </tbody>
            </table>
          </section>
        }
      }

      @if (view() !== 'ready') {
        @if (matrix(); as grid) {
          <section class="surface registry" id="measure-matrix">
            <h3><mat-icon>grid_on</mat-icon> Мероприятия по типам (представление «Матрица»)</h3>
            @if (grid.results.length < grid.total) {
              <div class="more">
                <span class="muted">Показаны {{ grid.results.length }} из {{ grid.total }}</span>
                <button mat-stroked-button type="button" (click)="moreMatrix()">Показать ещё</button>
              </div>
            }
            @if (!grid.results.length && !error()) {
              <p class="muted">За выбранные условия мероприятий нет.</p>
            }
            @if (grid.results.length) {
              <div class="matrix-wrap">
                <table class="matrix">
                  <thead>
                    <tr>
                      <th>ФИО должника</th>
                      <th>ЛС</th>
                      @for (kind of grid.kinds; track kind.code) { <th>{{ kind.label }}</th> }
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of grid.results; track row.account_id) {
                      <tr>
                        <td><a [routerLink]="['/accounts', row.account_id]">{{ row.debtor_name || 'ЛС' }}</a></td>
                        <td class="muted">{{ row.client_account }}</td>
                        @for (kind of grid.kinds; track kind.code) {
                          <td>
                            @if (row.cells[kind.code]; as cell) {
                              <a class="cell {{ cell.tone }}" [routerLink]="['/measures', cell.measure_id]">
                                <span class="action-dot {{ cell.status }}"></span>{{ cell.label }}
                              </a>
                            } @else {
                              <span class="muted">—</span>
                            }
                          </td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>
        }
      }

      @if (view() === 'ready') {
        <section class="surface group st-failed">
          <div class="group-head">
            <span>Срок предупреждения истёк</span>
            <span class="count">{{ candidates().length }}</span>
          </div>
          <p class="muted pad">
            Лицевые счета, где предупреждение вручено, срок оплаты прошёл, долг не погашен и услугу можно
            отключать за неоплату. Отметьте услуги и сформируйте задание поставщику.
          </p>
          @if (!candidates().length) {
            <p class="muted pad">Счетов, готовых к отключению, сейчас нет.</p>
          } @else {
            <table>
              <thead>
                <tr>
                  <th class="tick"></th>
                  <th>Должник</th>
                  <th>Предупреждение вручено</th>
                  <th>Срок оплаты истёк</th>
                  <th>Услуги</th>
                </tr>
              </thead>
              <tbody>
                @for (row of candidates(); track row.account_id) {
                  <tr>
                    <td class="tick">
                      <mat-checkbox [checked]="picked().has(row.account_id)" (change)="pickAccount(row)" />
                    </td>
                    <td>
                      <a [routerLink]="['/accounts', row.account_id]">{{ row.debtor_name || 'ЛС' }}</a>
                      <div class="muted">ЛС {{ row.client_account }}</div>
                      @if (row.refused) { <div class="kind-chip disconnect">акт об отказе</div> }
                    </td>
                    <td>{{ row.delivered_on | date: 'dd.MM.yyyy' }}</td>
                    <td>
                      {{ row.warning_due | date: 'dd.MM.yyyy' }}
                      @if (row.requires_approval) { <div class="kind-chip warning">нужно согласование</div> }
                    </td>
                    <td>
                      @for (service of row.services; track service.id) {
                        <div>
                          <mat-checkbox
                            [checked]="services().has(service.id)"
                            (change)="pickService(row, service.id)">
                            {{ service.name }}
                          </mat-checkbox>
                        </div>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
            <div class="more">
              <span class="muted">Отмечено счетов: {{ picked().size }}</span>
              <button mat-flat-button color="primary" [disabled]="busy() || !picked().size" (click)="launch()">
                Сформировать задание на отключение
              </button>
            </div>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
    h2 { margin: 0; font-size: 18px; color: var(--erip-primary-dark); white-space: nowrap; }
    .searchbar {
      flex: 1; display: flex; align-items: center; gap: 8px; min-width: 280px; height: 40px; padding: 0 10px;
      background: #fff; border: 1px solid var(--erip-border); border-radius: 8px;
    }
    .searchbar mat-icon { color: var(--erip-muted); font-size: 20px; width: 20px; height: 20px; }
    .searchbar input:not([type="month"]) { flex: 1; border: 0; outline: 0; font: inherit; background: transparent; min-width: 80px; }
    .period {
      border: 0; background: var(--erip-primary-soft); color: var(--erip-primary); border-radius: 999px;
      padding: 2px 8px; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap;
    }
    .month { flex: 0 0 9.2rem; width: 9.2rem; max-width: 9.2rem; min-width: 0; border: 0; color: var(--erip-muted); background: transparent; }
    .views { display: flex; gap: 4px; margin-left: auto; }
    .views button {
      width: 36px; height: 36px; border: 1px solid var(--erip-border); background: #fff; border-radius: 8px;
      color: var(--erip-muted); cursor: pointer; display: grid; place-items: center;
    }
    .views button.on { color: var(--erip-primary); border-color: var(--erip-primary); background: var(--erip-primary-soft); }
    .views mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .ready-title { margin: 0; color: var(--erip-muted); }
    .guide { margin: 0 0 12px; color: var(--erip-muted); font-size: 13px; }
    .guide button, .guide a { margin: 0 4px; }
    .guide button {
      border: 0; background: transparent; color: var(--erip-link); font: inherit; font-weight: 600; cursor: pointer; padding: 0;
    }
    .registry { margin-top: 12px; overflow: hidden; }
    .band td { background: #f7f9fb; padding: 0; }
    .band button {
      display: flex; align-items: center; gap: 4px; width: 100%; border: 0; background: transparent;
      padding: 8px 8px; font: inherit; font-weight: 700; color: #1f2933; cursor: pointer; text-align: left;
    }
    table { border: 0; border-radius: 0; }
    th { text-align: left; font-size: 12px; font-weight: 600; color: var(--erip-muted); padding: 8px 12px; background: #fff; }
    td { padding: 10px 12px; border-top: 1px solid var(--erip-border); vertical-align: middle; }
    .title { font-weight: 600; color: inherit; }
    .mini { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
    .track { display: block; width: 72px; height: 6px; border-radius: 3px; background: #e5e7eb; overflow: hidden; }
    .track span { display: block; height: 100%; background: #16a34a; }
    .person { display: inline-flex; }
    .dash { color: var(--erip-muted); }
    .more-row td { display: flex; align-items: center; gap: 12px; }
    .more { display: flex; align-items: center; gap: 12px; margin: 0; padding: 8px 12px 12px; }
    .tick { width: 40px; }
    .pad { padding: 0 12px 8px; }
    a.cell { text-decoration: none; }
    h3 {
      margin: 0; padding: 12px 12px 0; font-size: 15px; color: var(--erip-primary-dark);
      display: flex; align-items: center; gap: 6px;
    }
    h3 mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--erip-muted); }
    .group { margin-top: 12px; overflow: hidden; border-left: 4px solid #dc2626; }
    .group-head {
      display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 12px; border: 0;
      background: #fef2f2; font: inherit; font-weight: 700; color: #b91c1c;
    }
    .count { min-width: 22px; padding: 1px 8px; border-radius: 10px; background: #fff; font-size: 12px; font-weight: 700; }
    .matrix-wrap { overflow: auto; }
    .matrix { min-width: 860px; }
    .cell {
      display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 10px; font-size: 12px; font-weight: 700;
      background: #f3f4f6; color: var(--erip-muted);
    }
    .cell.pending { background: #dbeafe; color: #1d4ed8; }
    .cell.run { background: #fef3c7; color: #b45309; }
    .cell.done { background: #dcfce7; color: #15803d; }
    .cell.error { background: #fee2e2; color: #b91c1c; }
    .cell.wait { background: #fde68a; color: #92400e; }
    .cell.muted { background: #f3f4f6; color: #6b7280; }
  `,
})
export class MeasuresListComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly period = new FormControl('', { nonNullable: true });
  protected readonly view = signal<'list' | 'ready'>('list');
  protected readonly marked = signal<Set<number>>(new Set());
  protected readonly waitDays = signal(5);
  protected readonly groups = signal<MeasureGroup[]>([]);
  protected readonly matrix = signal<MeasureMatrix | null>(null);
  protected readonly candidates = signal<DisconnectCandidate[]>([]);
  protected readonly picked = signal<Set<number>>(new Set());
  protected readonly services = signal<Set<number>>(new Set());
  protected readonly collapsed = signal<Set<string>>(new Set());
  protected readonly error = signal('');
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  private request = 0;

  protected canOrderDisconnect(): boolean {
    return this.auth.canWrite() && this.auth.me()?.contour !== 'supplier';
  }

  ngOnInit(): void {
    this.search.valueChanges.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => this.load());
    this.period.valueChanges.subscribe(() => this.load());
    this.api.dialSettings().subscribe({
      next: (settings) => this.waitDays.set(settings.warning_wait_days || 5),
    });
    this.load();
  }

  protected show(mode: 'list' | 'ready'): void {
    this.view.set(mode);
    this.load();
  }

  protected mark(id: number): void {
    const next = new Set(this.marked());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.marked.set(next);
  }

  protected scrollMatrix(): void {
    if (this.view() !== 'list') {
      this.show('list');
      setTimeout(() => document.getElementById('measure-matrix')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    document.getElementById('measure-matrix')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected download(): void {
    const lines = ['Мероприятие;Должник;ЛС;Исполнитель;Следующее действие;Статус'];
    const chosen = this.marked();
    for (const group of this.groups()) {
      for (const row of group.results) {
        if (chosen.size && !chosen.has(row.id)) continue;
        lines.push([row.title, row.debtor_name, row.debtor_account, row.assignee_name, row.next_action, row.status_display]
          .map((value) => `"${String(value || '').replaceAll('"', '""')}"`)
          .join(';'));
      }
    }
    const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'meropriyatiya.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /** Отметка счёта тянет за собой его услуги: отключать нечего, если ни одна не выбрана. */
  protected pickAccount(row: DisconnectCandidate): void {
    const accounts = new Set(this.picked());
    const services = new Set(this.services());
    if (accounts.has(row.account_id)) {
      accounts.delete(row.account_id);
      for (const service of row.services) services.delete(service.id);
    } else {
      accounts.add(row.account_id);
      for (const service of row.services) services.add(service.id);
    }
    this.picked.set(accounts);
    this.services.set(services);
  }

  protected pickService(row: DisconnectCandidate, id: number): void {
    const services = new Set(this.services());
    if (services.has(id)) services.delete(id);
    else services.add(id);
    this.services.set(services);
    const accounts = new Set(this.picked());
    if (row.services.some((service) => services.has(service.id))) accounts.add(row.account_id);
    else accounts.delete(row.account_id);
    this.picked.set(accounts);
  }

  protected launch(): void {
    const accounts = [...this.picked()];
    const services = this.candidates()
      .filter((row) => this.picked().has(row.account_id))
      .flatMap((row) => row.services.map((service) => service.id))
      .filter((id) => this.services().has(id));
    if (!services.length) {
      this.snack.open('Отметьте хотя бы одну услугу', 'OK');
      return;
    }
    this.busy.set(true);
    this.api.createMeasure({ kind: 'disconnect', account_ids: accounts, service_ids: services }).subscribe({
      next: (measure) => {
        this.busy.set(false);
        this.snack.open('Задание на отключение создано', 'OK', { duration: 3000 });
        this.router.navigate(['/measures', measure.id]);
      },
      error: (err) => {
        this.busy.set(false);
        this.snack.open(errorMessage(err), 'OK');
      },
    });
  }

  protected toggle(status: string): void {
    const next = new Set(this.collapsed());
    if (next.has(status)) next.delete(status);
    else next.add(status);
    this.collapsed.set(next);
  }

  protected periodLabel(value: string): string {
    const [year, month] = value.split('-');
    const name = MONTHS[Number(month) - 1] ?? value;
    return `${name} ${year}`;
  }

  protected initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
  }

  protected tone(name: string): number {
    let sum = 0;
    for (const ch of name) sum += ch.charCodeAt(0);
    return sum % 5;
  }

  protected share(row: { progress?: { total: number; done: number } }): number {
    const total = row.progress?.total ?? 0;
    return total ? Math.round(((row.progress?.done ?? 0) / total) * 100) : 0;
  }

  protected more(group: MeasureGroup): void {
    const current = this.request;
    const offset = group.results.length;
    this.api.measureRegistry(this.params({ status: group.status, offset })).subscribe({
      next: (payload) => {
        if (current !== this.request) return;
        const extra = payload.groups.find((item) => item.status === group.status);
        if (!extra) return;
        this.groups.update((groups) => groups.map((item) => item.status === group.status
          ? { ...item, total: extra.total, results: [...item.results, ...extra.results], shown: item.results.length + extra.results.length }
          : item));
      },
      error: (err) => {
        if (current === this.request) this.error.set(errorMessage(err));
      },
    });
  }

  protected moreMatrix(): void {
    const current = this.request;
    const grid = this.matrix();
    if (!grid) return;
    this.api.measureMatrix(this.params({ offset: grid.results.length })).subscribe({
      next: (payload) => {
        if (current !== this.request) return;
        const results = [...grid.results, ...payload.results];
        this.matrix.set({ ...payload, results, truncated: results.length < payload.total });
      },
      error: (err) => {
        if (current === this.request) this.error.set(errorMessage(err));
      },
    });
  }

  private params(extra: Record<string, string | number> = {}): Record<string, string | number> {
    return { search: this.search.value.trim(), period: this.period.value, ...extra };
  }

  private load(): void {
    const current = ++this.request;
    const params = this.params();
    this.error.set('');
    if (this.view() === 'ready') {
      this.api.readyToDisconnect().subscribe({
        next: (payload) => {
          if (current !== this.request) return;
          this.candidates.set(payload.results);
          this.picked.set(new Set());
          this.services.set(new Set());
        },
        error: (err) => {
          if (current === this.request) this.error.set(errorMessage(err));
        },
      });
      return;
    }
    this.loaded.set(false);
    this.api.measureRegistry(params).subscribe({
      next: (payload) => {
        if (current !== this.request) return;
        this.groups.set(payload.groups);
        this.loaded.set(true);
      },
      error: (err) => {
        if (current !== this.request) return;
        this.loaded.set(true);
        this.error.set(errorMessage(err));
      },
    });
    this.api.measureMatrix(params).subscribe({
      next: (payload) => {
        if (current === this.request) this.matrix.set(payload);
      },
      error: (err) => {
        if (current === this.request) this.error.set(errorMessage(err));
      },
    });
  }
}
