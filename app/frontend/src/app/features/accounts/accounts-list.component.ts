import { Component, HostListener, OnInit, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
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
import { AccountRow, CalendarEvent, KanbanColumn, SavedFilter } from '../../core/models';
import { AccountsMapComponent } from './accounts-map.component';

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

type CustomField = 'group' | 'rating' | 'stage';

@Component({
  selector: 'app-accounts-list',
  standalone: true,
  imports: [
    ReactiveFormsModule, MatTableModule, MatPaginatorModule, MatSortModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatButtonModule, MatSnackBarModule, AccountsMapComponent,
  ],
  template: `
    <div class="registry">
      <div class="control">
        <span class="crumb">Реестр ЛС</span>
        <div class="search-wrap" (click)="$event.stopPropagation()">
          <div class="search" (click)="panelOpen.set(true)">
            @if (groupsSelected.value.length) {
              <button type="button" class="fchip" (click)="clearGroups($event)">Группа: {{ groupsSelected.value.join(', ') }} ×</button>
            }
            @if (rating.value.length) {
              <button type="button" class="fchip" (click)="clearRating($event)">Рейтинг: {{ rating.value.join(', ') }} ×</button>
            }
            @if (stage.value) {
              <button type="button" class="fchip" (click)="clearStage($event)">Этап: {{ stageLabel(stage.value) }} ×</button>
            }
            @if (groupBy.value) {
              <button type="button" class="fchip" (click)="clearGroupByChip($event)">Группировать по: {{ groupByLabel(groupBy.value) }} ×</button>
            }
            @if (territoryName()) {
              <button type="button" class="fchip" (click)="clearTerritoryChip($event)">{{ territoryName() }} ×</button>
            }
            <input
              [formControl]="search"
              placeholder="Поиск по ФИО, номеру ЛС, адресу, ИН…"
              (focus)="panelOpen.set(true)"
            />
            <button type="button" class="chevron" aria-label="Фильтры" [attr.aria-expanded]="panelOpen()" (click)="togglePanel($event)">▾</button>
          </div>
          @if (panelOpen()) {
            <div class="search-panel" role="dialog" aria-label="Фильтры реестра">
              <div class="col">
                <div class="col-title">Фильтры</div>
                <div class="sub">Группа задолженности</div>
                <div class="pills">
                  @for (g of groups; track g) {
                    <button type="button" class="pill" [class.on]="groupsSelected.value.includes(g)" (click)="toggleGroup(g)">{{ g }}</button>
                  }
                </div>
                <div class="sub">Рейтинг</div>
                <div class="pills">
                  @for (letter of letters; track letter) {
                    <button type="button" class="pill" [class.on]="rating.value.includes(letter)" (click)="toggleRating(letter)">{{ letter }}</button>
                  }
                </div>
                <div class="sub">Этап</div>
                @for (item of stages; track item.id) {
                  <button type="button" class="menu-item" [class.on]="stage.value === item.id" (click)="setStage(item.id)">{{ item.label }}</button>
                }
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
                @for (item of filters(); track item.id) {
                  <button type="button" class="menu-item" (click)="applyFilter(item)">★ {{ item.name }}</button>
                }
                @if (!filters().length) {
                  <p class="empty">Сохранённых наборов пока нет</p>
                }
              </div>
            </div>
          }
        </div>
        <button type="button" class="tool" (click)="measureOpen.set(!measureOpen())">Мероприятие</button>
        <button type="button" class="tool" (click)="exportCsv()">CSV</button>
        <div class="views">
          <button type="button" class="view-btn" [class.on]="view() === 'list' || view() === 'grouped'" title="Список" (click)="showList()">≡</button>
          <button type="button" class="view-btn" [class.on]="view() === 'kanban'" title="Канбан" (click)="showKanban()">▦</button>
          <button type="button" class="view-btn" [class.on]="view() === 'calendar'" title="Календарь" (click)="showCalendar()">▤</button>
          <button type="button" class="view-btn" [class.on]="view() === 'map'" title="Карта" (click)="showMap()">⌖</button>
        </div>
      </div>

      @if (measureOpen()) {
        <div class="measure">
          <p class="hint">Мероприятие уйдёт по всем лицевым счетам текущего фильтра. Отключение и взыскание с выбором услуг — в карточке счёта.</p>
          <div class="filters">
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
            <button mat-flat-button color="primary" (click)="launch()">Запустить</button>
          </div>
        </div>
      }

      <div class="body">
        @if (error()) { <p class="status-failed">{{ error() }}</p> }

        @if (view() === 'map') {
          <app-accounts-map [query]="mapQuery()" (openList)="openTerritory($event)" />
        }

        @if (view() === 'list') {
          <table mat-table [dataSource]="rows()" matSort (matSortChange)="sortBy($event)">
            @for (name of columns(); track name) {
              <ng-container [matColumnDef]="name">
                <th mat-header-cell *matHeaderCellDef [mat-sort-header]="sortable(name) ? name : ''" [disabled]="!sortable(name)">{{ label(name) }}</th>
                <td mat-cell *matCellDef="let r" [class.amount-danger]="name === 'mulct_total' && +r.mulct_total > 0">
                  @switch (name) {
                    @case ('effective_group') { @if (r.effective_group) { <span class="group-badge g{{ r.effective_group }}">{{ r.effective_group }}</span> } }
                    @case ('rating_label') { @if (r.rating_label) { <span class="rating-badge r{{ r.rating_label[0] }}">{{ r.rating_label }}</span> } }
                    @case ('client_account') { <b class="account-no">{{ r.client_account }}</b> }
                    @case ('funnel_stage') { {{ stageLabel(r.funnel_stage) }} }
                    @default { {{ cell(r, name) }} }
                  }
                </td>
              </ng-container>
            }
            <tr mat-header-row *matHeaderRowDef="columns()"></tr>
            <tr mat-row *matRowDef="let row; columns: columns()" class="clickable-row" (click)="open(row)"></tr>
          </table>
          <mat-paginator [length]="total()" [pageSize]="pageSize" [pageSizeOptions]="[25, 50, 100]" (page)="pageChanged($event)" />
        }

        @if (view() === 'grouped') {
          <table mat-table [dataSource]="groupedRows()">
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
                  <article class="card g{{ card.effective_group ?? 0 }}" (click)="open(card)">
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

      @if (customOpen()) {
        <div class="backdrop" (click)="customOpen.set(false)">
          <div class="dialog" (click)="$event.stopPropagation()" role="dialog" aria-label="Пользовательский фильтр">
            <h3>Добавить пользовательский фильтр</h3>
            <p class="muted">Одно условие: группа, рейтинг или этап воронки.</p>
            <div class="filters">
              <mat-form-field>
                <mat-label>Поле</mat-label>
                <mat-select [formControl]="customField">
                  <mat-option value="group">Группа задолженности</mat-option>
                  <mat-option value="rating">Рейтинг</mat-option>
                  <mat-option value="stage">Этап воронки</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field>
                <mat-label>Значение</mat-label>
                <mat-select [formControl]="customValue">
                  @if (customField.value === 'group') {
                    @for (g of groups; track g) { <mat-option [value]="'' + g">Группа {{ g }}</mat-option> }
                  }
                  @if (customField.value === 'rating') {
                    @for (letter of letters; track letter) { <mat-option [value]="letter">{{ letter }}</mat-option> }
                  }
                  @if (customField.value === 'stage') {
                    @for (item of stages; track item.id) { <mat-option [value]="item.id">{{ item.label }}</mat-option> }
                  }
                </mat-select>
              </mat-form-field>
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
    .chevron {
      border: 0; background: transparent; color: var(--erip-muted); cursor: pointer; font-size: 12px; padding: 4px;
    }
    .search-panel {
      position: absolute; z-index: 30; top: calc(100% + 4px); left: 0;
      display: grid; grid-template-columns: 1.15fr 1fr .9fr; width: min(820px, 100%);
      background: #fff; border: 1px solid var(--erip-border); border-radius: 6px;
      box-shadow: 0 8px 24px rgba(16, 42, 67, .16);
    }
    .col { padding: 8px 0 12px; min-width: 0; }
    .col + .col { border-left: 1px solid var(--erip-border); }
    .col-title {
      padding: 6px 16px 8px; font-size: 11px; font-weight: 700; letter-spacing: .04em;
      text-transform: uppercase; color: var(--erip-muted);
    }
    .sub { padding: 4px 16px; font-size: 12px; color: var(--erip-muted); }
    .pills { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 8px; }
    .pill, .menu-item, .menu-add, .save-row button, .tool, .view-btn { font: inherit; cursor: pointer; }
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
    .tool, .view-btn {
      height: 32px; border: 1px solid #d8dce0; border-radius: 4px; background: #fff; color: #374151;
    }
    .tool { padding: 0 10px; font-size: 13px; white-space: nowrap; }
    .views { display: flex; gap: 4px; }
    .view-btn { width: 32px; font-size: 14px; }
    .view-btn.on { background: var(--erip-primary); color: #fff; border-color: var(--erip-primary); }
    .measure { padding: 10px 16px 0; background: #fff; border-bottom: 1px solid var(--erip-border); }
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
    h3 { margin: 0 0 8px; font-size: 14px; color: var(--erip-primary-dark); }
    .account-no { color: var(--erip-link); }
    .backdrop {
      position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center;
      background: rgba(20, 40, 55, .35);
    }
    .dialog { width: min(520px, calc(100vw - 32px)); background: #fff; border-radius: 8px; padding: 20px; box-shadow: 0 12px 32px rgba(16, 42, 67, .2); }
    .dialog h3 { margin: 0 0 8px; color: var(--erip-primary-dark); }
    .dialog-actions { display: flex; gap: 8px; margin-top: 8px; }
  `,
})
export class AccountsListComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  protected readonly groups = [1, 2, 3, 4, 5, 6];
  protected readonly letters = ['A', 'B', 'C', 'D', 'E'];
  protected readonly stages = [
    { id: 'new', label: 'Новый' },
    { id: 'prevention', label: 'Превентивные меры' },
    { id: 'warning', label: 'Предупреждение' },
    { id: 'disconnect', label: 'Отключение' },
    { id: 'enforcement', label: 'Взыскание' },
    { id: 'court', label: 'Суд / ОПИ' },
    { id: 'closed', label: 'Не должник' },
  ];
  protected readonly groupOptions = [
    { id: 'provider', label: 'Организация' },
    { id: 'debt_group', label: 'Группа задолженности' },
    { id: 'rating', label: 'Рейтинг' },
    { id: 'category', label: 'Категория' },
    { id: 'specialist', label: 'Специалист' },
    { id: 'period', label: 'Период' },
  ];
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
  protected readonly view = signal<'list' | 'kanban' | 'calendar' | 'grouped' | 'map'>('list');
  protected readonly panelOpen = signal(false);
  protected readonly customOpen = signal(false);
  protected readonly measureOpen = signal(false);
  protected readonly mapQuery = signal<Record<string, string | number | null>>({});
  protected readonly territoryId = signal<number | null>(null);
  protected readonly territoryName = signal('');
  protected readonly columns = signal<string[]>([
    'client_account', 'short_fio', 'account_address', 'rating_label', 'funnel_stage',
    'debt_total', 'mulct_total', 'effective_group', 'assigned_name',
  ]);
  protected readonly board = signal<KanbanColumn[]>([]);
  protected readonly events = signal<CalendarEvent[]>([]);
  protected readonly filters = signal<SavedFilter[]>([]);
  protected readonly groupedRows = signal<{ value: string; accounts: number; debt: string | null }[]>([]);
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly groupsSelected = new FormControl<number[]>([], { nonNullable: true });
  protected readonly rating = new FormControl<string[]>([], { nonNullable: true });
  protected readonly stage = new FormControl('', { nonNullable: true });
  protected readonly groupBy = new FormControl('', { nonNullable: true });
  protected readonly filterName = new FormControl('', { nonNullable: true });
  protected readonly customField = new FormControl<CustomField>('group', { nonNullable: true });
  protected readonly customValue = new FormControl('', { nonNullable: true });
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

  @HostListener('document:click')
  protected closeSearch(): void {
    this.panelOpen.set(false);
  }

  ngOnInit(): void {
    this.search.valueChanges.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => this.onFilter());
    this.groupsSelected.valueChanges.subscribe(() => this.onFilter());
    this.rating.valueChanges.subscribe(() => this.onFilter());
    this.stage.valueChanges.subscribe(() => this.onFilter());
    this.groupBy.valueChanges.subscribe((value) => {
      if (value) this.showGrouped();
      else if (this.view() === 'grouped') this.reload(1);
    });
    this.customField.valueChanges.subscribe(() => this.customValue.setValue(''));
    this.api.columns().subscribe((prefs) => {
      if (prefs.columns.length) this.columns.set(prefs.columns);
    });
    this.api.savedFilters('accounts').subscribe((page) => this.filters.set(page.results));
    this.reload(1);
  }

  label(name: string): string {
    return LABELS[name] ?? name;
  }

  stageLabel(id: string): string {
    return this.stages.find((item) => item.id === id)?.label ?? id;
  }

  groupByLabel(id: string): string {
    return this.groupOptions.find((item) => item.id === id)?.label ?? id;
  }

  sortable(name: string): boolean {
    return ['client_account', 'short_fio', 'effective_group', 'rating_label', 'months_debt', 'funnel_stage', 'debt_started_on', 'subj_count'].includes(name);
  }

  cell(row: AccountRow, name: string): string {
    const value = row[name as keyof AccountRow];
    if (name === 'effective_group') return value ? String(value) : '';
    return value == null ? '' : String(value);
  }

  togglePanel(event: Event): void {
    event.stopPropagation();
    this.panelOpen.update((open) => !open);
  }

  toggleGroup(group: number): void {
    const current = this.groupsSelected.value;
    const next = current.includes(group) ? current.filter((item) => item !== group) : [...current, group].sort((a, b) => a - b);
    this.groupsSelected.setValue(next);
  }

  toggleRating(letter: string): void {
    const current = this.rating.value;
    const next = current.includes(letter)
      ? current.filter((item) => item !== letter)
      : [...current, letter].sort();
    this.rating.setValue(next);
  }

  setStage(id: string): void {
    this.stage.setValue(this.stage.value === id ? '' : id);
  }

  setGroupBy(id: string): void {
    this.groupBy.setValue(this.groupBy.value === id ? '' : id);
  }

  clearGroups(event: Event): void {
    event.stopPropagation();
    this.groupsSelected.setValue([]);
  }

  clearRating(event: Event): void {
    event.stopPropagation();
    this.rating.setValue([]);
  }

  clearStage(event: Event): void {
    event.stopPropagation();
    this.stage.setValue('');
  }

  clearGroupByChip(event: Event): void {
    event.stopPropagation();
    this.groupBy.setValue('');
  }

  clearTerritoryChip(event: Event): void {
    event.stopPropagation();
    this.clearTerritory();
  }

  addCustom(): void {
    const value = this.customValue.value;
    if (!value) return;
    if (this.customField.value === 'group') {
      const group = Number(value);
      if (!this.groupsSelected.value.includes(group)) this.toggleGroup(group);
    }
    if (this.customField.value === 'rating' && !this.rating.value.includes(value)) this.toggleRating(value);
    if (this.customField.value === 'stage') this.stage.setValue(value);
    this.customOpen.set(false);
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

  showList(): void {
    this.dropGrouping();
    this.view.set('list');
    this.reload(1);
  }

  showKanban(): void {
    this.dropGrouping();
    this.view.set('kanban');
    this.api.kanban(this.query()).subscribe({
      next: (columns) => this.board.set(columns),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  showCalendar(): void {
    this.dropGrouping();
    this.view.set('calendar');
    this.loadCalendar();
  }

  showMap(): void {
    this.dropGrouping();
    this.territoryId.set(null);
    this.territoryName.set('');
    this.view.set('map');
    this.mapQuery.set(this.query());
  }

  openTerritory(node: { id: number; name: string }): void {
    this.territoryId.set(node.id);
    this.territoryName.set(node.name);
    this.view.set('list');
    this.reload(1);
  }

  clearTerritory(): void {
    this.territoryId.set(null);
    this.territoryName.set('');
    this.reload(1);
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
      next: () => {
        this.filterName.setValue('');
        this.api.savedFilters('accounts').subscribe((page) => this.filters.set(page.results));
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  applyFilter(item: SavedFilter | null): void {
    if (!item) return;
    this.search.setValue(String(item.query['q'] ?? ''), { emitEvent: false });
    this.groupsSelected.setValue(this.parseGroups(item.query['debt_group__in']), { emitEvent: false });
    this.rating.setValue(this.parseRatings(item.query['rating__in'] ?? item.query['rating']), { emitEvent: false });
    this.stage.setValue(String(item.query['funnel_stage'] ?? ''), { emitEvent: false });
    this.groupBy.setValue(String(item.query['group_by'] ?? ''), { emitEvent: false });
    this.panelOpen.set(false);
    if (this.groupBy.value) this.showGrouped();
    else this.reload(1);
  }

  launch(): void {
    const kind = this.measureKind.value;
    const body: Record<string, unknown> = { kind, filters: this.query(), all_matching: true };
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
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  private dropGrouping(): void {
    if (this.groupBy.value) this.groupBy.setValue('', { emitEvent: false });
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

  private parseRatings(value: unknown): string[] {
    return String(value ?? '').split(',').map((item) => item.trim()).filter((item) => this.letters.includes(item));
  }

  private query(): Record<string, string | number | null> {
    const selected = this.groupsSelected.value;
    return {
      q: this.search.value,
      debt_group__in: selected.length ? selected.join(',') : null,
      rating__in: this.rating.value.length ? this.rating.value.join(',') : null,
      funnel_stage: this.stage.value,
      group_by: this.groupBy.value,
      territory: this.territoryId(),
    };
  }

  private onFilter(): void {
    const current = this.view();
    if (current === 'map') {
      this.mapQuery.set(this.query());
      return;
    }
    if (this.groupBy.value) {
      this.showGrouped();
      return;
    }
    if (current === 'kanban') {
      this.showKanban();
      return;
    }
    if (current === 'calendar') {
      this.loadCalendar();
      return;
    }
    this.reload(1);
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
