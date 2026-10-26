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
import { debounceTime, distinctUntilChanged, forkJoin } from 'rxjs';

import { ApiService, ColumnPrefs, FunnelGateInfo, errorMessage, funnelGate } from '../../core/api.service';
import { hideColumn, moveColumn, resolveColumnOrder, showColumn } from '../column-layout';
import { AuthService } from '../../core/auth.service';
import { BynSignComponent, MoneyComponent } from '../../core/money.component';
import { AccountRow, CalendarEvent, DirectoryUser, KanbanColumn, MeasureRow, MessageTemplate, SavedFilter, ServiceChoice } from '../../core/models';
import { AnalyticsComponent } from '../analytics/analytics.component';
import { RegistryViewsComponent } from '../registry-views.component';
import { CalendarBoardComponent, CalendarDraft, CalendarMode } from '../calendar/calendar-board.component';
import { briefText, bucketParam, groupSectionTitle } from '../group-title';
import { DomainFilterComponent, DomainRule, accountDomainFields, parseDomain } from '../domain-filter.component';
import { GridResizeDirective } from '../grid-resize.directive';
import { FUNNEL_STAGES, funnelId, funnelTitle } from '../funnel-stages';
import { FunnelGateDialogComponent } from '../funnel-gate-dialog.component';
import { KanbanDebtorComponent } from '../kanban-debtor.component';
import { KanbanDragDirective } from '../kanban-drag.directive';
import { AccountsMapComponent } from './accounts-map.component';

const LABELS: Record<string, string> = {
  account_id: 'ID ЛС',
  client_account: 'Номер ЛС',
  unified_account: 'Уникальный единый номер (УЕН)',
  provider_short_name: 'Обслуживающая организация',
  schema_label: 'Наименование схемы',
  account_address: 'Адрес',
  short_fio: 'ФИО плательщика / Наименование юридического лица',
  payer_identifier: 'Идентификационный номер (ИН)',
  payer_unp: 'Учётный номер плательщика (УНП)',
  rating_label: 'Рейтинг должника',
  debt_started_on: 'Наиболее ранний период возникновения долга',
  debt_total: 'Сумма основного долга',
  mulct_total: 'Сумма пени',
  obligation_total: 'Суммарный долг по всем услугам ЛС',
  services_debt_count: 'Количество услуг с задолженностью',
  contract_number: 'Номер договора',
  contract_date: 'Дата договора',
  service_provider: 'Поставщик услуги',
  initial_principal: 'Первоначальная сумма задолженности',
  initial_penalty: 'Первоначальная сумма пени',
  period_balances: 'Остатки задолженности и пени по периодам',
  repayment_due_on: 'Срок погашения по договору',
  last_payment_date: 'Дата последней оплаты',
  effective_group: 'Группа задолженности',
  scenario_name: 'Сценарий',
  scenario_brief: 'Сценарий',
  assigned_name: 'Закреплённый специалист',
  ownership_type_name: 'Тип собственности',
  acc_category_full: 'Тип объекта жилфонда',
  months_debt: 'Кол-во месяцев долга',
  subj_count: 'Кол-во проживающих',
  registered_count: 'Кол-во зарегистрированных',
  funnel_stage: 'Этап воронки взыскания',
};

const SHORT_LABELS: Record<string, string> = {
  account_id: 'ID ЛС',
  client_account: 'Номер\nЛС',
  unified_account: 'УЕН',
  provider_short_name: 'Обслуж.\nорганизация',
  schema_label: 'Схема',
  account_address: 'Адрес',
  short_fio: 'ФИО /\nнаименование',
  payer_identifier: 'ИН',
  payer_unp: 'УНП',
  rating_label: 'Рейтинг',
  debt_started_on: 'Ранний\nпериод долга',
  debt_total: 'Основной\nдолг',
  mulct_total: 'Пеня',
  obligation_total: 'Суммарный\nдолг',
  services_debt_count: 'Услуг\nс долгом',
  contract_number: 'Номер\nдоговора',
  contract_date: 'Дата\nдоговора',
  service_provider: 'Поставщик\nуслуги',
  initial_principal: 'Первонач.\nдолг',
  initial_penalty: 'Первонач.\nпеня',
  period_balances: 'Остатки\nпо периодам',
  repayment_due_on: 'Срок\nпогашения',
  last_payment_date: 'Последняя\nоплата',
  effective_group: 'Группа',
  scenario_name: 'Сценарий',
  scenario_brief: 'Сценарий',
  assigned_name: 'Специалист',
  ownership_type_name: 'Собствен-\nность',
  acc_category_full: 'Жилфонд',
  months_debt: 'Месяцев\nдолга',
  subj_count: 'Прожива-\nющие',
  registered_count: 'Зареги-\nстрировано',
  funnel_stage: 'Этап\nворонки',
};

const MONEY_COLUMNS = new Set([
  'debt_total', 'mulct_total', 'obligation_total', 'initial_principal', 'initial_penalty', 'period_balances',
]);

const BASE_COLUMNS = [
  'client_account', 'unified_account', 'account_id', 'short_fio', 'account_address', 'payer_identifier', 'payer_unp',
  'provider_short_name', 'schema_label',
  'rating_label', 'funnel_stage', 'debt_total', 'mulct_total', 'obligation_total', 'effective_group',
  'scenario_brief', 'assigned_name', 'ownership_type_name', 'acc_category_full', 'months_debt',
  'subj_count', 'registered_count', 'debt_started_on',
];

type CustomField = 'group' | 'rating' | 'stage' | 'specialist' | 'ownership' | 'housing' | 'months' | 'residents';

const GROUP_PAGE = 40;

interface GroupSection {
  value: string;
  accounts: number;
  services: number;
  debt: string | null;
  penalty: string | null;
  rows: AccountRow[];
  rowTotal: number;
  page: number;
  open: boolean;
  loading: boolean;
}

