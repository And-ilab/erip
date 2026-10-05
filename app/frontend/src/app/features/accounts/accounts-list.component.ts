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
import { AuthService } from '../../core/auth.service';
import { AccountRow, CalendarEvent, KanbanColumn, MessageTemplate, SavedFilter, ServiceChoice } from '../../core/models';
import { AnalyticsComponent } from '../analytics/analytics.component';
import { RegistryViewsComponent } from '../registry-views.component';
import { CalendarBoardComponent, CalendarDraft, CalendarMode } from '../calendar/calendar-board.component';
import { AccountsMapComponent } from './accounts-map.component';

const LABELS: Record<string, string> = {
  account_id: 'Код ЛС',
  client_account: 'Номер ЛС',
  unified_account: 'УЕН',
  provider_short_name: 'Обслуживающая организация',
  schema_label: 'Схема',
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
    MatInputModule, MatSelectModule, MatButtonModule, MatSnackBarModule, AccountsMapComponent, AnalyticsComponent,
    CalendarBoardComponent, RegistryViewsComponent,
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
                @for (item of groupChoices(); track item.id) {
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
        @if (selectedCount()) {
          <span class="picked-count">Выбрано {{ selectedCount() }}</span>
          <button type="button" class="tool" (click)="clearSelection()">Снять</button>
        }
        @if (canLaunch()) {
          <button type="button" class="tool" (click)="measureOpen.set(!measureOpen())">Мероприятие</button>
        }
        <button type="button" class="tool" (click)="exportCsv()">CSV</button>
        <app-registry-views
          [mode]="view() === 'grouped' ? 'list' : view()"
          [map]="true"
          (modeChange)="showRegistry($event)" />
      </div>

      @if (measureOpen()) {
        <div class="measure">
          <p class="hint">
            @if (selectedCount()) {
              Мероприятие уйдёт по {{ selectedCount() }} выбранным лицевым счетам.
            } @else {
              Мероприятие уйдёт по всем лицевым счетам текущего фильтра.
            }
            Шаблон выбирается из списка. Поставщик отмечает свои услуги: в партию попадут только они.
          </p>
          <div class="filters">
            <mat-form-field>
              <mat-label>Мероприятие</mat-label>
              <mat-select [formControl]="measureKind">
                @for (item of measures; track item.id) { <mat-option [value]="item.id">{{ item.label }}</mat-option> }
              </mat-select>
            </mat-form-field>
            @if (needsTemplate()) {
              <mat-form-field>
                <mat-label>Шаблон</mat-label>
                <mat-select [formControl]="templateId">
                  @for (item of templateOptions(); track item.id) {
                    <mat-option [value]="item.id">{{ item.name }} ({{ item.channel_display }})</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            }
            @if (needsServices()) {
              <mat-form-field>
                <mat-label>Услуги</mat-label>
                <mat-select [formControl]="catalogServices" multiple>
                  @for (item of serviceChoices(); track item.service_id) {
                    <mat-option [value]="item.service_id">{{ item.service_name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
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
                  <mat-option value="email">E-mail</mat-option>
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

        @if (view() === 'charts') {
          <app-analytics />
        }

        @if (view() === 'list') {
          <table mat-table [dataSource]="rows()" matSort (matSortChange)="sortBy($event)">
            <ng-container matColumnDef="select">
              <th mat-header-cell *matHeaderCellDef>
                <input type="checkbox" aria-label="Выбрать страницу" [checked]="pageAllSelected()" (change)="togglePage($event)" />
              </th>
              <td mat-cell *matCellDef="let r" (click)="$event.stopPropagation()">
                <input type="checkbox" [attr.aria-label]="'Выбрать ЛС ' + r.client_account" [checked]="isSelected(r.id)" (change)="toggleRow(r, $event)" />
              </td>
            </ng-container>
            @for (name of columns(); track name) {
              <ng-container [matColumnDef]="name">
                <th mat-header-cell *matHeaderCellDef [mat-sort-header]="sortable(name) ? name : ''" [disabled]="!sortable(name)"
                    draggable="true" (dragstart)="startColumn($event, name)" (dragover)="allowColumn($event)" (drop)="dropColumn($event, name)">{{ label(name) }}</th>
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
            <tr mat-header-row *matHeaderRowDef="shownColumns()"></tr>
            <tr mat-row *matRowDef="let row; columns: shownColumns()" class="clickable-row" [class.picked]="isSelected(row.id)"
                [attr.data-account]="row.id" (pointerdown)="beginSelect($event, row)" (click)="openRow($event, row)"></tr>
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
          <div class="k-board">
            @for (column of board(); track column.stage) {
              <section class="k-col" [class.drop]="dropStage() === column.stage" [attr.data-stage]="column.stage"
                       (dragover)="allowDrop($event, column.stage)" (dragleave)="clearDrop(column.stage)" (drop)="dropOnStage($event, column.stage)">
                <h3><span>{{ column.title }}</span><b>{{ column.total }}</b></h3>
                @for (card of column.cards; track card.id) {
                  <article class="k-card g{{ card.effective_group ?? 0 }}" [class.picked]="isSelected(card.id)"
                           [draggable]="canMove()" (dragstart)="startCard($event, card)" (click)="openCard($event, card)">
                    <div class="name">{{ card.short_fio || 'Без ФИО' }}</div>
                    @if (canMove()) {
                      <button type="button" class="more" aria-label="Сменить этап" (click)="toggleStage($event, card.id)">
                        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2.5h4.5V7M13.2 2.8 7.2 8.8M7 3.5H3.5v9h9V9" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>
                      </button>
                    }
                    @if (stageMenu() === card.id) {
                      <div class="stage-menu" (click)="$event.stopPropagation()">
                        @for (item of stages; track item.id) {
                          <button type="button" [class.on]="(card.funnel_stage || 'new') === item.id" (click)="move(card, item.id)">{{ item.label }}</button>
                        }
                      </div>
                    }
                    <div class="line">ЛС {{ card.client_account }}@if (card.account_address) { · {{ street(card.account_address) }} }</div>
                    @if (card.effective_group) {
                      <div class="group-line">
                        <span class="letter">{{ letter(card.rating_label) }}</span>
                        <span>Группа {{ card.effective_group }}</span>
                      </div>
                    }
                    <div class="money">{{ money(card.debt_total) }} р. <small>+ пени {{ money(card.mulct_total) }} р.</small></div>
                    <div class="foot">
                      @if (mark(card); as note) {
                        <span class="when">
                          <svg class="cal" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.2" y="3.2" width="11.6" height="10.4" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.2 6.4h11.6M5 2v2.6M11 2v2.6" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>
                          {{ note }}
                        </span>
                      } @else { <span></span> }
                      @if (initials(card.assigned_name); as who) {
                        <span class="who" [style.background]="avatarColor(card.assigned_name)">{{ who }}</span>
                      }
                    </div>
                  </article>
                }
              </section>
            }
          </div>
        }

        @if (view() === 'calendar') {
          <app-calendar-board
            [events]="events()" [from]="spanFrom" [to]="spanTo" [mode]="calendarMode" [canCreate]="canLaunch()"
            [supplier]="supplierContour()" [templates]="templates()" [serviceChoices]="serviceChoices()"
            (modeChange)="calendarMode = $event" (spanChange)="setSpan($event)" (openEvent)="openCalendarEvent($event)"
            (createEvent)="submitCalendar($event)" (filters)="panelOpen.set(true)" />
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
    .view-btn.on, .charts-box.on { background: var(--erip-primary); color: #fff; border-color: var(--erip-primary); }
    .charts-box { margin-left: 10px; }
    .measure { padding: 10px 16px 0; background: #fff; border-bottom: 1px solid var(--erip-border); }
    .hint { margin: 0 0 8px; font-size: 13px; color: var(--erip-muted); }
    .body { padding: 16px 24px; }
    .k-board { display: flex; gap: 14px; overflow: auto; align-items: flex-start; padding-bottom: 12px; }
    .k-col { width: 268px; flex: 0 0 268px; }
    .k-col h3 {
      display: flex; justify-content: space-between; align-items: baseline; gap: 8px;
      margin: 0 0 8px; padding: 0 2px 6px; border-bottom: 3px solid #cbd5e1;
      font-size: 13px; font-weight: 600; color: #243140;
    }
    .k-col h3 b { font-weight: 600; color: #8b95a1; }
    .k-col[data-stage="new"] h3 { border-bottom-color: #1f9d55; }
    .k-col[data-stage="prevention"] h3 { border-bottom-color: #2563eb; }
    .k-col[data-stage="warning"] h3 { border-bottom-color: #e0a106; }
    .k-col[data-stage="disconnect"] h3 { border-bottom-color: #f08c2e; }
    .k-col[data-stage="enforcement"] h3 { border-bottom-color: #e53935; }
    .k-col[data-stage="court"] h3 { border-bottom-color: #8e2430; }
    .k-col[data-stage="closed"] h3 { border-bottom-color: #9ca3af; }
    .k-card {
      position: relative; background: #fff; border: 1px solid #e6ebf0; border-left: 3px solid #cbd5e1;
      border-radius: 8px; padding: 10px 12px 8px; margin-bottom: 8px; cursor: pointer;
      box-shadow: 0 1px 2px rgba(16, 42, 67, .06);
    }
    .k-card:hover { box-shadow: 0 2px 8px rgba(16, 42, 67, .12); }
    .k-card.picked, tr.picked { background: #e7f4f1; }
    .k-col.drop { outline: 2px dashed var(--erip-primary); outline-offset: 2px; border-radius: 8px; }
    .picked-count { font-size: 13px; color: var(--erip-primary); white-space: nowrap; }
    th[draggable="true"] { cursor: grab; }
    .k-card.g1 { border-left-color: #1f9d55; } .k-card.g2 { border-left-color: #c8962e; }
    .k-card.g3 { border-left-color: #ef6c00; } .k-card.g4 { border-left-color: #e53935; }
    .k-card.g5 { border-left-color: #c62828; } .k-card.g6 { border-left-color: #7f1d1d; }
    .k-card .name { font-weight: 700; font-size: 14px; line-height: 1.25; padding-right: 18px; color: #1f2933; }
    .k-card .more {
      position: absolute; top: 8px; right: 8px; width: 18px; height: 18px; padding: 0; border: 0;
      background: transparent; color: #9aa3ad; cursor: pointer;
    }
    .k-card .more svg { width: 14px; height: 14px; display: block; }
    .stage-menu {
      position: absolute; z-index: 5; top: 28px; right: 8px; min-width: 180px; padding: 4px;
      background: #fff; border: 1px solid var(--erip-border); border-radius: 6px;
      box-shadow: 0 8px 20px rgba(16, 42, 67, .16);
    }
    .stage-menu button {
      display: block; width: 100%; text-align: left; border: 0; background: transparent;
      padding: 6px 8px; font: inherit; font-size: 12px; border-radius: 4px; cursor: pointer;
    }
    .stage-menu button.on, .stage-menu button:hover { background: #f3f6f8; }
    .k-card .line { margin-top: 3px; font-size: 12px; line-height: 1.35; color: #6b7280; }
    .k-card .group-line { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12px; font-weight: 600; }
    .k-card .letter {
      width: 18px; height: 18px; border-radius: 50%; color: #fff; font-size: 11px; font-weight: 700;
      display: grid; place-items: center; background: #9ca3af;
    }
    .k-card.g1 .letter, .k-card.g1 .group-line { color: #1f9d55; } .k-card.g1 .letter { background: #1f9d55; color: #fff; }
    .k-card.g2 .letter, .k-card.g2 .group-line { color: #a16207; } .k-card.g2 .letter { background: #c8962e; color: #fff; }
    .k-card.g3 .letter, .k-card.g3 .group-line { color: #ef6c00; } .k-card.g3 .letter { background: #ef6c00; color: #fff; }
    .k-card.g4 .letter, .k-card.g4 .group-line { color: #e53935; } .k-card.g4 .letter { background: #e53935; color: #fff; }
    .k-card.g5 .letter, .k-card.g5 .group-line { color: #c62828; } .k-card.g5 .letter { background: #c62828; color: #fff; }
    .k-card.g6 .letter, .k-card.g6 .group-line { color: #7f1d1d; } .k-card.g6 .letter { background: #7f1d1d; color: #fff; }
    .k-card .money { margin-top: 6px; font-size: 13px; font-weight: 700; color: #1f2933; }
    .k-card .money small { font-weight: 400; color: #6b7280; }
    .k-card .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; min-height: 26px; }
    .k-card .when { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #6b7280; }
    .k-card .cal { width: 14px; height: 14px; flex: 0 0 14px; }
    .k-card .who {
      width: 26px; height: 26px; border-radius: 50%; color: #fff; font-size: 10px; font-weight: 700;
      display: grid; place-items: center; flex: 0 0 26px;
    }
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
  private readonly auth = inject(AuthService);

  protected readonly groups = [1, 2, 3, 4, 5, 6];
  protected readonly letters = ['A', 'B', 'C', 'D', 'E'];
  protected readonly stages = [
    { id: 'new', label: 'Новый должник' },
    { id: 'prevention', label: 'Автообзвон/уведомления' },
    { id: 'warning', label: 'Предупреждение вручено' },
    { id: 'disconnect', label: 'Отключение услуг' },
    { id: 'enforcement', label: 'Испол. надпись / иск' },
    { id: 'court', label: 'ОПИ' },
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
  protected readonly view = signal<'list' | 'kanban' | 'calendar' | 'grouped' | 'map' | 'charts'>('list');
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
  protected readonly stageMenu = signal<number | null>(null);
  protected readonly events = signal<CalendarEvent[]>([]);
  protected readonly filters = signal<SavedFilter[]>([]);
  protected readonly templates = signal<MessageTemplate[]>([]);
  protected readonly serviceChoices = signal<ServiceChoice[]>([]);
  protected readonly groupedRows = signal<{ value: string; accounts: number; debt: string | null }[]>([]);
  protected readonly selected = signal<Set<number>>(new Set());
  protected readonly dropStage = signal<string | null>(null);
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly groupsSelected = new FormControl<number[]>([], { nonNullable: true });
  protected readonly rating = new FormControl<string[]>([], { nonNullable: true });
  protected readonly stage = new FormControl('', { nonNullable: true });
  protected readonly groupBy = new FormControl('', { nonNullable: true });
  protected readonly filterName = new FormControl('', { nonNullable: true });
  protected readonly customField = new FormControl<CustomField>('group', { nonNullable: true });
  protected readonly customValue = new FormControl('', { nonNullable: true });
  protected readonly measureKind = new FormControl('call', { nonNullable: true });
  protected readonly templateId = new FormControl<number | null>(null);
  protected readonly catalogServices = new FormControl<number[]>([], { nonNullable: true });
  protected readonly timeFrom = new FormControl('09:00', { nonNullable: true });
  protected readonly timeTo = new FormControl('18:00', { nonNullable: true });
  protected readonly days = new FormControl('3', { nonNullable: true });
  protected readonly channel = new FormControl('email', { nonNullable: true });
  protected readonly scenarioName = new FormControl('', { nonNullable: true });
  protected readonly startedOn = new FormControl('', { nonNullable: true });
  protected readonly assignee = new FormControl('', { nonNullable: true });
  protected readonly dueOn = new FormControl('', { nonNullable: true });
  protected pageSize = 50;
  protected spanFrom = monthStart();
  protected spanTo = monthEnd();
  protected calendarMode: CalendarMode = 'month';
  private page = 1;
  private ordering = '';

  private selectAnchor: number | null = null;
  private pointerSelecting = false;
  private dragMoved = false;
  private cardDragged = false;
  private draggedColumn = '';

  @HostListener('document:click')
  protected closeSearch(): void {
    this.panelOpen.set(false);
    this.stageMenu.set(null);
  }

  @HostListener('document:pointermove', ['$event'])
  protected dragSelect(event: PointerEvent): void {
    if (!this.pointerSelecting || this.selectAnchor == null) return;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const row = element?.closest('tr[data-account]');
    const id = Number(row?.getAttribute('data-account'));
    if (!id) return;
    if (id !== this.selectAnchor) this.dragMoved = true;
    this.selectRange(this.selectAnchor, id);
  }

  @HostListener('document:pointerup')
  protected endSelect(): void {
    this.pointerSelecting = false;
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
      const saved = prefs.columns.length ? prefs.columns : [];
      const names = saved.filter((name) => name !== 'provider_short_name' || this.auth.showServiceOrg());
      if (this.auth.showSchema() && !names.includes('schema_label')) names.unshift('schema_label');
      if (names.length) this.columns.set(names);
    });
    this.api.savedFilters('accounts').subscribe((page) => this.filters.set(page.results));
    this.api.templates({ is_active: true, page_size: 200 }).subscribe({
      next: (page) => this.templates.set(page.results),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
    this.api.serviceChoices().subscribe({
      next: (page) => this.serviceChoices.set(page.results),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
    this.channel.valueChanges.subscribe(() => this.keepTemplateInList());
    this.reload(1);
  }

  label(name: string): string {
    return LABELS[name] ?? name;
  }

  stageLabel(id: string): string {
    return this.stages.find((item) => item.id === id)?.label ?? id;
  }

  groupByLabel(id: string): string {
    return this.groupChoices().find((item) => item.id === id)?.label ?? this.groupOptions.find((item) => item.id === id)?.label ?? id;
  }

  protected groupChoices(): { id: string; label: string }[] {
    const items = this.groupOptions.filter((item) => item.id !== 'provider' || this.auth.showServiceOrg());
    if (!this.auth.showSchema()) return items;
    return [{ id: 'schema', label: 'Схема' }, ...items];
  }

  protected canLaunch(): boolean {
    return this.auth.canWrite();
  }

  protected supplierContour(): boolean {
    return this.auth.me()?.contour === 'supplier';
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

  showRegistry(mode: string): void {
    if (mode === 'list') this.showList();
    else if (mode === 'kanban') this.showKanban();
    else if (mode === 'calendar') this.showCalendar();
    else if (mode === 'map') this.showMap();
    else if (mode === 'charts') this.showCharts();
  }

  showCharts(): void {
    this.dropGrouping();
    this.view.set('charts');
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

  setSpan(span: { from: string; to: string }): void {
    this.spanFrom = span.from;
    this.spanTo = span.to;
    this.loadCalendar();
  }

  protected openCalendarEvent(event: CalendarEvent): void {
    if (event.measure_id) this.router.navigate(['/measures', event.measure_id]);
    else if (event.account_id) this.router.navigate(['/accounts', event.account_id]);
  }

  protected submitCalendar(draft: CalendarDraft): void {
    const chosen = [...this.selected()];
    const body: Record<string, unknown> = chosen.length
      ? { kind: draft.kind, account_ids: chosen }
      : { kind: draft.kind, filters: this.query(), all_matching: true };
    this.fillEvent(body, draft);
    this.api.createMeasure(body).subscribe({
      next: (measure) => {
        this.snack.open(`${measure.kind_display}: ${measure.status_display}`, 'OK', { duration: 5000 });
        this.loadCalendar();
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  private fillEvent(body: Record<string, unknown>, draft: CalendarDraft): void {
    body['due_on'] = draft.date;
    body['started_on'] = draft.date;
    if (draft.template_name) body['template_name'] = draft.template_name;
    if (draft.catalog_service_ids) body['catalog_service_ids'] = draft.catalog_service_ids;
    if (draft.channel) body['channel'] = draft.channel;
    if (draft.time_from) {
      body['time_from'] = draft.time_from;
      body['time_to'] = draft.time_to;
      body['days'] = draft.days;
    }
    if (draft.scenario_name) body['scenario_name'] = draft.scenario_name;
    if (draft.assignee) body['assignee'] = draft.assignee;
  }

  protected canMove(): boolean {
    const me = this.auth.me();
    return !!me && me.role !== 'observer' && me.contour !== 'supplier';
  }

  protected shownColumns(): string[] {
    return ['select', ...this.columns()];
  }

  protected selectedCount(): number {
    return this.selected().size;
  }

  protected isSelected(id: number): boolean {
    return this.selected().has(id);
  }

  protected pageAllSelected(): boolean {
    const rows = this.rows();
    return rows.length > 0 && rows.every((row) => this.selected().has(row.id));
  }

  protected clearSelection(): void {
    this.selected.set(new Set());
  }

  protected togglePage(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const next = new Set(this.selected());
    for (const row of this.rows()) {
      if (checked) next.add(row.id);
      else next.delete(row.id);
    }
    this.selected.set(next);
  }

  protected toggleRow(row: AccountRow, event: Event): void {
    event.stopPropagation();
    const next = new Set(this.selected());
    if (next.has(row.id)) next.delete(row.id);
    else next.add(row.id);
    this.selected.set(next);
    this.selectAnchor = row.id;
  }

  protected beginSelect(event: PointerEvent, row: AccountRow): void {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('a, button, input')) return;
    this.pointerSelecting = true;
    this.dragMoved = false;
    if (!(event.shiftKey && this.selectAnchor != null)) this.selectAnchor = row.id;
  }

  protected openRow(event: MouseEvent, row: AccountRow): void {
    if (this.dragMoved) {
      this.dragMoved = false;
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('input, button, a')) return;
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      const next = new Set(this.selected());
      if (event.shiftKey && this.selectAnchor != null) this.selectRange(this.selectAnchor, row.id);
      else if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      if (!event.shiftKey) {
        this.selected.set(next);
        this.selectAnchor = row.id;
      }
      return;
    }
    this.open(row);
  }

  protected startColumn(event: DragEvent, name: string): void {
    this.draggedColumn = name;
    event.dataTransfer?.setData('text/plain', name);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  protected allowColumn(event: DragEvent): void {
    if (!this.draggedColumn) return;
    event.preventDefault();
  }

  protected dropColumn(event: DragEvent, name: string): void {
    event.preventDefault();
    const from = this.draggedColumn;
    this.draggedColumn = '';
    if (!from || from === name) return;
    const columns = [...this.columns()];
    const source = columns.indexOf(from);
    const target = columns.indexOf(name);
    if (source < 0 || target < 0) return;
    columns.splice(source, 1);
    columns.splice(target, 0, from);
    this.columns.set(columns);
    this.api.saveColumns(columns).subscribe({ error: (e) => this.snack.open(errorMessage(e), 'OK') });
  }

  protected startCard(event: DragEvent, card: AccountRow): void {
    if (!this.canMove()) {
      event.preventDefault();
      return;
    }
    this.cardDragged = true;
    const ids = this.selected().has(card.id) ? [...this.selected()] : [card.id];
    event.dataTransfer?.setData('text/plain', ids.join(','));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    event.stopPropagation();
  }

  protected allowDrop(event: DragEvent, stage: string): void {
    if (!this.canMove()) return;
    event.preventDefault();
    this.dropStage.set(stage);
  }

  protected clearDrop(stage: string): void {
    if (this.dropStage() === stage) this.dropStage.set(null);
  }

  protected dropOnStage(event: DragEvent, stage: string): void {
    event.preventDefault();
    this.dropStage.set(null);
    if (!this.canMove()) return;
    const raw = event.dataTransfer?.getData('text/plain') || '';
    const ids = raw.split(',').map((part) => Number(part)).filter((id) => id > 0);
    if (ids.length) this.moveIds(ids, stage);
  }

  protected openCard(event: MouseEvent, card: AccountRow): void {
    if (this.cardDragged) {
      this.cardDragged = false;
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      event.stopPropagation();
      const next = new Set(this.selected());
      if (next.has(card.id)) next.delete(card.id);
      else next.add(card.id);
      this.selected.set(next);
      return;
    }
    this.open(card);
  }

  private selectRange(fromId: number, toId: number): void {
    const ids = this.rows().map((row) => row.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    const [start, end] = from < to ? [from, to] : [to, from];
    this.selected.set(new Set(ids.slice(start, end + 1)));
  }

  private moveIds(ids: number[], stage: string): void {
    const pending = [...ids];
    const step = (): void => {
      const id = pending.shift();
      if (id == null) {
        this.selected.set(new Set());
        this.showKanban();
        return;
      }
      this.api.updateAccount(id, { funnel_stage: stage }).subscribe({
        next: () => step(),
        error: (e) => this.snack.open(errorMessage(e), 'OK'),
      });
    };
    step();
  }

  protected toggleStage(event: Event, id: number): void {
    event.stopPropagation();
    this.stageMenu.update((open) => open === id ? null : id);
  }

  protected letter(label: string): string {
    return (label || '—').slice(0, 1);
  }

  protected street(address: string): string {
    const lower = address.toLowerCase();
    const marks = ['ул.', 'ул ', 'пр-т', 'пр.', 'просп', 'пер.', 'б-р', 'тракт', 'пл.', 'ш.'];
    let cut = -1;
    for (const mark of marks) {
      const index = lower.indexOf(mark);
      if (index >= 0 && (cut < 0 || index < cut)) cut = index;
    }
    return (cut >= 0 ? address.slice(cut) : address).replace(/\s+/g, ' ').trim();
  }

  protected money(value: string | null): string {
    const number = Number(value ?? 0);
    if (Number.isNaN(number)) return '0,00';
    return number.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected mark(card: AccountRow): string {
    const stage = card.funnel_stage || 'new';
    if (stage === 'warning' && card.warning_handed_on) return `Вручено ${this.dayMonth(card.warning_handed_on)}`;
    if (stage === 'disconnect' && card.order_on) return `Наряд от ${this.dayMonth(card.order_on)}`;
    const filed = card.filed_on || card.package_on;
    if (stage === 'enforcement' && filed) return `Подано ${this.dayMonth(filed)}`;
    if (stage === 'court' && filed) return `Передано ${this.dayMonth(filed)}`;
    const due = stage === 'enforcement' || stage === 'court' ? (card.claim_due || card.warning_due) : (card.warning_due || card.claim_due);
    return due ? this.relative(due) : '';
  }

  protected initials(name: string): string {
    const parts = (name || '').split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('');
  }

  protected avatarColor(name: string): string {
    const palette = ['#2e7d32', '#7c3aed', '#ea580c', '#c62828', '#1d4ed8', '#0f766e'];
    let hash = 0;
    for (const char of name) hash = (hash + char.charCodeAt(0)) % palette.length;
    return palette[hash];
  }

  move(card: AccountRow, stage: string): void {
    this.stageMenu.set(null);
    this.moveIds([card.id], stage);
  }

  private dayMonth(iso: string): string {
    const parts = iso.slice(0, 10).split('-');
    return parts.length === 3 ? `${parts[2]}.${parts[1]}` : iso;
  }

  private relative(iso: string): string {
    const due = new Date(`${iso.slice(0, 10)}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
    if (Number.isNaN(diff)) return '';
    if (diff === 0) return 'Сегодня';
    if (diff === 1) return 'Завтра';
    if (diff === -1) return 'Вчера';
    if (diff > 1) return `Через ${diff} ${this.dayWord(diff)}`;
    const past = Math.abs(diff);
    return `${past} ${this.dayWord(past)} назад`;
  }

  private dayWord(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return 'день';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
    return 'дней';
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

  needsTemplate(): boolean {
    const kind = this.measureKind.value;
    return kind === 'call' || kind === 'notice' || kind === 'warning';
  }

  needsServices(): boolean {
    const kind = this.measureKind.value;
    if (kind === 'scenario') return false;
    if (this.auth.me()?.contour === 'supplier') return true;
    return kind === 'disconnect' || kind === 'collection';
  }

  templateOptions(): MessageTemplate[] {
    const all = this.templates();
    if (this.measureKind.value !== 'notice') return all;
    const channel = this.channel.value;
    if (channel !== 'email' && channel !== 'sms') return all;
    const matched = all.filter((item) => item.channel === channel);
    return matched.length ? matched : all;
  }

  launch(): void {
    const kind = this.measureKind.value;
    const template = this.templates().find((item) => item.id === this.templateId.value);
    if (this.needsTemplate() && !template) {
      this.snack.open('Выберите шаблон', 'OK');
      return;
    }
    if (this.needsServices() && !this.catalogServices.value.length) {
      const text = this.auth.me()?.contour === 'supplier'
        ? 'Выберите услуги своего поставщика'
        : 'Выберите услуги';
      this.snack.open(text, 'OK');
      return;
    }
    const chosen = [...this.selected()];
    const body: Record<string, unknown> = chosen.length
      ? { kind, account_ids: chosen }
      : { kind, filters: this.query(), all_matching: true };
    if (template) body['template_name'] = template.name;
    if (this.needsServices()) body['catalog_service_ids'] = this.catalogServices.value;
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

  private keepTemplateInList(): void {
    const selected = this.templateId.value;
    if (selected != null && !this.templateOptions().some((item) => item.id === selected)) {
      this.templateId.setValue(null);
    }
  }

  private dropGrouping(): void {
    if (this.groupBy.value) this.groupBy.setValue('', { emitEvent: false });
  }

  private loadCalendar(): void {
    this.api.calendar({ date_from: this.spanFrom, date_to: this.spanTo }, this.query()).subscribe({
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
    if (current === 'charts') return;
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

function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function monthEnd(): string {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}
