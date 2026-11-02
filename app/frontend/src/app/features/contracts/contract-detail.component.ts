import { DatePipe } from '@angular/common';
import { Component, OnInit, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { Router, RouterLink } from '@angular/router';

import { ApiService, errorMessage } from '../../core/api.service';
import { BynSignComponent, MoneyComponent } from '../../core/money.component';
import { AuthService } from '../../core/auth.service';
import { funnelTitle } from '../funnel-stages';
import { GridResizeDirective } from '../grid-resize.directive';
import { MeasureTasksComponent } from '../measures/measure-tasks.component';
import {
  AccountDetail,
  AccountService,
  ContactRow,
  ContractPeriod,
  DebtorCategory,
  HistoryRow,
  MeasureRow,
  MessageTemplate,
  Registration,
  ScenarioBoard,
  ScenarioMeasure,
  ScenarioStep,
  categoryGroups,
} from '../../core/models';

@Component({
  selector: 'app-contract-detail',
  standalone: true,
  imports: [
    DatePipe, FormsModule, RouterLink, MatCardModule, MatButtonModule, MatFormFieldModule, MoneyComponent, BynSignComponent,
    MatInputModule, MatSelectModule, MatCheckboxModule, MatSnackBarModule, MatTabsModule, GridResizeDirective,
    MeasureTasksComponent,
  ],
  template: `
    <div class="page">
      <div class="page-header">
        <a mat-button routerLink="/contracts">← Реестр договоров</a>
        <h2>Договор {{ contract()?.service_list_id }} · {{ contract()?.service_name }}</h2>
        @if (auth.canWrite() && account()) {
          <button mat-stroked-button type="button" (click)="refreshNow()">Обновить сейчас</button>
        }
      </div>
      @if (error()) { <p class="status-failed">{{ error() }}</p> }
      @if (contract(); as c) {
        <mat-tab-group>
          <mat-tab label="Общие">
            <div class="grid">
              <div>
                <mat-card><mat-card-content>
                  <h3>Лицевой счёт</h3>
                  <dl>
                    <dt>Номер ЛС</dt><dd><a [routerLink]="['/accounts', account()?.id]">{{ account()?.client_account }}</a></dd>
                    <dt>Адрес</dt><dd>{{ account()?.account_address || c.address }}</dd>
                    <dt>Обслуживающая организация</dt><dd>{{ account()?.provider_short_name || '—' }}</dd>
                    <dt>Период действия ЛС</dt><dd>{{ accountPeriod(account()) }}</dd>
                    <dt>Кол-во месяцев долга</dt><dd>{{ account()?.months_debt ?? '—' }}</dd>
                    <dt>Рейтинг</dt><dd>{{ account()?.rating_label || '—' }}</dd>
                    <dt>Группа</dt><dd>{{ account()?.effective_group ?? '—' }}</dd>
                    <dt>Тип собственности</dt><dd>{{ account()?.ownership_type_name || '—' }}</dd>
                    <dt>Тип объекта</dt><dd>{{ account()?.acc_category_full || account()?.acc_category_short || '—' }}</dd>
                    <dt>Категория жилфонда</dt><dd>{{ account()?.category_name || account()?.category_short_name || '—' }}</dd>
                    <dt>Площадь</dt><dd>{{ account()?.acc_total_space || '—' }}</dd>
                    <dt>Комнаты</dt><dd>{{ account()?.room_count ?? '—' }}</dd>
                    <dt>Телефон</dt><dd>{{ account()?.phone || '—' }}</dd>
                    <dt>Контактный телефон</dt><dd>{{ account()?.contact_phone || '—' }}</dd>
                    <dt>ЧУП</dt><dd>{{ account()?.is_private_enterprise ? 'да' : 'нет' }}</dd>
                  </dl>
                </mat-card-content></mat-card>
                @if (canEditGroup()) {
                  <div class="framed">
                    <h4>Ручная группа этого договора</h4>
                    <div class="filters">
                      <mat-form-field>
                        <mat-label>Группа</mat-label>
                        <mat-select [(ngModel)]="manualGroup">
                          <mat-option [value]="null">По расчёту</mat-option>
                          @for (g of [0, 1, 2, 3, 4, 5, 6]; track g) { <mat-option [value]="g">{{ g }}</mat-option> }
                        </mat-select>
                      </mat-form-field>
                      <mat-form-field class="reason"><mat-label>Причина</mat-label><input matInput [(ngModel)]="reason" /></mat-form-field>
                      <button mat-stroked-button (click)="saveGroup()">Сохранить</button>
                    </div>
                  </div>
                }
              </div>
              <div>
                <mat-card><mat-card-content>
                  <h3>Договор</h3>
                  <dl>
                    <dt>ID договора</dt><dd>{{ c.service_list_id }}</dd>
                    <dt>Номер договора</dt><dd>{{ c.agreement_number || '—' }}</dd>
                    <dt>Дата</dt><dd>{{ c.start_date | date: 'dd.MM.yyyy' }}</dd>
                    <dt>Услуга</dt><dd>{{ c.service_name }}</dd>
                    @if (auth.showSupplier()) {
                      <dt>Наименование поставщика</dt><dd>{{ c.full_name || c.shot_name }}</dd>
                    }
                    <dt>Сумма основного долга <app-byn-sign /></dt><dd><app-money [value]="c.initial_principal" [blank]="false" /></dd>
                    <dt>Сумма пени <app-byn-sign /></dt><dd><app-money [value]="c.initial_penalty" [blank]="false" /></dd>
                    <dt>Исходящее сальдо <app-byn-sign /></dt><dd><b><app-money [value]="c.balance_out" [blank]="false" /></b></dd>
                    <dt>Исходящее сальдо пени <app-byn-sign /></dt><dd><app-money [value]="c.balance_mulct_out" [blank]="false" /></dd>
                    <dt>Дата возникновения долга</dt><dd>{{ c.debt_started_on | date: 'dd.MM.yyyy' }}</dd>
                    <dt title="Оплата за предыдущий месяц вносится до этого числа. День не привязан к году и месяцу.">Срок погашения</dt>
                    <dd title="Оплата за предыдущий месяц вносится до этого числа. День не привязан к году и месяцу.">{{ c.payment_due_day ?? '—' }}</dd>
                    <dt>Последняя оплата</dt><dd>{{ c.last_payment_date | date: 'dd.MM.yyyy' }}</dd>
                    <dt>Группа задолженности по услуге</dt><dd>{{ c.effective_group ?? '—' }}</dd>
                    <dt>Сценарий</dt><dd>{{ c.scenario_brief || c.scenario_name || '—' }}</dd>
                  </dl>
                </mat-card-content></mat-card>
                <div class="framed">
                  <h4>Категория, проживание, наследство</h4>
                  @if (auth.canWrite()) {
                    <div class="filters">
                      <mat-form-field>
                        <mat-label>Категория</mat-label>
                        <mat-select [(ngModel)]="categoryId" panelClass="debtor-category-panel">
                          <mat-option [value]="null">Не задана</mat-option>
                          @for (group of categoryGroups(categories()); track group.section) {
                            @if (group.section) {
                              <mat-optgroup [label]="group.section">
                                @for (item of group.items; track item.id) { <mat-option [value]="item.id">{{ item.name }}</mat-option> }
                              </mat-optgroup>
                            } @else {
                              @for (item of group.items; track item.id) { <mat-option [value]="item.id">{{ item.name }}</mat-option> }
                            }
                          }
                        </mat-select>
                      </mat-form-field>
                      <button mat-stroked-button type="button" (click)="saveProfile()">Сохранить</button>
                      <button mat-stroked-button type="button" (click)="clearCategory()">Очистить</button>
                      <mat-form-field class="reason"><mat-label>Фактическое проживание</mat-label><input matInput [(ngModel)]="residence" /></mat-form-field>
                      <mat-checkbox [(ngModel)]="inheritance">Наследственное дело</mat-checkbox>
                      <mat-form-field><mat-label>Приостановка до</mat-label><input matInput type="date" [(ngModel)]="inheritanceUntil" /></mat-form-field>
                      <mat-form-field>
                        <mat-label>Статус юрлица</mat-label>
                        <mat-select [(ngModel)]="legalStatus">
                          <mat-option value="active">Действующее</mat-option>
                          <mat-option value="liquidation">В стадии ликвидации</mat-option>
                          <mat-option value="bankruptcy">Банкротство</mat-option>
                        </mat-select>
                      </mat-form-field>
                      <mat-form-field><mat-label>Новая категория</mat-label><input matInput [(ngModel)]="newCategory" /></mat-form-field>
                      <button mat-stroked-button type="button" (click)="addCategory()">Добавить в справочник</button>
                      <button mat-stroked-button type="button" (click)="removeCategory()">Удалить выбранную</button>
                    </div>
                  } @else {
                    <p>{{ c.category_name || 'Категория не задана' }}@if (c.inheritance_case) { · наследственное дело }</p>
                  }
                </div>
              </div>
            </div>
          </mat-tab>

          <mat-tab label="Регистрация ({{ activeRegistrationCount() }})">
            <div class="list-pane">
              <table class="plain" appGridResize="contract-registrations">
                <thead>
                  <tr>
                    @for (col of regColumns; track col) { <th [attr.data-col]="col">{{ regLabel(col) }}</th> }
                  </tr>
                </thead>
                <tbody>
                  @for (person of people(); track person.id) {
                    <tr>
                      @for (col of regColumns; track col) { <td>{{ regCell(person, col) }}</td> }
                    </tr>
                  } @empty {
                    <tr><td [attr.colspan]="regColumns.length" class="muted">Зарегистрированных лиц нет.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </mat-tab>

          <mat-tab label="Контакты">
            @if (auth.canWrite()) {
              <div class="filters">
                <mat-form-field>
                  <mat-label>Режим автообзвона</mat-label>
                  <mat-select [(ngModel)]="contactMode" (selectionChange)="saveMode()">
                    <mat-option value="pm">Только контакты ПМ</mat-option>
                    <mat-option value="ais">Только контакты АИС «Расчет-ЖКУ»</mat-option>
                    <mat-option value="combined">ПМ и АИС</mat-option>
                  </mat-select>
                </mat-form-field>
              </div>
              <p class="muted">Приоритет ставит режим: выбранный источник получает 1, другой — 0. Телефон и e-mail добавляются отдельно, без источника и без приоритета.</p>
              <div class="filters">
                <mat-form-field>
                  <mat-label>Лицо</mat-label>
                  <mat-select [(ngModel)]="contactPersonId">
                    <mat-option [value]="null">Плательщик счёта</mat-option>
                    @for (person of people(); track person.id) { <mat-option [value]="person.id">{{ person.full_name }}</mat-option> }
                  </mat-select>
                </mat-form-field>
                <mat-form-field><mat-label>Телефон или e-mail</mat-label><input matInput [(ngModel)]="contactValue" /></mat-form-field>
                <mat-form-field>
                  <mat-label>Тип</mat-label>
                  <mat-select [(ngModel)]="contactKind">
                    <mat-option value="mobile">Мобильный</mat-option>
                    <mat-option value="city">Городской</mat-option>
                    <mat-option value="email">E-mail</mat-option>
                  </mat-select>
                </mat-form-field>
                <button mat-stroked-button (click)="addContact()">Добавить контакт</button>
              </div>
            }
            <div class="list-pane">
              <table class="plain" appGridResize="contract-contacts">
                <thead>
                  <tr>
                    <th data-col="person">Лицо</th>
                    <th data-col="kind">Тип</th>
                    <th data-col="value">Значение</th>
                    <th data-col="source">Источник</th>
                    <th data-col="priority">Приоритет</th>
                    <th data-col="actions"></th>
                  </tr>
                </thead>
                <tbody>
                  @for (contact of contacts(); track contact.id) {
                    <tr>
                      <td>{{ contact.person_name || 'Плательщик счёта' }}</td>
                      <td>{{ contactKindLabel(contact.kind) }}</td>
                      <td>{{ contact.value }}</td>
                      <td>{{ contactSourceLabel(contact.source) }}@if (contact.source === 'ais' && contact.ais_updated_at) { · {{ contact.ais_updated_at | date: 'dd.MM.yyyy' }} }</td>
                      <td>{{ contact.priority }}</td>
                      <td>
                        @if (auth.canWrite() && contact.source === 'pm') {
                          <button mat-button (click)="editContact(contact)">Изменить</button>
                          <button mat-button (click)="removeContact(contact)">Удалить</button>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6" class="muted">Контактов нет.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </mat-tab>

          <mat-tab label="Мероприятия">
            <p class="muted">Сценарий {{ scenario()?.scenario_name || c.scenario_name || 'не назначен' }}. <a routerLink="/measures">Реестр мероприятий</a></p>
            @if (isSupplier() && auth.canWrite()) {
              <div class="filters">
                <mat-form-field>
                  <mat-label>Шаблон предупреждения</mat-label>
                  <mat-select [(ngModel)]="templateId">
                    @for (item of templates(); track item.id) { <mat-option [value]="item.id">{{ item.name }}</mat-option> }
                  </mat-select>
                </mat-form-field>
                <button mat-stroked-button type="button" (click)="launchOwn('warning')">Предупреждение по этой услуге</button>
                <button mat-stroked-button type="button" (click)="launchOwn('disconnect')">Отключение этой услуги</button>
              </div>
            }
            @for (step of scenario()?.steps || []; track step.order + step.action) {
              <details class="step" [open]="step.measures.length > 0">
                <summary class="step-summary">
                  {{ step.title }}
                  <span class="muted">{{ stepSpan(step) }}</span>
                  @if (canHold() && step.measures[0]; as measure) {
                    <button type="button" class="text-btn pause-btn" (click)="$event.preventDefault(); $event.stopPropagation(); askPause(measure)">
                      {{ measure.status === 'paused' ? 'Возобновить мероприятие' : 'Приостановить мероприятие' }}
                    </button>
                  }
                </summary>
                @for (row of step.measures; track row.id) {
                  <div class="step-measure">
                    <div class="step-head">
                      <a [routerLink]="['/measures', row.id]">{{ row.kind_label }}</a>
                      <span class="status-pill {{ row.status }}">{{ row.status_label }}</span>
                      @if (row.owner_name) { <span class="muted">{{ row.owner_name }}</span> }
                    </div>
                    <app-measure-tasks [measureId]="row.id" [tasks]="row.tasks" [canWrite]="auth.canWrite()" (changed)="loadScenario()" />
                  </div>
                }
              </details>
            }
            <details class="step" open>
              <summary>Инициировано вручную</summary>
              @for (row of scenario()?.manual || []; track row.id) {
                <div class="step-measure">
                  <div class="step-head">
                    <a [routerLink]="['/measures', row.id]">{{ row.kind_label }}</a>
                    <span class="status-pill {{ row.status }}">{{ row.status_label }}</span>
                    @if (row.owner_name) { <span class="muted">{{ row.owner_name }}</span> }
                    @if (canHold()) {
                      <button type="button" class="text-btn pause-btn" (click)="askPause(row)">
                        {{ row.status === 'paused' ? 'Возобновить мероприятие' : 'Приостановить мероприятие' }}
                      </button>
                    }
                  </div>
                  <app-measure-tasks [measureId]="row.id" [tasks]="row.tasks" [canWrite]="auth.canWrite()" (changed)="loadScenario()" />
                </div>
              } @empty { <p class="muted">Отдельных мероприятий нет.</p> }
            </details>
            @if (measures().length) {
              <div class="list-pane">
                <table class="plain" appGridResize="contract-measures">
                  <thead>
                    <tr>
                      <th data-col="kind">Мероприятие</th>
                      <th data-col="next">Следующее действие</th>
                      <th data-col="status">Статус</th>
                      <th data-col="due">Срок</th>
                      <th data-col="open"></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (measure of measures(); track measure.id) {
                      <tr>
                        <td><a [routerLink]="['/measures', measure.id]">{{ measure.title || measure.kind_display }}</a></td>
                        <td>{{ measure.next_action || '—' }}</td>
                        <td>{{ measure.status === 'failed' ? 'Ошибка' : measure.status_display }}</td>
                        <td>{{ measure.due_on || '—' }}</td>
                        <td>
                          @if (measure.kind === 'disconnect' && canConfirmSuspension()) {
                            <button mat-button (click)="confirm(measure, 'suspend', 'pm')">Факт приостановления, ПМ</button>
                            <button mat-button (click)="confirm(measure, 'suspend', 'ais')">По данным АИС</button>
                            <button mat-button (click)="confirm(measure, 'resume', 'pm')">Возобновление, ПМ</button>
                            <button mat-button (click)="confirm(measure, 'resume', 'ais')">Возобновление по АИС</button>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
            @if (auth.canWrite()) {
              <div class="framed">
                <h4>Дополнительное мероприятие</h4>
                <div class="filters">
                  <mat-form-field>
                    <mat-label>Мероприятие</mat-label>
                    <mat-select [(ngModel)]="extraCatalogId">
                      @for (item of extraCatalog(); track item.id) { <mat-option [value]="item.id">{{ item.name }}</mat-option> }
                    </mat-select>
                  </mat-form-field>
                  <button mat-stroked-button type="button" (click)="addExtra()">Добавить дополнительное мероприятие</button>
                </div>
              </div>
            }
            @if (pauseFor) {
              <div class="pause-box">
                <h4>Приостановить мероприятие</h4>
                <mat-checkbox [(ngModel)]="pauseIndefinite">Приостановить навсегда (до ручного возобновления)</mat-checkbox>
                @if (!pauseIndefinite) {
                  <mat-form-field><mat-label>До</mat-label><input matInput type="date" [min]="todayIso()" [(ngModel)]="pauseUntil" /></mat-form-field>
                }
                <mat-form-field class="reason"><mat-label>Причина</mat-label><input matInput [(ngModel)]="pauseReason" /></mat-form-field>
                <button mat-flat-button color="primary" type="button" (click)="confirmPause()">Приостановить</button>
                <button mat-button type="button" (click)="pauseFor = null">Отмена</button>
              </div>
            }
          </mat-tab>

          <mat-tab label="Услуги поставщика по ЛС">
            <div class="list-pane">
              <table class="plain" appGridResize="contract-provider-services">
                <thead>
                  <tr>
                    <th>ID договора</th>
                    <th>Услуга</th>
                    <th>Номер ЛС</th>
                    <th>Адрес</th>
                    <th>Группа по услуге</th>
                    <th>Долг</th>
                    <th>Пеня</th>
                    <th>Итого</th>
                  </tr>
                </thead>
                <tbody>
                  @for (service of providerServices(); track service.id) {
                    <tr [class.current]="service.id === c.id" (click)="openService(service)">
                      <td>{{ service.service_list_id }}</td>
                      <td>{{ service.service_name }}</td>
                      <td>{{ service.account_number }}</td>
                      <td>{{ service.address }}</td>
                      <td>{{ service.effective_group ?? '—' }}</td>
                      <td><app-money [value]="service.balance_out" [blank]="false" /></td>
                      <td><app-money [value]="service.balance_mulct_out" [blank]="false" /></td>
                      <td><app-money [value]="service.obligation_total" [blank]="false" /></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </mat-tab>

          <mat-tab label="Остатки по периодам">
            <div class="filters">
              <mat-form-field>
                <mat-label>Год</mat-label>
                <mat-select [(ngModel)]="periodYear">
                  <mat-option value="">Все</mat-option>
                  @for (year of periodYears(); track year) { <mat-option [value]="year">{{ year }}</mat-option> }
                </mat-select>
              </mat-form-field>
              <mat-form-field>
                <mat-label>Месяц</mat-label>
                <mat-select [(ngModel)]="periodMonth">
                  <mat-option value="">Все</mat-option>
                  @for (month of months; track month.id) { <mat-option [value]="month.id">{{ month.label }}</mat-option> }
                </mat-select>
              </mat-form-field>
            </div>
            <div class="list-pane">
              <table class="plain">
                <thead><tr><th>Период</th><th>Долг</th><th>Пеня</th><th>Срок</th></tr></thead>
                <tbody>
                  @for (period of shownPeriods(); track period.period) {
                    <tr>
                      <td>{{ period.period }}</td>
                      <td><app-money [value]="period.principal" [blank]="false" /></td>
                      <td><app-money [value]="period.penalty" [blank]="false" /></td>
                      <td>{{ period.due_on || '—' }}</td>
                    </tr>
                  } @empty { <tr><td colspan="4" class="muted">Остатков по этой услуге нет.</td></tr> }
                </tbody>
              </table>
            </div>
          </mat-tab>

          <mat-tab [label]="'История изменений (' + journal().length + ')'">
            <div class="filters history-tabs">
              <button mat-stroked-button type="button" (click)="historyPane = 'rating'">Группа и рейтинг</button>
              <button mat-stroked-button type="button" (click)="historyPane = 'measure'">Изменение мероприятий</button>
              <button mat-stroked-button type="button" (click)="historyPane = 'other'">Прочие изменения</button>
            </div>
            <p class="muted tab-note">Группа и рейтинг — отдельно. Этап, сценарий, контакты и остальные изменения — на кнопке «Прочие».</p>
            <div class="list-pane">
              <table class="journal plain" appGridResize="contract-history">
                <thead>
                  <tr>
                    <th>Дата и время</th>
                    <th>Пользователь</th>
                    <th>Параметр</th>
                    <th>Текущее значение</th>
                    <th>Новое значение</th>
                    <th>Основание</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of historyRows(); track row.id) {
                    <tr>
                      <td>{{ row.created_at | date: 'dd.MM.yyyy HH:mm' : 'Europe/Minsk' }}</td>
                      <td>{{ row.author_name || 'Система' }}</td>
                      <td>{{ historyKind(row.kind) }}</td>
                      <td>{{ historyValue(row.kind, row.old_value) }}</td>
                      <td>{{ historyValue(row.kind, row.new_value) }}</td>
                      <td>{{ row.reason || '—' }}</td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6" class="muted">Записей нет.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </mat-tab>
        </mat-tab-group>
      }
    </div>
  `,
  styles: `
    .page-header { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px; }
    dl { display: grid; grid-template-columns: 220px 1fr; row-gap: 6px; }
    dt { color: #6b7280; } dd { margin: 0; }
    .reason { min-width: 240px; }
    .framed { border: 1px solid var(--erip-border, #e5e7eb); border-radius: 8px; padding: 12px; margin-top: 12px; }
    .step { border: 1px solid var(--erip-border, #e5e7eb); border-radius: 8px; margin: 8px 0; padding: 8px 12px; background: #fff; }
    .step summary { cursor: pointer; font-weight: 600; }
    .step-summary, .step-head { display: flex; gap: 12px; align-items: center; margin: 6px 0; }
    .step-measure { display: flex; flex-direction: column; align-items: stretch; gap: 4px; margin: 8px 0; }
    .pause-btn { margin-left: auto; }
    .pause-box { border: 1px solid var(--erip-border, #e5e7eb); border-radius: 8px; padding: 12px; margin-top: 12px; display: grid; gap: 8px; max-width: 420px; }
    .history-tabs { margin-top: 10px; }
    .list-pane { border: 1px solid var(--erip-border, #e5e7eb); border-radius: 8px; overflow: auto; background: #fff; margin-top: 8px; }
    tr.current { background: #e8f6ee; cursor: default; }
    tr { cursor: pointer; }
    table { width: 100%; border-collapse: collapse; }
    table.plain th, table.plain td { text-align: left; padding: 6px 10px; border: 1px solid var(--erip-border, #e5e7eb); white-space: nowrap; }
    table.plain th { background: #f7f9fb; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .02em; color: #5c6b7a; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
    .tab-note { margin: 12px 0 8px; font-size: 13px; line-height: 1.45; max-width: 760px; }
    table.journal tr, table.plain tr { cursor: default; }
    .text-btn { border: 0; background: transparent; color: var(--erip-link); cursor: pointer; font: inherit; font-size: 13px; padding: 0; }
  `,
})
export class ContractDetailComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  private readonly snack = inject(MatSnackBar);
  private readonly followId = effect(() => {
    if (this.id()) this.load();
  });
  readonly id = input.required<string>();
  protected readonly contract = signal<AccountService | null>(null);
  protected readonly account = signal<AccountDetail | null>(null);
  protected readonly services = signal<AccountService[]>([]);
  protected readonly people = signal<Registration[]>([]);
  protected readonly contacts = signal<ContactRow[]>([]);
  protected readonly periods = signal<ContractPeriod[]>([]);
  protected readonly measures = signal<MeasureRow[]>([]);
  protected readonly journal = signal<HistoryRow[]>([]);
  protected readonly categories = signal<DebtorCategory[]>([]);
  protected readonly scenario = signal<ScenarioBoard | null>(null);
  protected readonly extraCatalog = signal<{ id: number; name: string }[]>([]);
  protected readonly templates = signal<MessageTemplate[]>([]);
  protected readonly categoryGroups = categoryGroups;
  protected readonly error = signal('');
  protected manualGroup: number | null = null;
  protected reason = '';
  protected contactMode = 'combined';
  protected contactValue = '';
  protected contactKind = 'mobile';
  protected categoryId: number | null = null;
  protected residence = '';
  protected inheritance = false;
  protected inheritanceUntil = '';
  protected legalStatus = 'active';
  protected contactPersonId: number | null = null;
  protected newCategory = '';
  protected extraCatalogId: number | null = null;
  protected templateId: number | null = null;
  protected pauseFor: ScenarioMeasure | null = null;
  protected pauseUntil = '';
  protected pauseReason = '';
  protected pauseIndefinite = false;
  protected periodYear = '';
  protected periodMonth = '';
  protected historyPane: 'rating' | 'measure' | 'other' = 'other';
  protected readonly regColumns = [
    'payer', 'registered', 'fam', 'im', 'ot', 'debtor_role', 'legal', 'relation', 'family',
    'birthday', 'check_in_date', 'check_out_date', 'address', 'work', 'phone', 'email',
  ];
  protected readonly months = [
    { id: '01', label: 'январь' }, { id: '02', label: 'февраль' }, { id: '03', label: 'март' },
    { id: '04', label: 'апрель' }, { id: '05', label: 'май' }, { id: '06', label: 'июнь' },
    { id: '07', label: 'июль' }, { id: '08', label: 'август' }, { id: '09', label: 'сентябрь' },
    { id: '10', label: 'октябрь' }, { id: '11', label: 'ноябрь' }, { id: '12', label: 'декабрь' },
  ];

  ngOnInit(): void {
    this.api.categories().subscribe((page) => this.categories.set(page.results));
  }

  protected canEditGroup(): boolean {
    return this.auth.canWrite() && this.auth.me()?.contour !== 'supplier';
  }

  protected canConfirmSuspension(): boolean {
    return this.auth.canWrite() && this.auth.me()?.contour === 'supplier';
  }

  protected canHold(): boolean {
    return this.auth.canWrite() && this.auth.me()?.contour !== 'supplier';
  }

  protected isSupplier(): boolean {
    return this.auth.me()?.contour === 'supplier';
  }

  personTitle(): string {
    return this.mainPerson()?.subj_legal_entity ? 'Юридическое лицо' : 'Физическое лицо';
  }

  mainPerson(): Registration | undefined {
    return this.people().find((person) => person.subj_is_main) || this.people()[0];
  }

  legalLabel(): string {
    const labels: Record<string, string> = {
      active: 'Действующее', liquidation: 'В стадии ликвидации', bankruptcy: 'Банкротство',
    };
    return labels[this.account()?.legal_status || 'active'] || 'Действующее';
  }

  protected providerServices(): AccountService[] {
    const current = this.contract();
    if (!current) return [];
    return this.services().filter((row) => row.account === current.account && row.provider_id === current.provider_id);
  }

  protected openService(service: AccountService): void {
    if (service.id === this.contract()?.id) return;
    this.router.navigate(['/contracts', service.id]);
  }

  protected periodYears(): string[] {
    const years = new Set<string>();
    for (const row of this.ownPeriods()) {
      const year = this.periodParts(row.period).year;
      if (year) years.add(year);
    }
    return [...years].sort();
  }

  protected shownPeriods(): ContractPeriod[] {
    return this.ownPeriods().filter((row) => {
      const parts = this.periodParts(row.period);
      if (this.periodYear && parts.year !== this.periodYear) return false;
      if (this.periodMonth && parts.month !== this.periodMonth) return false;
      return true;
    });
  }

  protected historyRows(): HistoryRow[] {
    const rows = this.journal();
    if (this.historyPane === 'rating') {
      const rank = (kind: string) => (kind === 'group' ? 0 : kind === 'rating' ? 1 : 2);
      return rows
        .filter((row) => row.kind === 'group' || row.kind === 'rating')
        .slice()
        .sort((a, b) => {
          const byTime = String(a.created_at).localeCompare(String(b.created_at));
          if (byTime) return byTime;
          return rank(a.kind) - rank(b.kind);
        });
    }
    if (this.historyPane === 'measure') return rows.filter((row) => row.kind === 'measure');
    return rows.filter((row) => row.kind !== 'group' && row.kind !== 'rating' && row.kind !== 'measure');
  }

  protected historyKind(kind: string): string {
    const labels: Record<string, string> = {
      group: 'Группа', rating: 'Рейтинг', funnel: 'Этап воронки', scenario: 'Сценарий',
      contact: 'Контакт', category: 'Категория', inheritance: 'Наследственное дело',
      registration: 'Регистрация', residence: 'Проживание', legal: 'Статус лица',
      measure: 'Мероприятие',
    };
    return labels[kind] || kind;
  }

  protected historyValue(kind: string, value: string): string {
    if (!value) return '—';
    if (kind === 'funnel') return funnelTitle(value);
    return value;
  }

  protected refreshNow(): void {
    const account = this.account();
    if (!account) return;
    this.api.refreshAccount(account.id).subscribe({
      next: () => this.load(),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  protected launchOwn(kind: 'warning' | 'disconnect'): void {
    const row = this.contract();
    if (!row) return;
    const template = this.templates().find((item) => item.id === this.templateId);
    if (kind === 'warning' && !template) {
      this.snack.open('Выберите шаблон предупреждения', 'OK');
      return;
    }
    const body: Record<string, unknown> = { kind, account_ids: [row.account], service_ids: [row.id] };
    if (template && kind === 'warning') body['template_name'] = template.name;
    this.api.createMeasure(body).subscribe({
      next: () => {
        this.snack.open('Мероприятие назначено', 'OK', { duration: 3000 });
        this.load();
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  protected addExtra(): void {
    const row = this.contract();
    if (!row || this.extraCatalogId == null) return;
    this.api.addContractExtra(row.id, this.extraCatalogId).subscribe({
      next: () => {
        this.snack.open('Дополнительное мероприятие добавлено', 'OK', { duration: 3000 });
        this.load();
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  protected accountPeriod(account: AccountDetail | null | undefined): string {
    if (!account?.start_date) return '—';
    const start = this.showDate(account.start_date);
    if (!account.stop_date || account.stop_date.startsWith('2100-01-01')) return `с ${start}`;
    return `с ${start} по ${this.showDate(account.stop_date)}`;
  }

  protected showDate(value: string | null | undefined): string {
    if (!value) return '';
    const iso = value.slice(0, 10);
    const parts = iso.split('-');
    return parts.length === 3 && parts[0].length === 4 ? `${parts[2]}.${parts[1]}.${parts[0]}` : value;
  }

  protected todayIso(): string {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${m}-${d}`;
  }

  protected stepSpan(step: ScenarioStep): string {
    const row = step.measures[0];
    if (!row) return '';
    const start = this.showDate(row.started_on);
    const end = this.showDate(row.finished_on);
    if (!start && !end) return '';
    return `${start || '…'} — ${end || '…'}`;
  }

  protected activeRegistrationCount(): number {
    return this.people().filter((person) => this.regCell(person, 'registered') === 'да').length;
  }

  protected regLabel(col: string): string {
    const labels: Record<string, string> = {
      payer: 'Плательщик', registered: 'Зарегистрирован', fam: 'Фамилия', im: 'Имя', ot: 'Отчество',
      debtor_role: 'Роль', legal: 'Юр.лицо', relation: 'Родственные отношения', family: 'Является членом семьи',
      birthday: 'Дата рождения', check_in_date: 'Дата прибытия', check_out_date: 'Дата убытия',
      address: 'Адрес местожительства', work: 'Наименование предприятия', phone: 'Контактный телефон', email: 'E-mail',
    };
    return labels[col] || col;
  }

  protected regCell(person: Registration, col: string): string {
    const yn = (value: boolean | number | null | undefined) => (value ? 'да' : 'нет');
    const sheet = (label: string) =>
      (person.sheet || []).find((field) => field.label.toLowerCase().includes(label.toLowerCase()))?.value || '';
    if (col === 'payer') return yn(person.subj_is_main);
    if (col === 'registered') {
      const removed = person.subj_is_check_out || sheet('снят').startsWith('1') || sheet('снят') === 'да';
      if (removed) return 'нет';
      const status = sheet('статус регистрации');
      if (status === '0' || status === 'нет') return 'нет';
      return 'да';
    }
    if (col === 'fam') return person.full_name.split(' ')[0] || sheet('фамилия') || '—';
    if (col === 'im') return person.full_name.split(' ')[1] || '—';
    if (col === 'ot') return person.full_name.split(' ').slice(2).join(' ') || '—';
    if (col === 'debtor_role') return person.debtor_role || '—';
    if (col === 'legal') return yn(person.subj_legal_entity);
    if (col === 'relation') return person.relation_degree_name || '—';
    if (col === 'family') return yn(person.is_close_relative);
    if (col === 'birthday') return this.showDate(person.birthday) || '—';
    if (col === 'check_in_date') return this.showDate(sheet('прибытия')) || '—';
    if (col === 'check_out_date') return this.showDate(sheet('убытия')) || '—';
    if (col === 'address') return person.registration_address || sheet('местожительства') || '—';
    if (col === 'work') return person.work_place_name || sheet('предприятия') || '—';
    if (col === 'phone') return person.contact_phone || '—';
    if (col === 'email') return person.email || '—';
    return '—';
  }

  protected askPause(row: ScenarioMeasure): void {
    if (row.status === 'paused') {
      this.api.releaseMeasure(row.id).subscribe({
        next: () => this.loadScenario(),
        error: (e) => this.snack.open(errorMessage(e), 'OK'),
      });
      return;
    }
    this.pauseUntil = '';
    this.pauseReason = '';
    this.pauseIndefinite = false;
    this.pauseFor = row;
  }

  protected confirmPause(): void {
    const row = this.pauseFor;
    if (!row || !this.pauseReason.trim()) return;
    if (!this.pauseIndefinite && !this.pauseUntil) return;
    if (!this.pauseIndefinite && this.pauseUntil < this.todayIso()) {
      this.snack.open('Дата приостановки не может быть раньше сегодняшней', 'OK');
      return;
    }
    this.api.holdMeasure(row.id, this.pauseUntil, this.pauseReason.trim(), this.pauseIndefinite).subscribe({
      next: () => {
        this.pauseFor = null;
        this.loadScenario();
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  saveGroup(): void {
    const row = this.contract();
    if (!row) return;
    this.api.httpPatchContract(row.id, this.manualGroup, this.reason).subscribe({
      next: () => {
        this.snack.open('Группа договора сохранена', 'OK', { duration: 3000 });
        this.load();
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  savePerson(person: Registration): void {
    this.api.saveRegistration(person.id, {
      social_category: person.social_category,
      unfit_for_work: person.unfit_for_work,
      heritage_transfer: person.heritage_transfer,
    }).subscribe({
      next: () => {
        this.snack.open('Сведения о лице сохранены', 'OK', { duration: 3000 });
        this.load();
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  contactKindLabel(kind: string): string {
    const labels: Record<string, string> = { mobile: 'Мобильный', city: 'Городской', email: 'E-mail' };
    return labels[kind] || kind;
  }

  contactSourceLabel(source: string): string {
    return source === 'ais' ? 'АИС «Расчет-ЖКУ»' : 'ПМ';
  }

  addContact(): void {
    const account = this.account();
    if (!account || !this.contactValue.trim()) return;
    this.api.saveContact({
      account: account.id, registration: this.contactPersonId, kind: this.contactKind,
      value: this.contactValue.trim(),
    }).subscribe({
      next: () => {
        this.contactValue = '';
        this.load();
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  editContact(contact: ContactRow): void {
    const value = this.contactValue.trim();
    if (!value) {
      this.snack.open('Введите новое значение в поле контакта', 'OK');
      return;
    }
    this.api.saveContact({ id: contact.id, kind: contact.kind, value }).subscribe({
      next: () => {
        this.contactValue = '';
        this.load();
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  removeContact(contact: ContactRow): void {
    this.api.deleteContact(contact.id).subscribe({
      next: () => this.load(),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  saveMode(): void {
    const account = this.account();
    if (!account || (account.contact_source_mode || 'combined') === this.contactMode) return;
    this.api.updateAccount(account.id, { contact_source_mode: this.contactMode }).subscribe({
      next: (updated) => {
        this.account.set(updated);
        this.api.accountContacts(updated.id).subscribe((page) => this.contacts.set(page.results));
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  saveProfile(): void {
    const account = this.account();
    if (!account) return;
    this.api.updateAccount(account.id, {
      debtor_category: this.categoryId,
      residence_note: this.residence,
      inheritance_case: this.inheritance,
      inheritance_until: this.inheritanceUntil || null,
      legal_status: this.legalStatus,
      contact_source_mode: this.contactMode,
    }).subscribe({
      next: () => {
        this.snack.open('Сохранено', 'OK', { duration: 3000 });
        this.load();
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  clearCategory(): void {
    this.categoryId = null;
    this.saveProfile();
  }

  addCategory(): void {
    const name = this.newCategory.trim();
    if (!name) return;
    this.api.saveCategory({ code: name.toLowerCase().replace(/\s+/g, '-'), name }).subscribe({
      next: (row) => {
        this.categories.update((list) => [...list, row]);
        this.categoryId = row.id;
        this.newCategory = '';
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  removeCategory(): void {
    if (!this.categoryId) return;
    this.api.deleteCategory(this.categoryId).subscribe({
      next: () => {
        this.categories.update((list) => list.filter((item) => item.id !== this.categoryId));
        this.categoryId = null;
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  confirm(measure: MeasureRow, action: 'suspend' | 'resume', source: 'pm' | 'ais'): void {
    this.api.confirmMeasure(measure.id, action, source).subscribe({
      next: () => this.load(),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  private ownPeriods(): ContractPeriod[] {
    const id = this.contract()?.id;
    return this.periods().filter((row) => row.service_id === id);
  }

  private periodParts(value: string): { year: string; month: string } {
    if (value.includes('.')) {
      const [month, year] = value.split('.');
      return { month: (month || '').padStart(2, '0'), year: (year || '').slice(0, 4) };
    }
    return { year: value.slice(0, 4), month: value.slice(5, 7) };
  }

  protected loadScenario(): void {
    const account = this.account();
    if (!account) return;
    this.api.accountScenario(account.id).subscribe((board) => this.scenario.set(board));
  }

  private load(): void {
    this.api.contractDossier(Number(this.id())).subscribe({
      next: (dossier) => {
        this.contract.set(dossier.contract);
        this.account.set(dossier.account);
        this.services.set(dossier.services);
        this.people.set(dossier.people);
        this.contacts.set(dossier.contacts);
        this.periods.set(dossier.periods);
        this.measures.set(dossier.measures);
        this.journal.set(dossier.journal);
        this.manualGroup = dossier.contract.debt_group_manual ?? null;
        this.reason = dossier.contract.debt_group_manual_reason || '';
        this.contactMode = dossier.account.contact_source_mode || 'combined';
        this.categoryId = dossier.account.debtor_category;
        this.residence = dossier.account.residence_note;
        this.inheritance = dossier.account.inheritance_case;
        this.inheritanceUntil = dossier.account.inheritance_until || '';
        this.legalStatus = dossier.account.legal_status || 'active';
        this.error.set('');
        this.loadScenario();
        if (this.auth.canWrite() && !this.extraCatalog().length) {
          this.api.extraMeasureCatalog().subscribe((page) => {
            this.extraCatalog.set(page.results);
            this.extraCatalogId = page.results[0]?.id ?? null;
          });
        }
        if (this.isSupplier() && !this.templates().length) {
          this.api.templates({ is_active: true, page_size: 100 }).subscribe((page) => {
            this.templates.set(page.results);
            this.templateId = page.results[0]?.id ?? null;
          });
        }
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }
}
