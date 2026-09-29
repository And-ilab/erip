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
      <div class="page-header">
        <h2>Реестр мероприятий</h2>
        <button mat-icon-button [class.active]="view() === 'list'" matTooltip="Список" (click)="show('list')">
          <mat-icon>view_list</mat-icon>
        </button>
        <button mat-icon-button [class.active]="view() === 'matrix'" matTooltip="Матрица по типам" (click)="show('matrix')">
          <mat-icon>grid_on</mat-icon>
        </button>
        <button
          mat-icon-button
          [class.active]="view() === 'ready'"
          matTooltip="Готовы к отключению"
          (click)="show('ready')">
          <mat-icon>power_off</mat-icon>
        </button>
      </div>

      @if (view() !== 'ready') {
        <div class="filters">
          <mat-form-field class="search">
            <mat-label>Поиск по ЛС, должнику, типу мероприятия</mat-label>
            <input matInput [formControl]="search" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Период</mat-label>
            <input matInput type="month" [formControl]="period" />
          </mat-form-field>
          @if (period.value) {
            <button type="button" class="chip" (click)="period.setValue('')">Период: {{ periodLabel(period.value) }} ×</button>
          }
        </div>
      }

      @if (error()) { <p class="status-failed">{{ error() }}</p> }

      @if (view() === 'list') {
        @if (loaded() && !groups().length && !error()) {
          <p class="muted">За выбранные условия мероприятий нет.</p>
        }
        @for (group of groups(); track group.status) {
          <section class="surface group">
            <button type="button" class="group-head" (click)="toggle(group.status)">
              <mat-icon>{{ collapsed().has(group.status) ? 'chevron_right' : 'expand_more' }}</mat-icon>
              <span>{{ group.label }}</span>
              <span class="muted">({{ group.total }})</span>
            </button>
            @if (!collapsed().has(group.status)) {
              <table>
                <thead>
                  <tr>
                    <th>Мероприятие</th>
                    <th>Должник</th>
                    <th>Исполнитель</th>
                    <th>Следующее действие</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of group.results; track row.id) {
                    <tr>
                      <td>
                        <a class="title" [routerLink]="['/measures', row.id]">{{ row.title }}</a>
                        @if (row.progress && row.progress.total) {
                          <div class="muted">ЛС завершено {{ row.progress.done }} из {{ row.progress.total }}</div>
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
                            <span class="avatar">{{ initials(row.assignee_name) }}</span>
                          </span>
                        } @else {
                          <span class="muted">—</span>
                        }
                      </td>
                      <td>{{ row.next_action }}</td>
                      <td><span class="pill {{ row.status }}">{{ row.status_display }}</span></td>
                    </tr>
                  }
                </tbody>
              </table>
              @if (group.results.length < group.total) {
                <div class="more">
                  <span class="muted">Показаны {{ group.results.length }} из {{ group.total }}</span>
                  <button mat-stroked-button type="button" (click)="more(group)">Показать ещё</button>
                </div>
              }
            }
          </section>
        }
      }

      @if (view() === 'matrix') {
        @if (matrix(); as grid) {
          <section class="surface group">
            <h3>Мероприятия по типам</h3>
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
                              <a class="cell {{ cell.tone }}" [routerLink]="['/measures', cell.measure_id]">{{ cell.label }}</a>
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
        <section class="surface group">
          <div class="group-head">
            <span>Срок предупреждения истёк</span>
            <span class="muted">({{ candidates().length }})</span>
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
                      @if (row.refused) { <div class="muted">вручено по акту об отказе</div> }
                    </td>
                    <td>{{ row.delivered_on | date: 'dd.MM.yyyy' }}</td>
                    <td>
                      {{ row.warning_due | date: 'dd.MM.yyyy' }}
                      @if (row.requires_approval) { <div class="muted">нужно согласование</div> }
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
    .search { min-width: 360px; }
    .page-header button.active { background: var(--erip-primary-soft); color: var(--erip-primary); }
    .group { margin-top: 12px; overflow: hidden; }
    .group-head {
      display: flex; align-items: center; gap: 4px; width: 100%; padding: 10px 12px; border: 0;
      background: #f7f9fb; font: inherit; font-weight: 600; color: var(--erip-primary-dark); cursor: pointer;
    }
    .group-head .muted { font-weight: 500; }
    table { border: 0; border-radius: 0; }
    th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .02em; color: var(--erip-muted); padding: 8px 12px; }
    td { padding: 10px 12px; border-top: 1px solid var(--erip-border); vertical-align: top; }
    .title { font-weight: 600; }
    .person { display: inline-flex; }
    .avatar {
      display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
      border-radius: 50%; background: var(--erip-primary); color: #fff; font-size: 11px; font-weight: 700;
    }
    .pill {
      display: inline-flex; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;
      background: var(--erip-primary-soft); color: var(--erip-primary);
    }
    .pill.assigned { background: var(--erip-primary-soft); color: var(--erip-link); }
    .pill.running { background: var(--erip-accent-soft); color: var(--erip-warning); }
    .pill.done { background: var(--erip-success-soft); color: var(--erip-success); }
    .pill.failed { background: var(--erip-danger-soft); color: var(--erip-danger); }
    .pill.paused { background: var(--erip-warning-soft); color: var(--erip-warning); }
    .pill.cancelled { background: #f3f4f6; color: var(--erip-muted); }
    .more { display: flex; align-items: center; gap: 12px; margin: 0; padding: 8px 12px 12px; }
    .tick { width: 40px; }
    .pad { padding: 0 12px 8px; }
    a.cell { text-decoration: none; }
    h3 { margin: 0; padding: 12px 12px 0; font-size: 15px; color: var(--erip-primary-dark); }
    .matrix-wrap { overflow: auto; }
    .matrix { min-width: 860px; }
    .cell {
      display: inline-flex; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 600;
      background: #f3f4f6; color: var(--erip-muted);
    }
    .cell.pending { background: var(--erip-primary-soft); color: var(--erip-link); }
    .cell.run { background: var(--erip-accent-soft); color: var(--erip-warning); }
    .cell.done { background: var(--erip-success-soft); color: var(--erip-success); }
    .cell.error { background: var(--erip-danger-soft); color: var(--erip-danger); }
    .cell.wait { background: var(--erip-warning-soft); color: var(--erip-warning); }
  `,
})
export class MeasuresListComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly period = new FormControl('', { nonNullable: true });
  protected readonly view = signal<'list' | 'matrix' | 'ready'>('list');
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

  ngOnInit(): void {
    this.search.valueChanges.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => this.load());
    this.period.valueChanges.subscribe(() => this.load());
    this.load();
  }

  protected show(mode: 'list' | 'matrix' | 'ready'): void {
    this.view.set(mode);
    this.load();
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
    if (this.view() === 'matrix') {
      this.api.measureMatrix(params).subscribe({
        next: (payload) => {
          if (current === this.request) this.matrix.set(payload);
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
  }
}
