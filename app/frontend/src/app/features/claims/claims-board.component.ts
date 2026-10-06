import { Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { debounceTime, distinctUntilChanged, filter } from 'rxjs';

import { ApiService, AssignedAccount, ClaimCase, Named, errorMessage } from '../../core/api.service';
import { BynSignComponent, MoneyComponent } from '../../core/money.component';
import { AuthService } from '../../core/auth.service';
import { AccountRow, CalendarEvent, KanbanColumn } from '../../core/models';
import { AnalyticsComponent } from '../analytics/analytics.component';
import { CalendarBoardComponent, CalendarMode } from '../calendar/calendar-board.component';
import { RegistryFilterComponent, RegistryFilterQuery } from '../registry-filter.component';
import { RegistryViewsComponent } from '../registry-views.component';

@Component({
  selector: 'app-claims-board',
  standalone: true,
  imports: [
    FormsModule, ReactiveFormsModule, RouterLink, RouterLinkActive, RouterOutlet, MatButtonModule, MatSnackBarModule,
    RegistryViewsComponent, AnalyticsComponent, CalendarBoardComponent, RegistryFilterComponent, MoneyComponent, BynSignComponent,
  ],
  template: `
    <div class="page" [class.dim]="dialog()">
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
      <p class="hint">
        С группы 3: исполнительная надпись, иск и ОПИ.
        Канбан собран в пять колонок по 2–3 этапа. Карточку переносят левой кнопкой или выбирают точный этап значком.
      </p>
      @if (error()) { <p class="error">{{ error() }}</p> }

      @if (mode() === 'list') {
        <section class="main">
          <router-outlet />
          @if (!caseOpen()) {
            @if (!debtors().length) {
              <div class="empty">
                <h2>Претензионно-исковая работа</h2>
                <p>Должников на взыскании пока нет. Они появляются с группы 3, по мероприятию «взыскание» или когда дело уже открыто.</p>
              </div>
            } @else {
              <div class="list-pane">
              <table>
                <thead>
                  <tr>
                    <th>Должник</th>
                    <th>Лицевой счёт (Номер ЛС)</th>
                    <th>Адрес ЛС запросом (Адрес)</th>
                    <th>Группа</th>
                    <th>Рейтинг</th>
                    <th>Исходящее сальдо с пенями</th>
                    <th>Исходящее сальдо пени</th>
                    <th>Этап</th>
                    <th>Дело</th>
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
                      <td>{{ claimOf(row)?.stage_label || 'не открыто' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
              </div>
              @if (hiddenDebtors() > 0) {
                <p class="hint">Показаны первые {{ debtors().length }} из {{ debtorTotal() }}.</p>
              }
            }
          }
        </section>
      }

      @if (mode() === 'kanban') {
        <div class="k-board">
          @for (lane of lanes; track lane.id) {
            <section class="k-col" [class.drop]="dropStage() === lane.id" [attr.data-lane]="lane.id"
                     (dragover)="allowDrop($event, lane.id)" (dragleave)="clearDrop(lane.id)" (drop)="dropOnLane($event, lane)">
              <h3><span>{{ lane.label }}</span><b>{{ laneTotal(lane) }}</b></h3>
              <div class="list-pane cards">
              @for (card of laneCards(lane); track card.id) {
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
                      @for (item of caseStages; track item.id) {
                        <button type="button" [class.on]="(card.claim_stage || 'queue') === item.id" (click)="move(card, item.id)">{{ item.label }}</button>
                      }
                    </div>
                  }
                  <div class="line">ЛС {{ card.client_account }}@if (card.account_address) { · {{ street(card.account_address || '') }} }</div>
                  <div class="stage" [attr.data-stage]="card.claim_stage || 'queue'">{{ stageName(card) }}</div>
                  @if (card.effective_group) {
                    <div class="group-line">
                      <span class="letter">{{ letter(card.rating_label) }}</span>
                      <span>Группа {{ card.effective_group }}</span>
                    </div>
                  }
                  <div class="money"><app-money [value]="card.debt_total" [blank]="false" /> <small>+ пени <app-money [value]="card.mulct_total" [blank]="false" /></small></div>
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
              </div>
            </section>
          }
        </div>
        @if (boardEmpty()) {
          <p class="hint">По этому отбору должников нет.</p>
        }
      }

      @if (mode() === 'calendar') {
        <app-calendar-board
          [events]="events()" [from]="spanFrom" [to]="spanTo" [mode]="calendarMode" [canCreate]="false"
          (modeChange)="calendarMode = $event" (spanChange)="setSpan($event)" (openEvent)="openClaimEvent($event)" />
      }

      @if (mode() === 'charts') {
        <app-analytics scope="claims" scopeLabel="Лицевые счета претензионно-исковой работы" [query]="chartQuery()" />
      }

      @if (dialog()) {
        <div class="backdrop" (click)="closeDialog()">
          <form class="modal" (click)="pickerOpen.set(false); $event.stopPropagation()" (ngSubmit)="save(false)">
            <h2>Добавление исполнительной надписи</h2>
            <p class="hint">
              Пакет собирается из шаблона и вложений. Переход «Направлено нотариусу» возможен только с датой вручения предупреждения и нотариальным тарифом.
              В личный кабинет БНП на этом этапе пакет не уходит: канал — заглушка, файлы .pdf.sgn / .pdf.p7s до 15 МБ проверяет шлюз.
            </p>

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
              @if (early(row)) {
                <p class="warn">
                  Группа {{ groupOf(row) }}: исполнительная надпись не открывается.
                  Для группы 2 — предупреждение и приостановление услуг в реестре мероприятий.
                  Модуль включается с группы 3.
                </p>
              }
              @if ((groupOf(row) || 0) >= 4) {
                <p class="hint">Группа {{ groupOf(row) }}: после надписи доступны иск о выселении и отчуждении жилья.</p>
              }
              @if (already(); as open) {
                <p class="hint">Дело уже есть: {{ open.stage_label }}. <a [routerLink]="['/claims', open.id]" (click)="closeDialog()">Открыть</a></p>
              }
            }
            <label>Период задолженности
              <input [value]="periodText()" readonly />
            </label>
            <label [class.miss]="sendTried() && !warningDate">Дата вручения предупреждения
              <input type="date" [(ngModel)]="warningDate" name="warning" />
            </label>
            <p class="check" [class.ok]="!!warningDate">
              {{ warningDate ? 'Вручено — условие чек-листа выполнено' : 'Нет даты вручения предупреждения' }}
            </p>

            <h3>Суммы</h3>
            <label>Исходящее сальдо с пенями <span class="sum-box"><app-money [value]="picked()?.balance_out ?? editing()?.balance_out ?? null" /></span></label>
            <label>Исходящее сальдо пени <span class="sum-box"><app-money [value]="picked()?.mulct_total ?? editing()?.penalty ?? null" /></span></label>
            <label [class.miss]="sendTried() && !(Number(tariff) > 0)">Нотариальный тариф
              <span class="with-sign">
                <input [(ngModel)]="tariff" name="tariff" placeholder="считает АИС, пока можно внести" />
                <app-byn-sign />
              </span>
            </label>
            <p class="aside-note">Рассчитывается в АИС и относится на должника. ПМ сумму начисления не меняет.</p>
            <label class="total">Итого к взысканию <span class="sum-box"><app-money [value]="grand()" [blank]="false" /></span></label>

            <h3>Нотариус</h3>
            <label>Нотариальная контора
              <input value="Справочник контор ещё не подключён" disabled />
            </label>

            <h3>Пакет документов</h3>
            <ul class="pack">
              <li><span>Заявление о совершении исполнительной надписи</span><em class="wait">из шаблона при направлении</em></li>
              <li>
                <span>Расчёт задолженности по ЛС {{ picked()?.client_account || editing()?.client_account || '' }}</span>
                <em class="ok">из АИС</em>
              </li>
              <li>
                <span>Копия предупреждения с отметкой о вручении</span>
                <em [class.ok]="!!warningDate" [class.wait]="!warningDate">{{ warningDate ? 'дата есть' : 'нет даты' }}</em>
              </li>
              <li><span>Выписка о зарегистрированных лицах</span><em class="wait">ожидает загрузки на карточку</em></li>
            </ul>

            <div class="actions">
              <button type="button" class="primary" [disabled]="busy() || !canSend()" (click)="save(true)">Сформировать пакет и направить</button>
              <button type="submit" class="ghost" [disabled]="busy() || !canDraft()">Сохранить черновик</button>
              <button type="button" class="ghost" (click)="closeDialog()">Отмена</button>
            </div>
          </form>
        </div>
      }
    </div>
  `,
  styles: `
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
    .k-board { display: flex; gap: 14px; overflow: auto; align-items: flex-start; padding-bottom: 12px; }
    .k-col { width: 268px; flex: 0 0 268px; }
    .k-col h3 {
      display: flex; justify-content: space-between; align-items: baseline; gap: 8px;
      margin: 0 0 8px; padding: 0 2px 6px; border-bottom: 3px solid #cbd5e1;
      font-size: 13px; font-weight: 600; color: #243140;
    }
    .k-col h3 b { font-weight: 600; color: #8b95a1; }
    .k-col[data-lane="pack"] h3 { border-bottom-color: #2e7d32; }
    .k-col[data-lane="notary"] h3 { border-bottom-color: #7c3aed; }
    .k-col[data-lane="court"] h3 { border-bottom-color: #e0a106; }
    .k-col[data-lane="opi"] h3 { border-bottom-color: #f08c2e; }
    .k-col[data-lane="finish"] h3 { border-bottom-color: #6b7280; }
    .k-card {
      position: relative; background: #fff; border: 1px solid #e6ebf0; border-left: 3px solid #cbd5e1;
      border-radius: 8px; padding: 10px 12px 8px; margin-bottom: 8px; cursor: pointer;
      box-shadow: 0 1px 2px rgba(16, 42, 67, .06);
    }
    .k-card:hover { box-shadow: 0 2px 8px rgba(16, 42, 67, .12); }
    .k-card.picked { background: #e7f4f1; }
    .k-col.drop { outline: 2px dashed var(--erip-primary); outline-offset: 2px; border-radius: 8px; }
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
    .k-card .money small { font-weight: 400; color: #6b7280; }
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
      box-sizing: border-box; width: 720px; max-width: calc(100vw - 32px);
      height: min(640px, calc(100vh - 48px)); overflow: auto;
      background: #fff; border-radius: 12px; padding: 20px 22px 16px; box-shadow: 0 16px 40px rgba(16, 42, 67, .25);
    }
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
    .picks button { text-align: left; border: 1px solid var(--erip-border); background: #fff; border-radius: 6px; padding: 6px 8px; cursor: pointer; }
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

  protected readonly lanes = [
    { id: 'pack', label: 'Пакет', stages: ['queue', 'prep', 'notary'], entry: 'prep' },
    { id: 'notary', label: 'Ответ нотариуса', stages: ['writ_done', 'refused'], entry: 'writ_done' },
    { id: 'court', label: 'Суд', stages: ['lawsuit', 'court'], entry: 'lawsuit' },
    { id: 'opi', label: 'ОПИ', stages: ['opi', 'opi_measures'], entry: 'opi' },
    { id: 'finish', label: 'Итог', stages: ['recovered', 'impossible', 'writeoff'], entry: 'recovered' },
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
    { id: 'enforcement', label: 'Испол. надпись / иск' },
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
  protected readonly mode = signal<'list' | 'kanban' | 'calendar' | 'charts'>('list');
  private filter: RegistryFilterQuery = { q: '', groups: [], ratings: [], stage: '', period: '' };
  protected readonly chartQuery = signal<Record<string, string | number>>({});
  protected readonly pickerOpen = signal(false);
  protected spanFrom = monthStart();
  protected spanTo = monthEnd();
  protected calendarMode: CalendarMode = 'month';
  protected readonly caseOpen = signal(false);
  protected readonly dialog = signal(false);
  protected readonly found = signal<AccountRow[]>([]);
  protected readonly picked = signal<AccountRow | null>(null);
  protected readonly editing = signal<ClaimCase | null>(null);
  protected readonly busy = signal(false);
  protected readonly sendTried = signal(false);
  protected readonly query = new FormControl('', { nonNullable: true });
  protected readonly Number = Number;
  protected warningDate = '';
  protected tariff = '';

  ngOnInit(): void {
    this.trackCase();
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => this.trackCase());
    this.route.queryParamMap.subscribe((params) => {
      if (params.get('writ') === '1') this.openFromRoute();
    });
    this.query.valueChanges.pipe(debounceTime(300), distinctUntilChanged()).subscribe((value) => this.lookup(value));
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

  protected boardEmpty(): boolean {
    return !this.board().some((column) => column.total > 0);
  }

  protected canMove(): boolean {
    const me = this.auth.me();
    return !!me && me.role !== 'observer' && me.contour !== 'supplier';
  }

  protected isSelected(id: number): boolean {
    return this.selected().has(id);
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

  protected dropOnLane(event: DragEvent, lane: { stages: string[]; entry: string }): void {
    event.preventDefault();
    this.dropStage.set(null);
    if (!this.canMove()) return;
    const raw = event.dataTransfer?.getData('text/plain') || '';
    const ids = raw.split(',').map((part) => Number(part)).filter((id) => id > 0);
    const known = this.board().flatMap((column) => column.cards);
    const moving = ids.filter((id) => {
      const card = known.find((item) => item.id === id);
      return !!card && !lane.stages.includes(card.claim_stage || 'queue');
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

  private moveIds(ids: number[], stage: string): void {
    const pending = this.board().flatMap((column) => column.cards).filter((card) => ids.includes(card.id));
    const step = (): void => {
      const card = pending.shift();
      if (!card) {
        this.selected.set(new Set());
        this.loadBoard();
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
        this.api.claimAction(claimId, 'move', { stage }).subscribe({
          next: () => step(),
          error: (err) => {
            this.snack.open(errorMessage(err), 'OK');
            this.loadBoard();
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
    return this.cards().find((card) => card.account === row.id);
  }

  protected stageLabel(id: string): string {
    return this.funnel.find((item) => item.id === (id || 'new'))?.label || 'Новый должник';
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
    const card = this.cards().find((item) => item.account === event.account_id);
    if (card) {
      this.mode.set('list');
      this.router.navigate(['/claims', card.id]);
      return;
    }
    this.router.navigate(['/accounts', event.account_id]);
  }

  protected openDebtor(row: AccountRow): void {
    const claim = this.claimOf(row);
    if (claim) {
      this.mode.set('list');
      setTimeout(() => this.router.navigate(['/claims', claim.id]));
      return;
    }
    this.openAssigned({
      account: row.id,
      client_account: row.client_account,
      short_fio: row.short_fio,
      debt_group: row.effective_group,
      account_address: row.account_address,
      funnel_stage: row.funnel_stage,
    });
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

  protected early(row: AccountRow): boolean {
    const group = this.groupOf(row);
    return group != null && group < 3;
  }

  protected groupOf(row: AccountRow | null): number | null {
    if (!row) return null;
    return row.effective_group ?? row.debt_group;
  }

  protected already(): ClaimCase | undefined {
    const id = this.picked()?.id;
    if (!id || this.editing()) return undefined;
    return this.cards().find((card) => card.account === id);
  }

  protected periodText(): string {
    const row = this.picked();
    if (!row?.debt_started_on) return 'Дата возникновения в выгрузке не указана';
    const started = this.dotDate(row.debt_started_on);
    const months = row.months_debt ? `, ${row.months_debt} мес.` : '';
    return `с ${started}${months}`;
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

  protected grand(): number {
    const debt = Number(this.picked()?.balance_out || this.editing()?.balance_out || 0);
    const penalty = Number(this.picked()?.mulct_total || this.editing()?.penalty || 0);
    const tariff = Number(this.tariff || 0);
    return debt + penalty + tariff;
  }

  protected canDraft(): boolean {
    return !!this.picked() && !this.tooEarly();
  }

  protected canSend(): boolean {
    return this.canDraft() && !!this.warningDate && Number(this.tariff) > 0;
  }

  protected openCreate(): void {
    this.editing.set(null);
    this.picked.set(null);
    this.warningDate = '';
    this.tariff = '';
    this.sendTried.set(false);
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
    if (!this.warningDate && row.warning_handed_on) this.warningDate = row.warning_handed_on;
  }

  protected closeDialog(): void {
    this.dialog.set(false);
    this.router.navigate([], { queryParams: { writ: null }, queryParamsHandling: 'merge' });
  }

  protected save(send: boolean): void {
    const row = this.picked();
    if (!row || this.tooEarly()) return;
    if (send) this.sendTried.set(true);
    if (send && !this.canSend()) return;
    const existing = this.already();
    this.busy.set(true);
    const opened = existing
      ? this.api.claim(existing.id)
      : this.editing()
        ? this.api.claim(this.editing()!.id)
        : this.api.openClaim(row.id);
    opened.subscribe({
      next: (claim) => this.patchAndMaybeSend(claim, send),
      error: (err) => this.fail(err),
    });
  }

  private tooEarly(): boolean {
    const group = this.groupOf(this.picked());
    return group != null && group < 3;
  }

  private patchAndMaybeSend(claim: ClaimCase, send: boolean): void {
    this.api.patchClaim(claim.id, {
      warning_delivered_on: this.warningDate || null,
      notary_tariff: this.tariff || null,
    }).subscribe({
      next: (saved) => {
        if (!send) {
          this.busy.set(false);
          this.finish(saved, 'Черновик сохранён');
          return;
        }
        this.api.claimAction(saved.id, 'send-notary').subscribe({
          next: (sent) => {
            this.busy.set(false);
            this.finish(sent, 'Пакет отмечен заглушкой БНП');
          },
          error: (err) => this.fail(err),
        });
      },
      error: (err) => this.fail(err),
    });
  }

  private finish(row: ClaimCase, text: string): void {
    this.dialog.set(false);
    this.snack.open(text, 'OK', { duration: 2500 });
    this.reload();
    this.router.navigate(['/claims', row.id], { queryParams: { writ: null }, queryParamsHandling: 'merge' });
  }

  private fail(err: unknown): void {
    this.busy.set(false);
    this.snack.open(errorMessage(err), 'OK');
  }

  private openFromRoute(): void {
    const id = Number(this.route.firstChild?.snapshot.paramMap.get('id') || this.router.url.match(/\/claims\/(\d+)/)?.[1]);
    if (!id) return;
    this.api.claim(id).subscribe({
      next: (row) => {
        this.editing.set(row);
        this.warningDate = row.warning_delivered_on || '';
        this.tariff = row.notary_tariff || '';
        this.dialog.set(true);
        this.api.account(row.account).subscribe({
          next: (account) => this.picked.set(account),
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
