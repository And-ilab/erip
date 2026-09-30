import { DecimalPipe } from '@angular/common';
import { Component, HostListener, OnInit, inject, signal } from '@angular/core';
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

type CustomField = 'group' | 'category' | 'stage' | 'billing';

@Component({
  selector: 'app-contracts-list',
  standalone: true,
  imports: [
    DecimalPipe, ReactiveFormsModule, MatTableModule, MatPaginatorModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatButtonModule,
  ],
  template: `
    <div class="registry">
      <div class="control">
        <span class="crumb">Реестр договоров</span>
        <div class="search-wrap" (click)="$event.stopPropagation()">
          <div class="search" (click)="panelOpen.set(true)">
            @if (groups.value.length) {
              <button type="button" class="fchip" (click)="clearGroups($event)">Группа: {{ groups.value.join(', ') }} ×</button>
            }
            @if (category.value) {
              <button type="button" class="fchip" (click)="clearCategory($event)">Категория: {{ categoryLabel(category.value) }} ×</button>
            }
            @if (stage.value) {
              <button type="button" class="fchip" (click)="clearStage($event)">Этап: {{ stageLabel(stage.value) }} ×</button>
            }
            @if (billing.value) {
              <button type="button" class="fchip" (click)="clearBilling($event)">Организация: {{ billing.value }} ×</button>
            }
            @if (groupBy.value) {
              <button type="button" class="fchip" (click)="clearGroupByChip($event)">Группировать по: {{ groupByLabel(groupBy.value) }} ×</button>
            }
            <input
              [formControl]="search"
              placeholder="Поиск по ФИО, номеру ЛС, услуге, ИН, УНП…"
              (focus)="panelOpen.set(true)"
            />
            <button type="button" class="chevron" aria-label="Фильтры" [attr.aria-expanded]="panelOpen()" (click)="togglePanel($event)">▾</button>
          </div>
          @if (panelOpen()) {
            <div class="search-panel" role="dialog" aria-label="Фильтры реестра договоров">
              <div class="col">
                <div class="col-title">Фильтры</div>
                <div class="sub">Группа задолженности</div>
                <div class="pills">
                  @for (g of groupNumbers; track g) {
                    <button type="button" class="pill" [class.on]="groups.value.includes(g)" (click)="toggleGroup(g)">{{ g }}</button>
                  }
                </div>
                <div class="sub">Категория</div>
                @for (item of categories(); track item.id) {
                  <button type="button" class="menu-item" [class.on]="category.value === '' + item.id" (click)="setCategory(item.id)">{{ item.name }}</button>
                }
                <div class="sub">Этап</div>
                @for (item of stages; track item.id) {
                  <button type="button" class="menu-item" [class.on]="stage.value === item.id" (click)="setStage(item.id)">{{ item.label }}</button>
                }
                <div class="sub">Обслуживающая организация</div>
                <div class="save-row">
                  <input [formControl]="billing" placeholder="Название или код" (click)="$event.stopPropagation()" />
                </div>
                <button type="button" class="menu-add" (click)="customOpen.set(true)">+ Добавить пользовательский фильтр</button>
              </div>
              <div class="col">
                <div class="col-title">Группировать по</div>
                @for (item of groupOptions; track item.id) {
                  <button type="button" class="menu-item" [class.on]="groupBy.value === item.id" (click)="setGroupBy(item.id)">{{ item.label }}</button>
                }
              </div>
              <div class="col">
                <div class="col-title">Избранное</div>
                <div class="save-row">
                  <input [formControl]="filterName" placeholder="Имя фильтра" (click)="$event.stopPropagation()" />
                  <button type="button" (click)="remember()">Сохранить</button>
                </div>
                @for (item of saved(); track item.id) {
                  <button type="button" class="menu-item" (click)="apply(item)">★ {{ item.name }}</button>
                }
                @if (!saved().length) {
                  <p class="empty">Сохранённых наборов пока нет</p>
                }
              </div>
            </div>
          }
        </div>
        <div class="views">
          <button type="button" class="view-btn wide" [class.on]="view() === 'persons'" (click)="showPersons()">Лица</button>
          <button type="button" class="view-btn wide" [class.on]="view() === 'services'" (click)="showServices()">Услуги</button>
          <button type="button" class="view-btn" [class.on]="view() === 'kanban'" title="Канбан" (click)="showKanban()">▦</button>
          <button type="button" class="view-btn" [class.on]="view() === 'calendar'" title="Календарь" (click)="showCalendar()">▤</button>
        </div>
      </div>

      <div class="body">
        @if (summary(); as s) {
          <p class="hint">
            Лицевых счетов с задолженностью: <b>{{ s.ls_count }}</b>.
            Долг {{ s.principal | number: '1.2-2' }}, пеня {{ s.penalty | number: '1.2-2' }}.
            Мероприятия:
            @for (item of s.measures; track item.kind) { {{ item.kind }} {{ item.total }}; }
          </p>
        }
        @if (dial(); as rule) {
          <p class="hint">
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
        @if (error()) { <p class="status-failed">{{ error() }}</p> }
        @if (view() === 'persons') {
          <table mat-table [dataSource]="persons()">
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
          <table mat-table [dataSource]="rows()">
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
          <div class="board">
            @for (column of kanban(); track column.stage) {
              <section>
                <h3>{{ column.title }} ({{ column.total }})</h3>
                @for (card of column.cards; track card.sample_id) {
                  <article class="card g{{ card.debt_group ?? 0 }}" (click)="open(card.sample_id)">
                    <b>{{ card.payer }}</b>
                    <div class="muted">{{ card.ls_count }} ЛС</div>
                    <div>{{ card.principal | number: '1.2-2' }}</div>
                    @if (card.debt_group) { <span class="group-badge g{{ card.debt_group }}">{{ card.debt_group }}</span> }
                  </article>
                }
              </section>
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

      @if (customOpen()) {
        <div class="backdrop" (click)="customOpen.set(false)">
          <div class="dialog" (click)="$event.stopPropagation()" role="dialog" aria-label="Пользовательский фильтр">
            <h3>Добавить пользовательский фильтр</h3>
            <p class="hint">Одно условие: группа, категория, этап или обслуживающая организация.</p>
            <div class="filters">
              <mat-form-field>
                <mat-label>Поле</mat-label>
                <mat-select [formControl]="customField">
                  <mat-option value="group">Группа задолженности</mat-option>
                  <mat-option value="category">Категория</mat-option>
                  <mat-option value="stage">Этап воронки</mat-option>
                  <mat-option value="billing">Обслуживающая организация</mat-option>
                </mat-select>
              </mat-form-field>
              @if (customField.value === 'billing') {
                <mat-form-field>
                  <mat-label>Название или код</mat-label>
                  <input matInput [formControl]="customValue" />
                </mat-form-field>
              } @else {
                <mat-form-field>
                  <mat-label>Значение</mat-label>
                  <mat-select [formControl]="customValue">
                    @if (customField.value === 'group') {
                      @for (g of groupNumbers; track g) { <mat-option [value]="'' + g">Группа {{ g }}</mat-option> }
                    }
                    @if (customField.value === 'category') {
                      @for (item of categories(); track item.id) { <mat-option [value]="'' + item.id">{{ item.name }}</mat-option> }
                    }
                    @if (customField.value === 'stage') {
                      @for (item of stages; track item.id) { <mat-option [value]="item.id">{{ item.label }}</mat-option> }
                    }
                  </mat-select>
                </mat-form-field>
              }
            </div>
            <div class="dialog-actions">
              <button mat-flat-button color="primary" type="button" (click)="addCustom()">Добавить</button>
              <button mat-stroked-button type="button" (click)="customOpen.set(false)">Отмена</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .control {
      display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 16px;
      background: #f7f9fb; border-bottom: 1px solid var(--erip-border);
    }
    .crumb { color: var(--erip-muted); font-size: 13px; white-space: nowrap; }
    .search-wrap { position: relative; flex: 1; min-width: 0; }
    .search {
      display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 8px;
      background: #fff; border: 1px solid #d8dce0; border-radius: 4px;
    }
    .search input {
      flex: 1; min-width: 80px; border: 0; outline: none; background: transparent;
      font: inherit; font-size: 13px; color: #1f2933;
    }
    .fchip {
      border: 0; background: var(--erip-primary-soft); color: var(--erip-primary);
      border-radius: 3px; font-size: 12px; padding: 2px 8px; cursor: pointer; white-space: nowrap;
    }
    .chevron { border: 0; background: transparent; color: var(--erip-muted); cursor: pointer; font-size: 12px; padding: 4px; }
    .search-panel {
      position: absolute; z-index: 30; top: calc(100% + 4px); left: 0;
      display: grid; grid-template-columns: 1.2fr .9fr .9fr; width: min(860px, 100%);
      background: #fff; border: 1px solid var(--erip-border); border-radius: 6px;
      box-shadow: 0 8px 24px rgba(16, 42, 67, .16); max-height: 70vh;
    }
    .col { padding: 8px 0 12px; min-width: 0; overflow: auto; }
    .col + .col { border-left: 1px solid var(--erip-border); }
    .col-title {
      padding: 6px 16px 8px; font-size: 11px; font-weight: 700; letter-spacing: .04em;
      text-transform: uppercase; color: var(--erip-muted);
    }
    .sub { padding: 4px 16px; font-size: 12px; color: var(--erip-muted); }
    .pills { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 8px; }
    .pill, .menu-item, .menu-add, .save-row button, .view-btn { font: inherit; cursor: pointer; }
    .pill {
      min-width: 28px; height: 28px; padding: 0 8px; border: 1px solid var(--erip-border); border-radius: 4px;
      background: #fff; color: #1f2933;
    }
    .pill.on, .menu-item.on { background: var(--erip-primary-soft); color: var(--erip-primary); font-weight: 600; border-color: transparent; }
    .menu-item, .menu-add {
      display: block; width: 100%; text-align: left; border: 0; background: transparent;
      padding: 6px 16px; font-size: 13px; color: #1f2933;
    }
    .menu-item:hover, .menu-add:hover, .pill:hover { background: #f3f6f8; }
    .menu-add { color: var(--erip-link); }
    .save-row { display: flex; gap: 6px; padding: 0 12px 8px; }
    .save-row input {
      flex: 1; min-width: 0; height: 30px; border: 1px solid var(--erip-border); border-radius: 4px; padding: 0 8px; font: inherit;
    }
    .save-row button {
      height: 30px; padding: 0 10px; border: 0; border-radius: 4px; background: var(--erip-primary); color: #fff; font-size: 13px;
    }
    .empty { margin: 4px 16px; font-size: 12px; color: var(--erip-muted); }
    .view-btn {
      height: 32px; border: 1px solid #d8dce0; border-radius: 4px; background: #fff; color: #374151; width: 32px; font-size: 14px;
    }
    .view-btn.wide { width: auto; padding: 0 10px; font-size: 13px; }
    .view-btn.on { background: var(--erip-primary); color: #fff; border-color: var(--erip-primary); }
    .views { display: flex; gap: 4px; }
    .hint { margin: 0 0 8px; font-size: 13px; color: var(--erip-muted); }
    .body { padding: 16px 24px; }
    .board { display: flex; gap: 12px; overflow: auto; align-items: flex-start; }
    section { min-width: 220px; background: #fff; border: 1px solid var(--erip-border); border-top: 3px solid var(--erip-primary); border-radius: 8px; padding: 8px; }
    .card {
      border: 1px solid var(--erip-border); border-left: 4px solid #cbd5e1; border-radius: 6px; padding: 8px; margin-bottom: 8px;
      cursor: pointer; background: #fff; transition: box-shadow .15s;
    }
    .card:hover { box-shadow: 0 2px 6px rgba(16, 42, 67, .12); }
    .card.g1 { border-left-color: #22c55e; } .card.g2 { border-left-color: #84cc16; } .card.g3 { border-left-color: #eab308; }
    .card.g4 { border-left-color: #f97316; } .card.g5 { border-left-color: #ef4444; } .card.g6 { border-left-color: #7f1d1d; }
    .muted { color: var(--erip-muted); font-size: 12px; }
    h3 { margin: 0 0 8px; font-size: 14px; color: var(--erip-primary-dark); }
    .backdrop {
      position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center;
      background: rgba(20, 40, 55, .35);
    }
    .dialog { width: min(560px, calc(100vw - 32px)); background: #fff; border-radius: 8px; padding: 20px; box-shadow: 0 12px 32px rgba(16, 42, 67, .2); }
    .dialog h3 { margin: 0 0 8px; color: var(--erip-primary-dark); }
    .dialog-actions { display: flex; gap: 8px; margin-top: 8px; }
  `,
})
export class ContractsListComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly groupNumbers = [1, 2, 3, 4, 5, 6];
  protected readonly stages = [
    { id: 'new', label: 'Новый' },
    { id: 'prevention', label: 'Профилактика' },
    { id: 'warning', label: 'Предупреждение' },
    { id: 'disconnect', label: 'Отключение' },
    { id: 'enforcement', label: 'Взыскание' },
    { id: 'court', label: 'Суд' },
    { id: 'closed', label: 'Не должник' },
  ];
  protected readonly groupOptions = [
    { id: 'debt_group', label: 'Группа' },
    { id: 'provider', label: 'Поставщик' },
    { id: 'billing', label: 'Обслуживающая организация' },
    { id: 'category', label: 'Категория' },
  ];
  protected readonly personColumns = [
    'payer', 'payer_identifier', 'payer_unp', 'ls_count', 'principal', 'penalty', 'earliest', 'category',
  ];
  protected readonly columns = [
    'payer', 'payer_identifier', 'payer_unp', 'account_number', 'service_name', 'shot_name', 'billing_provider',
    'balance_out', 'balance_mulct_out', 'debt_started_on', 'effective_group', 'category_name',
  ];
  protected readonly groupColumns = ['value', 'accounts', 'debt', 'penalty'];
  protected readonly view = signal<'persons' | 'services' | 'kanban' | 'calendar' | 'grouped'>('persons');
  protected readonly panelOpen = signal(false);
  protected readonly customOpen = signal(false);
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
  protected readonly customField = new FormControl<CustomField>('group', { nonNullable: true });
  protected readonly customValue = new FormControl('', { nonNullable: true });
  protected readonly dialDay = new FormControl(25, { nonNullable: true });
  protected readonly dialFrom = new FormControl<number | null>(null);
  protected readonly dialTo = new FormControl<number | null>(null);
  protected month = new Date().toISOString().slice(0, 7);
  private page = 1;

  @HostListener('document:click')
  protected closeSearch(): void {
    this.panelOpen.set(false);
  }

  ngOnInit(): void {
    this.search.valueChanges.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => this.reload());
    this.groups.valueChanges.subscribe(() => this.reload());
    this.category.valueChanges.subscribe(() => this.reload());
    this.stage.valueChanges.subscribe(() => this.reload());
    this.billing.valueChanges.pipe(debounceTime(300)).subscribe(() => this.reload());
    this.groupBy.valueChanges.subscribe((value) => {
      if (value) this.showGrouped();
      else if (this.view() === 'grouped') this.showPersons();
    });
    this.customField.valueChanges.subscribe(() => this.customValue.setValue(''));
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

  stageLabel(id: string): string {
    return this.stages.find((item) => item.id === id)?.label ?? id;
  }

  categoryLabel(id: string): string {
    return this.categories().find((item) => String(item.id) === id)?.name ?? id;
  }

  groupByLabel(id: string): string {
    return this.groupOptions.find((item) => item.id === id)?.label ?? id;
  }

  togglePanel(event: Event): void {
    event.stopPropagation();
    this.panelOpen.update((open) => !open);
  }

  toggleGroup(group: number): void {
    const current = this.groups.value;
    const next = current.includes(group) ? current.filter((item) => item !== group) : [...current, group].sort((a, b) => a - b);
    this.groups.setValue(next);
  }

  setCategory(id: number): void {
    const value = String(id);
    this.category.setValue(this.category.value === value ? '' : value);
  }

  setStage(id: string): void {
    this.stage.setValue(this.stage.value === id ? '' : id);
  }

  setGroupBy(id: string): void {
    this.groupBy.setValue(this.groupBy.value === id ? '' : id);
  }

  clearGroups(event: Event): void {
    event.stopPropagation();
    this.groups.setValue([]);
  }

  clearCategory(event: Event): void {
    event.stopPropagation();
    this.category.setValue('');
  }

  clearStage(event: Event): void {
    event.stopPropagation();
    this.stage.setValue('');
  }

  clearBilling(event: Event): void {
    event.stopPropagation();
    this.billing.setValue('');
  }

  clearGroupByChip(event: Event): void {
    event.stopPropagation();
    this.groupBy.setValue('');
  }

  addCustom(): void {
    const value = this.customValue.value.trim();
    if (!value) return;
    if (this.customField.value === 'group') {
      const group = Number(value);
      if (!this.groups.value.includes(group)) this.toggleGroup(group);
    }
    if (this.customField.value === 'category') this.category.setValue(value);
    if (this.customField.value === 'stage') this.stage.setValue(value);
    if (this.customField.value === 'billing') this.billing.setValue(value);
    this.customOpen.set(false);
  }

  pageChanged(event: PageEvent): void {
    this.page = event.pageIndex + 1;
    this.reload();
  }

  open(id: number): void {
    this.router.navigate(['/contracts', id]);
  }

  showPersons(): void {
    this.dropGrouping();
    this.view.set('persons');
    this.reload();
  }

  showServices(): void {
    this.dropGrouping();
    this.view.set('services');
    this.reload();
  }

  showKanban(): void {
    this.dropGrouping();
    this.view.set('kanban');
    this.api.contractKanban(this.query()).subscribe({
      next: (columns) => this.kanban.set(columns),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  showCalendar(): void {
    this.dropGrouping();
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
    this.api.saveFilter({
      name,
      target: 'contracts',
      query: { ...this.query(), group_by: this.groupBy.value },
    }).subscribe({
      next: () => {
        this.filterName.setValue('');
        this.api.savedFilters('contracts').subscribe((page) => this.saved.set(page.results));
      },
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
    this.groups.setValue(raw ? raw.split(',').map(Number).filter((item) => item > 0) : [], { emitEvent: false });
    this.groupBy.setValue(String(query['group_by'] ?? ''), { emitEvent: false });
    this.panelOpen.set(false);
    if (this.groupBy.value) this.showGrouped();
    else this.reload();
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

  private dropGrouping(): void {
    if (this.groupBy.value) this.groupBy.setValue('', { emitEvent: false });
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
    if (this.groupBy.value || this.view() === 'grouped') {
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
