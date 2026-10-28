import { Component, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { debounceTime, distinctUntilChanged, filter } from 'rxjs';

import { ApiService, AssignedAccount, ClaimCase, FunnelGateInfo, Named, NotaryOffice, errorMessage, funnelGate, gateTarget } from '../../core/api.service';
import { BynSignComponent, MoneyComponent } from '../../core/money.component';
import { AuthService } from '../../core/auth.service';
import { AccountRow, CalendarEvent, KanbanColumn, WritDraft } from '../../core/models';
import { AnalyticsComponent } from '../analytics/analytics.component';
import { CalendarBoardComponent, CalendarMode } from '../calendar/calendar-board.component';
import { RegistryFilterComponent, RegistryFilterQuery } from '../registry-filter.component';
import { briefText } from '../group-title';
import { GridResizeDirective } from '../grid-resize.directive';
import { KanbanDebtorComponent } from '../kanban-debtor.component';
import { KanbanDragDirective } from '../kanban-drag.directive';
import { FunnelGateDialogComponent } from '../funnel-gate-dialog.component';
import { RegistryViewsComponent } from '../registry-views.component';

@Component({
  selector: 'app-claims-board',
  host: {
    '[class.case-open]': 'caseOpen()',
    '[class.board]': '!caseOpen() && mode() === "kanban"',
  },
  standalone: true,
  imports: [
    FormsModule, ReactiveFormsModule, RouterLink, RouterLinkActive, RouterOutlet, MatButtonModule, MatSnackBarModule,
    RegistryViewsComponent, AnalyticsComponent, CalendarBoardComponent, RegistryFilterComponent, MoneyComponent, BynSignComponent,
    KanbanDebtorComponent, KanbanDragDirective, GridResizeDirective, FunnelGateDialogComponent,
  ],
  template: `
    <div class="page" [class.dim]="dialog()" [class.case]="caseOpen()" [class.board]="!caseOpen() && mode() === 'kanban'">
      @if (!caseOpen()) {
      <div class="toolbar">
        <h2>Претензионно-исковая работа</h2>
        @if (canAdd()) {
          <button type="button" class="add" (click)="openCreate()">+ Добавить исполнительную надпись</button>
        }
        <app-registry-views [mode]="mode()" (modeChange)="showView($event)" />
      </div>
      <div class="filters">
        <app-registry-filter
          target="claims"
          placeholder="Поиск по ФИО, номеру ЛС, адресу"
          (queryChange)="onFilter($event)" />
      </div>
      <p class="hint">Нотариат — исполнительная надпись. Суд — если спор или нотариус отказал. ОПИ — принудительное исполнение и списание.</p>
      <nav class="modules">
        <button type="button" [class.on]="module() === 'notary'" (click)="setModule('notary')">1. Нотариат</button>
        <button type="button" [class.on]="module() === 'court'" (click)="setModule('court')">2. Суд</button>
        <button type="button" [class.on]="module() === 'opi'" (click)="setModule('opi')">3. ОПИ</button>
      </nav>
      }
      @if (error() && !caseOpen()) { <p class="error">{{ error() }}</p> }
      <router-outlet />

      @if (!caseOpen() && mode() === 'list') {
        <section class="main">
            @if (!debtors().length) {
              <div class="empty">
                <h2>Претензионно-исковая работа</h2>
                <p>Должников на взыскании пока нет. Они появляются с группы 3, по мероприятию «взыскание» или когда дело уже открыто.</p>
              </div>
            } @else {
              <div class="list-pane">
              <table appGridResize="claims">
                <thead>
                  <tr>
                    <th data-col="debtor">Должник</th>
                    <th data-col="account">Лицевой счёт (Номер ЛС)</th>
                    <th data-col="address">Адрес ЛС запросом (Адрес)</th>
                    <th data-col="group">Группа</th>
                    <th data-col="rating">Рейтинг</th>
                    <th data-col="debt">Исходящее сальдо с пенями <app-byn-sign /></th>
                    <th data-col="mulct">Исходящее сальдо пени <app-byn-sign /></th>
                    <th data-col="stage">Этап</th>
                    <th data-col="case">Дело</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of debtors(); track row.id) {
                    <tr (click)="openDebtor(row)">
                      <td>{{ row.short_fio || 'Без ФИО' }}</td>
                      <td><b class="account-no">{{ row.client_account }}</b></td>
                      <td>{{ street(row.account_address || '') || '—' }}</td>
                      <td>@if (row.effective_group) { <span class="group-badge g{{ row.effective_group }}">{{ row.effective_group }}</span> }</td>
                      <td>@if (row.rating_label) { <span class="rating-badge r{{ letter(row.rating_label) }}">{{ row.rating_label }}</span> }</td>
                      <td><app-money [value]="row.debt_total" [blank]="false" /></td>
                      <td [class.amount-danger]="+(row.mulct_total || 0) > 0"><app-money [value]="row.mulct_total" [blank]="false" /></td>
                      <td>{{ stageLabel(row.funnel_stage) }}</td>
                      <td>
                        @for (claim of datedClaims(row); track claim.id) {
                          <a class="pack-link" [routerLink]="['/claims', claim.id]" [queryParams]="{ tab: defaultClaimTab() }" (click)="$event.stopPropagation()">{{ packageLabel(claim) }}</a>
                        } @empty { не заведена }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
              </div>
              @if (hiddenDebtors() > 0) {
                <p class="hint">Показаны первые {{ debtors().length }} из {{ debtorTotal() }}.</p>
              }
            }
        </section>
      }

      @if (!caseOpen() && mode() === 'kanban') {
        <div class="k-scroll">
        <div class="k-board">
          @for (lane of shownLanes(); track lane.id) {
            <section class="k-col" [attr.data-kanban-stage]="lane.entry" [attr.data-lane]="lane.id">
              <h3><span [attr.title]="lane.label">{{ lane.label }}</span><b>{{ laneTotal(lane) }}</b></h3>
              <div class="k-cards">
              @for (card of laneCards(lane); track card.id) {
                <article class="k-card g{{ card.effective_group ?? 0 }}" [class.picked]="isSelected(card.id)"
                         [appKanbanDrag]="card.id" [dragDisabled]="!canMove()" (kanbanDrop)="onKanbanDrop($event)"
                         (click)="openCard($event, card)">
                  <app-kanban-debtor
                    [name]="card.short_fio || 'Без ФИО'"
                    [rating]="card.rating_label"
                    [group]="card.effective_group"
                    [account]="card.client_account"
                    [address]="card.account_address ? short(street(card.account_address)) : ''"
                    [scenario]="scenarioLine(card)"
                    [ownership]="card.ownership_type_name ? short(card.ownership_type_name) : ''"
                    [housing]="card.acc_category_full ? short(card.acc_category_full) : ''"
                    [months]="card.months_debt"
                    [residents]="card.subj_count"
                    [registered]="card.registered_count"
                    [total]="card.obligation_total"
                    [principal]="card.debt_total"
                    [penalty]="card.mulct_total"
                    [when]="mark(card)"
                    [specialist]="card.assigned_name">
                    <div class="stage" [attr.data-stage]="card.claim_stage || 'queue'">{{ stageName(card) }}</div>
                    @if (module() === 'notary' && canMove() && courtFrom(card)) {
                      <button type="button" class="court" (click)="toCourt($event, card)">{{ courtFrom(card) }}</button>
                    }
                  </app-kanban-debtor>
                </article>
              }
              </div>
            </section>
          }
        </div>
        </div>
        @if (boardEmpty()) {
          <p class="hint">По этому отбору должников нет.</p>
        }
      }

      @if (!caseOpen() && mode() === 'calendar') {
        <app-calendar-board
          [events]="events()" [from]="spanFrom" [to]="spanTo" [mode]="calendarMode" [canCreate]="false"
          captionTail="мероприятия по делам" [selectedGroups]="filter.groups"
          (modeChange)="calendarMode = $event" (spanChange)="setSpan($event)" (openEvent)="openClaimEvent($event)"
          (groupsChange)="applyCalendarGroups($event)" />
      }

      @if (!caseOpen() && mode() === 'charts') {
        <app-analytics scope="claims" scopeLabel="Лицевые счета претензионно-исковой работы" [query]="chartQuery()" />
      }

      @if (dialog()) {
        <div class="backdrop" (click)="closeDialog()">
          <form class="modal" (click)="closePickers($event)" (ngSubmit)="saveWrit()">
            <h2>Добавление исполнительной надписи</h2>
            <p class="hint">Новый период — отдельный пакет. Документы и почта уже открытых пакетов в него не копируются.</p>

            <h3>Дело</h3>
            <div class="picker" (click)="$event.stopPropagation()">
              <label>Лицевой счёт (Номер ЛС) / должник
                <input [formControl]="query" placeholder="Лицевой счёт (Номер ЛС) или ФИО плательщиков" (click)="openPicker()" />
              </label>
              @if (pickerOpen()) {
                <div class="picks">
                  @if (query.value.trim().length < 2) {
                    <p>Введите не меньше 2 символов — в списке не больше 12 счетов.</p>
                  } @else if (!found().length) {
                    <p>Ничего не найдено.</p>
                  } @else {
                    @for (row of found(); track row.id) {
                      <button type="button" [class.on]="picked()?.id === row.id" (click)="choose(row)">
                        {{ row.client_account }} — {{ row.short_fio || 'без ФИО' }} (Группа {{ groupOf(row) || '—' }})
                      </button>
                    }
                  }
                </div>
              }
            </div>
            @if (picked(); as row) {
              <p class="chosen">{{ row.client_account }} — {{ row.short_fio || 'без ФИО' }} (Группа {{ groupOf(row) || '—' }})</p>
              @if ((groupOf(row) || 0) >= 4) {
                <p class="hint">Группа {{ groupOf(row) }}: после надписи доступны иск о выселении и отчуждении жилья.</p>
              }
              <div class="writ-form">
                <label>Период с
                  <input type="date" name="writFrom" [(ngModel)]="writFrom" (change)="refreshWritWindow()" />
                </label>
                <label>Период по
                  <input type="date" name="writTo" [(ngModel)]="writTo" (change)="refreshWritWindow()" />
                </label>
                <label>Дата вручения предупреждения
                  <input type="date" name="writWarning" [(ngModel)]="writWarning" (change)="refreshWritWindow()" />
                </label>
                <label>Дата акта о невручении
                  <input type="date" name="writAct" [(ngModel)]="writAct" (change)="refreshWritWindow()" />
                </label>
                <label>Дней на погашение
                  <input type="number" name="writDays" min="1" [(ngModel)]="writDays" />
                </label>
                <div class="picker office-picker wide" (click)="$event.stopPropagation()">
                  <label>Нотариальная контора
                    <input [(ngModel)]="office" name="office" autocomplete="off" placeholder="Название, округ или адрес"
                           (focus)="officeOpen.set(true)" (input)="officeOpen.set(true)" />
                  </label>
                  @if (officeOpen()) {
                    <div class="picks">
                      @if (!officeHits().length) {
                        <p>В справочнике такой конторы нет. Можно оставить вписанное название.</p>
                      } @else {
                        @for (item of officeHits(); track item.code) {
                          <button type="button" [class.on]="office === item.name" (click)="chooseOffice(item)">
                            {{ item.name }}
                            <small>{{ item.district }}</small>
                          </button>
                        }
                      }
                    </div>
                  }
                </div>
              </div>
              <dl class="writ-sheet">
                <div><dt>Долг по услугам</dt><dd>{{ writ()?.principal || '—' }}</dd></div>
                <div><dt>Пеня</dt><dd>{{ writ()?.penalty || '—' }}</dd></div>
                <div><dt>Тариф нотариуса</dt><dd>{{ writ()?.tariff || 'не передано из АИС' }}</dd></div>
                <div><dt>ФИО ответчика</dt><dd>{{ writ()?.defendant_name || '—' }}</dd></div>
              </dl>
              @for (msg of writ()?.blockers || []; track msg) { <p class="warn">{{ msg }}</p> }
              @if (writError()) { <p class="warn">{{ writError() }}</p> }
            } @else {
              <p class="hint">Сначала выберите лицевой счёт.</p>
            }
            <div class="actions">
              <button type="submit" class="primary" [disabled]="busy() || !picked()">Сохранить и открыть пакет документов</button>
              <button type="button" class="ghost" (click)="closeDialog()">Отмена</button>
            </div>
          </form>
        </div>
      }
      <app-funnel-gate-dialog [gate]="gate()" (go)="openGate()" (closed)="gate.set(null)" />
    </div>
  `,
  styles: `
    :host.board {
      display: flex; flex-direction: column; flex: 1 1 auto; height: 100%; max-height: 100%;
      min-height: 0; min-width: 0; overflow: hidden;
    }
    .page.board {
      display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; box-sizing: border-box;
    }
    .page.board > :not(.k-scroll) { flex: 0 0 auto; }
    .page.board .k-scroll {
      display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0;
      overflow-x: auto; overflow-y: scroll; overscroll-behavior: none;
      scrollbar-color: #8b98a5 #e7edf2;
    }
    .page.board .k-scroll::-webkit-scrollbar { width: 14px; height: 14px; }
    .page.board .k-scroll::-webkit-scrollbar-track { background: #e7edf2; }
    .page.board .k-scroll::-webkit-scrollbar-thumb { background: #8b98a5; border-radius: 7px; border: 3px solid #e7edf2; }
    .page.board .k-board {
      flex: 1 0 auto; align-items: stretch; min-height: 100%; min-width: 100%; width: max-content; overflow: visible;
    }
    .page.board .k-cards { padding-top: 8px; }
    :host.case-open { display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%; overflow: hidden; }
    .page.case { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; padding: 12px 16px 16px; }
    :host.case-open:has(app-claim-checklist.file-open) { flex: 1 0 auto; height: auto; min-height: 100%; overflow: visible; }
    .page.case:has(app-claim-checklist.file-open) { flex: none; height: auto; min-height: auto; overflow: visible; }
    .filters { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
    .searchbar { flex: 1; }
    .searchbar input {
      width: 100%; box-sizing: border-box; height: 34px; border: 1px solid var(--erip-border);
      border-radius: 6px; padding: 0 10px; font: inherit;
    }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--erip-border); font-size: 13px; }
    th { color: var(--erip-muted); font-weight: 600; }
    tbody tr { cursor: pointer; }
    tbody tr:hover { background: #f7f9fb; }
    .account-no { color: var(--erip-link); }
    .pack-link { display: block; color: var(--erip-link); text-decoration: none; }
    .pack-link + .pack-link { margin-top: 4px; }
    .k-board {
      display: flex; gap: 14px; align-items: stretch; overflow: visible;
    }
    .k-col {
      width: 268px; flex: 0 0 268px; align-self: stretch;
      display: flex; flex-direction: column;
    }
    .k-cards {
      display: flex; flex-direction: column; flex: 1 1 auto;
      overflow: visible; padding-bottom: 12px;
    }
    .k-card.kanban-source { opacity: .35; }
    .k-col h3 {
      display: flex; justify-content: space-between; align-items: center; gap: 8px;
      position: sticky; top: 0; z-index: 2;
      flex: 0 0 auto; box-sizing: border-box; height: 44px; margin: 0; padding: 0 2px 6px;
      border-bottom: 3px solid #cbd5e1; font-size: 13px; font-weight: 600; line-height: 1.25;
      color: #243140; background: var(--erip-bg);
    }
    .k-col h3 span {
      flex: 1 1 auto; min-width: 0; max-height: 2.5em; overflow: hidden;
      text-align: justify;
    }
    .k-col h3 b { flex: 0 0 auto; align-self: center; font-weight: 600; color: #8b95a1; line-height: 1.25; }
    .modules { display: flex; gap: 8px; margin: 0 0 12px; }
    .modules button {
      border: 0; border-bottom: 2px solid transparent; background: transparent; font: inherit; font-weight: 600;
      color: var(--erip-muted); padding: 6px 2px; cursor: pointer;
    }
    .modules button.on { color: var(--erip-primary-dark); border-bottom-color: var(--erip-primary); }
    .k-col[data-lane="prep"] h3 { border-bottom-color: #2e7d32; }
    .k-col[data-lane="sent"] h3 { border-bottom-color: #7c3aed; }
    .k-col[data-lane="done"] h3 { border-bottom-color: #1f9d55; }
    .k-col[data-lane="refused"] h3 { border-bottom-color: #c62828; }
    .k-col[data-lane="lawsuit"] h3 { border-bottom-color: #e0a106; }
    .k-col[data-lane="decision"] h3 { border-bottom-color: #8e2430; }
    .k-col[data-lane="opi"] h3, .k-col[data-lane="opi_ready"] h3, .k-col[data-lane="opi_sent"] h3, .k-col[data-lane="opi_measures"] h3, .k-col[data-lane="finish"] h3, .k-col[data-lane="recovered"] h3, .k-col[data-lane="impossible"] h3, .k-col[data-lane="writeoff"] h3 { border-bottom-color: #94a3b8; }
    .court {
      margin-top: 6px; border: 1px solid var(--erip-border); background: #fff; border-radius: 999px;
      font: inherit; font-size: 11px; padding: 2px 8px; cursor: pointer; color: var(--erip-primary);
    }
    .k-card {
      position: relative; background: #fff; border: 1px solid #e6ebf0; border-left: 3px solid #cbd5e1;
      border-radius: 8px; padding: 10px 12px 4px; margin-bottom: 8px; cursor: pointer;
      box-shadow: 0 1px 2px rgba(16, 42, 67, .06);
    }
    .k-card:hover { box-shadow: 0 2px 8px rgba(16, 42, 67, .12); }
    .k-card.picked { background: #e7f4f1; }
    .k-col.drop { outline: 2px dashed var(--erip-primary); outline-offset: 2px; border-radius: 8px; }
    .k-card.g1 { border-left-color: #1f9d55; } .k-card.g2 { border-left-color: #c8962e; }
    .k-card.g3 { border-left-color: #ef6c00; } .k-card.g4 { border-left-color: #e53935; }
    .k-card.g5 { border-left-color: #c62828; } .k-card.g6 { border-left-color: #7f1d1d; }
    .k-card .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .k-card .name { font-weight: 700; font-size: 14px; line-height: 1.25; flex: 1; min-width: 0; color: #1f2933; }
    .k-card .card-head .card-marks { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
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
    .k-card .stage {
      display: inline-flex; align-self: flex-start; margin-top: 6px; padding: 2px 8px; border-radius: 999px;
      font-size: 11px; font-weight: 700; line-height: 1.4; background: #eef2f6; color: #334155;
    }
    .k-card .stage[data-stage="queue"] { background: #fff4e5; color: #9a3412; }
    .k-card .stage[data-stage="prep"] { background: #e8f6ee; color: #166534; }
    .k-card .stage[data-stage="notary"] { background: #f3e8ff; color: #6b21a8; }
    .k-card .stage[data-stage="writ_done"], .k-card .stage[data-stage="recovered"] { background: #e5f6ea; color: #166534; }
    .k-card .stage[data-stage="refused"], .k-card .stage[data-stage="impossible"] { background: #fdecec; color: #b42318; }
    .k-card .stage[data-stage="lawsuit"], .k-card .stage[data-stage="court"] { background: #fff6db; color: #92400e; }
    .k-card .stage[data-stage="opi"], .k-card .stage[data-stage="opi_measures"] { background: #ffedd5; color: #c2410c; }
    .k-card .stage[data-stage="writeoff"] { background: #f3f4f6; color: #4b5563; }
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
    .k-card .money > span, .k-card .money small { display: block; }
    .k-card .money small { font-weight: 400; color: #6b7280; }
    .k-card .money .amount-danger { color: var(--erip-danger); }
    .k-card .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; min-height: 26px; }
    .k-card .when { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #6b7280; }
    .k-card .cal { width: 14px; height: 14px; flex: 0 0 14px; }
    .k-card .who {
      width: 26px; height: 26px; border-radius: 50%; color: #fff; font-size: 10px; font-weight: 700;
      display: grid; place-items: center; flex: 0 0 26px;
    }
    .toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .toolbar h2 { margin: 0; color: var(--erip-primary-dark); font-size: 20px; }
    .add {
      border: 0; background: var(--erip-primary); color: #fff; border-radius: 8px; padding: 8px 12px;
      font: inherit; font-weight: 600; cursor: pointer;
    }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
    .chips button { border: 1px solid var(--erip-border); background: #fff; border-radius: 999px; padding: 3px 10px; cursor: pointer; font: inherit; font-size: 12px; }
    .chips button.on { background: var(--erip-primary); color: #fff; border-color: var(--erip-primary); }
    .hint, .empty p { color: var(--erip-muted); font-size: 13px; }
    .error, .warn { color: var(--erip-danger); font-size: 13px; }
    .main { min-width: 0; }
    .empty { background: #fff; border: 1px solid var(--erip-border); border-radius: 10px; padding: 16px 18px; }
    .empty h2 { margin: 0 0 8px; color: var(--erip-primary-dark); font-size: 18px; }
    .backdrop { position: fixed; inset: 0; z-index: 30; background: rgba(20, 40, 55, .45); display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
    .modal {
      box-sizing: border-box; width: min(1080px, calc(100vw - 32px)); max-width: calc(100vw - 32px);
      height: auto; max-height: calc(100vh - 48px); overflow: auto;
      background: #fff; border-radius: 12px; padding: 20px 22px 16px; box-shadow: 0 16px 40px rgba(16, 42, 67, .25);
    }
    .writ-form { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-top: 12px; }
    .modal .writ-form label {
      display: flex; flex-direction: column; align-items: stretch; gap: 4px; flex: 1 1 170px;
      margin: 0; grid-template-columns: none; font-size: 12px; color: var(--erip-muted);
    }
    .modal .writ-form .wide { flex: 1 1 100%; position: relative; }
    .modal .writ-form input { width: 100%; box-sizing: border-box; color: #1f2933; font-size: 14px; }
    .writ-form .picks { left: 0; }
    .writ-sheet { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px 16px; margin: 14px 0 0; }
    .writ-sheet dt { color: var(--erip-muted); font-size: 12px; }
    .writ-sheet dd { margin: 4px 0 0; font-weight: 600; }
    .modal h2 { margin: 0 0 6px; font-size: 20px; color: #1f2933; }
    .modal h3 { margin: 14px 0 8px; font-size: 12px; letter-spacing: .04em; color: var(--erip-muted); }
    .modal label { display: grid; grid-template-columns: 220px 1fr; gap: 8px; align-items: center; margin: 6px 0; font-size: 14px; }
    .modal input { border: 1px solid var(--erip-border); border-radius: 6px; padding: 8px 10px; font: inherit; background: #fff; }
    .modal input[readonly], .modal input:disabled { background: #f7f8fa; color: #374151; }
    .modal label.miss input { border-color: var(--erip-danger); background: #fff6f6; }
    .modal label.total .sum-box { font-weight: 700; }
    .sum-box {
      display: flex; align-items: center; min-height: 36px; box-sizing: border-box;
      border: 1px solid var(--erip-border); border-radius: 6px; padding: 8px 10px; background: #f7f8fa; color: #374151;
    }
    .with-sign { display: flex; align-items: center; gap: 8px; }
    .with-sign input { flex: 1; }
    .with-sign app-byn-sign { font-size: 18px; }
    .picker { position: relative; }
    .picks {
      position: absolute; z-index: 2; left: 220px; right: 0; top: 100%; max-height: 240px; overflow: auto;
      display: flex; flex-direction: column; gap: 4px; margin: 4px 0 0; padding: 6px;
      background: #fff; border: 1px solid var(--erip-border); border-radius: 8px; box-shadow: 0 8px 20px rgba(16, 42, 67, .15);
    }
    .picks p { margin: 4px; color: var(--erip-muted); font-size: 13px; }
    .picks button, .chosen { font-size: 13px; }
    .picks button { display: flex; flex-direction: column; align-items: flex-start; text-align: left; border: 1px solid var(--erip-border); background: #fff; border-radius: 6px; padding: 6px 8px; cursor: pointer; }
    .picks button small { color: var(--erip-muted); font-size: 12px; }
    .picks button.on { border-color: var(--erip-primary); background: var(--erip-primary-soft); }
    .check { margin: 0 0 0 220px; font-size: 13px; color: var(--erip-danger); }
    .check.ok { color: var(--erip-success); }
    .aside-note { margin: 0 0 0 220px; color: var(--erip-muted); font-size: 12px; }
    .pack { list-style: none; padding: 0; margin: 0; }
    .pack li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--erip-border); font-size: 14px; }
    .pack em { font-style: normal; font-size: 12px; font-weight: 700; }
    .pack em.ok { color: var(--erip-success); }
    .pack em.wait { color: #b45309; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
    .actions button { border-radius: 8px; padding: 8px 14px; font: inherit; cursor: pointer; }
    .actions button:disabled { opacity: .55; cursor: default; }
    .primary { border: 0; background: var(--erip-primary); color: #fff; font-weight: 600; }
    .ghost { border: 1px solid var(--erip-border); background: #fff; }
    @media (max-width: 900px) {
      .modal label { grid-template-columns: 1fr; }
      .picks { left: 0; }
      .check, .aside-note { margin-left: 0; }
      .writ-sheet { grid-template-columns: 1fr 1fr; }
      .toolbar { flex-wrap: wrap; }
    }
  `,
})
export class ClaimsBoardComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  protected readonly module = signal<'notary' | 'court' | 'opi'>('notary');
  protected readonly notaryLanes = [
    { id: 'prep', label: 'Подготовка пакета', stages: ['queue', 'prep'], entry: 'prep' },
    { id: 'sent', label: 'Направлено нотариусу', stages: ['notary'], entry: 'notary' },
    { id: 'done', label: 'Надпись совершена', stages: ['writ_done'], entry: 'writ_done' },
    { id: 'refused', label: 'Отказ', stages: ['refused'], entry: 'refused' },
    { id: 'opi', label: 'Дальше: ОПИ', stages: ['opi', 'opi_measures'], entry: 'opi' },
    { id: 'finish', label: 'Итог', stages: ['recovered', 'impossible', 'writeoff'], entry: 'recovered' },
  ];
  protected readonly courtLanes = [
    { id: 'lawsuit', label: 'Исковое заявление', stages: ['lawsuit'], entry: 'lawsuit' },
    { id: 'decision', label: 'Судебное решение', stages: ['court'], entry: 'court' },
    { id: 'opi', label: 'Дальше: ОПИ', stages: ['opi', 'opi_measures'], entry: 'opi' },
    { id: 'finish', label: 'Итог', stages: ['recovered', 'impossible', 'writeoff'], entry: 'recovered' },
  ];
  protected readonly opiLanes = [
    { id: 'opi_ready', label: 'К направлению в ОПИ', stages: ['writ_done', 'court'], entry: 'opi' },
    { id: 'opi_sent', label: 'Направлено в ОПИ', stages: ['opi'], entry: 'opi' },
    { id: 'opi_measures', label: 'Меры ОПИ приняты', stages: ['opi_measures'], entry: 'opi_measures' },
    { id: 'recovered', label: 'Взыскано', stages: ['recovered'], entry: 'recovered' },
    { id: 'impossible', label: 'Невозможность взыскания', stages: ['impossible'], entry: 'impossible' },
    { id: 'writeoff', label: 'Списание', stages: ['writeoff'], entry: 'writeoff' },
  ];
  protected readonly caseStages = [
    { id: 'queue', label: 'К взысканию' },
    { id: 'prep', label: 'Подготовка пакета' },
    { id: 'notary', label: 'Направлено нотариусу' },
    { id: 'writ_done', label: 'Надпись совершена' },
    { id: 'refused', label: 'Отказ нотариуса' },
    { id: 'lawsuit', label: 'Исковое заявление' },
    { id: 'court', label: 'Судебное решение' },
    { id: 'opi', label: 'Направлено в ОПИ' },
    { id: 'opi_measures', label: 'Меры ОПИ' },
    { id: 'recovered', label: 'Взыскано' },
    { id: 'impossible', label: 'Невозможность взыскания' },
    { id: 'writeoff', label: 'Списание' },
  ];
  protected readonly funnel = [
    { id: 'new', label: 'Новый должник' },
    { id: 'prevention', label: 'Автообзвон/уведомления' },
    { id: 'warning', label: 'Предупреждение вручено' },
    { id: 'disconnect', label: 'Отключение услуг' },
    { id: 'enforcement', label: 'Исполнительная надпись / иск' },
    { id: 'court', label: 'ОПИ' },
    { id: 'closed', label: 'Не должник' },
  ];
  protected readonly stages = signal<Named[]>([]);
  protected readonly cards = signal<ClaimCase[]>([]);
  protected readonly debtors = signal<AccountRow[]>([]);
  protected readonly debtorTotal = signal(0);
  protected readonly board = signal<KanbanColumn[]>([]);
  protected readonly selected = signal<Set<number>>(new Set());
  protected readonly dropStage = signal<string | null>(null);
  protected readonly stageMenu = signal<number | null>(null);
  private cardDragged = false;
  protected readonly events = signal<CalendarEvent[]>([]);
  protected readonly error = signal('');
  protected readonly mode = signal<'list' | 'kanban' | 'calendar' | 'charts'>('kanban');
  @ViewChild(RegistryFilterComponent) private registryFilter?: RegistryFilterComponent;
  protected filter: RegistryFilterQuery = { q: '', groups: [], ratings: [], stage: '', period: '' };
  protected readonly chartQuery = signal<Record<string, string | number>>({});
  protected readonly pickerOpen = signal(false);
  protected spanFrom = monthStart();
  protected spanTo = monthEnd();
  protected calendarMode: CalendarMode = 'month';
  protected readonly caseOpen = signal(false);
  protected readonly dialog = signal(false);
  protected readonly gate = signal<FunnelGateInfo | null>(null);
  protected readonly found = signal<AccountRow[]>([]);
  protected readonly picked = signal<AccountRow | null>(null);
  protected readonly busy = signal(false);
  protected readonly query = new FormControl('', { nonNullable: true });
  protected readonly Number = Number;
  protected readonly writ = signal<WritDraft | null>(null);
  protected readonly writError = signal('');
  protected writFrom = '';
  protected writTo = '';
  protected writWarning = '';
  protected writAct = '';
  protected writDays = 7;
  protected office = '';
  protected readonly officeOpen = signal(false);
  protected readonly offices = signal<NotaryOffice[]>([]);

  ngOnInit(): void {
    this.trackCase();
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => this.trackCase());
    this.route.queryParamMap.subscribe((params) => {
      if (params.get('writ') === '1') this.openFromRoute();
    });
    const module = this.route.snapshot.queryParamMap.get('module');
    if (module === 'court' || module === 'notary' || module === 'opi') this.module.set(module);
    this.query.valueChanges.pipe(debounceTime(300), distinctUntilChanged()).subscribe((value) => this.lookup(value));
    this.api.notaryOffices().subscribe({
      next: (page) => this.offices.set(page.results),
      error: () => this.offices.set([]),
    });
    const account = this.route.snapshot.queryParamMap.get('account');
    if (account) {
      this.api.openClaim(Number(account)).subscribe({
        next: (row) => this.router.navigate(['/claims', row.id]),
        error: (err) => this.snack.open(errorMessage(err), 'OK'),
      });
    }
    this.reload();
  }

  protected canAdd(): boolean {
    return this.auth.canWrite() && this.auth.me()?.contour !== 'supplier';
  }

  protected shownLanes(): { id: string; label: string; stages: string[]; entry: string }[] {
    if (this.module() === 'opi') return this.opiLanes;
    return this.module() === 'court' ? this.courtLanes : this.notaryLanes;
  }

  protected setModule(module: 'notary' | 'court' | 'opi'): void {
    this.module.set(module);
    this.router.navigate([], { relativeTo: this.route, queryParams: { module }, queryParamsHandling: 'merge' });
    this.refreshView();
  }

  protected defaultClaimTab(): string {
    if (this.module() === 'opi') return 'opi';
    if (this.module() === 'court') return 'court';
    return 'pack';
  }

  protected courtFrom(card: AccountRow): string {
    const stage = card.claim_stage || 'queue';
    if (stage === 'refused') return 'В суд';
    if (stage === 'queue' || stage === 'prep') return 'Спор: в суд';
    return '';
  }

  protected toCourt(event: Event, card: AccountRow): void {
    event.stopPropagation();
    const stage = card.claim_stage || 'queue';
    const reason = stage === 'refused' ? 'Отказ нотариуса' : 'Спор о праве';
    this.moveIds([card.id], 'lawsuit', reason, () => this.setModule('court'));
  }

  protected boardEmpty(): boolean {
    return !this.board().some((column) => column.total > 0);
  }

  protected canMove(): boolean {
    const me = this.auth.me();
    return this.auth.canSkip() && !!me && me.contour !== 'supplier';
  }

  protected isSelected(id: number): boolean {
    return this.selected().has(id);
  }

  protected onKanbanDrop(event: { id: string; stage: string }): void {
    const id = Number(event.id);
    if (!id || !this.canMove()) return;
    const lane = this.shownLanes().find((item) => item.entry === event.stage);
    if (!lane) return;
    const known = this.board().flatMap((column) => column.cards);
    const card = known.find((item) => item.id === id);
    if (card && lane.stages.includes(card.claim_stage || 'queue')) return;
    const ids = this.selected().has(id) ? [...this.selected()] : [id];
    const moving = ids.filter((item) => {
      const row = known.find((candidate) => candidate.id === item);
      return !!row && !lane.stages.includes(row.claim_stage || 'queue');
    });
    if (moving.length) this.moveIds(moving, lane.entry);
  }

  protected laneCards(lane: { stages: string[] }): AccountRow[] {
    const wanted = new Set(lane.stages);
    return this.board().filter((column) => wanted.has(column.stage)).flatMap((column) => column.cards);
  }

  protected laneTotal(lane: { stages: string[] }): number {
    const wanted = new Set(lane.stages);
    return this.board().filter((column) => wanted.has(column.stage)).reduce((sum, column) => sum + column.total, 0);
  }

  protected stageName(card: AccountRow): string {
    return this.caseStages.find((item) => item.id === (card.claim_stage || 'queue'))?.label || '';
  }

  protected openCard(event: MouseEvent, card: AccountRow): void {
    if (this.cardDragged) {
      this.cardDragged = false;
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('button')) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      const next = new Set(this.selected());
      if (next.has(card.id)) next.delete(card.id);
      else next.add(card.id);
      this.selected.set(next);
      return;
    }
    this.openDebtor(card);
  }

  protected toggleStage(event: Event, id: number): void {
    event.stopPropagation();
    this.stageMenu.update((open) => open === id ? null : id);
  }

  protected move(card: AccountRow, stage: string): void {
    this.stageMenu.set(null);
    this.moveIds([card.id], stage);
  }

  private moveIds(ids: number[], stage: string, reason = '', done?: () => void): void {
    const pending = this.board().flatMap((column) => column.cards).filter((card) => ids.includes(card.id));
    const step = (): void => {
      const card = pending.shift();
      if (!card) {
        this.selected.set(new Set());
        if (done) done();
        else this.loadBoard();
        return;
      }
      if ((card.claim_stage || 'queue') === stage) {
        step();
        return;
      }
      if (stage === 'queue') {
        this.snack.open('Открытое дело в очередь не возвращается', 'OK');
        this.loadBoard();
        return;
      }
      const moved = (claimId: number): void => {
        this.api.claimAction(claimId, 'move', { stage, reason }).subscribe({
          next: () => step(),
          error: (err) => {
            this.loadBoard();
            const blocked = funnelGate(err);
            if (blocked) {
              this.gate.set(blocked.accountId ? blocked : { ...blocked, accountId: card.id });
              return;
            }
            this.snack.open(errorMessage(err), 'OK');
          },
        });
      };
      if (card.claim_id) {
        moved(card.claim_id);
        return;
      }
      this.api.openClaim(card.id).subscribe({
        next: (claim) => (stage === 'prep' ? step() : moved(claim.id)),
        error: (err) => {
          this.snack.open(errorMessage(err), 'OK');
          this.loadBoard();
        },
      });
    };
    step();
  }

  protected hiddenDebtors(): number {
    return Math.max(this.debtorTotal() - this.debtors().length, 0);
  }

  protected claimOf(row: AccountRow): ClaimCase | undefined {
    return this.datedClaims(row)[0];
  }

  protected datedClaims(row: AccountRow): ClaimCase[] {
    return this.claimsOf(row).filter((claim) => claim.debt_from && claim.debt_to);
  }

  protected claimsOf(row: AccountRow): ClaimCase[] {
    return this.cards()
      .filter((card) => card.account === row.id)
      .sort((left, right) => (left.debt_from || '').localeCompare(right.debt_from || ''));
  }

  protected packageLabel(claim: ClaimCase): string {
    if (claim.debt_from && claim.debt_to) {
      return `${this.dotDate(claim.debt_from)}–${this.dotDate(claim.debt_to)} · ${claim.stage_label}`;
    }
    return `без периода · ${claim.stage_label}`;
  }

  protected stageLabel(id: string): string {
    return this.funnel.find((item) => item.id === (id || 'new'))?.label || 'Новый должник';
  }

  protected applyCalendarGroups(groups: number[]): void {
    this.registryFilter?.setGroups(groups);
  }

  protected onFilter(query: RegistryFilterQuery): void {
    this.filter = query;
    this.refreshView();
  }

  protected showView(mode: string): void {
    if (mode !== 'list' && mode !== 'kanban' && mode !== 'calendar' && mode !== 'charts') return;
    this.mode.set(mode);
    this.refreshView();
  }

  protected setSpan(span: { from: string; to: string }): void {
    this.spanFrom = span.from;
    this.spanTo = span.to;
    this.loadCalendar();
  }

  protected openClaimEvent(event: CalendarEvent): void {
    if (event.measure_id) {
      this.router.navigate(['/measures', event.measure_id]);
      return;
    }
    if (!event.account_id) return;
    const row = this.debtors().find((item) => item.id === event.account_id);
    if (row) {
      this.openDebtor(row);
      return;
    }
    const dated = this.cards()
      .filter((item) => item.account === event.account_id && item.debt_from && item.debt_to)
      .sort((left, right) => (left.debt_from || '').localeCompare(right.debt_from || ''));
    if (dated.length) {
      this.mode.set('list');
      this.router.navigate(['/claims', dated[0].id]);
      return;
    }
    this.missingWrit();
  }

  protected openDebtor(row: AccountRow): void {
    const claim = this.claimOf(row);
    if (!claim) {
      this.missingWrit();
      return;
    }
    this.mode.set('list');
    const tab = this.defaultClaimTab();
    setTimeout(() => this.router.navigate(['/claims', claim.id], { queryParams: { tab } }));
  }

  protected openGate(): void {
    const blocked = this.gate();
    this.gate.set(null);
    const target = blocked ? gateTarget(blocked) : null;
    if (!target) return;
    this.mode.set('list');
    this.router.navigate(target.path, { queryParams: target.query });
  }

  private missingWrit(): void {
    this.snack.open(
      'Исполнительная надпись ещё не заведена. Создайте её кнопкой «Добавить исполнительную надпись» и укажите период.',
      'OK',
      { duration: 6000 },
    );
  }

  protected openAssigned(row: AssignedAccount): void {
    if (!this.canAdd()) {
      this.router.navigate(['/accounts', row.account]);
      return;
    }
    this.api.openClaim(row.account).subscribe({
      next: (claim) => {
        this.mode.set('list');
        this.reload();
        this.router.navigate(['/claims', claim.id]);
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected groupOf(row: AccountRow | null): number | null {
    if (!row) return null;
    return row.effective_group ?? row.debt_group;
  }

  protected letter(label: string): string {
    return (label || '—').slice(0, 1);
  }

  protected short(text: string | null | undefined): string {
    return briefText(text || '');
  }

  protected scenarioLine(card: AccountRow): string {
    const text = this.short(card.scenario_brief);
    return text === '—' ? 'Сценарий не назначен' : text;
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

  protected openCreate(): void {
    this.picked.set(null);
    this.writ.set(null);
    this.writError.set('');
    this.writFrom = '';
    this.writTo = '';
    this.writWarning = '';
    this.writAct = '';
    this.writDays = 7;
    this.office = '';
    this.officeOpen.set(false);
    this.query.setValue('');
    this.found.set([]);
    this.pickerOpen.set(false);
    this.dialog.set(true);
  }

  protected openPicker(): void {
    this.pickerOpen.set(true);
    this.lookup(this.query.value);
  }

  protected choose(row: AccountRow): void {
    this.picked.set(row);
    this.pickerOpen.set(false);
    this.writError.set('');
    this.loadWrit(row.id, true);
  }

  protected refreshWritWindow(): void {
    const row = this.picked();
    if (!row) return;
    this.loadWrit(row.id, false);
  }

  protected saveWrit(): void {
    const row = this.picked();
    if (!row || this.busy()) return;
    this.busy.set(true);
    this.writError.set('');
    this.api.createWrit(row.id, {
      debt_from: this.writFrom,
      debt_to: this.writTo,
      warning_delivered_on: this.writWarning,
      non_delivery_act_on: this.writAct,
      repayment_days: this.writDays,
      notary_office: this.office.trim(),
    }).subscribe({
      next: (created) => {
        this.busy.set(false);
        this.dialog.set(false);
        this.reload();
        this.router.navigate(['/claims', created.id], { queryParams: { tab: 'pack', writ: null }, queryParamsHandling: 'merge' });
      },
      error: (err) => {
        this.busy.set(false);
        this.writError.set(errorMessage(err));
      },
    });
  }

  private loadWrit(id: number, fill: boolean): void {
    const params = fill ? undefined : {
      debt_from: this.writFrom,
      debt_to: this.writTo,
      warning_delivered_on: this.writWarning,
      non_delivery_act_on: this.writAct,
    };
    this.api.writDraft(id, params).subscribe({
      next: (draft) => {
        this.writ.set(draft);
        if (!fill) return;
        this.writFrom = draft.eligible_from || '';
        this.writTo = draft.eligible_to || '';
        this.writWarning = draft.warning_delivered_on || '';
        this.writAct = draft.non_delivery_act_on || '';
        this.writDays = draft.repayment_days || 7;
      },
      error: (err) => this.writError.set(errorMessage(err)),
    });
  }

  protected officeHits(): NotaryOffice[] {
    const query = this.office.trim().toLowerCase();
    const rows = this.offices();
    const matched = query
      ? rows.filter((row) => `${row.name} ${row.district} ${row.address}`.toLowerCase().includes(query))
      : rows;
    return matched.slice(0, 12);
  }

  protected chooseOffice(row: NotaryOffice): void {
    this.office = row.name;
    this.officeOpen.set(false);
  }

  protected closePickers(event: Event): void {
    event.stopPropagation();
    const target = event.target as HTMLElement | null;
    this.pickerOpen.set(false);
    if (!target?.closest('.office-picker')) this.officeOpen.set(false);
  }

  protected closeDialog(): void {
    this.dialog.set(false);
    this.router.navigate([], { queryParams: { writ: null }, queryParamsHandling: 'merge' });
  }

  private openFromRoute(): void {
    const id = Number(this.route.firstChild?.snapshot.paramMap.get('id') || this.router.url.match(/\/claims\/(\d+)/)?.[1]);
    if (!id) return;
    this.api.claim(id).subscribe({
      next: (row) => {
        this.office = row.notary_office || '';
        this.dialog.set(true);
        this.api.account(row.account).subscribe({
          next: (account) => {
            this.picked.set(account);
            this.loadWrit(account.id, true);
          },
          error: (err) => this.snack.open(errorMessage(err), 'OK'),
        });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private lookup(value: string): void {
    const text = value.trim();
    if (!this.pickerOpen() || text.length < 2) {
      this.found.set([]);
      return;
    }
    this.api.accounts({ q: text, page_size: 12 }).subscribe({
      next: (page) => this.found.set(page.results.slice(0, 12)),
      error: () => this.found.set([]),
    });
  }

  private population(): Record<string, string | number> {
    const params: Record<string, string | number> = { scope: 'claims' };
    if (this.filter.q) params['q'] = this.filter.q;
    if (this.filter.groups.length === 1) params['debt_group'] = this.filter.groups[0];
    else if (this.filter.groups.length) params['debt_group__in'] = this.filter.groups.join(',');
    if (this.filter.ratings.length === 1) params['rating'] = this.filter.ratings[0];
    else if (this.filter.ratings.length) params['rating__in'] = this.filter.ratings.join(',');
    if (this.filter.stage) params['funnel_stage'] = this.filter.stage;
    if (this.filter.domain) params['domain'] = JSON.stringify(this.filter.domain);
    params['claim_module'] = this.module();
    return params;
  }

  private refreshView(): void {
    this.chartQuery.set(this.population());
    const mode = this.mode();
    if (mode === 'list') this.loadDebtors();
    else if (mode === 'kanban') this.loadBoard();
    else if (mode === 'calendar') this.loadCalendar();
  }

  private loadDebtors(): void {
    this.api.accounts({ ...this.population(), page_size: 200 }).subscribe({
      next: (page) => {
        this.debtors.set(page.results);
        this.debtorTotal.set(page.count);
      },
      error: (err) => this.error.set(errorMessage(err)),
    });
  }

  private loadBoard(): void {
    this.api.kanban(this.population()).subscribe({
      next: (columns) => this.board.set(columns),
      error: (err) => this.error.set(errorMessage(err)),
    });
  }

  private loadCalendar(): void {
    this.loadDebtors();
    this.api.calendar({ date_from: this.spanFrom, date_to: this.spanTo }, this.population()).subscribe({
      next: (rows) => this.events.set(rows),
      error: (err) => this.error.set(errorMessage(err)),
    });
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

  private trackCase(): void {
    this.caseOpen.set(/\/claims\/\d+/.test(this.router.url));
  }

  private dotDate(value: string): string {
    const [year, month, day] = value.slice(0, 10).split('-');
    return day && month && year ? `${day}.${month}.${year}` : value;
  }

  private reload(): void {
    this.api.claims().subscribe({
      next: (page) => {
        this.stages.set(page.stages);
        this.cards.set(page.results);
        this.error.set('');
      },
      error: (err) => this.error.set(errorMessage(err)),
    });
    this.refreshView();
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
