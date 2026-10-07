import { MoneyComponent } from '../../core/money.component';
import { Component, HostListener, OnInit, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { Router, RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { ApiService, errorMessage } from '../../core/api.service';
import { AnalyticsComponent } from '../analytics/analytics.component';
import { CalendarBoardComponent, CalendarDraft, CalendarMode } from '../calendar/calendar-board.component';
import { RegistryViewsComponent } from '../registry-views.component';
import { AuthService } from '../../core/auth.service';
import {
  AccountService,
  CalendarEvent,
  ContractPerson,
  ContractSummary,
  DebtorCategory,
  MessageTemplate,
  SavedFilter,
  ServiceChoice,
} from '../../core/models';

type CustomField = 'group' | 'category' | 'stage' | 'billing' | 'specialist' | 'ownership' | 'housing' | 'months' | 'residents';

@Component({
  selector: 'app-contracts-list',
  standalone: true,
  imports: [
    ReactiveFormsModule, MatTableModule, MatPaginatorModule, MatFormFieldModule, MoneyComponent,
    MatInputModule, MatSelectModule, MatButtonModule, CalendarBoardComponent, AnalyticsComponent, RegistryViewsComponent, RouterLink,
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
            @if (specialist.value) {
              <button type="button" class="fchip" (click)="clearText(specialist, $event)">Специалист: {{ specialist.value }} ×</button>
            }
            @if (ownership.value) {
              <button type="button" class="fchip" (click)="clearText(ownership, $event)">Собственность: {{ ownership.value }} ×</button>
            }
            @if (housing.value) {
              <button type="button" class="fchip" (click)="clearText(housing, $event)">Жилфонд: {{ housing.value }} ×</button>
            }
            @if (monthsDebt.value) {
              <button type="button" class="fchip" (click)="clearText(monthsDebt, $event)">Месяцев: {{ monthsDebt.value }} ×</button>
            }
            @if (residents.value) {
              <button type="button" class="fchip" (click)="clearText(residents, $event)">Проживающих: {{ residents.value }} ×</button>
            }
            @if (periodFrom.value || periodTo.value) {
              <button type="button" class="fchip" (click)="clearPeriod($event)">Период: {{ periodFrom.value || '…' }} — {{ periodTo.value || '…' }} ×</button>
            }
            @if (groupBy.value) {
              <button type="button" class="fchip" (click)="clearGroupByChip($event)">Группировать по: {{ groupByLabel(groupBy.value) }} ×</button>
            }
            <input
              [formControl]="search"
              placeholder="Поиск по ФИО плательщиков, лицевому счёту, наименованию услуги, идентификационному номеру, учетному номеру…"
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
                @if (auth.showServiceOrg()) {
                  <div class="sub">Краткое наименование поставщика или обслуживающей организации</div>
                  <div class="save-row">
                    <input [formControl]="billing" placeholder="Название или код" (click)="$event.stopPropagation()" />
                  </div>
                }
                <div class="sub">Закреплённый специалист</div>
                <div class="save-row">
                  <input [formControl]="specialist" placeholder="ФИО специалиста" (click)="$event.stopPropagation()" />
                </div>
                <div class="sub">Тип собственности</div>
                <div class="save-row">
                  <input [formControl]="ownership" placeholder="Например, частная" (click)="$event.stopPropagation()" />
                </div>
                <div class="sub">Тип объекта жилфонда</div>
                <div class="save-row">
                  <input [formControl]="housing" placeholder="Например, квартира" (click)="$event.stopPropagation()" />
                </div>
                <div class="sub">Кол-во месяцев долга</div>
                <div class="save-row">
                  <input [formControl]="monthsDebt" type="number" placeholder="Месяцев" (click)="$event.stopPropagation()" />
                </div>
                <div class="sub">Кол-во проживающих</div>
                <div class="save-row">
                  <input [formControl]="residents" type="number" placeholder="Человек" (click)="$event.stopPropagation()" />
                </div>
                <div class="sub">Период возникновения долга</div>
                <div class="save-row">
                  <input [formControl]="periodFrom" type="date" (click)="$event.stopPropagation()" />
                  <input [formControl]="periodTo" type="date" (click)="$event.stopPropagation()" />
                </div>
                <button type="button" class="menu-add" (click)="customOpen.set(true)">+ Добавить пользовательский фильтр</button>
              </div>
              <div class="col">
                <div class="col-title">Группировать по</div>
                @for (item of groupChoices; track item.id) {
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
          @if (view() === 'persons' || view() === 'services' || view() === 'grouped') {
            <button type="button" class="view-btn wide" [class.on]="view() === 'persons'" (click)="showPersons()">Лица</button>
            <button type="button" class="view-btn wide" [class.on]="view() === 'services'" (click)="showServices()">Услуги</button>
          }
          <app-registry-views [mode]="registryMode()" (modeChange)="showRegistry($event)" />
        </div>
      </div>

      <div class="body">
        @if (summary(); as s) {
          <p class="hint">
            Сводка для поставщика услуг. Лицевых счетов с задолженностью: <b>{{ s.ls_count }}</b>.
            Сумма основного долга <app-money [value]="s.principal" [blank]="false" />,
            сумма пени <app-money [value]="s.penalty" [blank]="false" />,
            сумма задолженности <app-money [value]="obligation(s.principal, s.penalty)" [blank]="false" />.
            Мероприятия по этим счетам:
            @for (item of s.measures; track item.kind) { {{ item.kind }} {{ item.total }}; }
          </p>
        }
        @if (error()) { <p class="status-failed">{{ error() }}</p> }
        @if (view() === 'persons') {
          <div class="list-pane">
          <table mat-table [dataSource]="persons()">
            <ng-container matColumnDef="select">
              <th mat-header-cell *matHeaderCellDef></th>
              <td mat-cell *matCellDef="let r" (click)="$event.stopPropagation()">
                <input type="checkbox" [checked]="isSelected(r.sample_id)" (change)="togglePerson(r)" />
              </td>
            </ng-container>
            <ng-container matColumnDef="payer"><th mat-header-cell *matHeaderCellDef>ФИО плательщика / Наименование юридического лица</th><td mat-cell *matCellDef="let r">{{ r.payer }}</td></ng-container>
            <ng-container matColumnDef="payer_identifier"><th mat-header-cell *matHeaderCellDef>Идентификационный номер (ИН)</th><td mat-cell *matCellDef="let r">{{ r.payer_identifier }}</td></ng-container>
            <ng-container matColumnDef="payer_unp"><th mat-header-cell *matHeaderCellDef>Учётный номер плательщика (УНП)</th><td mat-cell *matCellDef="let r">{{ r.payer_unp }}</td></ng-container>
            <ng-container matColumnDef="rating_label"><th mat-header-cell *matHeaderCellDef>Рейтинг должника</th><td mat-cell *matCellDef="let r">@if (r.rating_label) { <span class="rating-badge r{{ r.rating_label[0] }}">{{ r.rating_label }}</span> }</td></ng-container>
            <ng-container matColumnDef="funnel_stage"><th mat-header-cell *matHeaderCellDef>Этап воронки взыскания</th><td mat-cell *matCellDef="let r">{{ stageLabel(r.funnel_stage || '') }}</td></ng-container>
            <ng-container matColumnDef="ls_count"><th mat-header-cell *matHeaderCellDef>Номер ЛС с долгом</th><td mat-cell *matCellDef="let r">{{ r.ls_count }}</td></ng-container>
            <ng-container matColumnDef="principal"><th mat-header-cell *matHeaderCellDef>Сумма основного долга</th><td mat-cell *matCellDef="let r"><app-money [value]="r.principal" [blank]="false" /></td></ng-container>
            <ng-container matColumnDef="penalty"><th mat-header-cell *matHeaderCellDef>Сумма пени</th><td mat-cell *matCellDef="let r"><app-money [value]="r.penalty" [blank]="false" /></td></ng-container>
            <ng-container matColumnDef="obligation"><th mat-header-cell *matHeaderCellDef>Сумма задолженности</th><td mat-cell *matCellDef="let r"><app-money [value]="r.obligation" [blank]="false" /></td></ng-container>
            <ng-container matColumnDef="effective_group"><th mat-header-cell *matHeaderCellDef>Группа задолженности</th><td mat-cell *matCellDef="let r">{{ r.debt_group }}</td></ng-container>
            <ng-container matColumnDef="assigned_name"><th mat-header-cell *matHeaderCellDef>Закреплённый специалист</th><td mat-cell *matCellDef="let r">{{ r.assigned_name }}</td></ng-container>
            <ng-container matColumnDef="ownership_type_name"><th mat-header-cell *matHeaderCellDef>Тип собственности</th><td mat-cell *matCellDef="let r">{{ r.ownership_type_name }}</td></ng-container>
            <ng-container matColumnDef="housing_object"><th mat-header-cell *matHeaderCellDef>Тип объекта жилфонда</th><td mat-cell *matCellDef="let r">{{ r.housing_object }}</td></ng-container>
            <ng-container matColumnDef="months_debt"><th mat-header-cell *matHeaderCellDef>Кол-во месяцев долга</th><td mat-cell *matCellDef="let r">{{ r.months_debt }}</td></ng-container>
            <ng-container matColumnDef="subj_count"><th mat-header-cell *matHeaderCellDef>Кол-во проживающих</th><td mat-cell *matCellDef="let r">{{ r.subj_count }}</td></ng-container>
            <ng-container matColumnDef="earliest"><th mat-header-cell *matHeaderCellDef>Наиболее ранний период</th><td mat-cell *matCellDef="let r">{{ r.earliest }}</td></ng-container>
            <ng-container matColumnDef="category"><th mat-header-cell *matHeaderCellDef>Категория должника</th><td mat-cell *matCellDef="let r">{{ r.category }}</td></ng-container>
            <tr mat-header-row *matHeaderRowDef="personColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: personColumns" class="clickable-row" (click)="open(row.sample_id)"></tr>
          </table>
          </div>
          <mat-paginator [length]="total()" [pageSize]="50" (page)="pageChanged($event)" />
        }
        @if (view() === 'services') {
          <div class="list-pane">
          <table mat-table [dataSource]="rows()">
            <ng-container matColumnDef="select">
              <th mat-header-cell *matHeaderCellDef></th>
              <td mat-cell *matCellDef="let r" (click)="$event.stopPropagation()">
                <input type="checkbox" [checked]="isSelected(r.id)" (change)="toggleService(r)" />
              </td>
            </ng-container>
            <ng-container matColumnDef="payer"><th mat-header-cell *matHeaderCellDef>ФИО плательщика / Наименование юридического лица</th><td mat-cell *matCellDef="let r">{{ r.payer }}</td></ng-container>
            <ng-container matColumnDef="payer_identifier"><th mat-header-cell *matHeaderCellDef>Идентификационный номер (ИН)</th><td mat-cell *matCellDef="let r">{{ r.payer_identifier }}</td></ng-container>
            <ng-container matColumnDef="payer_unp"><th mat-header-cell *matHeaderCellDef>Учётный номер плательщика (УНП)</th><td mat-cell *matCellDef="let r">{{ r.payer_unp }}</td></ng-container>
            <ng-container matColumnDef="account_number"><th mat-header-cell *matHeaderCellDef>Номер ЛС</th><td mat-cell *matCellDef="let r"><a [routerLink]="['/accounts', r.account]" (click)="$event.stopPropagation()">{{ r.account_number }}</a></td></ng-container>
            <ng-container matColumnDef="rating_label"><th mat-header-cell *matHeaderCellDef>Рейтинг должника</th><td mat-cell *matCellDef="let r">@if (r.rating_label) { <span class="rating-badge r{{ r.rating_label[0] }}">{{ r.rating_label }}</span> }</td></ng-container>
            <ng-container matColumnDef="funnel_stage"><th mat-header-cell *matHeaderCellDef>Этап воронки взыскания</th><td mat-cell *matCellDef="let r">{{ stageLabel(r.funnel_stage) }}</td></ng-container>
            <ng-container matColumnDef="service_name"><th mat-header-cell *matHeaderCellDef>Наименование услуги</th><td mat-cell *matCellDef="let r">{{ r.service_name }}</td></ng-container>
            <ng-container matColumnDef="service_list_id"><th mat-header-cell *matHeaderCellDef>Номер договора</th><td mat-cell *matCellDef="let r">{{ r.service_list_id }}</td></ng-container>
            <ng-container matColumnDef="start_date"><th mat-header-cell *matHeaderCellDef>Дата договора</th><td mat-cell *matCellDef="let r">{{ r.start_date }}</td></ng-container>
            <ng-container matColumnDef="shot_name"><th mat-header-cell *matHeaderCellDef>Поставщик услуги</th><td mat-cell *matCellDef="let r">{{ r.shot_name }}</td></ng-container>
            <ng-container matColumnDef="billing_provider"><th mat-header-cell *matHeaderCellDef>Обслуживающая организация</th><td mat-cell *matCellDef="let r">{{ r.billing_provider }}</td></ng-container>
            <ng-container matColumnDef="schema_label"><th mat-header-cell *matHeaderCellDef>Наименование схемы</th><td mat-cell *matCellDef="let r">{{ r.schema_label }}</td></ng-container>
            <ng-container matColumnDef="balance_out"><th mat-header-cell *matHeaderCellDef>Сумма основного долга</th><td mat-cell *matCellDef="let r"><app-money [value]="r.balance_out" [blank]="false" /></td></ng-container>
            <ng-container matColumnDef="balance_mulct_out"><th mat-header-cell *matHeaderCellDef>Сумма пени</th><td mat-cell *matCellDef="let r"><app-money [value]="r.balance_mulct_out" [blank]="false" /></td></ng-container>
            <ng-container matColumnDef="obligation_total"><th mat-header-cell *matHeaderCellDef>Сумма задолженности</th><td mat-cell *matCellDef="let r"><app-money [value]="r.obligation_total" [blank]="false" /></td></ng-container>
            <ng-container matColumnDef="initial_principal"><th mat-header-cell *matHeaderCellDef>Первоначальная сумма долга</th><td mat-cell *matCellDef="let r"><app-money [value]="r.initial_principal" /></td></ng-container>
            <ng-container matColumnDef="initial_penalty"><th mat-header-cell *matHeaderCellDef>Первоначальная сумма пени</th><td mat-cell *matCellDef="let r"><app-money [value]="r.initial_penalty" /></td></ng-container>
            <ng-container matColumnDef="debt_started_on"><th mat-header-cell *matHeaderCellDef>Наиболее ранний период</th><td mat-cell *matCellDef="let r">{{ r.debt_started_on }}</td></ng-container>
            <ng-container matColumnDef="repayment_due_on"><th mat-header-cell *matHeaderCellDef>Срок погашения</th><td mat-cell *matCellDef="let r">{{ r.repayment_due_on }}</td></ng-container>
            <ng-container matColumnDef="last_payment_date"><th mat-header-cell *matHeaderCellDef>Дата последней оплаты</th><td mat-cell *matCellDef="let r">{{ r.last_payment_date }}</td></ng-container>
            <ng-container matColumnDef="effective_group"><th mat-header-cell *matHeaderCellDef>Группа задолженности</th><td mat-cell *matCellDef="let r">{{ r.effective_group }}</td></ng-container>
            <ng-container matColumnDef="scenario_brief"><th mat-header-cell *matHeaderCellDef>Сценарий</th><td mat-cell *matCellDef="let r">{{ r.scenario_brief }}</td></ng-container>
            <ng-container matColumnDef="assigned_name"><th mat-header-cell *matHeaderCellDef>Закреплённый специалист</th><td mat-cell *matCellDef="let r">{{ r.assigned_name }}</td></ng-container>
            <ng-container matColumnDef="ownership_type_name"><th mat-header-cell *matHeaderCellDef>Тип собственности</th><td mat-cell *matCellDef="let r">{{ r.ownership_type_name }}</td></ng-container>
            <ng-container matColumnDef="housing_object"><th mat-header-cell *matHeaderCellDef>Тип объекта жилфонда</th><td mat-cell *matCellDef="let r">{{ r.housing_object }}</td></ng-container>
            <ng-container matColumnDef="debt_period"><th mat-header-cell *matHeaderCellDef>Кол-во месяцев долга</th><td mat-cell *matCellDef="let r">{{ r.debt_period }}</td></ng-container>
            <ng-container matColumnDef="subj_count"><th mat-header-cell *matHeaderCellDef>Кол-во проживающих</th><td mat-cell *matCellDef="let r">{{ r.subj_count }}</td></ng-container>
            <ng-container matColumnDef="category_name"><th mat-header-cell *matHeaderCellDef>Категория должника</th><td mat-cell *matCellDef="let r">{{ r.category_name }}</td></ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns" class="clickable-row" (click)="open(row.id)"></tr>
          </table>
          </div>
          <mat-paginator [length]="total()" [pageSize]="50" (page)="pageChanged($event)" />
        }
        @if (view() === 'kanban') {
          <div class="k-board">
            @for (column of kanban(); track column.stage) {
              <section class="k-col" [class.drop]="dropStage() === column.stage" [attr.data-stage]="column.stage"
                       (dragover)="allowDrop($event, column.stage)" (dragleave)="clearDrop(column.stage)" (drop)="dropOnStage($event, column.stage)">
                <h3><span>{{ column.title }}</span><b>{{ column.total }}</b></h3>
                <div class="list-pane cards">
                @for (card of column.cards; track card.sample_id) {
                  <article class="k-card g{{ card.debt_group ?? 0 }}" [class.picked]="isSelected(card.sample_id)"
                           [draggable]="canMove()" (dragstart)="startCard($event, card)" (click)="openCard($event, card)">
                    <div class="name">{{ card.payer || 'Без наименования' }}</div>
                    @if (canMove()) {
                      <button type="button" class="more" aria-label="Сменить этап" (click)="toggleStage($event, card.sample_id)">
                        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2.5h4.5V7M13.2 2.8 7.2 8.8M7 3.5H3.5v9h9V9" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>
                      </button>
                    }
                    @if (stageMenu() === card.sample_id) {
                      <div class="stage-menu" (click)="$event.stopPropagation()">
                        @for (item of stages; track item.id) {
                          <button type="button" [class.on]="column.stage === item.id" (click)="move(card, item.id)">{{ item.label }}</button>
                        }
                      </div>
                    }
                    <div class="line">{{ personId(card) }} · {{ card.ls_count }} ЛС · {{ card.service_count || 1 }} усл.</div>
                    @if (card.service_name) {
                      <div class="line">{{ card.service_name }}</div>
                    }
                    @if (card.address) {
                      <div class="line">{{ street(card.address) }}</div>
                    }
                    <div class="group-line">
                      @if (card.rating_label) {
                        <span class="rating-badge r{{ card.rating_label[0] }}" title="Рейтинг должника">{{ card.rating_label }}</span>
                      }
                      <span>Группа задолженности {{ card.debt_group || '—' }}@if (card.category) { · {{ card.category }} }</span>
                    </div>
                    @if (card.assigned_name) { <div class="line">Закреплённый специалист: {{ card.assigned_name }}</div> }
                    <div class="line">Месяцев долга {{ card.months_debt ?? '—' }} · проживающих {{ card.subj_count ?? '—' }}</div>
                    <div class="money">
                      <div>Сумма задолженности <app-money [value]="card.obligation" [blank]="false" /></div>
                      <small>Сумма основного долга <app-money [value]="card.principal" [blank]="false" /> · Сумма пени <app-money [value]="card.penalty" [blank]="false" /></small>
                    </div>
                    <div class="foot"><span class="when">{{ cardMark(card) }}</span></div>
                  </article>
                }
                </div>
              </section>
            }
          </div>
        }
        @if (view() === 'charts') {
          <app-analytics scope="contracts" scopeLabel="Лицевые счета с услугами" />
        }
        @if (view() === 'calendar') {
          <app-calendar-board
            [events]="events()" [from]="spanFrom" [to]="spanTo" [mode]="calendarMode" [canCreate]="auth.canWrite()"
            [supplier]="auth.me()?.contour === 'supplier'" [templates]="templates()" [serviceChoices]="serviceChoices()"
            (modeChange)="calendarMode = $event" (spanChange)="setSpan($event)" (openEvent)="openCalendarEvent($event)"
            (createEvent)="submitCalendar($event)" (filters)="panelOpen.set(true)" />
        }
        @if (view() === 'grouped') {
          <div class="list-pane">
          <table mat-table [dataSource]="groupsRows()">
            <ng-container matColumnDef="value"><th mat-header-cell *matHeaderCellDef>Значение</th><td mat-cell *matCellDef="let r">{{ r.value }}</td></ng-container>
            <ng-container matColumnDef="accounts"><th mat-header-cell *matHeaderCellDef>Лицевой счёт (Номер ЛС)</th><td mat-cell *matCellDef="let r">{{ r.accounts }}</td></ng-container>
            <ng-container matColumnDef="debt"><th mat-header-cell *matHeaderCellDef>Сумма основного долга</th><td mat-cell *matCellDef="let r"><app-money [value]="r.debt" [blank]="false" /></td></ng-container>
            <ng-container matColumnDef="penalty"><th mat-header-cell *matHeaderCellDef>Сумма пени</th><td mat-cell *matCellDef="let r"><app-money [value]="r.penalty" [blank]="false" /></td></ng-container>
            <tr mat-header-row *matHeaderRowDef="groupColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: groupColumns"></tr>
          </table>
          </div>
        }
      </div>

      @if (customOpen()) {
        <div class="backdrop" (click)="customOpen.set(false)">
          <div class="dialog" (click)="$event.stopPropagation()" role="dialog" aria-label="Пользовательский фильтр">
            <h3>Добавить пользовательский фильтр</h3>
            <p class="hint">Дополнительное условие к уже выбранным фильтрам. Базовые поля доступны всем ролям.</p>
            <div class="filters">
              <mat-form-field>
                <mat-label>Поле</mat-label>
                <mat-select [formControl]="customField">
                  <mat-option value="group">Группа задолженности</mat-option>
                  <mat-option value="category">Категория</mat-option>
                  <mat-option value="stage">Этап воронки взыскания</mat-option>
                  <mat-option value="specialist">Закреплённый специалист</mat-option>
                  <mat-option value="ownership">Тип собственности</mat-option>
                  <mat-option value="housing">Тип объекта жилфонда</mat-option>
                  <mat-option value="months">Кол-во месяцев долга</mat-option>
                  <mat-option value="residents">Кол-во проживающих</mat-option>
                  @if (auth.showServiceOrg()) {
                    <mat-option value="billing">Краткое наименование поставщика или обслуживающей организации</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              @if (customField.value === 'billing' || customField.value === 'specialist' || customField.value === 'ownership' || customField.value === 'housing' || customField.value === 'months' || customField.value === 'residents') {
                <mat-form-field>
                  <mat-label>Значение</mat-label>
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

      @if (reasonOpen()) {
        <div class="backdrop" (click)="reasonOpen.set(false)">
          <div class="dialog" (click)="$event.stopPropagation()" role="dialog" aria-label="Основание смены этапа">
            <h3>Смена этапа воронки взыскания</h3>
            <p class="hint">Переход между этапами воронки. Мероприятие внутри сценария этой кнопкой не меняется. Укажите основание.</p>
            <div class="save-row">
              <input [formControl]="funnelReason" placeholder="Основание" (click)="$event.stopPropagation()" />
            </div>
            <div class="dialog-actions">
              <button mat-flat-button color="primary" type="button" (click)="confirmMove()">Перевести</button>
              <button mat-stroked-button type="button" (click)="reasonOpen.set(false)">Отмена</button>
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
    .k-col.drop { outline: 2px dashed var(--erip-primary); outline-offset: 2px; border-radius: 8px; }
    .k-card {
      position: relative; background: #fff; border: 1px solid #e6ebf0; border-left: 3px solid #cbd5e1; border-radius: 8px;
      padding: 10px 12px 8px; margin-bottom: 8px; cursor: pointer; box-shadow: 0 1px 2px rgba(16, 42, 67, .06);
    }
    .k-card[draggable="true"] { cursor: grab; }
    .k-card:hover { box-shadow: 0 2px 8px rgba(16, 42, 67, .12); }
    .k-card.picked { background: #e7f4f1; }
    .k-card .name { padding-right: 18px; }
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
    .k-card.g1 { border-left-color: #1f9d55; } .k-card.g2 { border-left-color: #c8962e; }
    .k-card.g3 { border-left-color: #ef6c00; } .k-card.g4 { border-left-color: #e53935; }
    .k-card.g5 { border-left-color: #c62828; } .k-card.g6 { border-left-color: #7f1d1d; }
    .k-card .name { font-weight: 700; font-size: 14px; line-height: 1.25; color: #1f2933; }
    .k-card .line, .k-card .when { margin-top: 3px; font-size: 12px; color: #6b7280; }
    .k-card .group-line { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12px; font-weight: 600; }
    .k-card .letter {
      width: 18px; height: 18px; border-radius: 50%; color: #fff; font-size: 11px; font-weight: 700;
      display: grid; place-items: center; background: #9ca3af;
    }
    .k-card.g1 .group-line { color: #1f9d55; } .k-card.g1 .letter { background: #1f9d55; }
    .k-card.g2 .group-line { color: #a16207; } .k-card.g2 .letter { background: #c8962e; }
    .k-card.g3 .group-line { color: #ef6c00; } .k-card.g3 .letter { background: #ef6c00; }
    .k-card.g4 .group-line { color: #e53935; } .k-card.g4 .letter { background: #e53935; }
    .k-card.g5 .group-line { color: #c62828; } .k-card.g5 .letter { background: #c62828; }
    .k-card.g6 .group-line { color: #7f1d1d; } .k-card.g6 .letter { background: #7f1d1d; }
    .k-card .money { margin-top: 6px; font-size: 13px; font-weight: 700; }
    .k-card .money small { font-weight: 400; color: #6b7280; }
    .muted { color: var(--erip-muted); font-size: 12px; }
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
    { id: 'new', label: 'Новый должник' },
    { id: 'prevention', label: 'Автообзвон/уведомления' },
    { id: 'warning', label: 'Предупреждение вручено' },
    { id: 'disconnect', label: 'Отключение услуг' },
    { id: 'enforcement', label: 'Испол. надпись / иск' },
    { id: 'court', label: 'ОПИ' },
    { id: 'closed', label: 'Не должник' },
  ];
  protected readonly groupOptions = [
    { id: 'debt_group', label: 'Группа задолженности' },
    { id: 'provider', label: 'Поставщик услуги' },
    { id: 'billing', label: 'Обслуживающая организация' },
    { id: 'category', label: 'Категория должника' },
    { id: 'specialist', label: 'Закреплённый специалист' },
    { id: 'ownership', label: 'Тип собственности' },
    { id: 'housing', label: 'Тип объекта жилфонда' },
    { id: 'months', label: 'Кол-во месяцев долга' },
    { id: 'residents', label: 'Кол-во проживающих' },
    { id: 'period', label: 'Период возникновения долга' },
  ];
  protected readonly personColumns = [
    'select', 'payer', 'payer_identifier', 'payer_unp', 'rating_label', 'funnel_stage', 'ls_count',
    'principal', 'penalty', 'obligation', 'effective_group', 'assigned_name', 'ownership_type_name',
    'housing_object', 'months_debt', 'subj_count', 'earliest', 'category',
  ];
  protected readonly columns = this.serviceColumns();
  protected readonly groupChoices = this.contractGroupChoices();
  protected readonly groupColumns = ['value', 'accounts', 'debt', 'penalty'];
  protected readonly view = signal<'persons' | 'services' | 'kanban' | 'calendar' | 'charts' | 'grouped'>('persons');
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
  protected readonly stageMenu = signal<number | null>(null);
  protected readonly dropStage = signal<string | null>(null);
  protected readonly selected = signal<Set<number>>(new Set());
  protected readonly reasonOpen = signal(false);
  protected readonly funnelReason = new FormControl('', { nonNullable: true });
  private pendingIds: number[] = [];
  private pendingStage = '';
  private cardDragged = false;
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly groups = new FormControl<number[]>([], { nonNullable: true });
  protected readonly category = new FormControl('', { nonNullable: true });
  protected readonly stage = new FormControl('', { nonNullable: true });
  protected readonly billing = new FormControl('', { nonNullable: true });
  protected readonly specialist = new FormControl('', { nonNullable: true });
  protected readonly ownership = new FormControl('', { nonNullable: true });
  protected readonly housing = new FormControl('', { nonNullable: true });
  protected readonly monthsDebt = new FormControl('', { nonNullable: true });
  protected readonly residents = new FormControl('', { nonNullable: true });
  protected readonly periodFrom = new FormControl('', { nonNullable: true });
  protected readonly periodTo = new FormControl('', { nonNullable: true });
  protected readonly filterName = new FormControl('', { nonNullable: true });
  protected readonly groupBy = new FormControl('', { nonNullable: true });
  protected readonly customField = new FormControl<CustomField>('group', { nonNullable: true });
  protected readonly customValue = new FormControl('', { nonNullable: true });
  protected readonly dialDay = new FormControl(25, { nonNullable: true });
  protected readonly dialFrom = new FormControl<number | null>(null);
  protected readonly dialTo = new FormControl<number | null>(null);
  protected spanFrom = monthStart();
  protected spanTo = monthEnd();
  protected calendarMode: CalendarMode = 'month';
  protected readonly templates = signal<MessageTemplate[]>([]);
  protected readonly serviceChoices = signal<ServiceChoice[]>([]);
  private page = 1;

  @HostListener('document:click')
  protected closeSearch(): void {
    this.panelOpen.set(false);
    this.stageMenu.set(null);
  }

  ngOnInit(): void {
    this.search.valueChanges.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => this.reload());
    this.groups.valueChanges.subscribe(() => this.reload());
    this.category.valueChanges.subscribe(() => this.reload());
    this.stage.valueChanges.subscribe(() => this.reload());
    this.billing.valueChanges.pipe(debounceTime(300)).subscribe(() => this.reload());
    this.specialist.valueChanges.pipe(debounceTime(300)).subscribe(() => this.reload());
    this.ownership.valueChanges.pipe(debounceTime(300)).subscribe(() => this.reload());
    this.housing.valueChanges.pipe(debounceTime(300)).subscribe(() => this.reload());
    this.monthsDebt.valueChanges.pipe(debounceTime(300)).subscribe(() => this.reload());
    this.residents.valueChanges.pipe(debounceTime(300)).subscribe(() => this.reload());
    this.periodFrom.valueChanges.subscribe(() => this.reload());
    this.periodTo.valueChanges.subscribe(() => this.reload());
    this.groupBy.valueChanges.subscribe((value) => {
      if (value) this.showGrouped();
      else if (this.view() === 'grouped') this.showPersons();
    });
    this.customField.valueChanges.subscribe(() => this.customValue.setValue(''));
    this.api.categories().subscribe((page) => this.categories.set(page.results));
    this.api.savedFilters('contracts').subscribe((page) => this.saved.set(page.results));
    this.reload();
  }

  private serviceColumns(): string[] {
    const columns = [
      'select', 'payer', 'payer_identifier', 'payer_unp', 'account_number', 'rating_label', 'funnel_stage',
      'service_name', 'service_list_id', 'start_date',
    ];
    if (this.auth.showSupplier()) columns.push('shot_name');
    if (this.auth.showServiceOrg()) columns.push('billing_provider');
    if (this.auth.showSchema()) columns.push('schema_label');
    columns.push(
      'balance_out', 'balance_mulct_out', 'obligation_total', 'initial_principal', 'initial_penalty',
      'debt_started_on', 'repayment_due_on', 'last_payment_date', 'effective_group', 'scenario_brief',
      'assigned_name', 'ownership_type_name', 'housing_object', 'debt_period', 'subj_count', 'category_name',
    );
    return columns;
  }

  private contractGroupChoices(): { id: string; label: string }[] {
    return this.groupOptions.filter((item) => {
      if (item.id === 'provider') return this.auth.showSupplier();
      if (item.id === 'billing') return this.auth.showServiceOrg();
      return true;
    });
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

  clearText(control: FormControl<string>, event: Event): void {
    event.stopPropagation();
    control.setValue('');
  }

  clearPeriod(event: Event): void {
    event.stopPropagation();
    this.periodFrom.setValue('');
    this.periodTo.setValue('');
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
    if (this.customField.value === 'specialist') this.specialist.setValue(value);
    if (this.customField.value === 'ownership') this.ownership.setValue(value);
    if (this.customField.value === 'housing') this.housing.setValue(value);
    if (this.customField.value === 'months') this.monthsDebt.setValue(value);
    if (this.customField.value === 'residents') this.residents.setValue(value);
    this.customOpen.set(false);
  }

  pageChanged(event: PageEvent): void {
    this.page = event.pageIndex + 1;
    this.reload();
  }

  open(id: number): void {
    this.router.navigate(['/contracts', id]);
  }

  protected canMove(): boolean {
    const me = this.auth.me();
    return !!me && me.role !== 'observer' && me.contour !== 'supplier';
  }

  protected isSelected(id: number): boolean {
    return this.selected().has(id);
  }

  protected startCard(event: DragEvent, card: ContractPerson): void {
    if (!this.canMove()) {
      event.preventDefault();
      return;
    }
    this.cardDragged = true;
    const cards = this.selected().has(card.sample_id) ? [...this.selected()] : [card.sample_id];
    event.dataTransfer?.setData('text/plain', cards.join(','));
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
    const sampleIds = raw.split(',').map((part) => Number(part)).filter((id) => id > 0);
    const accountIds = this.accountIds(sampleIds);
    if (accountIds.length) this.moveAccounts(accountIds, stage);
  }

  protected openCard(event: MouseEvent, card: ContractPerson): void {
    if (this.cardDragged) {
      this.cardDragged = false;
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      event.stopPropagation();
      const next = new Set(this.selected());
      if (next.has(card.sample_id)) next.delete(card.sample_id);
      else next.add(card.sample_id);
      this.selected.set(next);
      return;
    }
    this.open(card.sample_id);
  }

  protected toggleStage(event: Event, id: number): void {
    event.stopPropagation();
    this.stageMenu.update((open) => open === id ? null : id);
  }

  move(card: ContractPerson, stage: string): void {
    this.moveAccounts(card.account_ids || [], stage);
  }

  private accountIds(sampleIds: number[]): number[] {
    const wanted = new Set(sampleIds);
    const ids = new Set<number>();
    for (const column of this.kanban()) {
      for (const card of column.cards) {
        if (!wanted.has(card.sample_id)) continue;
        for (const id of card.account_ids || []) ids.add(id);
      }
    }
    return [...ids];
  }

  private moveAccounts(ids: number[], stage: string): void {
    this.stageMenu.set(null);
    if (!ids.length) return;
    this.pendingIds = ids;
    this.pendingStage = stage;
    this.funnelReason.setValue('');
    this.reasonOpen.set(true);
  }

  protected confirmMove(): void {
    const reason = this.funnelReason.value.trim();
    if (!this.pendingIds.length || !reason) {
      this.error.set('Укажите основание смены этапа воронки взыскания');
      return;
    }
    this.reasonOpen.set(false);
    this.api.contractStage(this.pendingIds, this.pendingStage, reason).subscribe({
      next: () => {
        this.selected.set(new Set());
        this.pendingIds = [];
        this.showKanban();
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  protected togglePerson(row: ContractPerson): void {
    const next = new Set(this.selected());
    if (next.has(row.sample_id)) next.delete(row.sample_id);
    else next.add(row.sample_id);
    this.selected.set(next);
  }

  protected toggleService(row: AccountService): void {
    const next = new Set(this.selected());
    if (next.has(row.id)) next.delete(row.id);
    else next.add(row.id);
    this.selected.set(next);
  }

  protected obligation(principal: string | null, penalty: string | null): number {
    return Number(principal ?? 0) + Number(penalty ?? 0);
  }

  registryMode(): string {
    const current = this.view();
    if (current === 'persons' || current === 'services' || current === 'grouped') return 'list';
    return current;
  }

  showRegistry(mode: string): void {
    if (mode === 'list') this.showPersons();
    else if (mode === 'kanban') this.showKanban();
    else if (mode === 'calendar') this.showCalendar();
    else if (mode === 'charts') this.view.set('charts');
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
    if (!this.templates().length) {
      this.api.templates({ is_active: true, page_size: 200 }).subscribe((page) => this.templates.set(page.results));
      this.api.serviceChoices().subscribe((page) => this.serviceChoices.set(page.results));
    }
    this.api.contractCalendar({ date_from: this.spanFrom, date_to: this.spanTo }, this.query()).subscribe({
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

  setSpan(span: { from: string; to: string }): void {
    this.spanFrom = span.from;
    this.spanTo = span.to;
    if (this.view() === 'calendar') this.showCalendar();
  }

  protected openCalendarEvent(event: CalendarEvent): void {
    if (event.measure_id) this.router.navigate(['/measures', event.measure_id]);
    else if (event.contract_id) this.router.navigate(['/contracts', event.contract_id]);
    else if (event.account_id) this.router.navigate(['/accounts', event.account_id]);
  }

  protected submitCalendar(draft: CalendarDraft): void {
    const body: Record<string, unknown> = { kind: draft.kind, due_on: draft.date, started_on: draft.date };
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
    this.api.contractEvent(body, this.query()).subscribe({
      next: () => this.showCalendar(),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  protected personId(card: ContractPerson): string {
    if (card.payer_identifier) return `ИН ${card.payer_identifier}`;
    if (card.payer_unp) return `УНП ${card.payer_unp}`;
    return 'без ИН';
  }

  protected cardMark(card: ContractPerson): string {
    if (card.due_on) return `срок ${card.due_on}`;
    if (card.earliest) return `долг с ${card.earliest}`;
    return 'срок не задан';
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
    this.specialist.setValue(String(query['assigned_name'] ?? ''), { emitEvent: false });
    this.ownership.setValue(String(query['ownership'] ?? ''), { emitEvent: false });
    this.housing.setValue(String(query['housing'] ?? ''), { emitEvent: false });
    this.monthsDebt.setValue(String(query['months_debt'] ?? ''), { emitEvent: false });
    this.residents.setValue(String(query['subj_count'] ?? ''), { emitEvent: false });
    this.periodFrom.setValue(String(query['period_from'] ?? ''), { emitEvent: false });
    this.periodTo.setValue(String(query['period_to'] ?? ''), { emitEvent: false });
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
    if (this.view() === 'charts') return;
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
      assigned_name: this.specialist.value,
      ownership: this.ownership.value,
      housing: this.housing.value,
      months_debt: this.monthsDebt.value || null,
      subj_count: this.residents.value || null,
      period_from: this.periodFrom.value,
      period_to: this.periodTo.value,
    };
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
