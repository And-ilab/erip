import { DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { Router } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { ApiService, errorMessage } from '../../core/api.service';
import { AccountRow, AccountService, CalendarEvent, KanbanColumn, SavedFilter } from '../../core/models';

const LABELS: Record<string, string> = {
  account_id: 'Код ЛС',
  client_account: 'Номер ЛС',
  unified_account: 'УЕН',
  provider_short_name: 'Обслуживающая организация',
  account_address: 'Адрес',
  short_fio: 'Должник',
  payer_identifier: 'ИН',
  payer_unp: 'УНП',
  rating_label: 'Рейтинг',
  debt_started_on: 'Дата возникновения',
  debt_total: 'Долг',
  mulct_total: 'Пеня',
  effective_group: 'Группа',
  scenario_name: 'Сценарий',
  assigned_name: 'Специалист',
  ownership_type_name: 'Тип собственности',
  months_debt: 'Месяцев долга',
  subj_count: 'Проживающих',
  funnel_stage: 'Этап воронки',
};

@Component({
  selector: 'app-accounts-list',
  standalone: true,
  imports: [
    DecimalPipe, ReactiveFormsModule, MatTableModule, MatPaginatorModule, MatSortModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatButtonModule, MatCheckboxModule, MatSnackBarModule,
  ],
  template: `
    <div class="page">
      <div class="page-header">
        <h2>Реестр задолженностей по ЛС</h2>
        <button mat-stroked-button (click)="view.set('list')">Список</button>
        <button mat-stroked-button (click)="showKanban()">Канбан</button>
        <button mat-stroked-button (click)="showCalendar()">Календарь</button>
        <button mat-stroked-button (click)="exportCsv()">Экспорт CSV</button>
      </div>
      <div class="filters">
        <mat-form-field>
          <mat-label>Поиск: номер ЛС, ФИО, адрес, ИН</mat-label>
          <input matInput [formControl]="search" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Группы</mat-label>
          <mat-select [formControl]="groupsSelected" multiple>
            @for (g of groups; track g) { <mat-option [value]="g">Группа {{ g }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Рейтинг</mat-label>
          <mat-select [formControl]="rating">
            <mat-option value="">Все</mat-option>
            @for (letter of letters; track letter) { <mat-option [value]="letter">{{ letter }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Этап</mat-label>
          <mat-select [formControl]="stage">
            <mat-option value="">Все</mat-option>
            <mat-option value="new">Новый</mat-option>
            <mat-option value="prevention">Превентивные меры</mat-option>
            <mat-option value="warning">Предупреждение</mat-option>
            <mat-option value="disconnect">Отключение</mat-option>
            <mat-option value="enforcement">Взыскание</mat-option>
            <mat-option value="court">Суд / ОПИ</mat-option>
            <mat-option value="closed">Не должник</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Группировать по</mat-label>
          <mat-select [formControl]="groupBy">
            <mat-option value="">Без группировки</mat-option>
            <mat-option value="provider">Организация</mat-option>
            <mat-option value="debt_group">Группа задолженности</mat-option>
            <mat-option value="rating">Рейтинг</mat-option>
            <mat-option value="category">Категория</mat-option>
            <mat-option value="specialist">Специалист</mat-option>
            <mat-option value="period">Период</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Сохранённый фильтр</mat-label>
          <mat-select (selectionChange)="applyFilter($event.value)">
            <mat-option [value]="null">—</mat-option>
            @for (item of filters(); track item.id) { <mat-option [value]="item">{{ item.name }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Имя фильтра</mat-label>
          <input matInput [formControl]="filterName" />
        </mat-form-field>
        <button mat-stroked-button (click)="remember()">Сохранить фильтр</button>
      </div>
      @if (error()) { <p class="status-failed">{{ error() }}</p> }

      @if (view() === 'list') {
        <div class="filters">
          @for (name of available(); track name) {
            <mat-checkbox [checked]="columns().includes(name)" (change)="toggleColumn(name, $event.checked)">{{ label(name) }}</mat-checkbox>
          }
        </div>
        @if (selected().size || allMatching()) {
        <div class="filters">
          <span>Выбрано: {{ selected().size }} @if (allMatching()) { (все по фильтру) }</span>
          <mat-checkbox [checked]="allMatching()" (change)="allMatching.set($event.checked)">Все по фильтру</mat-checkbox>
          <mat-form-field>
            <mat-label>Мероприятие</mat-label>
            <mat-select [formControl]="measureKind">
              @for (item of measures; track item.id) { <mat-option [value]="item.id">{{ item.label }}</mat-option> }
            </mat-select>
          </mat-form-field>
          @if (measureKind.value === 'call' || measureKind.value === 'notice' || measureKind.value === 'warning') {
            <mat-form-field><mat-label>Шаблон</mat-label><input matInput [formControl]="templateName" /></mat-form-field>
          }
          @if (measureKind.value === 'call') {
            <mat-form-field><mat-label>Время с</mat-label><input matInput type="time" [formControl]="timeFrom" /></mat-form-field>
            <mat-form-field><mat-label>Время по</mat-label><input matInput type="time" [formControl]="timeTo" /></mat-form-field>
            <mat-form-field><mat-label>Дней</mat-label><input matInput type="number" [formControl]="days" /></mat-form-field>
          }
          @if (measureKind.value === 'notice') {
            <mat-form-field>
              <mat-label>Канал</mat-label>
              <mat-select [formControl]="channel">
                <mat-option value="sms">SMS</mat-option>
                <mat-option value="messenger">Мессенджер</mat-option>
                <mat-option value="email">E-mail</mat-option>
                <mat-option value="erip">Личный кабинет ЕРИП</mat-option>
                <mat-option value="letter">Письмо</mat-option>
              </mat-select>
            </mat-form-field>
          }
          @if (measureKind.value === 'scenario') {
            <mat-form-field><mat-label>Сценарий</mat-label><input matInput [formControl]="scenarioName" /></mat-form-field>
            <mat-form-field><mat-label>Дата начала</mat-label><input matInput type="date" [formControl]="startedOn" /></mat-form-field>
          }
          @if (measureKind.value === 'collection') {
            <mat-form-field><mat-label>Исполнитель (id)</mat-label><input matInput [formControl]="assignee" /></mat-form-field>
            <mat-form-field><mat-label>Срок</mat-label><input matInput type="date" [formControl]="dueOn" /></mat-form-field>
          }
          @if (serviceChoices().length) {
            @for (service of serviceChoices(); track service.id) {
              <mat-checkbox [checked]="pickedServices().has(service.id)" (change)="toggleService(service.id, $event.checked)">
                {{ service.service_name }} — {{ service.shot_name }}
              </mat-checkbox>
            }
          }
          <button mat-flat-button color="primary" (click)="launch()">Запустить</button>
        </div>
        }
        <table mat-table [dataSource]="rows()" matSort (matSortChange)="sortBy($event)" class="mat-elevation-z1">
          <ng-container matColumnDef="pick">
            <th mat-header-cell *matHeaderCellDef></th>
            <td mat-cell *matCellDef="let r" (click)="$event.stopPropagation()">
              <mat-checkbox [checked]="selected().has(r.id)" (change)="toggleRow(r.id, $event.checked)" />
            </td>
          </ng-container>
          @for (name of columns(); track name) {
            <ng-container [matColumnDef]="name">
              <th mat-header-cell *matHeaderCellDef [mat-sort-header]="sortable(name) ? name : ''" [disabled]="!sortable(name)">{{ label(name) }}</th>
              <td mat-cell *matCellDef="let r">{{ cell(r, name) }}</td>
            </ng-container>
          }
          <tr mat-header-row *matHeaderRowDef="shown()"></tr>
          <tr mat-row *matRowDef="let row; columns: shown()" class="clickable-row" (click)="open(row)"></tr>
        </table>
        <mat-paginator [length]="total()" [pageSize]="pageSize" [pageSizeOptions]="[25, 50, 100]" (page)="pageChanged($event)" />
      }

      @if (view() === 'grouped') {
        <table mat-table [dataSource]="groupedRows()" class="mat-elevation-z1">
          <ng-container matColumnDef="value"><th mat-header-cell *matHeaderCellDef>Значение</th><td mat-cell *matCellDef="let r">{{ r.value || '—' }}</td></ng-container>
          <ng-container matColumnDef="accounts"><th mat-header-cell *matHeaderCellDef>ЛС</th><td mat-cell *matCellDef="let r">{{ r.accounts }}</td></ng-container>
          <ng-container matColumnDef="debt"><th mat-header-cell *matHeaderCellDef>Сальдо</th><td mat-cell *matCellDef="let r">{{ r.debt }}</td></ng-container>
          <tr mat-header-row *matHeaderRowDef="['value', 'accounts', 'debt']"></tr>
          <tr mat-row *matRowDef="let row; columns: ['value', 'accounts', 'debt']"></tr>
        </table>
      }

      @if (view() === 'kanban') {
        <div class="board">
          @for (column of board(); track column.stage) {
            <section>
              <h3>{{ column.title }} <span class="muted">{{ column.cards.length }} из {{ column.total }}</span></h3>
              @for (card of column.cards; track card.id) {
                <article class="card" (click)="open(card)">
                  <b>{{ card.client_account }}</b>
                  <div>{{ card.short_fio }}</div>
                  <div class="muted">{{ card.account_address }}</div>
                  @if (card.effective_group) { <span class="group-badge g{{ card.effective_group }}">{{ card.effective_group }}</span> }
                  <mat-form-field (click)="$event.stopPropagation()">
                    <mat-label>Этап</mat-label>
                    <mat-select [value]="card.funnel_stage" (selectionChange)="move(card, $event.value)">
                      @for (column of board(); track column.stage) { <mat-option [value]="column.stage">{{ column.title }}</mat-option> }
                    </mat-select>
                  </mat-form-field>
                </article>
              }
            </section>
          }
        </div>
      }

      @if (view() === 'calendar') {
        <div class="filters">
          <mat-form-field>
            <mat-label>Месяц</mat-label>
            <input matInput type="month" [value]="month" (change)="setMonth($any($event.target).value)" />
          </mat-form-field>
        </div>
        @for (event of events(); track event.date + event.title) {
          <p><b>{{ event.date }}</b> · {{ event.kind }} · {{ event.title }}</p>
        }
      }
    </div>
  `,
  styles: `
    .board { display: flex; gap: 12px; overflow: auto; align-items: flex-start; }
    section { min-width: 220px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; }
    .card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px; margin-bottom: 8px; cursor: pointer; }
    h3 { margin: 0 0 8px; font-size: 14px; }
  `,
})
export class AccountsListComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  protected readonly groups = [1, 2, 3, 4, 5, 6];
  protected readonly letters = ['A', 'B', 'C', 'D', 'E'];
  protected readonly measures = [
    { id: 'call', label: 'Автообзвон' },
    { id: 'notice', label: 'Уведомление' },
    { id: 'warning', label: 'Предупреждение' },
    { id: 'disconnect', label: 'Отключение' },
    { id: 'collection', label: 'Взыскание' },
    { id: 'scenario', label: 'Смена сценария' },
  ];
  protected readonly rows = signal<AccountRow[]>([]);
  protected readonly total = signal(0);
  protected readonly error = signal('');
  protected readonly view = signal<'list' | 'kanban' | 'calendar' | 'grouped'>('list');
  protected readonly columns = signal<string[]>(['client_account', 'short_fio', 'account_address', 'provider_short_name', 'debt_total', 'effective_group']);
  protected readonly available = signal<string[]>([]);
  protected readonly selected = signal<Set<number>>(new Set());
  protected readonly allMatching = signal(false);
  protected readonly board = signal<KanbanColumn[]>([]);
  protected readonly events = signal<CalendarEvent[]>([]);
  protected readonly filters = signal<SavedFilter[]>([]);
  protected readonly serviceChoices = signal<AccountService[]>([]);
  protected readonly pickedServices = signal<Set<number>>(new Set());
  protected readonly groupedRows = signal<{ value: string; accounts: number; debt: string | null }[]>([]);
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly groupsSelected = new FormControl<number[]>([], { nonNullable: true });
  protected readonly rating = new FormControl('', { nonNullable: true });
  protected readonly stage = new FormControl('', { nonNullable: true });
  protected readonly groupBy = new FormControl('', { nonNullable: true });
  protected readonly filterName = new FormControl('', { nonNullable: true });
  protected readonly measureKind = new FormControl('call', { nonNullable: true });
  protected readonly templateName = new FormControl('', { nonNullable: true });
  protected readonly timeFrom = new FormControl('09:00', { nonNullable: true });
  protected readonly timeTo = new FormControl('18:00', { nonNullable: true });
  protected readonly days = new FormControl('3', { nonNullable: true });
  protected readonly channel = new FormControl('sms', { nonNullable: true });
  protected readonly scenarioName = new FormControl('', { nonNullable: true });
  protected readonly startedOn = new FormControl('', { nonNullable: true });
  protected readonly assignee = new FormControl('', { nonNullable: true });
  protected readonly dueOn = new FormControl('', { nonNullable: true });
  protected pageSize = 50;
  protected month = new Date().toISOString().slice(0, 7);
  private page = 1;
  private ordering = '';

  ngOnInit(): void {
    this.search.valueChanges.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => this.reload(1));
    this.groupsSelected.valueChanges.subscribe(() => this.reload(1));
    this.rating.valueChanges.subscribe(() => this.reload(1));
    this.stage.valueChanges.subscribe(() => this.reload(1));
    this.groupBy.valueChanges.subscribe((value) => {
      if (value) this.showGrouped();
      else this.reload(1);
    });
    this.api.columns().subscribe((prefs) => {
      this.available.set(prefs.available);
      if (prefs.columns.length) this.columns.set(prefs.columns);
    });
    this.api.savedFilters('accounts').subscribe((page) => this.filters.set(page.results));
    this.reload(1);
  }

  label(name: string): string {
    return LABELS[name] ?? name;
  }

  shown(): string[] {
    return ['pick', ...this.columns()];
  }

  sortable(name: string): boolean {
    return ['client_account', 'short_fio', 'effective_group', 'rating_label', 'months_debt', 'funnel_stage', 'debt_started_on', 'subj_count'].includes(name);
  }

  cell(row: AccountRow, name: string): string {
    const value = row[name as keyof AccountRow];
    if (name === 'effective_group') return value ? String(value) : '';
    return value == null ? '' : String(value);
  }

  pageChanged(event: PageEvent): void {
    this.pageSize = event.pageSize;
    this.reload(event.pageIndex + 1);
  }

  sortBy(sort: Sort): void {
    const field = sort.active === 'effective_group' ? 'debt_group' : sort.active === 'rating_label' ? 'rating' : sort.active;
    this.ordering = sort.direction ? `${sort.direction === 'desc' ? '-' : ''}${field}` : '';
    this.reload(1);
  }

  open(row: AccountRow): void {
    this.router.navigate(['/accounts', row.id]);
  }

  toggleColumn(name: string, on: boolean): void {
    const next = on ? [...this.columns(), name] : this.columns().filter((item) => item !== name);
    this.columns.set(this.available().filter((item) => next.includes(item)));
    this.api.saveColumns(this.columns()).subscribe();
  }

  toggleRow(id: number, on: boolean): void {
    const next = new Set(this.selected());
    if (on) next.add(id);
    else next.delete(id);
    this.selected.set(next);
  }

  showKanban(): void {
    this.view.set('kanban');
    this.api.kanban(this.query()).subscribe({
      next: (columns) => this.board.set(columns),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  showCalendar(): void {
    this.view.set('calendar');
    this.loadCalendar();
  }

  setMonth(value: string): void {
    this.month = value;
    this.loadCalendar();
  }

  move(card: AccountRow, stage: string): void {
    this.api.updateAccount(card.id, { funnel_stage: stage }).subscribe({
      next: () => this.showKanban(),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  exportCsv(): void {
    this.api.exportAccounts(this.query()).subscribe((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'accounts.csv';
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  remember(): void {
    const name = this.filterName.value.trim();
    if (!name) return;
    this.api.saveFilter({ name, target: 'accounts', query: this.query() }).subscribe({
      next: () => this.api.savedFilters('accounts').subscribe((page) => this.filters.set(page.results)),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  applyFilter(item: SavedFilter | null): void {
    if (!item) return;
    this.search.setValue(String(item.query['q'] ?? ''), { emitEvent: false });
    this.groupsSelected.setValue(this.parseGroups(item.query['debt_group__in']), { emitEvent: false });
    this.rating.setValue(String(item.query['rating'] ?? ''), { emitEvent: false });
    this.stage.setValue(String(item.query['funnel_stage'] ?? ''), { emitEvent: false });
    this.groupBy.setValue(String(item.query['group_by'] ?? ''), { emitEvent: false });
    if (this.groupBy.value) this.showGrouped();
    else this.reload(1);
  }

  toggleService(id: number, on: boolean): void {
    const next = new Set(this.pickedServices());
    if (on) next.add(id);
    else next.delete(id);
    this.pickedServices.set(next);
  }

  launch(): void {
    const kind = this.measureKind.value;
    const ids = [...this.selected()];
    if ((kind === 'disconnect' || kind === 'collection') && ids.length === 1 && !this.allMatching() && !this.pickedServices().size) {
      this.api.accountServices(ids[0], true).subscribe({
        next: (page) => this.serviceChoices.set(page.results.filter((row) => Number(row.balance_out) > 0 || Number(row.balance_mulct_out) > 0)),
        error: (e) => this.snack.open(errorMessage(e), 'OK'),
      });
      this.snack.open('Отметьте услуги и нажмите «Запустить» ещё раз', 'OK', { duration: 4000 });
      return;
    }
    const body: Record<string, unknown> = { kind, filters: this.query() };
    if (this.allMatching()) body['all_matching'] = true;
    else body['account_ids'] = ids;
    const serviceIds = [...this.pickedServices()];
    if (serviceIds.length) body['service_ids'] = serviceIds;
    if (kind === 'call' || kind === 'notice' || kind === 'warning') body['template_name'] = this.templateName.value;
    if (kind === 'call') {
      body['time_from'] = this.timeFrom.value;
      body['time_to'] = this.timeTo.value;
      body['days'] = this.days.value;
      body['started_on'] = new Date().toISOString().slice(0, 10);
    }
    if (kind === 'notice') body['channel'] = this.channel.value;
    if (kind === 'scenario') {
      body['scenario_name'] = this.scenarioName.value;
      body['started_on'] = this.startedOn.value;
    }
    if (kind === 'collection') {
      body['assignee'] = this.assignee.value;
      body['due_on'] = this.dueOn.value;
    }
    this.api.createMeasure(body).subscribe({
      next: (measure) => {
        const file = measure.artifact ? ` Файл: ${measure.artifact}` : '';
        this.snack.open(`${measure.kind_display}: ${measure.status_display}.${file}`, 'OK', { duration: 5000 });
        this.serviceChoices.set([]);
        this.pickedServices.set(new Set());
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  private loadCalendar(): void {
    this.api.calendar(this.month, this.query()).subscribe({
      next: (events) => this.events.set(events),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  private showGrouped(): void {
    this.view.set('grouped');
    this.api.grouped(this.query()).subscribe({
      next: (rows) => this.groupedRows.set(rows),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  private parseGroups(value: unknown): number[] {
    return String(value ?? '').split(',').map((item) => Number(item)).filter((item) => item > 0);
  }

  private query(): Record<string, string | number | null> {
    const selected = this.groupsSelected.value;
    return {
      q: this.search.value,
      debt_group__in: selected.length ? selected.join(',') : null,
      rating: this.rating.value,
      funnel_stage: this.stage.value,
      group_by: this.groupBy.value,
    };
  }

  private reload(page: number): void {
    this.page = page;
    if (this.groupBy.value) {
      this.showGrouped();
      return;
    }
    this.view.set('list');
    this.api.accounts({ page, page_size: this.pageSize, ordering: this.ordering, ...this.query() }).subscribe({
      next: (result) => {
        this.rows.set(result.results);
        this.total.set(result.count);
        this.error.set('');
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }
}
