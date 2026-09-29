import { Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { ApiService, errorMessage } from '../../core/api.service';
import { MeasureGroup, MeasureMatrix } from '../../core/models';

const MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

@Component({
  selector: 'app-measures-list',
  standalone: true,
  imports: [
    ReactiveFormsModule, RouterLink, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule,
    MatTooltipModule,
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
      </div>

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

      @if (error()) { <p class="status-failed">{{ error() }}</p> }

      @if (view() === 'list') {
        @if (!groups().length && !error()) {
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
                        <div class="title">{{ row.title }}</div>
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
              @if (group.shown < group.total) {
                <p class="more muted">Показаны первые {{ group.shown }} из {{ group.total }}.</p>
              }
            }
          </section>
        }
      }

      @if (view() === 'matrix') {
        @if (matrix(); as grid) {
          <section class="surface group">
            <h3>Мероприятия по типам</h3>
            @if (grid.truncated) {
              <p class="muted">Показаны первые {{ grid.results.length }} лицевых счетов из {{ grid.total }}.</p>
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
                              <span class="cell {{ cell.tone }}">{{ cell.label }}</span>
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
    .more { margin: 0; padding: 8px 12px 12px; }
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

  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly period = new FormControl('', { nonNullable: true });
  protected readonly view = signal<'list' | 'matrix'>('list');
  protected readonly groups = signal<MeasureGroup[]>([]);
  protected readonly matrix = signal<MeasureMatrix | null>(null);
  protected readonly collapsed = signal<Set<string>>(new Set());
  protected readonly error = signal('');
  private request = 0;

  ngOnInit(): void {
    this.search.valueChanges.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => this.load());
    this.period.valueChanges.subscribe(() => this.load());
    this.load();
  }

  protected show(mode: 'list' | 'matrix'): void {
    this.view.set(mode);
    this.load();
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

  private load(): void {
    const current = ++this.request;
    const params = { search: this.search.value.trim(), period: this.period.value };
    this.error.set('');
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
    this.api.measureRegistry(params).subscribe({
      next: (payload) => {
        if (current === this.request) this.groups.set(payload.groups);
      },
      error: (err) => {
        if (current === this.request) this.error.set(errorMessage(err));
      },
    });
  }
}
