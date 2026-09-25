import { DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { Router } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import {
  AccountService,
  CalendarEvent,
  ContractPerson,
  ContractSummary,
  DebtorCategory,
  SavedFilter,
} from '../../core/models';

@Component({
  selector: 'app-contracts-list',
  standalone: true,
  imports: [
    DecimalPipe, ReactiveFormsModule, MatTableModule, MatPaginatorModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatButtonModule,
  ],
  template: `
    <div class="page">
      <div class="page-header"><h2>Реестр задолженностей по договорам</h2></div>
      @if (summary(); as s) {
        <p>
          Лицевых счетов с задолженностью: <b>{{ s.ls_count }}</b>.
          Долг {{ s.principal | number: '1.2-2' }}, пеня {{ s.penalty | number: '1.2-2' }}.
          Мероприятия:
          @for (item of s.measures; track item.kind) { {{ item.kind }} {{ item.total }}; }
        </p>
      }
      @if (dial(); as rule) {
        <p>
          Обзвон: с {{ rule.dial_mobile_from_day }}-го числа и в выходные — только мобильный.
          @if (rule.dial_mobile_from_hour != null) {
            Часы только мобильного: {{ rule.dial_mobile_from_hour }}–{{ rule.dial_mobile_to_hour }}.
          }
        </p>
      }
      @if (auth.isSuperadmin()) {
        <div class="filters">
          <mat-form-field><mat-label>День месяца</mat-label><input matInput type="number" [formControl]="dialDay" /></mat-form-field>
          <mat-form-field><mat-label>Час с</mat-label><input matInput type="number" [formControl]="dialFrom" /></mat-form-field>
          <mat-form-field><mat-label>Час до</mat-label><input matInput type="number" [formControl]="dialTo" /></mat-form-field>
          <button mat-stroked-button (click)="saveDial()">Сохранить правило обзвона</button>
        </div>
      }
      <div class="filters">
        <mat-form-field>
          <mat-label>Поиск: ФИО, номер ЛС, услуга, ИН, УНП</mat-label>
          <input matInput [formControl]="search" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Группы</mat-label>
          <mat-select [formControl]="groups" multiple>
            @for (g of [1, 2, 3, 4, 5, 6]; track g) { <mat-option [value]="g">{{ g }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Категория</mat-label>
          <mat-select [formControl]="category">
            <mat-option value="">Все</mat-option>
            @for (item of categories(); track item.id) { <mat-option [value]="item.id">{{ item.name }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Этап</mat-label>
          <mat-select [formControl]="stage">
            <mat-option value="">Все</mat-option>
            <mat-option value="new">Новый</mat-option>
            <mat-option value="prevention">Профилактика</mat-option>
            <mat-option value="warning">Предупреждение</mat-option>
            <mat-option value="disconnect">Отключение</mat-option>
            <mat-option value="enforcement">Взыскание</mat-option>
            <mat-option value="court">Суд</mat-option>
            <mat-option value="closed">Не должник</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field><mat-label>Обслуживающая организация, код</mat-label><input matInput [formControl]="billing" /></mat-form-field>
        <mat-form-field><mat-label>Имя фильтра</mat-label><input matInput [formControl]="filterName" /></mat-form-field>
        <button mat-stroked-button (click)="remember()">Сохранить фильтр</button>
        @for (item of saved(); track item.id) {
          <button mat-button (click)="apply(item)">{{ item.name }}</button>
        }
      </div>
      <div class="filters">
        <button mat-stroked-button (click)="showPersons()">Лица</button>
        <button mat-stroked-button (click)="showServices()">Услуги</button>
        <button mat-stroked-button (click)="showKanban()">Канбан</button>
        <button mat-stroked-button (click)="showCalendar()">Календарь</button>
        <mat-form-field>
          <mat-label>Группировка</mat-label>
          <mat-select [formControl]="groupBy">
            <mat-option value="">Нет</mat-option>
            <mat-option value="debt_group">Группа</mat-option>
            <mat-option value="provider">Поставщик</mat-option>
            <mat-option value="billing">Обслуживающая организация</mat-option>
            <mat-option value="category">Категория</mat-option>
          </mat-select>
        </mat-form-field>
      </div>
      @if (error()) { <p class="status-failed">{{ error() }}</p> }
      @if (view() === 'persons') {
        <table mat-table [dataSource]="persons()" class="mat-elevation-z1">
          <ng-container matColumnDef="payer"><th mat-header-cell *matHeaderCellDef>Должник</th><td mat-cell *matCellDef="let r">{{ r.payer }}</td></ng-container>
          <ng-container matColumnDef="payer_identifier"><th mat-header-cell *matHeaderCellDef>ИН</th><td mat-cell *matCellDef="let r">{{ r.payer_identifier }}</td></ng-container>
          <ng-container matColumnDef="payer_unp"><th mat-header-cell *matHeaderCellDef>УНП</th><td mat-cell *matCellDef="let r">{{ r.payer_unp }}</td></ng-container>
          <ng-container matColumnDef="ls_count"><th mat-header-cell *matHeaderCellDef>ЛС с долгом</th><td mat-cell *matCellDef="let r">{{ r.ls_count }}</td></ng-container>
          <ng-container matColumnDef="principal"><th mat-header-cell *matHeaderCellDef>Долг</th><td mat-cell *matCellDef="let r">{{ r.principal | number: '1.2-2' }}</td></ng-container>
          <ng-container matColumnDef="penalty"><th mat-header-cell *matHeaderCellDef>Пеня</th><td mat-cell *matCellDef="let r">{{ r.penalty | number: '1.2-2' }}</td></ng-container>
          <ng-container matColumnDef="earliest"><th mat-header-cell *matHeaderCellDef>Ранний период</th><td mat-cell *matCellDef="let r">{{ r.earliest }}</td></ng-container>
          <ng-container matColumnDef="category"><th mat-header-cell *matHeaderCellDef>Категория</th><td mat-cell *matCellDef="let r">{{ r.category }}</td></ng-container>
          <tr mat-header-row *matHeaderRowDef="personColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: personColumns" class="clickable-row" (click)="open(row.sample_id)"></tr>
        </table>
        <mat-paginator [length]="total()" [pageSize]="50" (page)="pageChanged($event)" />
      }
      @if (view() === 'services') {
        <table mat-table [dataSource]="rows()" class="mat-elevation-z1">
          <ng-container matColumnDef="payer"><th mat-header-cell *matHeaderCellDef>Должник</th><td mat-cell *matCellDef="let r">{{ r.payer }}</td></ng-container>
          <ng-container matColumnDef="payer_identifier"><th mat-header-cell *matHeaderCellDef>ИН</th><td mat-cell *matCellDef="let r">{{ r.payer_identifier }}</td></ng-container>
          <ng-container matColumnDef="payer_unp"><th mat-header-cell *matHeaderCellDef>УНП</th><td mat-cell *matCellDef="let r">{{ r.payer_unp }}</td></ng-container>
          <ng-container matColumnDef="account_number"><th mat-header-cell *matHeaderCellDef>ЛС</th><td mat-cell *matCellDef="let r">{{ r.account_number }}</td></ng-container>
          <ng-container matColumnDef="service_name"><th mat-header-cell *matHeaderCellDef>Услуга</th><td mat-cell *matCellDef="let r">{{ r.service_name }}</td></ng-container>
          <ng-container matColumnDef="shot_name"><th mat-header-cell *matHeaderCellDef>Поставщик</th><td mat-cell *matCellDef="let r">{{ r.shot_name }}</td></ng-container>
          <ng-container matColumnDef="billing_provider"><th mat-header-cell *matHeaderCellDef>Схема</th><td mat-cell *matCellDef="let r">{{ r.billing_provider }}</td></ng-container>
          <ng-container matColumnDef="balance_out"><th mat-header-cell *matHeaderCellDef>Долг</th><td mat-cell *matCellDef="let r">{{ r.balance_out | number: '1.2-2' }}</td></ng-container>
          <ng-container matColumnDef="balance_mulct_out"><th mat-header-cell *matHeaderCellDef>Пеня</th><td mat-cell *matCellDef="let r">{{ r.balance_mulct_out | number: '1.2-2' }}</td></ng-container>
          <ng-container matColumnDef="debt_started_on"><th mat-header-cell *matHeaderCellDef>Возникновение</th><td mat-cell *matCellDef="let r">{{ r.debt_started_on }}</td></ng-container>
          <ng-container matColumnDef="effective_group"><th mat-header-cell *matHeaderCellDef>Группа</th><td mat-cell *matCellDef="let r">{{ r.effective_group }}</td></ng-container>
          <ng-container matColumnDef="category_name"><th mat-header-cell *matHeaderCellDef>Категория</th><td mat-cell *matCellDef="let r">{{ r.category_name }}</td></ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr>
          <tr mat-row *matRowDef="let row; columns: columns" class="clickable-row" (click)="open(row.id)"></tr>
        </table>
        <mat-paginator [length]="total()" [pageSize]="50" (page)="pageChanged($event)" />
      }
      @if (view() === 'kanban') {
        <div class="filters">
          @for (column of kanban(); track column.stage) {
            <div>
              <h3>{{ column.title }} ({{ column.total }})</h3>
              @for (card of column.cards; track card.sample_id) {
                <p class="clickable-row" (click)="open(card.sample_id)">{{ card.payer }} · {{ card.ls_count }} ЛС · {{ card.principal }}</p>
              }
            </div>
          }
        </div>
      }
      @if (view() === 'calendar') {
        <div class="filters">
          <button mat-stroked-button (click)="shiftMonth(-1)">←</button>
          <span>{{ month }}</span>
          <button mat-stroked-button (click)="shiftMonth(1)">→</button>
        </div>
        @for (event of events(); track event.title + event.date) {
          <p>{{ event.date }} · {{ event.kind }} · {{ event.title }}</p>
        }
      }
      @if (view() === 'grouped') {
        <table mat-table [dataSource]="groupsRows()">
          <ng-container matColumnDef="value"><th mat-header-cell *matHeaderCellDef>Значение</th><td mat-cell *matCellDef="let r">{{ r.value }}</td></ng-container>
          <ng-container matColumnDef="accounts"><th mat-header-cell *matHeaderCellDef>ЛС</th><td mat-cell *matCellDef="let r">{{ r.accounts }}</td></ng-container>
          <ng-container matColumnDef="debt"><th mat-header-cell *matHeaderCellDef>Долг</th><td mat-cell *matCellDef="let r">{{ r.debt | number: '1.2-2' }}</td></ng-container>
          <ng-container matColumnDef="penalty"><th mat-header-cell *matHeaderCellDef>Пеня</th><td mat-cell *matCellDef="let r">{{ r.penalty | number: '1.2-2' }}</td></ng-container>
          <tr mat-header-row *matHeaderRowDef="groupColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: groupColumns"></tr>
        </table>
      }
    </div>
  `,
})
export class ContractsListComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly personColumns = [
    'payer', 'payer_identifier', 'payer_unp', 'ls_count', 'principal', 'penalty', 'earliest', 'category',
  ];
  protected readonly columns = [
    'payer', 'payer_identifier', 'payer_unp', 'account_number', 'service_name', 'shot_name', 'billing_provider',
    'balance_out', 'balance_mulct_out', 'debt_started_on', 'effective_group', 'category_name',
  ];
  protected readonly groupColumns = ['value', 'accounts', 'debt', 'penalty'];
  protected readonly view = signal<'persons' | 'services' | 'kanban' | 'calendar' | 'grouped'>('persons');
  protected readonly persons = signal<ContractPerson[]>([]);
  protected readonly rows = signal<AccountService[]>([]);
  protected readonly kanban = signal<{ stage: string; title: string; total: number; cards: ContractPerson[] }[]>([]);
  protected readonly events = signal<CalendarEvent[]>([]);
  protected readonly groupsRows = signal<{ value: string; accounts: number; debt: string | null; penalty: string | null }[]>([]);
  protected readonly summary = signal<ContractSummary | null>(null);
  protected readonly dial = signal<{ dial_mobile_from_day: number; dial_mobile_from_hour: number | null; dial_mobile_to_hour: number | null } | null>(null);
  protected readonly categories = signal<DebtorCategory[]>([]);
  protected readonly saved = signal<SavedFilter[]>([]);
  protected readonly total = signal(0);
  protected readonly error = signal('');
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly groups = new FormControl<number[]>([], { nonNullable: true });
  protected readonly category = new FormControl('', { nonNullable: true });
  protected readonly stage = new FormControl('', { nonNullable: true });
  protected readonly billing = new FormControl('', { nonNullable: true });
  protected readonly filterName = new FormControl('', { nonNullable: true });
  protected readonly groupBy = new FormControl('', { nonNullable: true });
  protected readonly dialDay = new FormControl(25, { nonNullable: true });
  protected readonly dialFrom = new FormControl<number | null>(null);
  protected readonly dialTo = new FormControl<number | null>(null);
  protected month = new Date().toISOString().slice(0, 7);
  private page = 1;

  ngOnInit(): void {
    this.search.valueChanges.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => this.reload());
    this.groups.valueChanges.subscribe(() => this.reload());
    this.category.valueChanges.subscribe(() => this.reload());
    this.stage.valueChanges.subscribe(() => this.reload());
    this.billing.valueChanges.pipe(debounceTime(300)).subscribe(() => this.reload());
    this.groupBy.valueChanges.subscribe((value) => value ? this.showGrouped() : this.showPersons());
    this.api.categories().subscribe((page) => this.categories.set(page.results));
    this.api.savedFilters('contracts').subscribe((page) => this.saved.set(page.results));
    this.api.dialSettings().subscribe((rule) => {
      this.dial.set(rule);
      this.dialDay.setValue(rule.dial_mobile_from_day);
      this.dialFrom.setValue(rule.dial_mobile_from_hour);
      this.dialTo.setValue(rule.dial_mobile_to_hour);
    });
    this.reload();
  }

  pageChanged(event: PageEvent): void {
    this.page = event.pageIndex + 1;
    this.reload();
  }

  open(id: number): void {
    this.router.navigate(['/contracts', id]);
  }

  showPersons(): void {
    this.view.set('persons');
    this.reload();
  }

  showServices(): void {
    this.view.set('services');
    this.reload();
  }

  showKanban(): void {
    this.view.set('kanban');
    this.api.contractKanban(this.query()).subscribe({
      next: (columns) => this.kanban.set(columns),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  showCalendar(): void {
    this.view.set('calendar');
    this.api.contractCalendar(this.month, this.query()).subscribe({
      next: (rows) => this.events.set(rows),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  showGrouped(): void {
    this.view.set('grouped');
    this.api.contractGrouped({ ...this.query(), group_by: this.groupBy.value }).subscribe({
      next: (rows) => this.groupsRows.set(rows),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  shiftMonth(delta: number): void {
    const [year, month] = this.month.split('-').map(Number);
    const next = new Date(year, month - 1 + delta, 1);
    this.month = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    this.showCalendar();
  }

  remember(): void {
    const name = this.filterName.value.trim();
    if (!name) return;
    this.api.saveFilter({ name, target: 'contracts', query: this.query() }).subscribe({
      next: () => this.api.savedFilters('contracts').subscribe((page) => this.saved.set(page.results)),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  apply(item: SavedFilter): void {
    const query = item.query;
    this.search.setValue(String(query['search'] ?? ''), { emitEvent: false });
    this.category.setValue(String(query['debtor_category'] ?? ''), { emitEvent: false });
    this.stage.setValue(String(query['funnel_stage'] ?? ''), { emitEvent: false });
    this.billing.setValue(String(query['billing_provider'] ?? ''), { emitEvent: false });
    const raw = String(query['debt_group__in'] ?? '');
    this.groups.setValue(raw ? raw.split(',').map(Number) : [], { emitEvent: false });
    this.reload();
  }

  saveDial(): void {
    this.api.saveDialSettings({
      dial_mobile_from_day: this.dialDay.value,
      dial_mobile_from_hour: this.dialFrom.value,
      dial_mobile_to_hour: this.dialTo.value,
    }).subscribe({
      next: (rule) => this.dial.set(rule),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  private reload(): void {
    const params = { ...this.query(), page: this.page, page_size: 50 };
    this.api.contractSummary(this.query()).subscribe({
      next: (row) => this.summary.set(row),
      error: (e) => this.error.set(errorMessage(e)),
    });
    if (this.view() === 'kanban') {
      this.showKanban();
      return;
    }
    if (this.view() === 'calendar') {
      this.showCalendar();
      return;
    }
    if (this.view() === 'grouped') {
      this.showGrouped();
      return;
    }
    if (this.view() === 'persons') {
      this.api.contractPersons(params).subscribe({
        next: (result) => {
          this.persons.set(result.results);
          this.total.set(result.count);
          this.error.set('');
        },
        error: (e) => this.error.set(errorMessage(e)),
      });
    }
    if (this.view() === 'services') {
      this.api.contracts(params).subscribe({
        next: (result) => {
          this.rows.set(result.results);
          this.total.set(result.count);
          this.error.set('');
        },
        error: (e) => this.error.set(errorMessage(e)),
      });
    }
  }

  private query(): Record<string, string | number | null> {
    return {
      search: this.search.value,
      debt_group__in: this.groups.value.join(','),
      debtor_category: this.category.value,
      funnel_stage: this.stage.value,
      billing_provider: this.billing.value,
    };
  }
}
