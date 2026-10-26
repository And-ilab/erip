import { DatePipe } from '@angular/common';
import { Component, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CalendarEvent, DisconnectCandidate, MeasureGroup, MeasureMatrix, MeasureRow } from '../../core/models';
import { AnalyticsComponent } from '../analytics/analytics.component';
import { CalendarBoardComponent, CalendarMode } from '../calendar/calendar-board.component';
import { RegistryFilterComponent, RegistryChoice, RegistryFilterQuery } from '../registry-filter.component';
import { GridResizeDirective } from '../grid-resize.directive';
import { KanbanDebtorComponent } from '../kanban-debtor.component';
import { KanbanDragDirective } from '../kanban-drag.directive';
import { RegistryViewsComponent } from '../registry-views.component';

@Component({
  selector: 'app-measures-list',
  standalone: true,
  imports: [
    DatePipe, FormsModule, RouterLink, MatFormFieldModule, MatInputModule, MatButtonModule,
    MatIconModule, MatTooltipModule, MatCheckboxModule, MatSnackBarModule,
    RegistryViewsComponent, AnalyticsComponent, CalendarBoardComponent, RegistryFilterComponent, KanbanDebtorComponent,
    KanbanDragDirective, GridResizeDirective,
  ],
  template: `
    <div class="page" [class.board]="view() === 'kanban'">
      <div class="control">
        <h2>Реестр мероприятий</h2>
        @if (view() !== 'ready') {
          <app-registry-filter
            target="measures"
            placeholder="Поиск по ЛС, должнику, типу мероприятия..."
            [showMonth]="true"
            [showKind]="true"
            [groupChoices]="groupChoices"
            (queryChange)="onFilter($event)" />
        } @else {
          <p class="ready-title">Срок предупреждения истёк — можно приостанавливать услуги</p>
        }
        <button type="button" class="icon" matTooltip="Скачать видимый список" (click)="download()">
          <mat-icon>download</mat-icon>
        </button>
        @if (canOrderDisconnect()) {
          <button type="button" class="icon" [class.on]="view() === 'ready'" matTooltip="Готовы к отключению" (click)="show('ready')">
            <mat-icon>power_off</mat-icon>
          </button>
        }
        <app-registry-views [mockup]="true" [mode]="view() === 'ready' ? 'list' : view()" (modeChange)="showRegistry($event)" />
      </div>
      @if (canConduct() && view() === 'list') {
        <div class="conduct">
          <span class="muted">Отмечено мероприятий: {{ pickedRows().size }}</span>
          <button mat-flat-button color="primary" type="button" [disabled]="busy() || !pickedRows().size" (click)="conductPicked()">Провести</button>
        </div>
      }

      <div class="body">
      @if (error()) { <p class="status-failed">{{ error() }}</p> }

      @if (view() === 'list') {
        @if (loaded() && !groups().length && !error()) {
          <p class="muted">За выбранные условия мероприятий нет.</p>
        }
        @if (groups().length) {
          <section class="surface registry main">
            <div class="list-pane">
            <table class="wide" appGridResize="measures">
              <colgroup>
                <col class="c-tick" />
                <col class="c-kind" />
                <col class="c-period" />
                <col class="c-init" />
                <col class="c-account" />
                <col class="c-who" />
                <col class="c-next" />
                <col class="c-status" />
              </colgroup>
              <thead>
                <tr>
                  <th class="tick" data-col="select">
                    <input type="checkbox" aria-label="Выбрать видимые" [checked]="allVisible()" (change)="toggleVisible()" />
                  </th>
                  <th data-col="title" title="Тип мероприятия">Тип мероприятия</th>
                  <th data-col="period" title="Период выполнения">Период выполнения</th>
                  <th data-col="initiator" title="Инициатор">Инициатор</th>
                  <th data-col="debtor" title="Номер ЛС">Номер ЛС</th>
                  <th data-col="assignee" title="Исполнитель">Исполнитель</th>
                  <th data-col="next" title="Следующее действие">Следующее действие</th>
                  <th data-col="status" title="Статус">Статус</th>
                </tr>
              </thead>
              <tbody>
                @for (group of bands(); track group.status) {
                  <tr class="band">
                    <td colspan="8">
                      <button type="button" (click)="toggle(group.status)">{{ group.label }} ({{ group.total }})</button>
                    </td>
                  </tr>
                  @if (!collapsed().has(group.status)) {
                    @for (row of group.results; track row.id) {
                      <tr [class.picked]="pickedRows().has(row.id)">
                        <td class="tick">
                          <input type="checkbox" [attr.aria-label]="'Выбрать ' + row.title" [checked]="pickedRows().has(row.id)" (change)="toggleRow(row.id)" />
                        </td>
                        <td class="stack">
                          <a class="title" [routerLink]="['/measures', row.id]">{{ row.kind_display || row.title }}</a>
                          @if (row.progress && row.progress.total > 1) {
                            <div class="mini">
                              <span class="track"><span [style.width.%]="share(row)"></span></span>
                              <span class="muted">{{ row.progress.done }} / {{ row.progress.total }} ЛС</span>
                            </div>
                          }
                          @if (row.artifact) { <div><a [href]="row.artifact">Файл</a></div> }
                        </td>
                        <td class="clip">{{ row.started_on ? (row.started_on | date: 'dd.MM.yyyy') : '…' }} — {{ row.finished_on ? (row.finished_on | date: 'dd.MM.yyyy') : '…' }}</td>
                        <td class="clip">{{ row.initiator_name || '—' }}</td>
                        <td class="stack">
                          @if (row.debtor_id) {
                            <a class="title" [routerLink]="['/accounts', row.debtor_id]">{{ row.debtor_account || 'ЛС' }}</a>
                          } @else {
                            <span class="title">{{ row.debtor_account || '—' }}</span>
                          }
                          @if (row.debtor_name) { <div class="muted">{{ row.debtor_name }}</div> }
                          @if (row.accounts_count > 1) {
                            <div class="muted">ещё {{ row.accounts_count - 1 }} ЛС</div>
                          }
                        </td>
                        <td class="who">
                          @if (row.assignee_name) {
                            <span class="person" [matTooltip]="row.assignee_name">
                              <span class="face t{{ tone(row.assignee_name) }}">{{ initials(row.assignee_name) }}</span>
                            </span>
                          } @else {
                            <span class="dash">—</span>
                          }
                        </td>
                        <td class="clip next"><span class="action-dot {{ row.status }}"></span>{{ row.next_action }}</td>
                        <td class="clip"><span class="status-pill {{ row.status }}" [title]="row.status_display">{{ statusText(row) }}</span></td>
                      </tr>
                    }
                    @if (groupedByStatus() && group.results.length < group.total) {
                      <tr class="more-row">
                        <td colspan="8">
                          <div class="more-line">
                            <span class="muted">Показаны {{ group.results.length }} из {{ group.total }}</span>
                            <button mat-stroked-button type="button" (click)="more(group)">Показать ещё</button>
                          </div>
                        </td>
                      </tr>
                    }
                  }
                }
              </tbody>
            </table>
            </div>
            @if (!groupedByStatus() && hasMore()) {
              <div class="more">
                <span class="muted">Группировка по уже загруженным строкам.</span>
                <button mat-stroked-button type="button" (click)="moreAny()">Показать ещё</button>
              </div>
            }
          </section>
        }
      }

      @if (view() === 'list') {
        @if (matrix(); as grid) {
          <section class="surface registry matrix-card" id="measure-matrix" [class.fill]="!groups().length">
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
              <div class="matrix-wrap list-pane">
                <table class="matrix" appGridResize="measures-matrix">
                  <thead>
                    <tr>
                      <th data-col="debtor">ФИО должника</th>
                      <th data-col="account">ЛС</th>
                      @for (kind of grid.kinds; track kind.code) { <th [attr.data-col]="kind.code">{{ kind.label }}</th> }
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

      @if (view() === 'kanban') {
        <div class="k-board">
          @for (lane of lanes; track lane.status) {
            <section class="k-col" [attr.data-kanban-stage]="lane.status" [attr.data-status]="lane.status">
              <h3><span [attr.title]="lane.label">{{ lane.label }}</span><b>{{ laneTotal(lane.status) }}</b></h3>
              <div class="k-cards">
                @for (row of laneRows(lane.status); track row.id) {
                  <article class="k-card {{ row.kind }}"
                           [appKanbanDrag]="row.id" [dragDisabled]="!canMove()" (kanbanDrop)="onKanbanDrop($event)"
                           (click)="openCard($event, row)">
                    <app-kanban-debtor
                      [name]="row.debtor_name || 'ЛС'"
                      [rating]="row.rating_label"
                      [group]="row.effective_group"
                      [account]="row.debtor_account ? 'ЛС ' + row.debtor_account : ''"
                      scenarioTitle="Мероприятие"
                      [scenario]="row.title"
                      [showPeople]="false"
                      [showMoney]="false"
                      [when]="row.next_action"
                      [specialist]="row.assignee_name"
                      specialistCaption="Исполнитель" />
                  </article>
                }
                @if (laneGroup(lane.status); as group) {
                  @if (group.results.length < group.total) {
                    <button type="button" class="more-lane" (click)="more(group)">Показать ещё</button>
                  }
                }
              </div>
            </section>
          }
        </div>
      }

      @if (view() === 'calendar') {
        <app-calendar-board
          [events]="events()" [from]="spanFrom" [to]="spanTo" [mode]="calendarMode" [canCreate]="false"
          captionTail="мероприятия по делам" [selectedGroups]="filter.groups"
          (modeChange)="calendarMode = $event" (spanChange)="setSpan($event)" (openEvent)="openCalendar($event)"
          (groupsChange)="applyCalendarGroups($event)" />
      }

      @if (view() === 'charts') {
        <app-analytics scope="measures" scopeLabel="Лицевые счета с мероприятиями" />
      }

      @if (view() === 'ready') {
        <section class="surface group st-failed">
          <div class="group-head">
            <span>Срок предупреждения истёк</span>
            <span class="count">{{ candidates().length }}</span>
          </div>
          <p class="muted pad">
            Предупреждение вручено, прошло {{ waitDays() }} календарных дней на оплату, долг не погашен.
            Отметьте услуги и сформируйте задание поставщику. Группы 3–6 ведутся в
            <a routerLink="/claims">претензионно-исковой работе</a>.
          </p>
          @if (!candidates().length) {
            <p class="muted pad">Счетов, готовых к отключению, сейчас нет.</p>
          } @else {
            <div class="list-pane">
            <table appGridResize="measures-ready">
              <thead>
                <tr>
                  <th class="tick" data-col="select"></th>
                  <th data-col="debtor">Должник</th>
                  <th data-col="delivered">Предупреждение вручено</th>
                  <th data-col="due">Срок оплаты истёк</th>
                  <th data-col="services">Услуги</th>
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
            </div>
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
    </div>
  `,
  styles: `
    :host { display: flex; flex: 1; flex-direction: column; min-height: 0; }
    :host:has(.page.board) { height: 100%; min-width: 0; overflow: hidden; }
    .page { flex: 1; min-height: 0; display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden; background: #f3f6f8; }
    .page.board .body { display: flex; flex-direction: column; overflow: hidden; }
    .page.board .k-board {
      flex: 1; min-height: 0; min-width: 0;
      overflow-x: auto; overflow-y: hidden; align-items: stretch;
    }
    .page.board .k-cards { padding-top: 8px; }
    .control {
      display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 16px; flex: 0 0 auto;
      background: #f7f9fb; border-bottom: 1px solid var(--erip-border);
    }
    .body { flex: 1; min-height: 0; overflow: auto; padding: 0 0 28px; }
    .conduct {
      display: flex; align-items: center; gap: 12px; flex: 0 0 auto;
      padding: 8px 16px; background: #fff; border-bottom: 1px solid var(--erip-border);
    }
    h2 { margin: 0; font-size: 15px; font-weight: 600; color: #243140; white-space: nowrap; flex: 0 0 auto; }
    .icon {
      width: 36px; height: 36px; border: 1px solid var(--erip-border); background: #fff; border-radius: 8px;
      color: var(--erip-muted); cursor: pointer; display: grid; place-items: center;
    }
    .icon.on { color: var(--erip-primary); border-color: var(--erip-primary); background: var(--erip-primary-soft); }
    .icon mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .k-board {
      display: flex; gap: 14px; overflow-x: auto; overflow-y: hidden; align-items: stretch;
      min-height: 0; padding: 12px 16px 0;
    }
    .k-cards {
      display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0;
      overflow-x: hidden; overflow-y: auto; padding-bottom: 12px;
    }
    .k-card.kanban-source { opacity: .35; }
    .k-col {
      width: 268px; flex: 0 0 268px; min-height: 0; align-self: stretch;
      display: flex; flex-direction: column;
    }
    .k-col h3 {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;
      flex: 0 0 auto; box-sizing: border-box; height: 44px; margin: 0; padding: 0 2px 6px;
      border-bottom: 3px solid #cbd5e1; font-size: 13px; font-weight: 600; line-height: 1.25;
      color: #243140; background: #f3f6f8;
    }
    .k-col h3 span {
      flex: 1 1 auto; min-width: 0; overflow: hidden;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }
    .k-col h3 b { flex: 0 0 auto; font-weight: 600; color: #8b95a1; line-height: 1.25; }
    .k-col[data-status="assigned"] h3 { border-bottom-color: #2563eb; }
    .k-col[data-status="running"] h3 { border-bottom-color: #7c3aed; }
    .k-col[data-status="done"] h3 { border-bottom-color: #1f9d55; }
    .k-col[data-status="failed"] h3 { border-bottom-color: #e53935; }
    .k-col[data-status="paused"] h3 { border-bottom-color: #c8962e; }
    .k-col[data-status="cancelled"] h3 { border-bottom-color: #9ca3af; }
    .k-col .list-pane { flex: 1; min-height: 0; }
    .k-col .list-pane.cards { --list-row: 112px; }
    .k-card {
      display: flex; flex-direction: column; gap: 4px; background: #fff; border: 1px solid #e6ebf0;
      border-left: 3px solid #cbd5e1; border-radius: 8px; padding: 10px 12px 4px; margin-bottom: 8px;
      text-decoration: none; color: inherit; box-shadow: 0 1px 2px rgba(16, 42, 67, .06);
    }
    .k-card:hover { box-shadow: 0 2px 8px rgba(16, 42, 67, .12); }
    .k-card[draggable="true"] { cursor: grab; }
    .k-col.drop { outline: 2px dashed var(--erip-primary); outline-offset: 2px; border-radius: 8px; }
    .k-card.call { border-left-color: #2563eb; }
    .k-card.notice { border-left-color: #0f766e; }
    .k-card.warning { border-left-color: #e0a106; }
    .k-card.disconnect { border-left-color: #f08c2e; }
    .k-card.collection { border-left-color: #e53935; }
    .k-card .name { font-weight: 700; font-size: 14px; line-height: 1.25; color: #1f2933; }
    .k-card .line, .k-card .when { font-size: 12px; line-height: 1.35; color: #6b7280; }
    .more-lane {
      border: 0; background: transparent; color: var(--erip-link); font: inherit; font-weight: 600;
      cursor: pointer; padding: 4px 2px 8px;
    }
    app-calendar-board, app-analytics { display: block; flex: 1; min-height: 0; overflow: auto; }
    .ready-title { margin: 0; color: var(--erip-muted); flex: 1; }
    .registry { margin: 12px 16px 0; overflow: visible; background: #fff; }
    .registry.main { display: block; }
    .registry.main .list-pane, .matrix-card .list-pane { max-height: none; overflow: auto; }
    .matrix-card { display: block; max-height: none; margin: 16px 16px 0; }
    .matrix-card.fill { flex: 1; max-height: none; }
    .matrix-card .list-pane { flex: 1; max-height: none; min-height: 0; }
    .band td { background: #f7f9fb; padding: 0; overflow: visible; white-space: normal; }
    .band button {
      display: block; width: 100%; border: 0; background: transparent;
      padding: 10px 12px; font: inherit; font-size: 13px; font-weight: 700; color: #1f2933; cursor: pointer; text-align: left;
    }
    table { border: 0; border-radius: 0; border-collapse: collapse; }
    table.wide {
      width: 100%; min-width: 1180px; table-layout: fixed; border-collapse: collapse;
    }
    table.wide col.c-tick { width: 4%; }
    table.wide col.c-kind { width: 17%; }
    table.wide col.c-period { width: 15%; }
    table.wide col.c-init { width: 15%; }
    table.wide col.c-account { width: 16%; }
    table.wide col.c-who { width: 10%; }
    table.wide col.c-next { width: 14%; }
    table.wide col.c-status { width: 9%; }
    tr.picked td { background: #f3f8fb; }
    th {
      text-align: left; font-size: 12px; font-weight: 600; color: var(--erip-muted);
      padding: 10px 12px; background: #f7f9fb; border-bottom: 1px solid var(--erip-border);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    td { padding: 10px 12px; border-top: 1px solid var(--erip-border); vertical-align: middle; }
    table.wide td.clip, table.wide td.who, table.wide td.stack {
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    table.wide td.stack { white-space: normal; }
    table.wide td.stack .title, table.wide td.stack .muted {
      display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    table.wide td.who { text-align: left; }
    table.wide td.next .action-dot { flex: 0 0 auto; }
    .title { font-weight: 600; color: inherit; }
    .mini { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
    .track { display: block; width: 72px; height: 6px; border-radius: 3px; background: #e5e7eb; overflow: hidden; }
    .track span { display: block; height: 100%; background: #16a34a; }
    .person { display: inline-flex; }
    .dash { color: var(--erip-muted); }
    .more-row td { overflow: visible; white-space: normal; }
    .more-line { display: flex; align-items: center; gap: 12px; }
    .more { display: flex; align-items: center; gap: 12px; margin: 0; padding: 8px 12px 12px; }
    .tick { width: auto; text-align: center; }
    .pad { padding: 0 12px 8px; }
    a.cell { text-decoration: none; }
    h3 {
      margin: 0; padding: 12px 12px 0; font-size: 15px; color: var(--erip-primary-dark);
      display: flex; align-items: center; gap: 6px;
    }
    h3 mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--erip-muted); }
    .group { margin-top: 12px; overflow: auto; border-left: 4px solid #dc2626; flex: 1; min-height: 0; }
    .group-head {
      display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 12px; border: 0;
      background: #fef2f2; font: inherit; font-weight: 700; color: #b91c1c;
    }
    .count { min-width: 22px; padding: 1px 8px; border-radius: 10px; background: #fff; font-size: 12px; font-weight: 700; }
    .matrix-wrap { overflow: auto; }
    .matrix { width: 100%; min-width: 720px; table-layout: auto; }
    .matrix th, .matrix td { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }
    .cell {
      display: inline-flex; align-items: center; justify-content: center; min-width: 52px; padding: 3px 8px;
      border-radius: 10px; font-size: 12px; font-weight: 700; text-decoration: none;
      background: #f3f4f6; color: var(--erip-muted);
    }
    .cell.pending, .cell.done { background: #e5f6ea; color: #1e8a45; }
    .cell.run, .cell.wait { background: #fff1df; color: #c56a12; }
    .cell.error { background: #fde8e8; color: #d23b3b; }
    .status-pill.assigned { background: #e7f0fb; color: #3d6fbe; }
    .status-pill.running { background: #f3e9fb; color: #7b4bb8; }
    .status-pill.done { background: #e5f6ea; color: #1e8a45; }
    .status-pill.failed { background: #fde8e8; color: #d23b3b; }
    .action-dot.assigned { background: #e0a106; }
    .action-dot.running { background: #7b4bb8; }
    .action-dot.done { background: #1e8a45; }
    .action-dot.failed { background: #d23b3b; }
    .cell.muted { background: #f3f4f6; color: #6b7280; }
  `,
})
export class MeasuresListComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  @ViewChild(RegistryFilterComponent) private filters?: RegistryFilterComponent;

  protected readonly view = signal<'list' | 'kanban' | 'calendar' | 'charts' | 'ready'>('kanban');
  protected readonly lanes = [
    { status: 'assigned', label: 'Назначено' },
    { status: 'running', label: 'Выполняется' },
    { status: 'done', label: 'Завершено' },
    { status: 'failed', label: 'Завершено с ошибкой' },
    { status: 'paused', label: 'Приостановлено' },
    { status: 'cancelled', label: 'Прервано' },
  ];
  protected readonly groupChoices: RegistryChoice[] = [
    { id: 'status', label: 'Статус' },
    { id: 'kind', label: 'Вид мероприятия' },
    { id: 'assignee', label: 'Исполнитель' },
  ];
  protected filter: RegistryFilterQuery = { q: '', groups: [], ratings: [], stage: '', period: '', kind: '', groupBy: 'status' };
  protected calendarMode: CalendarMode = 'month';
  protected readonly pickedRows = signal<Set<number>>(new Set());
  protected readonly events = signal<CalendarEvent[]>([]);
  protected spanFrom = '';
  protected spanTo = '';
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
  protected readonly dropStatus = signal<string | null>(null);
  private request = 0;
  private cardDragged = false;

  protected canMove(): boolean {
    const me = this.auth.me();
    return this.auth.canSkip() && !!me && me.contour !== 'supplier';
  }

  protected canOrderDisconnect(): boolean {
    return this.auth.canLaunchMeasure() && this.auth.me()?.contour !== 'supplier';
  }

  ngOnInit(): void {
    this.api.scenarioTimeline().subscribe({
      next: (row) => this.waitDays.set(row.warning_wait_days || 5),
      error: () => this.api.dialSettings().subscribe({
        next: (settings) => this.waitDays.set(settings.warning_wait_days || 5),
      }),
    });
    this.load();
  }

  protected show(mode: 'list' | 'ready'): void {
    this.view.set(mode);
    this.load();
  }

  protected showRegistry(mode: string): void {
    if (mode !== 'list' && mode !== 'kanban' && mode !== 'calendar' && mode !== 'charts') return;
    this.view.set(mode);
    if (mode === 'calendar') this.loadCalendar();
    else if (mode !== 'charts') this.load();
  }

  protected setSpan(span: { from: string; to: string }): void {
    this.spanFrom = span.from;
    this.spanTo = span.to;
    this.loadCalendar();
  }

  protected openCalendar(event: CalendarEvent): void {
    if (event.measure_id) this.router.navigate(['/measures', event.measure_id]);
    else if (event.account_id) this.router.navigate(['/accounts', event.account_id]);
  }

  protected download(): void {
    const lines = ['Мероприятие;Должник;Лицевой счёт (Номер ЛС);Исполнитель;Следующее действие;Статус'];
    const picked = this.pickedRows();
    for (const group of this.bands()) {
      for (const row of group.results) {
        if (picked.size && !picked.has(row.id)) continue;
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

  protected canConduct(): boolean {
    return this.auth.canWrite() && this.auth.me()?.contour !== 'supplier';
  }

  protected conductPicked(): void {
    const ids = [...this.pickedRows()];
    if (!ids.length) return;
    this.busy.set(true);
    this.api.conductMeasures(ids).subscribe({
      next: (result) => {
        this.busy.set(false);
        const parts = [`Обзвон: ${result.dialed}`, `уведомления: ${result.sent}`];
        const skipped = result.skipped?.[0]?.reason;
        const text = skipped ? `${parts.join(', ')}. ${skipped}` : parts.join(', ');
        this.snack.open(text, 'OK', { duration: 6000 });
        this.pickedRows.set(new Set());
        this.load();
      },
      error: (err) => {
        this.busy.set(false);
        this.snack.open(errorMessage(err), 'OK');
      },
    });
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

  protected onFilter(query: RegistryFilterQuery): void {
    this.filter = { ...query, groupBy: query.groupBy || 'status' };
    if (this.view() === 'calendar') this.loadCalendar();
    else if (this.view() !== 'charts') this.load();
  }

  protected groupedByStatus(): boolean {
    return (this.filter.groupBy || 'status') === 'status';
  }

  protected bands(): MeasureGroup[] {
    const mode = this.filter.groupBy || 'status';
    if (mode !== 'kind' && mode !== 'assignee') return this.groups();
    const rows = this.groups().flatMap((group) => group.results);
    const order: string[] = [];
    const buckets = new Map<string, MeasureRow[]>();
    for (const row of rows) {
      const key = mode === 'kind' ? (row.kind_display || row.kind) : (row.assignee_name || 'Без исполнителя');
      if (!buckets.has(key)) {
        order.push(key);
        buckets.set(key, []);
      }
      buckets.get(key)?.push(row);
    }
    return order.map((key) => {
      const results = buckets.get(key) ?? [];
      return { status: key, label: key, total: results.length, shown: results.length, results };
    });
  }

  protected hasMore(): boolean {
    return this.groups().some((group) => group.results.length < group.total);
  }

  protected moreAny(): void {
    const group = this.groups().find((item) => item.results.length < item.total);
    if (group) this.more(group);
  }

  protected statusText(row: MeasureRow): string {
    return row.status === 'failed' ? 'Ошибка' : row.status_display;
  }

  protected visibleIds(): number[] {
    return this.bands().flatMap((group) => this.collapsed().has(group.status) ? [] : group.results.map((row) => row.id));
  }

  protected allVisible(): boolean {
    const ids = this.visibleIds();
    return ids.length > 0 && ids.every((id) => this.pickedRows().has(id));
  }

  protected toggleVisible(): void {
    const ids = this.visibleIds();
    const next = new Set(this.pickedRows());
    if (this.allVisible()) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    this.pickedRows.set(next);
  }

  protected toggleRow(id: number): void {
    const next = new Set(this.pickedRows());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.pickedRows.set(next);
  }

  protected applyCalendarGroups(groups: number[]): void {
    this.filters?.setGroups(groups);
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

  protected onKanbanDrop(event: { id: string; stage: string }): void {
    const id = Number(event.id);
    if (!id || !this.canMove()) return;
    const current = this.groups().flatMap((group) => group.results).find((row) => row.id === id);
    if (!current || current.status === event.stage) return;
    this.api.measureStatus(id, event.stage).subscribe({
      next: () => this.load(),
      error: (err) => {
        this.snack.open(errorMessage(err), 'OK');
        this.load();
      },
    });
  }

  protected openCard(event: MouseEvent, row: MeasureRow): void {
    if (this.cardDragged) {
      this.cardDragged = false;
      event.preventDefault();
      return;
    }
    this.router.navigate(['/measures', row.id]);
  }

  protected laneGroup(status: string): MeasureGroup | undefined {
    return this.groups().find((group) => group.status === status);
  }

  protected laneRows(status: string) {
    return this.laneGroup(status)?.results ?? [];
  }

  protected laneTotal(status: string): number {
    return this.laneGroup(status)?.total ?? 0;
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
    const query: Record<string, string | number> = {
      search: this.filter.q,
      period: this.filter.period,
      ...extra,
    };
    if (this.filter.groups.length) query['debt_group__in'] = this.filter.groups.join(',');
    if (this.filter.ratings.length) query['rating__in'] = this.filter.ratings.join(',');
    if (this.filter.stage) query['funnel_stage'] = this.filter.stage;
    if (this.filter.kind) query['kind'] = this.filter.kind;
    if (this.filter.domain) query['domain'] = JSON.stringify(this.filter.domain);
    return query;
  }

  private loadCalendar(): void {
    if (!this.spanFrom) {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      this.spanFrom = `${now.getFullYear()}-${month}-01`;
      this.spanTo = `${now.getFullYear()}-${month}-${String(last).padStart(2, '0')}`;
    }
    const query = this.params();
    delete query['period'];
    this.api.calendar({ date_from: this.spanFrom, date_to: this.spanTo }, query).subscribe({
      next: (events) => this.events.set(events.filter((event) => event.measure_id)),
      error: (err) => this.error.set(errorMessage(err)),
    });
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
    const paintMatrix = () => {
      this.api.measureMatrix(params).subscribe({
        next: (payload) => {
          if (current === this.request) this.matrix.set(payload);
        },
        error: (err) => {
          if (current === this.request) this.error.set(errorMessage(err));
        },
      });
    };
    this.api.measureRegistry(params).subscribe({
      next: (payload) => {
        if (current !== this.request) return;
        this.groups.set(payload.groups);
        this.pickedRows.set(new Set());
        this.loaded.set(true);
        paintMatrix();
      },
      error: (err) => {
        if (current !== this.request) return;
        this.loaded.set(true);
        this.error.set(errorMessage(err));
        paintMatrix();
      },
    });
  }
}