@Component({
  selector: 'app-accounts-list',
  host: { '[class.board]': 'view() === "kanban"' },
  standalone: true,
  imports: [
    ReactiveFormsModule, MatTableModule, MatPaginatorModule, MatSortModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatButtonModule, MatSnackBarModule, AccountsMapComponent, AnalyticsComponent,
    CalendarBoardComponent, RegistryViewsComponent, MoneyComponent, BynSignComponent, DomainFilterComponent,
    KanbanDebtorComponent, KanbanDragDirective, GridResizeDirective, FunnelGateDialogComponent,
  ],
  template: `
    <div class="registry" [class.board]="view() === 'kanban'">
      <div class="control" [class.tools-tight]="toolsTight()">
        <span class="crumb">Реестр ЛС</span>
        <div class="search-wrap" (click)="$event.stopPropagation()">
          <div class="search" (click)="openFilters()">
            @if (groupsSelected.value.length) {
              <button type="button" class="fchip" (click)="clearGroups($event)">Группа: {{ groupsSelected.value.join(', ') }} ×</button>
            }
            @if (rating.value.length) {
              <button type="button" class="fchip" (click)="clearRating($event)">Рейтинг: {{ rating.value.join(', ') }} ×</button>
            }
            @if (stage.value) {
              <button type="button" class="fchip" (click)="clearStage($event)">Этап: {{ stageLabel(stage.value) }} ×</button>
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
            @if (territoryName()) {
              <button type="button" class="fchip" (click)="clearTerritoryChip($event)">{{ territoryName() }} ×</button>
            }
            @if (domain()) {
              <button type="button" class="fchip" (click)="clearDomain($event)">Условие ×</button>
            }
            <input
              [formControl]="search"
              placeholder="Поиск по ФИО плательщиков, лицевому счёту, адресу, идентификационному номеру…"
              (focus)="openFilters()"
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
                <div class="sub">Рейтинг должника</div>
                <div class="pills">
                  @for (letter of letters; track letter) {
                    <button type="button" class="pill" [class.on]="rating.value.includes(letter)" (click)="toggleRating(letter)">{{ letter }}</button>
                  }
                </div>
                <div class="sub">Этап воронки взыскания</div>
                @for (item of stages; track item.id) {
                  <button type="button" class="menu-item" [class.on]="stage.value === item.id" (click)="setStage(item.id)">{{ item.label }}</button>
                }
                <div class="sub">Закреплённый специалист</div>
                @for (item of specialists(); track item.name) {
                  <button type="button" class="menu-item" [class.on]="specialist.value === item.name" (click)="setSpecialist(item.name)">{{ item.name }}</button>
                }
                @if (!specialists().length) {
                  <p class="empty">Закреплённых специалистов пока нет</p>
                }
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
          <button type="button" class="tool" title="Мероприятие" (click)="measureOpen.set(!measureOpen())">{{ toolLabel('Мероприятие', 'Меропр.') }}</button>
          @if (selectedCount()) {
            <button type="button" class="tool" title="Дополнительное мероприятие" (click)="openExtra()">{{ toolLabel('Доп. мероприятие', 'Доп.') }}</button>
          }
          <button type="button" class="tool" title="Изменить сценарий" (click)="scenarioOpen.set(!scenarioOpen())">{{ toolLabel('Изменить сценарий', 'Сценарий') }}</button>
          <button type="button" class="tool" title="Запустить сценарий" (click)="runScenarios()">{{ toolLabel('Запустить сценарий', 'Запуск') }}</button>
          <button type="button" class="tool" title="Передать специалисту ЮС" (click)="legalOpen.set(!legalOpen())">{{ toolLabel('Передать специалисту ЮС', 'ЮС') }}</button>
        }
        <button type="button" class="tool" title="CSV" (click)="exportCsv()">CSV</button>
        <div class="columns-wrap" (click)="$event.stopPropagation()">
          <button type="button" class="tool" title="Столбцы" [attr.aria-expanded]="columnsOpen()" (click)="toggleColumns($event)">{{ toolLabel('Столбцы', 'Столб.') }}</button>
          @if (columnsOpen()) {
            <div class="columns-panel" role="dialog" aria-label="Столбцы реестра">
              @for (name of catalog(); track name) {
                <label>
                  <input type="checkbox" [checked]="columns().includes(name)" (change)="toggleColumn(name)" />
                  <span>{{ label(name) }}</span>
                </label>
              }
            </div>
          }
        </div>
        <app-registry-views
          [mode]="view() === 'grouped' ? 'list' : view()"
          [map]="true"
          (modeChange)="showRegistry($event)" />
      </div>

      @if (scenarioOpen()) {
        <div class="measure">
          <p class="hint">Сценарий выбирается из справочника. Дальше мера стартует сама или ждёт кнопку — как настроено у обслуживающей организации.</p>
          <div class="filters">
            <mat-form-field>
              <mat-label>Сценарий</mat-label>
              <mat-select [formControl]="scenarioId">
                @for (item of scenarioChoices(); track item.id) { <mat-option [value]="item.id">{{ item.name }}</mat-option> }
              </mat-select>
            </mat-form-field>
            <button mat-flat-button color="primary" (click)="changeScenario()">Изменить сценарий</button>
          </div>
        </div>
      }
      @if (legalOpen()) {
        <div class="measure">
          <p class="hint">Специалист ЮС становится закреплённым и исполнителем меры взыскания. В реестре показывается фамилия, имя и отчество целиком.</p>
          <div class="filters">
            <mat-form-field>
              <mat-label>Специалист ЮС</mat-label>
              <mat-select [formControl]="legalId">
                @for (item of legalUsers(); track item.id) { <mat-option [value]="item.id">{{ item.registry_name || item.username }}</mat-option> }
              </mat-select>
            </mat-form-field>
            <button mat-flat-button color="primary" (click)="assignLegal()">Передать</button>
          </div>
        </div>
      }
      @if (extraOpen()) {
        <div class="measure">
          <p class="hint">Дополнительное мероприятие по {{ selectedCount() }} выбранным лицевым счетам.</p>
          <div class="filters">
            <mat-form-field>
              <mat-label>Мероприятие</mat-label>
              <mat-select [formControl]="extraId">
                @for (item of extraOptions(); track item.id) { <mat-option [value]="item.id">{{ item.name }}</mat-option> }
              </mat-select>
            </mat-form-field>
            <button mat-flat-button color="primary" type="button" (click)="addMassExtra()">Добавить</button>
          </div>
        </div>
      }
      @if (measureOpen()) {
        <div class="measure">
          <p class="hint">
            @if (selectedCount()) {
              Мероприятие назначается по {{ selectedCount() }} выбранным лицевым счетам.
            } @else {
              Мероприятие назначается по всем лицевым счетам текущего фильтра.
            }
            Запуск — кнопкой «Провести» в реестре мероприятий. Мероприятие сценария идёт само.
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
                    <mat-option [value]="item.id">{{ templateLabel(item) }}</mat-option>
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
            @if (measureKind.value === 'call') {
              <p class="hint">В справочнике тексты заведены с каналом e-mail. Для обзвона берётся текст, письмо не отправляется.</p>
            }
            @if (measureKind.value === 'notice' && !templateOptions().length) {
              <p class="hint">Для канала «{{ channel.value === 'sms' ? 'SMS' : 'E-mail' }}» шаблонов нет. Загруженные тексты заведены как e-mail.</p>
            }
            <button mat-flat-button color="primary" (click)="launch()">Назначить</button>
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
          <div class="list-pane fill">
          <table mat-table appGridResize="accounts" [dataSource]="rows()" matSort (matSortChange)="sortBy($event)">
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
                    draggable="true" (dragstart)="startColumn($event, name)" (dragover)="allowColumn($event)" (drop)="dropColumn($event, name)"
                    [attr.title]="label(name)">
                  <span class="col-head" [style.width.ch]="columnCh(name)">{{ shortLabel(name) }}@if (moneyColumn(name)) { <app-byn-sign /> }</span>
                </th>
                <td mat-cell *matCellDef="let r" [class.amount-danger]="name === 'mulct_total' && +r.mulct_total > 0" [class.one-line]="name === 'scenario_brief'"
                    [attr.title]="name === 'provider_short_name' ? cell(r, name) : null">
                  @switch (name) {
                    @case ('effective_group') { @if (r.effective_group) { <span class="group-badge g{{ r.effective_group }}">{{ r.effective_group }}</span> } }
                    @case ('rating_label') { @if (r.rating_label) { <span class="rating-badge r{{ r.rating_label[0] }}">{{ r.rating_label }}</span> } }
                    @case ('client_account') { <b class="account-no">{{ r.client_account }}</b> }
                    @case ('short_fio') { {{ r.short_fio }}@if (r.is_legal) { <span class="legal">ЮЛ</span> } }
                    @case ('funnel_stage') { {{ stageLabel(r.funnel_stage) }} }
                    @case ('scenario_brief') { {{ short(r.scenario_brief) }} }
                    @case ('debt_total') { <app-money [value]="r.debt_total" [blank]="false" [sign]="false" /> }
                    @case ('mulct_total') { <app-money [value]="r.mulct_total" [blank]="false" [sign]="false" /> }
                    @case ('obligation_total') { <app-money [value]="r.obligation_total" [blank]="false" [sign]="false" /> }
                    @default { {{ boardCell(r, name) }} }
                  }
                </td>
              </ng-container>
            }
            <tr mat-header-row *matHeaderRowDef="shownColumns()"></tr>
            <tr mat-row *matRowDef="let row; columns: shownColumns()" class="clickable-row" [class.picked]="isSelected(row.id)"
                [attr.data-account]="row.id" (pointerdown)="beginSelect($event, row)" (click)="openRow($event, row)"></tr>
          </table>
          </div>
          <mat-paginator [length]="total()" [pageSize]="pageSize" [pageSizeOptions]="[25, 50, 100]" (page)="pageChanged($event)" />
        }

        @if (view() === 'grouped') {
          <div class="list-pane fill groups">
          @if (sectionsLoading()) {
            <p class="hint">Загрузка групп…</p>
          } @else if (!sections().length && !error()) {
            <p class="hint">По этому отбору лицевых счетов нет.</p>
          }
          @if (sections().length) {
            <table class="grouped-board" appGridResize="accounts">
              <thead>
                <tr>
                  @for (name of shownColumns(); track name) {
                    <th [attr.data-col]="name" [attr.title]="name === 'select' ? '' : label(name)">@if (name !== 'select') { <span class="col-head" [style.width.ch]="columnCh(name)">{{ shortLabel(name) }}@if (moneyColumn(name)) { <app-byn-sign /> }</span> }</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (section of sections(); track section.value) {
                  <tr [class]="'group-band g' + (section.value || '0')">
                    <td [attr.colspan]="shownColumns().length">
                      <button type="button" class="band" (click)="toggleSection(section.value)">
                        <span class="chev">{{ section.open ? '▾' : '▸' }}</span>
                        <span class="title">{{ sectionTitle(section.value) }}</span>
                        <span class="count">{{ section.accounts }} ЛС</span>
                        <b class="sum"><app-money [value]="sectionObligation(section)" [blank]="false" /></b>
                      </button>
                    </td>
                  </tr>
                  @if (section.open) {
                    @for (r of section.rows; track r.id) {
                      <tr class="clickable-row" [class.picked]="isSelected(r.id)" (click)="openRow($event, r)">
                        @for (name of shownColumns(); track name) {
                          <td [class.check]="name === 'select'" [class.amount-danger]="penaltyMarked(name, r)" [class.one-line]="name === 'scenario_brief'"
                              [attr.title]="name === 'provider_short_name' ? cell(r, name) : null">
                            @switch (name) {
                              @case ('select') {
                                <input type="checkbox" [attr.aria-label]="'Выбрать ЛС ' + r.client_account" [checked]="isSelected(r.id)" (click)="$event.stopPropagation()" (change)="toggleRow(r, $event)" />
                              }
                              @case ('effective_group') { @if (r.effective_group) { <span class="group-badge g{{ r.effective_group }}">{{ r.effective_group }}</span> } }
                              @case ('rating_label') { @if (r.rating_label) { <span class="rating-badge r{{ r.rating_label[0] }}">{{ r.rating_label }}</span> } }
                              @case ('client_account') { <b class="account-no">{{ r.client_account }}</b> }
                              @case ('short_fio') { {{ r.short_fio }}@if (r.is_legal) { <span class="legal">ЮЛ</span> } }
                              @case ('funnel_stage') { {{ stageLabel(r.funnel_stage) }} }
                              @case ('scenario_brief') { {{ short(r.scenario_brief) }} }
                              @case ('debt_total') { <app-money [value]="r.debt_total" [blank]="false" [sign]="false" /> }
                              @case ('mulct_total') { <app-money [value]="r.mulct_total" [blank]="false" [sign]="false" /> }
                              @case ('obligation_total') { <app-money [value]="r.obligation_total" [blank]="false" [sign]="false" /> }
                              @default { {{ boardCell(r, name) }} }
                            }
                          </td>
                        }
                      </tr>
                    }
                    @if (section.loading) {
                      <tr class="more"><td [attr.colspan]="shownColumns().length">Загрузка…</td></tr>
                    } @else if (section.rows.length < section.rowTotal) {
                      <tr class="more">
                        <td [attr.colspan]="shownColumns().length">
                          <button type="button" (click)="moreSection(section)">Показать ещё {{ section.rowTotal - section.rows.length }}</button>
                        </td>
                      </tr>
                    }
                  }
                }
                <tr class="group-foot">
                  <td [attr.colspan]="shownColumns().length">
                    <div class="foot">Итого {{ groupedTotals().accounts }} ЛС · услуг с задолженностью {{ groupedTotals().services }}
                    · основной долг <app-money [value]="groupedTotals().debt" [blank]="false" />
                    · пеня <app-money [value]="groupedTotals().penalty" [blank]="false" />
                    · задолженность <app-money [value]="groupedTotals().obligation" [blank]="false" />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          }
          </div>
        }

        @if (view() === 'kanban') {
          <div class="k-board">
            @for (column of board(); track column.stage) {
              <section class="k-col" [attr.data-kanban-stage]="column.stage" [attr.data-stage]="column.stage">
                <h3><span [attr.title]="column.title">{{ column.title }}</span><b>{{ column.total }}</b></h3>
                <div class="k-cards">
                @for (card of column.cards; track card.id) {
                  <article class="k-card g{{ card.effective_group ?? 0 }}" [class.picked]="isSelected(card.id)"
                           [appKanbanDrag]="card.id" [dragDisabled]="!canMove()" (kanbanDrop)="onKanbanDrop($event)"
                           (click)="openCard($event, card)">
                    <app-kanban-debtor
                      [name]="card.client_account"
                      [rating]="card.rating_label"
                      [group]="card.effective_group"
                      [account]="''"
                      [address]="card.account_address || ''"
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
                      [specialist]="card.assigned_name" />
                    @if (card.open_badges?.length) {
                      <div class="measure-badges">
                        @for (badge of card.open_badges; track badge.measure_id) {
                          <button type="button" class="measure-badge" (click)="openBadge($event, card, badge.measure_id)">{{ badge.label }}</button>
                        }
                      </div>
                    }
                  </article>
                }
                </div>
              </section>
            }
          </div>
        }

        @if (view() === 'calendar') {
          @if (canLaunch()) {
            <div class="filters">
              <input placeholder="дд.мм.гггг" [formControl]="noteDay" />
              <input placeholder="Заметка специалиста" [formControl]="noteText" />
              <button type="button" class="tool" (click)="saveNote()">Заметка</button>
            </div>
          }
          <app-calendar-board
            [events]="events()" [from]="spanFrom" [to]="spanTo" [mode]="calendarMode" [canCreate]="canLaunch()"
            [supplier]="supplierContour()" [templates]="templates()" [serviceChoices]="serviceChoices()"
            captionTail="мероприятия по делам" [selectedGroups]="groupsSelected.value"
            (modeChange)="calendarMode = $event" (spanChange)="setSpan($event)" (openEvent)="openCalendarEvent($event)"
            (createEvent)="submitCalendar($event)" (filters)="openFilters()"
            (groupsChange)="applyCalendarGroups($event)" />
        }
      </div>

      @if (customOpen()) {
        <app-domain-filter
          [fields]="accountFields"
          [domain]="domain()"
          (apply)="applyDomain($event)"
          (cancel)="customOpen.set(false)" />
      }

      <app-funnel-gate-dialog [gate]="gate()" (go)="openGate()" (closed)="gate.set(null)" />

    </div>
  `,
  styles: `
    :host { display: block; }
    :host.board {
      display: flex; flex-direction: column; flex: 1 1 auto; height: 100%; max-height: 100%;
      min-height: 0; min-width: 0; overflow: hidden;
    }
    .registry.board { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; box-sizing: border-box; }
    .registry.board > :not(.body) { flex: 0 0 auto; }
    .registry.board .body {
      display: flex; flex-direction: column; flex: 1; min-height: 0;
      overflow-x: auto; overflow-y: scroll; overscroll-behavior: none; box-sizing: border-box;
      scrollbar-color: #8b98a5 #e7edf2;
    }
    .registry.board .body::-webkit-scrollbar { width: 14px; height: 14px; }
    .registry.board .body::-webkit-scrollbar-track { background: #e7edf2; }
    .registry.board .body::-webkit-scrollbar-thumb { background: #8b98a5; border-radius: 7px; border: 3px solid #e7edf2; }
    .registry.board .k-board {
      flex: 1 0 auto; align-items: stretch; min-height: 100%; min-width: 100%; width: max-content;
      overflow: visible;
    }
    .registry.board .k-cards { padding-top: 8px; }
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
    .control.tools-tight { gap: 6px; }
    .control.tools-tight .tool { padding: 0 6px; font-size: 12px; }
    .search-panel {
      position: absolute; z-index: 30; top: calc(100% + 4px); left: 0;
      display: grid; grid-template-columns: minmax(260px, 1.15fr) minmax(220px, 1fr) minmax(200px, .9fr);
      width: min(960px, calc(100vw - 248px));
      background: #fff; border: 1px solid var(--erip-border); border-radius: 6px;
      box-shadow: 0 8px 24px rgba(16, 42, 67, .16);
    }
    .col { padding: 8px 0 12px; min-width: 0; }
    .col + .col { border-left: 1px solid var(--erip-border); }
    .col-title {
      padding: 6px 16px 8px; font-size: 11px; font-weight: 700; letter-spacing: .04em;
      text-transform: uppercase; color: var(--erip-muted); white-space: nowrap;
    }
    .sub { padding: 4px 16px; font-size: 12px; color: var(--erip-muted); white-space: nowrap; }
    .pills { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 8px; }
    .pill, .menu-item, .menu-add, .save-row button, .tool, .view-btn { font: inherit; cursor: pointer; }
    .pill {
      min-width: 28px; height: 28px; padding: 0 8px; border: 1px solid var(--erip-border); border-radius: 4px;
      background: #fff; color: #1f2933;
    }
    .pill.on, .menu-item.on { background: var(--erip-primary-soft); color: var(--erip-primary); font-weight: 600; border-color: transparent; }
    .menu-item, .menu-add {
      display: block; width: 100%; text-align: left; border: 0; background: transparent;
      padding: 6px 16px; font-size: 13px; color: #1f2933; white-space: nowrap;
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
    .columns-wrap { position: relative; }
    .columns-panel {
      position: absolute; z-index: 40; top: calc(100% + 4px); right: 0; width: 320px; max-height: 360px;
      overflow: auto; background: #fff; border: 1px solid var(--erip-border); border-radius: 6px;
      box-shadow: 0 8px 24px rgba(16, 42, 67, .16); padding: 6px 0;
    }
    .columns-panel label {
      display: flex; gap: 8px; align-items: flex-start; padding: 6px 12px; font-size: 13px; cursor: pointer;
    }
    .columns-panel label:hover { background: #f3f6f8; }
    .views { display: flex; gap: 4px; }
    .view-btn { width: 32px; font-size: 14px; }
    .view-btn.on, .charts-box.on { background: var(--erip-primary); color: #fff; border-color: var(--erip-primary); }
    .charts-box { margin-left: 10px; }
    .measure { padding: 10px 16px 0; background: #fff; border-bottom: 1px solid var(--erip-border); }
    .hint { margin: 0 0 8px; font-size: 13px; color: var(--erip-muted); }
    .body { padding: 16px 24px; }
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
    .measure-badges { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 8px; }
    .measure-badge {
      border: 0; background: #e7f2f4; color: var(--erip-primary); border-radius: 10px;
      font: inherit; font-size: 11px; line-height: 1.3; padding: 2px 8px; cursor: pointer; text-align: left;
    }
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
    .k-col[data-stage="new"] h3 { border-bottom-color: #1f9d55; }
    .k-col[data-stage="call"] h3 { border-bottom-color: #2563eb; }
    .k-col[data-stage="notice"] h3 { border-bottom-color: #0f766e; }
    .k-col[data-stage="disconnect"] h3 { border-bottom-color: #f08c2e; }
    .k-col[data-stage="prep"] h3 { border-bottom-color: #7c3aed; }
    .k-col[data-stage="notary"] h3 { border-bottom-color: #e53935; }
    .k-col[data-stage="writ_done"] h3 { border-bottom-color: #b45309; }
    .k-col[data-stage="refused"] h3 { border-bottom-color: #9f1239; }
    .k-col[data-stage="lawsuit"] h3 { border-bottom-color: #1d4ed8; }
    .k-col[data-stage="judgment"] h3 { border-bottom-color: #1e3a8a; }
    .k-col[data-stage="opi"] h3 { border-bottom-color: #8e2430; }
    .k-col[data-stage="opi_measures"] h3 { border-bottom-color: #7f1d1d; }
    .k-col[data-stage="recovered"] h3 { border-bottom-color: #15803d; }
    .k-col[data-stage="impossible"] h3 { border-bottom-color: #6b7280; }
    .k-col[data-stage="writeoff"] h3 { border-bottom-color: #9ca3af; }
    .k-card {
      position: relative; background: #fff; border: 1px solid #e6ebf0; border-left: 3px solid #cbd5e1;
      border-radius: 8px; padding: 10px 12px 4px; margin-bottom: 8px; cursor: pointer;
      box-shadow: 0 1px 2px rgba(16, 42, 67, .06);
    }
    .k-card:hover { box-shadow: 0 2px 8px rgba(16, 42, 67, .12); }
    .k-card.picked, tr.picked { background: #e7f4f1; }
    .k-col.drop { outline: 2px dashed var(--erip-primary); outline-offset: 2px; border-radius: 8px; }
    .picked-count { font-size: 13px; color: var(--erip-primary); white-space: nowrap; }
    th[draggable="true"] { cursor: grab; }
    .col-head {
      display: inline-block; white-space: pre-line; line-height: 1.15; vertical-align: bottom;
      font-size: 12px; font-weight: 600;
    }
    .list-pane.fill .mat-mdc-header-cell { white-space: normal; vertical-align: bottom; }
    :host ::ng-deep .list-pane.fill .mat-sort-header-content { white-space: normal; text-align: left; overflow: visible; }
    .list-pane.fill td.mat-mdc-cell, .grouped-board td { white-space: nowrap; }
    th app-byn-sign { margin-left: 0.28em; }
    .k-card.g1 { border-left-color: #1f9d55; } .k-card.g2 { border-left-color: #c8962e; }
    .k-card.g3 { border-left-color: #ef6c00; } .k-card.g4 { border-left-color: #e53935; }
    .k-card.g5 { border-left-color: #c62828; } .k-card.g6 { border-left-color: #7f1d1d; }
    .k-card .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .k-card .name { font-weight: 700; font-size: 14px; line-height: 1.25; flex: 1; min-width: 0; color: #1f2933; }
    .k-card .card-head .card-marks { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
    .k-card .stage-btn {
      position: absolute; top: 8px; right: 8px; border: 1px solid #d8dce0; background: #fff;
      color: var(--erip-primary); border-radius: 4px; font-size: 11px; line-height: 1.2;
      padding: 3px 6px; cursor: pointer;
    }
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
    .one-line { white-space: nowrap; }
    .k-card .line.one-line { overflow: hidden; text-overflow: ellipsis; }
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
    .account-no { color: var(--erip-link); }
    .backdrop {
      position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center;
      background: rgba(20, 40, 55, .35);
    }
    .dialog { width: min(520px, calc(100vw - 32px)); background: #fff; border-radius: 8px; padding: 20px; box-shadow: 0 12px 32px rgba(16, 42, 67, .2); }
    .dialog h3 { margin: 0 0 8px; color: var(--erip-primary-dark); }
    .dialog-actions { display: flex; gap: 8px; margin-top: 8px; }
    .reason-field { width: 100%; }
    .legal {
      margin-left: 6px; padding: 1px 6px; border-radius: 8px; background: #e7f2f4; color: var(--erip-primary);
      font-size: 11px; font-weight: 700;
    }
  `,
})
export class AccountsListComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly auth = inject(AuthService);

  protected readonly groups = [0, 1, 2, 3, 4, 5, 6];
  protected readonly letters = ['A', 'B', 'C', 'D', 'E'];
  protected readonly stages = FUNNEL_STAGES.map((stage) => ({ id: stage.id, label: stage.title }));
  protected readonly groupOptions = [
    { id: 'provider', label: 'Обслуживающая организация' },
    { id: 'debt_group', label: 'Группа задолженности' },
    { id: 'rating', label: 'Рейтинг должника' },
    { id: 'category', label: 'Категория должника' },
    { id: 'specialist', label: 'Закреплённый специалист' },
    { id: 'ownership', label: 'Тип собственности' },
    { id: 'housing', label: 'Тип объекта жилфонда' },
    { id: 'months', label: 'Кол-во месяцев долга' },
    { id: 'residents', label: 'Кол-во проживающих' },
    { id: 'period', label: 'Период возникновения долга' },
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
  protected readonly gate = signal<FunnelGateInfo | null>(null);
  protected readonly view = signal<'list' | 'kanban' | 'calendar' | 'grouped' | 'map' | 'charts'>('kanban');
  protected readonly panelOpen = signal(false);
  protected readonly customOpen = signal(false);
  protected readonly accountFields = accountDomainFields();
  protected readonly domain = signal<DomainRule | null>(null);
  protected readonly measureOpen = signal(false);
  protected readonly extraOpen = signal(false);
  protected readonly extraId = new FormControl<number | null>(null);
  protected readonly extraOptions = signal<{ id: number; name: string }[]>([]);
  protected readonly scenarioOpen = signal(false);
  protected readonly legalOpen = signal(false);
  protected readonly scenarioChoices = signal<{ id: number; name: string }[]>([]);
  protected readonly legalUsers = signal<DirectoryUser[]>([]);
  protected readonly scenarioId = new FormControl<number | null>(null);
  protected readonly legalId = new FormControl<number | null>(null);
  protected readonly noteDay = new FormControl('', { nonNullable: true });
  protected readonly noteText = new FormControl('', { nonNullable: true });
  protected readonly mapQuery = signal<Record<string, string | number | null>>({});
  protected readonly territoryId = signal<number | null>(null);
  protected readonly territoryName = signal('');
  protected readonly columns = signal<string[]>([...BASE_COLUMNS]);
  protected readonly columnOrder = signal<string[]>([...BASE_COLUMNS]);
  protected readonly catalog = signal<string[]>([...BASE_COLUMNS]);
  protected readonly columnsOpen = signal(false);
  protected readonly board = signal<KanbanColumn[]>([]);
  protected readonly stageMenu = signal<number | null>(null);
  protected readonly events = signal<CalendarEvent[]>([]);
  protected readonly filters = signal<SavedFilter[]>([]);
  protected readonly specialists = signal<{ name: string }[]>([]);
  protected readonly templates = signal<MessageTemplate[]>([]);
  protected readonly serviceChoices = signal<ServiceChoice[]>([]);
  protected readonly sections = signal<GroupSection[]>([]);
  protected readonly sectionsLoading = signal(false);
  private groupTicket = 0;
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
  protected readonly specialist = new FormControl('', { nonNullable: true });
  protected readonly ownership = new FormControl('', { nonNullable: true });
  protected readonly housing = new FormControl('', { nonNullable: true });
  protected readonly monthsDebt = new FormControl('', { nonNullable: true });
  protected readonly residents = new FormControl('', { nonNullable: true });
  protected readonly periodFrom = new FormControl('', { nonNullable: true });
  protected readonly periodTo = new FormControl('', { nonNullable: true });
  protected readonly funnelReason = new FormControl('', { nonNullable: true });
  protected readonly funnelStage = new FormControl('new', { nonNullable: true });
  protected readonly reasonOpen = signal(false);
  private pendingMove: { ids: number[]; stage: string } | null = null;
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
    this.columnsOpen.set(false);
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
    this.specialist.valueChanges.pipe(debounceTime(300)).subscribe(() => this.onFilter());
    this.ownership.valueChanges.pipe(debounceTime(300)).subscribe(() => this.onFilter());
    this.housing.valueChanges.pipe(debounceTime(300)).subscribe(() => this.onFilter());
    this.monthsDebt.valueChanges.pipe(debounceTime(300)).subscribe(() => this.onFilter());
    this.residents.valueChanges.pipe(debounceTime(300)).subscribe(() => this.onFilter());
    this.periodFrom.valueChanges.subscribe(() => this.onFilter());
    this.periodTo.valueChanges.subscribe(() => this.onFilter());
    this.groupBy.valueChanges.subscribe((value) => {
      if (value) this.showGrouped();
      else if (this.view() === 'grouped') this.reload(1);
    });
    this.customField.valueChanges.subscribe(() => this.customValue.setValue(''));
    this.api.columns().subscribe((prefs) => this.applyColumns(prefs));
    this.api.savedFilters('accounts').subscribe((page) => this.filters.set(page.results));
    this.api.specialists().subscribe({
      next: (rows) => this.specialists.set(rows),
      error: () => this.specialists.set([]),
    });
    this.api.templates({ is_active: true, page_size: 200 }).subscribe({
      next: (page) => this.templates.set(page.results),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
    this.api.scenarios().subscribe({
      next: (page) => this.scenarioChoices.set(page.results.map((row) => ({ id: row.id, name: row.name }))),
      error: () => this.scenarioChoices.set([]),
    });
    this.api.directoryUsers({ role: 'legal' }).subscribe({
      next: (page) => this.legalUsers.set(page.results),
      error: () => this.legalUsers.set([]),
    });
    this.api.serviceChoices().subscribe({
      next: (page) => this.serviceChoices.set(page.results),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
    this.channel.valueChanges.subscribe(() => this.keepTemplateInList());
    this.showKanban();
  }

  label(name: string): string {
    return LABELS[name] ?? name;
  }

  protected shortLabel(name: string): string {
    return SHORT_LABELS[name] ?? this.label(name);
  }

  protected columnCh(name: string): number {
    let longest = 0;
    const take = (row: AccountRow) => {
      longest = Math.max(longest, this.shownText(row, name).length);
    };
    for (const row of this.rows()) take(row);
    for (const section of this.sections()) {
      for (const row of section.rows) take(row);
    }
    const head = Math.max(...this.shortLabel(name).split('\n').map((line) => line.length), 4);
    return Math.max(longest, head, 4);
  }

  protected moneyColumn(name: string): boolean {
    return MONEY_COLUMNS.has(name);
  }

  stageLabel(id: string): string {
    return funnelTitle(id);
  }

  setSpecialist(name: string): void {
    this.specialist.setValue(this.specialist.value === name ? '' : name);
  }

  groupByLabel(id: string): string {
    return this.groupChoices().find((item) => item.id === id)?.label ?? this.groupOptions.find((item) => item.id === id)?.label ?? id;
  }

  protected groupChoices(): { id: string; label: string }[] {
    const items = this.groupOptions.filter((item) => item.id !== 'provider' || this.auth.showServiceOrg());
    if (!this.auth.showSchema()) return items;
    return [{ id: 'schema', label: 'Наименование схемы' }, ...items];
  }

  protected canLaunch(): boolean {
    return this.auth.canLaunchMeasure();
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

  protected short(text: string | null | undefined): string {
    return briefText(text || '');
  }

  protected scenarioLine(card: AccountRow): string {
    const text = this.short(card.scenario_brief);
    return text === '—' ? 'Сценарий не назначен' : text;
  }

  private shownText(row: AccountRow, name: string): string {
    if (name === 'funnel_stage') return this.stageLabel(row.funnel_stage);
    if (name === 'scenario_brief') return this.short(row.scenario_brief);
    if (name === 'short_fio') return `${row.short_fio || ''}${row.is_legal ? ' ЮЛ' : ''}`;
    if (name === 'effective_group') return row.effective_group ? String(row.effective_group) : '';
    if (name === 'rating_label') return row.rating_label || '';
    if (name === 'debt_total' || name === 'mulct_total' || name === 'obligation_total' || name === 'initial_principal' || name === 'initial_penalty') {
      const raw = name.startsWith('initial') ? this.boardCell(row, name) : String(row[name as keyof AccountRow] ?? '');
      return raw;
    }
    return this.boardCell(row, name);
  }

  boardCell(row: AccountRow, name: string): string {
    const lines = row.service_lines || [];
    const join = (pick: (line: NonNullable<AccountRow['service_lines']>[number]) => string) => {
      const text = lines.map(pick).filter(Boolean).join('; ');
      return briefText(text);
    };
    if (name === 'services_debt_count') return String(row.services_debt_count ?? 0);
    if (name === 'contract_number') return join((line) => line.service_name ? `${line.service_list_id} (${line.service_name})` : String(line.service_list_id));
    if (name === 'contract_date') return join((line) => line.start_date || '');
    if (name === 'service_provider') return join((line) => line.shot_name);
    if (name === 'initial_principal') return join((line) => line.initial_principal || '');
    if (name === 'initial_penalty') return join((line) => line.initial_penalty || '');
    if (name === 'repayment_due_on') return join((line) => line.repayment_due_on || '');
    if (name === 'last_payment_date') return join((line) => line.last_payment_date || '');
    if (name === 'period_balances') {
      return join((line) => (line.periods || []).map((period) =>
        `${line.service_name || line.service_list_id} ${period.period}: долг ${period.principal || 0}, пеня ${period.penalty || 0}`,
      ).join('; '));
    }
    const raw = this.cell(row, name);
    if (name === 'account_address' || name === 'provider_short_name') return raw;
    if (name === 'assigned_name') return raw;
    if (['ownership_type_name', 'acc_category_full', 'schema_label'].includes(name)) {
      return briefText(raw);
    }
    return raw;
  }

  protected toolsTight(): boolean {
    return this.panelOpen() || this.columnsOpen() || this.measureOpen() || this.extraOpen() || this.scenarioOpen() || this.legalOpen();
  }

  protected toolLabel(full: string, short: string): string {
    return this.toolsTight() ? short : full;
  }

  protected openFilters(): void {
    if (this.panelOpen()) return;
    this.panelOpen.set(true);
    this.markFilterOpen();
  }

  togglePanel(event: Event): void {
    event.stopPropagation();
    const opening = !this.panelOpen();
    this.panelOpen.update((open) => !open);
    if (opening) this.markFilterOpen();
  }

  private markFilterOpen(): void {
    const started = performance.now();
    requestAnimationFrame(() => {
      agentDbg('C', 'accounts-list.component.ts:openFilters', 'filter panel frame', {
        ms: Math.round(performance.now() - started),
        rows: this.rows().length,
        specialists: this.specialists().length,
      });
    });
  }

  applyCalendarGroups(groups: number[]): void {
    this.groupsSelected.setValue(groups);
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

  protected applyDomain(rule: DomainRule | null): void {
    this.domain.set(rule);
    this.customOpen.set(false);
    this.onFilter();
  }

  protected clearDomain(event: Event): void {
    event.stopPropagation();
    this.domain.set(null);
    this.onFilter();
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
    if (this.customField.value === 'specialist') this.specialist.setValue(value);
    if (this.customField.value === 'ownership') this.ownership.setValue(value);
    if (this.customField.value === 'housing') this.housing.setValue(value);
    if (this.customField.value === 'months') this.monthsDebt.setValue(value);
    if (this.customField.value === 'residents') this.residents.setValue(value);
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
      next: (measure) => this.afterCallLaunch(measure, () => this.loadCalendar()),
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
    return this.auth.canSkip() && !!me && me.contour !== 'supplier';
  }

  protected shownColumns(): string[] {
    return ['select', ...this.columns()];
  }

  protected selectedCount(): number {
    return this.selected().size;
  }

  protected openExtra(): void {
    this.extraOpen.update((open) => !open);
    if (!this.extraOpen() || this.extraOptions().length) return;
    this.api.extraMeasureCatalog().subscribe({
      next: (page) => {
        this.extraOptions.set(page.results);
        this.extraId.setValue(page.results[0]?.id ?? null);
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  protected addMassExtra(): void {
    const catalogId = this.extraId.value;
    if (catalogId == null || !this.selected().size) return;
    this.api.addExtraMeasures({ catalog_id: catalogId, account_ids: [...this.selected()] }).subscribe({
      next: () => {
        this.extraOpen.set(false);
        this.snack.open('Дополнительное мероприятие добавлено', 'OK');
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
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

  protected toggleColumns(event: Event): void {
    event.stopPropagation();
    this.panelOpen.set(false);
    this.columnsOpen.update((open) => !open);
  }

  protected toggleColumn(name: string): void {
    const current = { order: this.columnOrder(), visible: this.columns() };
    const next = current.visible.includes(name)
      ? hideColumn(current, name)
      : showColumn(current, this.catalog(), name);
    if (next === current || !next.visible.length) return;
    this.rememberColumns(next.visible, next.order);
  }

  protected startColumn(event: DragEvent, name: string): void {
    if (event.target instanceof Element && event.target.closest('.col-resize')) {
      event.preventDefault();
      return;
    }
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
    const next = moveColumn({ order: this.columnOrder(), visible: this.columns() }, from, name);
    if (next.visible === this.columns()) return;
    this.rememberColumns(next.visible, next.order);
  }

  private applyColumns(prefs: ColumnPrefs): void {
    const allowed = prefs.available.length ? prefs.available : [...BASE_COLUMNS];
    const names = prefs.columns.filter((name) => allowed.includes(name));
    this.catalog.set(allowed);
    const order = resolveColumnOrder(prefs.order ?? [], names, allowed);
    this.columnOrder.set(order);
    const shown = new Set(names);
    const visible = order.filter((name) => shown.has(name));
    if (visible.length) this.columns.set(visible);
  }

  private rememberColumns(visible: string[], order: string[]): void {
    this.columnOrder.set(order);
    this.columns.set(visible);
    this.api.saveColumns(visible, order).subscribe({ error: (e) => this.snack.open(errorMessage(e), 'OK') });
  }

  protected onKanbanDrop(event: { id: string; stage: string }): void {
    const id = Number(event.id);
    if (!id || !this.canMove()) return;
    const card = this.board().flatMap((column) => column.cards).find((item) => item.id === id);
    if (card && funnelId(card.funnel_stage) === event.stage) return;
    const ids = this.selected().has(id) ? [...this.selected()] : [id];
    this.moveIds(ids, event.stage);
  }

  protected openGate(): void {
    const blocked = this.gate();
    this.gate.set(null);
    const id = blocked?.accountId;
    if (!id) return;
    this.router.navigate(['/accounts', id], { queryParams: { tab: blocked.tab || 'activities' } });
  }

  protected openBadge(event: Event, card: AccountRow, measureId: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.router.navigate(['/accounts', card.id], { queryParams: { tab: 'activities', measure: measureId } });
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
    this.stageMenu.set(null);
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
        error: (e) => {
          this.showKanban();
          const blocked = funnelGate(e);
          if (blocked) {
            this.gate.set(blocked.accountId ? blocked : { ...blocked, accountId: id });
            return;
          }
          this.snack.open(errorMessage(e), 'OK');
        },
      });
    };
    step();
  }

  protected openStage(event: Event, card: AccountRow): void {
    event.stopPropagation();
    const ids = this.selected().has(card.id) ? [...this.selected()] : [card.id];
    this.moveIds(ids, card.funnel_stage || 'new');
  }

  protected confirmMove(): void {
    const pending = this.pendingMove;
    const reason = this.funnelReason.value.trim();
    const stage = this.funnelStage.value;
    if (!pending || !reason) {
      this.snack.open('Укажите основание смены этапа воронки взыскания', 'OK');
      return;
    }
    this.reasonOpen.set(false);
    const ids = [...pending.ids];
    const step = (): void => {
      const id = ids.shift();
      if (id == null) {
        this.selected.set(new Set());
        this.pendingMove = null;
        this.showKanban();
        return;
      }
      this.api.updateAccount(id, { funnel_stage: stage, funnel_reason: reason }).subscribe({
        next: () => step(),
        error: (e) => {
          const blocked = funnelGate(e);
          if (blocked) {
            this.gate.set(blocked.accountId ? blocked : { ...blocked, accountId: id });
            return;
          }
          this.snack.open(errorMessage(e), 'OK');
        },
      });
    };
    step();
  }

  protected clearText(control: FormControl<string>, event: Event): void {
    event.stopPropagation();
    control.setValue('');
  }

  protected clearPeriod(event: Event): void {
    event.stopPropagation();
    this.periodFrom.setValue('');
    this.periodTo.setValue('');
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
    this.specialist.setValue(String(item.query['assigned_name'] ?? ''), { emitEvent: false });
    this.ownership.setValue(String(item.query['ownership'] ?? ''), { emitEvent: false });
    this.housing.setValue(String(item.query['housing'] ?? ''), { emitEvent: false });
    this.monthsDebt.setValue(String(item.query['months_debt'] ?? ''), { emitEvent: false });
    this.residents.setValue(String(item.query['subj_count'] ?? ''), { emitEvent: false });
    this.periodFrom.setValue(String(item.query['period_from'] ?? ''), { emitEvent: false });
    this.periodTo.setValue(String(item.query['period_to'] ?? ''), { emitEvent: false });
    this.groupBy.setValue(String(item.query['group_by'] ?? ''), { emitEvent: false });
    this.domain.set(parseDomain(item.query['domain']));
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
    return all.filter((item) => item.channel === this.channel.value);
  }

  templateLabel(item: MessageTemplate): string {
    return this.measureKind.value === 'notice' ? `${item.name} (${item.channel_display})` : item.name;
  }

  protected saveNote(): void {
    const text = this.noteText.value.trim();
    const raw = this.noteDay.value.trim();
    const match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!text || !match) {
      this.snack.open('Укажите дату дд.мм.гггг и текст заметки', 'OK');
      return;
    }
    this.api.saveCalendarNote(`${match[3]}-${match[2]}-${match[1]}`, text).subscribe({
      next: () => {
        this.noteText.setValue('');
        this.loadCalendar();
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected runScenarios(): void {
    const chosen = [...this.selected()];
    const body: Record<string, unknown> = chosen.length ? { account_ids: chosen } : { all_matching: true, filters: this.query() };
    this.api.startScenarios(body).subscribe({
      next: (result) => this.snack.open(`Сценарий запущен по ${result.started} счетам`, 'OK', { duration: 4000 }),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected changeScenario(): void {
    if (this.scenarioId.value == null) {
      this.snack.open('Выберите сценарий', 'OK');
      return;
    }
    const chosen = [...this.selected()];
    const body: Record<string, unknown> = {
      scenario_id: this.scenarioId.value,
      ...(chosen.length ? { account_ids: chosen } : { all_matching: true, filters: this.query() }),
    };
    this.api.changeScenarios(body).subscribe({
      next: (result) => this.snack.open(`Сценарий изменён у ${result.changed} счетов`, 'OK', { duration: 4000 }),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected assignLegal(): void {
    if (this.legalId.value == null) {
      this.snack.open('Выберите специалиста ЮС', 'OK');
      return;
    }
    const chosen = [...this.selected()];
    const body: Record<string, unknown> = {
      user_id: this.legalId.value,
      ...(chosen.length ? { account_ids: chosen } : { all_matching: true, filters: this.query() }),
    };
    this.api.assignLegal(body).subscribe({
      next: (result) => {
        this.snack.open(`Передано счетов: ${result.assigned}`, 'OK', { duration: 4000 });
        this.reload(1);
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
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
      next: (measure) => this.afterCallLaunch(measure),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  private afterCallLaunch(measure: MeasureRow, done?: () => void): void {
    this.snack.open('Мероприятие назначено. Запуск — кнопкой «Провести» в реестре мероприятий.', 'OK', { duration: 5000 });
    done?.();
    if (!done) this.router.navigate(['/measures', measure.id]);
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

  protected penaltyMarked(name: string, row: AccountRow): boolean {
    return name === 'mulct_total' && Number(row.mulct_total) > 0;
  }

  protected sectionTitle(value: string): string {
    return groupSectionTitle(this.groupBy.value, value, this.groupByLabel(this.groupBy.value));
  }

  protected sectionObligation(section: GroupSection): number {
    return Number(section.debt ?? 0) + Number(section.penalty ?? 0);
  }

  protected groupedTotals(): { accounts: number; services: number; debt: string; penalty: string; obligation: string } {
    const rows = this.sections();
    const debt = rows.reduce((sum, row) => sum + Number(row.debt || 0), 0);
    const penalty = rows.reduce((sum, row) => sum + Number(row.penalty || 0), 0);
    return {
      accounts: rows.reduce((sum, row) => sum + row.accounts, 0),
      services: rows.reduce((sum, row) => sum + row.services, 0),
      debt: debt.toFixed(2),
      penalty: penalty.toFixed(2),
      obligation: (debt + penalty).toFixed(2),
    };
  }

  protected toggleSection(value: string): void {
    this.sections.update((list) => list.map((item) => item.value === value ? { ...item, open: !item.open } : item));
  }

  protected moreSection(section: GroupSection): void {
    if (section.loading || section.rows.length >= section.rowTotal) return;
    const ticket = this.groupTicket;
    this.sections.update((list) => list.map((item) => item.value === section.value ? { ...item, loading: true } : item));
    this.api.accounts({
      ...this.query(),
      bucket: bucketParam(section.value),
      page: section.page + 1,
      page_size: GROUP_PAGE,
    }).subscribe({
      next: (result) => {
        if (ticket !== this.groupTicket) return;
        this.sections.update((list) => list.map((item) => item.value === section.value ? {
          ...item,
          rows: [...item.rows, ...result.results],
          rowTotal: result.count,
          page: section.page + 1,
          loading: false,
        } : item));
      },
      error: (e) => {
        if (ticket !== this.groupTicket) return;
        this.sections.update((list) => list.map((item) => item.value === section.value ? { ...item, loading: false } : item));
        this.error.set(errorMessage(e));
      },
    });
  }

  private showGrouped(): void {
    this.view.set('grouped');
    this.sectionsLoading.set(true);
    const ticket = ++this.groupTicket;
    this.api.grouped(this.query()).subscribe({
      next: (rows) => {
        if (ticket !== this.groupTicket) return;
        if (!rows.length) {
          this.sections.set([]);
          this.sectionsLoading.set(false);
          this.error.set('');
          return;
        }
        forkJoin(rows.map((row) => this.api.accounts({
          ...this.query(),
          bucket: bucketParam(row.value),
          page: 1,
          page_size: GROUP_PAGE,
        }))).subscribe({
          next: (pages) => {
            if (ticket !== this.groupTicket) return;
            this.sections.set(rows.map((row, index) => ({
              value: row.value,
              accounts: row.accounts,
              services: row.services,
              debt: row.debt,
              penalty: row.penalty,
              rows: pages[index].results,
              rowTotal: pages[index].count,
              page: 1,
              open: true,
              loading: false,
            })));
            this.sectionsLoading.set(false);
            this.error.set('');
          },
          error: (e) => {
            if (ticket !== this.groupTicket) return;
            this.sectionsLoading.set(false);
            this.error.set(errorMessage(e));
          },
        });
      },
      error: (e) => {
        if (ticket !== this.groupTicket) return;
        this.sectionsLoading.set(false);
        this.error.set(errorMessage(e));
      },
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
      assigned_name: this.specialist.value,
      ownership: this.ownership.value,
      housing: this.housing.value,
      months_debt: this.monthsDebt.value || null,
      subj_count: this.residents.value || null,
      period_from: this.periodFrom.value,
      period_to: this.periodTo.value,
      group_by: this.groupBy.value,
      domain: this.domain() ? JSON.stringify(this.domain()) : null,
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
    const started = performance.now();
    this.api.accounts({ page, page_size: this.pageSize, ordering: this.ordering, ...this.query() }).subscribe({
      next: (result) => {
        agentDbg('D', 'accounts-list.component.ts:reload', 'accounts list', {
          ms: Math.round(performance.now() - started),
          page,
          pageSize: this.pageSize,
          count: result.count,
          rows: result.results.length,
        });
        this.rows.set(result.results);
        this.total.set(result.count);
        this.error.set('');
      },
      error: (e) => {
        agentDbg('D', 'accounts-list.component.ts:reload', 'accounts list failed', {
          ms: Math.round(performance.now() - started),
          page,
        });
        this.error.set(errorMessage(e));
      },
    });
  }
}

function agentDbg(hypothesisId: string, location: string, message: string, data: Record<string, unknown>): void {
  // #region agent log
  fetch('http://127.0.0.1:7711/ingest/f24f302c-2e56-43dc-abb2-a6fe7c5a2f70',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cb728a'},body:JSON.stringify({sessionId:'cb728a',runId:'pre-fix',hypothesisId,location,message,data,timestamp:Date.now()})}).catch(()=>{});
  // #endregion
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
