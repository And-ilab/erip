import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize, forkJoin, Observable } from 'rxjs';

import { ApiService, ColumnPrefs, FunnelGateInfo, errorMessage, funnelGate, gateTarget } from '../../core/api.service';
import { BynSignComponent, MoneyComponent } from '../../core/money.component';
import { AuthService } from '../../core/auth.service';
import {
  AccountDetail, AccountRow, AccountService, ActivityBoard, AttachmentRow, BalanceRow, Channel, ContactRow, DebtorCategory, DebtShare, HistoryRow, MeasureRow, MessageTemplate, Payment, Registration, ScenarioBoard, ScenarioMeasure, ScenarioStep, WorkItem, WritDraft, categoryGroups,
} from '../../core/models';
import { funnelTitle } from '../funnel-stages';
import { GridResizeDirective } from '../grid-resize.directive';
import { ColumnDragDirective } from '../column-drag.directive';
import { MeasureTasksComponent } from '../measures/measure-tasks.component';
import { AccountActivitiesComponent } from './account-activities.component';
import { FunnelGateDialogComponent } from '../funnel-gate-dialog.component';
import { FunnelBarComponent } from './funnel-bar.component';

@Component({
  selector: 'app-account-detail',
  standalone: true,
  imports: [
    DatePipe, FormsModule, RouterLink, MatTabsModule, MatTableModule, MatCardModule, MatButtonModule, MoneyComponent, BynSignComponent,
    MatAutocompleteModule,
    MatFormFieldModule, MatSelectModule, MatInputModule, MatSnackBarModule, MatCheckboxModule, MatIconModule,
    MeasureTasksComponent, GridResizeDirective, ColumnDragDirective, FunnelBarComponent, AccountActivitiesComponent,
    FunnelGateDialogComponent,
  ],
  template: `
    <div class="page">
      @if (error()) { <p class="alert danger"><mat-icon>error_outline</mat-icon>{{ error() }}</p> }

      @if (account(); as a) {
        <div class="crumbs">
          <a routerLink="/accounts">Реестр ЛС</a>
          <span class="sep">›</span>
          <b>{{ a.client_account }}</b>
        </div>

        <section class="surface head debtor">
          <div class="stage-line">
            <h2 title="Лицевой счет">{{ a.client_account }}</h2>
            <div class="title-tools">
              @if (a.uniq_attr_name) { <span class="pill" title="Тип уникальности ЛС">{{ a.uniq_attr_name }}</span> }
              @if (a.rating_label) { <span class="rating-badge r{{ a.rating_label[0] }}" title="Рейтинг">{{ a.rating_label }}</span> }
              @if (auth.canWrite()) {
                <button mat-stroked-button (click)="refreshNow()"><mat-icon>sync</mat-icon> Обновить сейчас</button>
              }
            </div>
            <app-funnel-bar
              [stage]="a.funnel_stage"
              [parallel]="a.parallel_stage || ''"
              [group]="a.effective_group"
              [canChange]="canChangeStage()"
              (stageChange)="changeStage($event)"
              (parallelChange)="changeParallel($event)" />
          </div>
          <div class="debtor-top">
            <div class="who">
              <p class="uen">УЕН ЛС {{ a.unified_account || 'не передан' }}</p>
              <div class="meta">
                <span class="k">Адрес</span>
                <b>{{ a.account_address || a.house_address || '—' }}</b>
              </div>
              <div class="meta">
                <span class="k">Плательщик</span>
                <b>{{ personName() }}</b>
              </div>
            </div>
            <div class="who-side">
              <div class="sum-block">
                <span class="k">Суммарная задолженность по ЛС <app-byn-sign /></span>
                <b class="sum">
                  <app-money [value]="obligationTotal()" [blank]="false" />
                  <span class="penalty-note">(в т.ч. пеня <app-money [value]="penaltyTotal()" [blank]="false" />)</span>
                </b>
              </div>
              <div class="meta side-meta">
                <span class="k">Солидарные должники</span>
                <b>{{ solidarityLine() }}</b>
              </div>
            </div>
          </div>
        </section>

        <mat-tab-group class="surface tabs" [selectedIndex]="tabIndex()" (selectedIndexChange)="openTab($event)">
        <mat-tab label="Активности">
          <app-account-activities
            [current]="activities()?.current || []"
            [parallel]="activities()?.parallel || []"
            [loading]="activitiesLoading()"
            [canAct]="canAct()"
            [focusMeasure]="focusMeasure()"
            [focusCode]="focusActivity()"
            (act)="actOn($event)"
            (openMeasure)="openAssignedMeasure($event)" />
        </mat-tab>
        <mat-tab label="Общие">
            <div class="grid">
              <div>
              <mat-card><mat-card-content>
                <dl>
                  <dt>Код ЛС</dt><dd>{{ a.account_id }}</dd>
                  <dt>Обслуживающая организация</dt><dd>{{ a.provider_short_name || '—' }}</dd>
                  @if (auth.showSchema()) { <dt>Код схемы</dt><dd>{{ a.schema_name || a.schema_label || '—' }}</dd> }
                  <dt>ЧУП</dt><dd>{{ a.is_private_enterprise ? 'есть' : 'нет' }}</dd>
                  <dt>Общая площадь</dt><dd>{{ a.acc_total_space ?? '—' }}</dd>
                  <dt>Кол-во комнат</dt><dd>{{ a.room_count ?? '—' }}</dd>
                  <dt>Кол-во проживающих</dt><dd>{{ a.subj_count ?? '—' }}</dd>
                  <dt>Кол-во льготников</dt><dd>{{ a.priv_acc_count ?? '—' }}</dd>
                  <dt>Кол-во месяцев долга</dt><dd>{{ a.months_debt ?? '—' }}</dd>
                  <dt>Тип объекта жилфонда</dt><dd>{{ a.acc_category_full || a.acc_category_short || '—' }}</dd>
                  <dt>Категория жилого фонда</dt><dd>{{ a.category_name || a.category_short_name || '—' }}</dd>
                  <dt>Тип собственности</dt><dd>{{ a.ownership_type_name || '—' }}</dd>
                  <dt>ID доп. информации 1</dt><dd>{{ a.info_param_id1 ?? '—' }}</dd>
                  <dt>Доп. информация 1</dt><dd>{{ a.info_param_value1 || '—' }}</dd>
                  <dt>ID доп. информации 2</dt><dd>{{ a.info_param_id2 ?? '—' }}</dd>
                  <dt>Доп. информация 2</dt><dd>{{ a.info_param_value2 || '—' }}</dd>
                  <dt>Телефон</dt><dd>{{ a.phone || '—' }}</dd>
                  <dt>Контактный телефон</dt><dd>{{ a.contact_phone || '—' }}</dd>
                  <dt>Период действия ЛС</dt><dd>{{ accountPeriod(a) }}</dd>
                </dl>
              </mat-card-content></mat-card>
              @if (auth.canWrite() && auth.me()?.contour !== 'supplier') {
                <div class="framed">
                  <h4>Ручное изменение группы задолженности</h4>
                  <div class="filters">
                    <mat-form-field>
                      <mat-label>Группа задолженности</mat-label>
                      <mat-select [(ngModel)]="manualGroup">
                        <mat-option [value]="null">По расчёту</mat-option>
                        @for (g of [0, 1, 2, 3, 4, 5, 6]; track g) { <mat-option [value]="g">{{ g }}</mat-option> }
                      </mat-select>
                    </mat-form-field>
                    <mat-form-field class="reason" [class.invalid]="groupInvalid">
                      <mat-label>Причина</mat-label>
                      <input matInput [(ngModel)]="manualReason" />
                    </mat-form-field>
                    <button mat-stroked-button (click)="saveGroup()">Сохранить</button>
                  </div>
                </div>
              }
              </div>
              <div>
              <mat-card><mat-card-content>
                <dl>
                  <dt>Входящее сальдо <app-byn-sign /></dt><dd><app-money [value]="a.balance_in" [blank]="false" /></dd>
                  <dt>Начислено <app-byn-sign /></dt><dd><app-money [value]="a.total_calc_sum" [blank]="false" /></dd>
                  <dt>Распределенная оплата <app-byn-sign /></dt><dd><app-money [value]="a.pay_sum" [blank]="false" /></dd>
                  <dt>В т.ч. списано <app-byn-sign /></dt><dd><app-money [value]="a.pay_sum_writeoff" [blank]="false" /></dd>
                  <dt>Исходящее сальдо <app-byn-sign /></dt><dd><app-money [value]="a.balance_out" [blank]="false" /></dd>
                  <dt>Квит. оплата <app-byn-sign /></dt><dd><app-money [value]="a.receipt_pay" [blank]="false" /></dd>
                  <dt>Нераспр. остаток <app-byn-sign /></dt><dd><app-money [value]="a.unshared_sum" [blank]="false" /></dd>
                  <dt>Сумма субсидии <app-byn-sign /></dt><dd><app-money [value]="a.calc_result_sum" [blank]="false" /></dd>
                  <dt>Сумма основного долга <app-byn-sign /></dt><dd class="money-line"><button type="button" class="sum-btn" (click)="openShares()"><app-money [value]="principalTotal()" [blank]="false" /></button></dd>
                  <dt>Сумма пени <app-byn-sign /></dt><dd class="money-line amount-danger"><app-money [value]="penaltyTotal()" [blank]="false" /></dd>
                  <dt>Операционная дата</dt><dd>{{ a.operational_date | date: 'dd.MM.yyyy' }}</dd>
                  <dt>Обновлено из АИС</dt><dd>{{ a.ais_updated_at | date: 'dd.MM.yyyy HH:mm' }}</dd>
                  <dt>Дата возникновения долга</dt><dd>{{ a.debt_started_on | date: 'dd.MM.yyyy' }}</dd>
                  <dt>Сценарий</dt><dd>{{ a.scenario_brief || a.scenario_name || '—' }}</dd>
                  <dt>Наследственное дело</dt><dd>{{ inheritanceText() }}</dd>
                  <dt>Категория должника</dt><dd>{{ categoryName() }}</dd>
                </dl>
                <p class="flag" [class.bad]="riskOn()">Признаки банкротства / недееспособности — {{ riskOn() ? 'есть' : 'нет' }}</p>
              </mat-card-content></mat-card>
                @if (auth.canWrite()) {
                  <div class="framed">
                    <h4>Категория должника</h4>
                    <p class="muted">Фактическое проживание — заметка ПМ, выгрузка АИС её не затирает. Наследственное дело останавливает автомеры, пока флаг не снят, не вышел срок или в АИС не появился новый плательщик. «Приостановка до» — этот срок.</p>
                    <div class="filters">
                      <mat-form-field class="category-field">
                        <mat-label>Категория должника</mat-label>
                        <input matInput [(ngModel)]="categoryText" [matAutocomplete]="catAuto" />
                        <mat-autocomplete #catAuto="matAutocomplete" panelClass="debtor-category-panel" (optionSelected)="pickCategory($event.option.value)">
                          @if (!categoryText.trim()) {
                            @for (group of categoryGroups(categories()); track group.section) {
                              @if (group.section) { <mat-option disabled>{{ group.section }}</mat-option> }
                              @for (item of group.items; track item.id) {
                                <mat-option [value]="item.name">{{ item.name }}</mat-option>
                              }
                            }
                          } @else {
                            @for (item of categoryMatches(); track item.id) {
                              <mat-option [value]="item.name">{{ item.name }}</mat-option>
                            }
                          }
                        </mat-autocomplete>
                      </mat-form-field>
                      <button mat-stroked-button (click)="applyCategory()">Выбрать или добавить</button>
                      <button mat-stroked-button (click)="clearCategory()">Очистить</button>
                      <mat-form-field class="reason"><mat-label>Фактическое проживание</mat-label><input matInput [(ngModel)]="residence" /></mat-form-field>
                      <mat-checkbox [(ngModel)]="inheritance">Наследственное дело</mat-checkbox>
                      <mat-form-field><mat-label>Приостановка до</mat-label><input matInput placeholder="дд.мм.гггг" [(ngModel)]="inheritanceUntil" /></mat-form-field>
                      <button mat-stroked-button (click)="saveProfile()">Сохранить</button>
                    </div>
                  </div>
                }
              </div>
            </div>
          </mat-tab>

          <mat-tab label="Регистрация ({{ activeRegistrationCount() }})">
            <div class="columns-wrap">
              <button mat-stroked-button type="button" class="table-settings" (click)="toggleColumnMenu('registration', $event)">Настройки таблицы</button>
              @if (columnMenu === 'registration') {
                <div class="picker-back" (click)="columnMenu = ''"></div>
                <div class="picker-menu" role="listbox" aria-label="Столбцы регистрации"
                     [style.top.px]="columnMenuTop" [style.left.px]="columnMenuLeft"
                     [style.max-height]="'calc(100vh - ' + (columnMenuTop + 12) + 'px)'">
                  <div class="picker-actions">
                    <button type="button" (click)="setRegColumns(true)">Отметить все</button>
                    <button type="button" (click)="setRegColumns(false)">Снять все</button>
                  </div>
                  @for (col of regCatalog; track col; let i = $index) {
                    <label>
                      <input type="checkbox" [checked]="regVisible(col)" (change)="toggleRegColumn(col, $any($event.target).checked)" />
                      <span>{{ regLabel(col) }}</span>
                      <button type="button" (click)="$event.preventDefault(); moveRegColumn(i, -1)">↑</button>
                      <button type="button" (click)="$event.preventDefault(); moveRegColumn(i, 1)">↓</button>
                    </label>
                  }
                </div>
              }
            </div>
            <div class="list-pane"><table class="plain" appGridResize="account-registrations" appColumnDrag (columnMove)="dragReg($event)">
              <thead><tr>@for (col of visibleRegColumns(); track col) { <th [attr.data-col]="col">{{ regLabel(col) }}</th> }</tr></thead>
              <tbody>
                @for (person of registrations(); track person.id) {
                  <tr>@for (col of visibleRegColumns(); track col) { <td>{{ regCell(person, col) }}</td> }</tr>
                }
              </tbody>
            </table></div>
          </mat-tab>

          <mat-tab [label]="'Мероприятия (' + measures().length + ')'">
            <p><a routerLink="/measures">Реестр мероприятий</a></p>
            @if (auth.canSkip()) {
              <div class="filters">
                <mat-form-field class="wide"><mat-label>Причина пропуска шага сценария</mat-label><input matInput [(ngModel)]="skipReason" /></mat-form-field>
                <button mat-stroked-button (click)="skipStep()">Пропустить текущий шаг</button>
              </div>
            }
            <p class="muted">Сценарий {{ scenarioName() || 'не назначен' }}. Задание — отдельная работа: название, срок и статус. Мероприятия, которые специалист начал сам, лежат в группе «Инициировано вручную».</p>
            @for (step of scenarioSteps(); track step.order + step.action) {
              <details class="step" [open]="stepOpen(step)">
                <summary class="step-summary">
                  <button type="button" class="step-no" [class.on]="stepDone(step)" (click)="$event.preventDefault(); $event.stopPropagation(); toggleStep(step)">{{ step.order }}</button>
                  {{ step.title }}
                  <span class="muted">{{ stepSpan(step) }}</span>
                  @if (canHold() && step.measures[0]; as measure) {
                    <button type="button" class="text-btn pause-btn" (click)="$event.preventDefault(); $event.stopPropagation(); askPause(measure)">
                      {{ measure.status === 'paused' ? 'Возобновить мероприятие' : 'Приостановить мероприятие' }}
                    </button>
                  }
                </summary>
                @for (item of step.checklist; track item) {
                  @if (step.measures.length) {
                    <button type="button" class="check-line check-go" (click)="openAssignedMeasure(step.measures[0].id)">{{ item }}</button>
                  } @else {
                    <p class="check-line">{{ item }}</p>
                  }
                }
                @for (row of step.measures; track row.id) {
                  <div class="step-measure" [id]="'measure-' + row.id" [class.focus]="focusMeasure() === row.id">
                    <div class="step-head">
                      <a [routerLink]="['/measures', row.id]">{{ row.kind_label }}</a>
                      <span class="status-pill {{ row.status }}">{{ row.status_label }}</span>
                    </div>
                    <app-measure-tasks [measureId]="row.id" [tasks]="row.tasks" [canWrite]="auth.canWrite()" (changed)="reloadScenario()" />
                    @for (call of row.calls || []; track call.at) {
                      <p class="muted">{{ showDateTime(call.at) }} · {{ call.duration_sec ?? '—' }} с · {{ call.status }}
                        @if (call.external_call && call.recording_ref) { · <a [href]="call.recording_ref">запись</a> }
                        @if (call.external_call === false) { · внешний вызов не выполнялся }
                      </p>
                    }
                  </div>
                }
                @if (!step.measures.length) {
                  <p class="muted">Мероприятие этого шага ещё не запущено. Задание добавляется в мероприятие шага после его запуска.</p>
                }
                @if (step.action === 'warning' && auth.canWrite()) {
                  <div class="filters">
                    <mat-form-field><mat-label>Дата вручения</mat-label><input matInput type="date" [(ngModel)]="warningDelivered" /></mat-form-field>
                    <input type="file" (change)="onWarningFile($event)" />
                    <button mat-stroked-button type="button" (click)="saveWarningProof()">Приложить подтверждение</button>
                  </div>
                }
              </details>
            }
            <details class="step" [open]="manualOpen()">
              <summary>Инициировано вручную</summary>
              @for (row of scenarioManual(); track row.id) {
                <div class="step-measure" [id]="'measure-' + row.id" [class.focus]="focusMeasure() === row.id">
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
                  <app-measure-tasks [measureId]="row.id" [tasks]="row.tasks" [canWrite]="auth.canWrite()" (changed)="reloadScenario()" />
                </div>
              } @empty { <p class="muted">Отдельных мероприятий нет.</p> }
            </details>
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
              <div class="picker-back" (click)="pauseFor = null"></div>
              <div class="pause-box">
                <h4>Приостановить мероприятие</h4>
                <mat-form-field><mat-label>До</mat-label><input matInput type="date" [(ngModel)]="pauseUntil" /></mat-form-field>
                <mat-form-field class="reason"><mat-label>Причина</mat-label><input matInput [(ngModel)]="pauseReason" /></mat-form-field>
                <button mat-flat-button color="primary" type="button" (click)="confirmPause()">Приостановить</button>
              </div>
            }
          </mat-tab>

          <mat-tab label="Контактные данные">
            <p class="muted">Приоритет ставит режим: выбранный источник получает 1, другой — 0. Телефон и e-mail добавляются отдельно, без источника и без приоритета.</p>
            @if (auth.canWrite()) {
            <div class="filters contact-add">
              <mat-form-field [class.invalid]="contactInvalid"><mat-label>Телефон или e-mail</mat-label><input matInput [(ngModel)]="contactValue" /></mat-form-field>
              <mat-form-field>
                <mat-label>Тип</mat-label>
                <mat-select [(ngModel)]="contactKind">
                  <mat-option value="mobile">Мобильный</mat-option>
                  <mat-option value="city">Городской</mat-option>
                  <mat-option value="email">E-mail</mat-option>
                </mat-select>
              </mat-form-field>
              <button mat-stroked-button (click)="addContact()">{{ editingContactId ? 'Сохранить' : 'Добавить контакт' }}</button>
              <span class="contact-mode">
                <mat-form-field>
                  <mat-label>Режим автообзвона</mat-label>
                  <mat-select [(ngModel)]="contactMode" (selectionChange)="saveMode()">
                    <mat-option value="pm">Только контакты ПМ</mat-option>
                    <mat-option value="ais">Только контакты АИС «Расчет-ЖКУ»</mat-option>
                    <mat-option value="combined">ПМ и АИС</mat-option>
                  </mat-select>
                </mat-form-field>
              </span>
            </div>
            }
            <div class="list-pane"><table mat-table [dataSource]="contacts()" appGridResize="account-contacts">
              <ng-container matColumnDef="kind"><th mat-header-cell *matHeaderCellDef>Тип</th><td mat-cell *matCellDef="let r">{{ contactKindLabel(r.kind) }}</td></ng-container>
              <ng-container matColumnDef="value"><th mat-header-cell *matHeaderCellDef>Значение</th><td mat-cell *matCellDef="let r">{{ r.value }}</td></ng-container>
              <ng-container matColumnDef="source"><th mat-header-cell *matHeaderCellDef>Источник</th><td mat-cell *matCellDef="let r">{{ contactSourceLabel(r.source) }}@if (r.source === 'ais' && r.ais_updated_at) { · {{ r.ais_updated_at | date: 'dd.MM.yyyy' }} }</td></ng-container>
              <ng-container matColumnDef="priority"><th mat-header-cell *matHeaderCellDef>Приоритет</th><td mat-cell *matCellDef="let r">{{ r.priority }}</td></ng-container>
              <ng-container matColumnDef="actions"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let r">
                @if (auth.canWrite() && r.source === 'pm') {
                  <button mat-button (click)="editContact(r)">{{ editingContactId === r.id ? 'Сохранить' : 'Изменить' }}</button>
                  <button mat-button (click)="removeContact(r)">Удалить</button>
                }
              </td></ng-container>
              <tr mat-header-row *matHeaderRowDef="contactColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: contactColumns"></tr>
            </table></div>
          </mat-tab>

          <mat-tab label="Услуги ({{ services().length }})">
            <div class="columns-wrap">
              <button mat-stroked-button type="button" class="table-settings" (click)="toggleColumnMenu('services', $event)">Настройки таблицы</button>
              @if (columnMenu === 'services') {
                <div class="picker-back" (click)="columnMenu = ''"></div>
                <div class="picker-menu" role="listbox" aria-label="Столбцы услуг"
                     [style.top.px]="columnMenuTop" [style.left.px]="columnMenuLeft"
                     [style.max-height]="'calc(100vh - ' + (columnMenuTop + 12) + 'px)'">
                  <div class="picker-actions">
                    <button type="button" (click)="setServiceColumns(true)">Отметить все</button>
                    <button type="button" (click)="setServiceColumns(false)">Снять все</button>
                  </div>
                  @for (col of serviceCatalog; track col; let i = $index) {
                    <label>
                      <input type="checkbox" [checked]="serviceVisible(col)" (change)="toggleServiceColumn(col, $any($event.target).checked)" />
                      <span>{{ serviceLabel(col) }}</span>
                      <button type="button" (click)="$event.preventDefault(); moveServiceColumn(i, -1)">↑</button>
                      <button type="button" (click)="$event.preventDefault(); moveServiceColumn(i, 1)">↓</button>
                    </label>
                  }
                </div>
              }
            </div>
            <div class="list-pane service-pane"><table mat-table [dataSource]="services()" appGridResize="card-services" appColumnDrag (columnMove)="dragService($event)">
              <ng-container matColumnDef="report_group_id"><th mat-header-cell *matHeaderCellDef>ID группы отчёта</th><td mat-cell *matCellDef="let s">{{ s.report_group_id ?? '—' }}</td></ng-container>
              <ng-container matColumnDef="netting_mulct_sum"><th mat-header-cell *matHeaderCellDef>Взаимозачет пени <app-byn-sign /></th><td mat-cell *matCellDef="let s"><app-money [value]="s.netting_mulct_sum" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="netting_sum"><th mat-header-cell *matHeaderCellDef>Взаимозачет по услуге <app-byn-sign /></th><td mat-cell *matCellDef="let s"><app-money [value]="s.netting_sum" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="calc_sum"><th mat-header-cell *matHeaderCellDef>Всего начислено <app-byn-sign /></th><td mat-cell *matCellDef="let s"><app-money [value]="s.calc_sum" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="balance_in"><th mat-header-cell *matHeaderCellDef>Вх. сальдо без пени <app-byn-sign /></th><td mat-cell *matCellDef="let s"><app-money [value]="s.balance_in" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="balance_mulct_in"><th mat-header-cell *matHeaderCellDef>Вх. сальдо пени <app-byn-sign /></th><td mat-cell *matCellDef="let s"><app-money [value]="s.balance_mulct_in" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="start_date"><th mat-header-cell *matHeaderCellDef>Дата с</th><td mat-cell *matCellDef="let s">{{ (s.start_date | date: 'dd.MM.yyyy') || '—' }}</td></ng-container>
              <ng-container matColumnDef="stop_date"><th mat-header-cell *matHeaderCellDef>Дата по</th><td mat-cell *matCellDef="let s">{{ (s.stop_date | date: 'dd.MM.yyyy') || '—' }}</td></ng-container>
              <ng-container matColumnDef="balance_mulct_out"><th mat-header-cell *matHeaderCellDef>Исх. сальдо пени <app-byn-sign /></th><td mat-cell *matCellDef="let s" [class.amount-danger]="+s.balance_mulct_out > 0"><app-money [value]="s.balance_mulct_out" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="balance_out"><th mat-header-cell *matHeaderCellDef>Исх. сальдо с пеней <app-byn-sign /></th><td mat-cell *matCellDef="let s"><app-money [value]="s.balance_out" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="service_list_id"><th mat-header-cell *matHeaderCellDef>ID договора</th><td mat-cell *matCellDef="let s">{{ s.service_list_id }}</td></ng-container>
              <ng-container matColumnDef="ais_account_id"><th mat-header-cell *matHeaderCellDef>Код ЛС (ID ЛС)</th><td mat-cell *matCellDef="let s">{{ s.ais_account_id }}</td></ng-container>
              <ng-container matColumnDef="calculation_id"><th mat-header-cell *matHeaderCellDef>Код операции расчета (ID Расчёта)</th><td mat-cell *matCellDef="let s">{{ s.calculation_id ?? '—' }}</td></ng-container>
              <ng-container matColumnDef="provider_id"><th mat-header-cell *matHeaderCellDef>Код поставщика услуги</th><td mat-cell *matCellDef="let s">{{ s.provider_id ?? '—' }}</td></ng-container>
              <ng-container matColumnDef="sort_code"><th mat-header-cell *matHeaderCellDef>Код сортировки</th><td mat-cell *matCellDef="let s">{{ s.sort_code ?? '—' }}</td></ng-container>
              <ng-container matColumnDef="service_id"><th mat-header-cell *matHeaderCellDef>ID услуги</th><td mat-cell *matCellDef="let s">{{ s.service_id }}</td></ng-container>
              <ng-container matColumnDef="debt_period"><th mat-header-cell *matHeaderCellDef>Кол-во периодов долга</th><td mat-cell *matCellDef="let s">{{ s.debt_period ?? '—' }}</td></ng-container>
              <ng-container matColumnDef="shot_name"><th mat-header-cell *matHeaderCellDef>Наименование поставщика</th><td mat-cell *matCellDef="let s">{{ s.shot_name || '—' }}</td></ng-container>
              <ng-container matColumnDef="calc_priv_sum"><th mat-header-cell *matHeaderCellDef>Сумма льготы <app-byn-sign /></th><td mat-cell *matCellDef="let s"><app-money [value]="s.calc_priv_sum" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="service_name"><th mat-header-cell *matHeaderCellDef>Наименование услуги</th>
                <td mat-cell *matCellDef="let s">
                  @if (!auth.showSupplier()) {
                    <a [routerLink]="['/contracts', s.id]">{{ s.service_name }}</a>
                  } @else {
                    {{ s.service_name }}
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="service_name_report"><th mat-header-cell *matHeaderCellDef>Наименование услуги в извещении для дополнительных</th><td mat-cell *matCellDef="let s">{{ s.service_name_report || '—' }}</td></ng-container>
              <ng-container matColumnDef="calc_result_sum"><th mat-header-cell *matHeaderCellDef>Начислено <app-byn-sign /></th><td mat-cell *matCellDef="let s"><app-money [value]="s.calc_result_sum" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="spent_fact"><th mat-header-cell *matHeaderCellDef>Количество</th><td mat-cell *matCellDef="let s">{{ quantity(s.spent_fact) }}</td></ng-container>
              <ng-container matColumnDef="mulct_sum"><th mat-header-cell *matHeaderCellDef>Начислено пени <app-byn-sign /></th><td mat-cell *matCellDef="let s"><app-money [value]="s.mulct_sum" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="recalc_sum"><th mat-header-cell *matHeaderCellDef>Перерасчёт <app-byn-sign /></th><td mat-cell *matCellDef="let s"><app-money [value]="s.recalc_sum" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="mulct_recalc_sum"><th mat-header-cell *matHeaderCellDef>Перерасчет по пене <app-byn-sign /></th><td mat-cell *matCellDef="let s"><app-money [value]="s.mulct_recalc_sum" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="full_name"><th mat-header-cell *matHeaderCellDef>Полное наименование поставщика</th><td mat-cell *matCellDef="let s">{{ s.full_name || '—' }}</td></ng-container>
              <ng-container matColumnDef="overdue_debt"><th mat-header-cell *matHeaderCellDef>Просроченная задолженность <app-byn-sign /></th><td mat-cell *matCellDef="let s"><app-money [value]="s.overdue_debt" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="share_mulct_summ"><th mat-header-cell *matHeaderCellDef>Распределённая оплата пени <app-byn-sign /></th><td mat-cell *matCellDef="let s"><app-money [value]="s.share_mulct_summ" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="share_service_summ"><th mat-header-cell *matHeaderCellDef>Распределённая оплата услуг <app-byn-sign /></th><td mat-cell *matCellDef="let s"><app-money [value]="s.share_service_summ" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="subs_pay"><th mat-header-cell *matHeaderCellDef>Сумма субсидии <app-byn-sign /></th><td mat-cell *matCellDef="let s"><app-money [value]="s.subs_pay" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="tarrif"><th mat-header-cell *matHeaderCellDef>Тариф</th><td mat-cell *matCellDef="let s">{{ tariff(s.tarrif) }}</td></ng-container>
              <ng-container matColumnDef="calc_date"><th mat-header-cell *matHeaderCellDef>Дата расчёта</th><td mat-cell *matCellDef="let s">{{ (s.calc_date | date: 'dd.MM.yyyy') || '—' }}</td></ng-container>
              <ng-container matColumnDef="months_debt"><th mat-header-cell *matHeaderCellDef>Кол-во месяцев долга</th><td mat-cell *matCellDef="let s">{{ s.debt_period ?? '—' }}</td></ng-container>
              <ng-container matColumnDef="supplier"><th mat-header-cell *matHeaderCellDef>Поставщик услуги</th>
                <td mat-cell *matCellDef="let s"><a [routerLink]="['/contracts', s.id]">{{ s.shot_name || '—' }}</a></td></ng-container>
              <ng-container matColumnDef="debt_group"><th mat-header-cell *matHeaderCellDef>Группа задолженности</th>
                <td mat-cell *matCellDef="let s">@if (s.effective_group) { <span class="group-badge g{{ s.effective_group }}">{{ s.effective_group }}</span> } @else { — }</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="visibleServiceColumns()"></tr>
              <tr mat-row *matRowDef="let row; columns: visibleServiceColumns()"></tr>
            </table></div>
          </mat-tab>

          <mat-tab label="Оплата ({{ payments().length }})">
            <div class="columns-wrap">
              <button mat-stroked-button type="button" class="table-settings" (click)="toggleColumnMenu('payments', $event)">Настройки таблицы</button>
              @if (columnMenu === 'payments') {
                <div class="picker-back" (click)="columnMenu = ''"></div>
                <div class="picker-menu" role="listbox" aria-label="Столбцы оплаты"
                     [style.top.px]="columnMenuTop" [style.left.px]="columnMenuLeft"
                     [style.max-height]="'calc(100vh - ' + (columnMenuTop + 12) + 'px)'">
                  <div class="picker-actions">
                    <button type="button" (click)="setPaymentColumns(true)">Отметить все</button>
                    <button type="button" (click)="setPaymentColumns(false)">Снять все</button>
                  </div>
                  @for (col of paymentCatalog; track col; let i = $index) {
                    <label>
                      <input type="checkbox" [checked]="paymentVisible(col)" (change)="togglePaymentColumn(col, $any($event.target).checked)" />
                      <span>{{ paymentLabel(col) }}</span>
                      <button type="button" (click)="$event.preventDefault(); movePaymentColumn(i, -1)">↑</button>
                      <button type="button" (click)="$event.preventDefault(); movePaymentColumn(i, 1)">↓</button>
                    </label>
                  }
                </div>
              }
            </div>
            <div class="list-pane">
              <table class="plain" appGridResize="card-payments" appColumnDrag (columnMove)="dragPayment($event)">
                <thead>
                  @if (paymentHasGroups()) {
                    <tr>
                      @for (cell of paymentGroups(); track cell.key) {
                        @if (cell.span > 1) {
                          <th [attr.colspan]="cell.span">{{ cell.title }}</th>
                        } @else {
                          <th rowspan="2" [attr.data-col]="cell.key">{{ cell.title }}</th>
                        }
                      }
                    </tr>
                    <tr>
                      @for (col of paymentGroupChildren(); track col) {
                        <th [attr.data-col]="col">{{ paymentSub(col) }}</th>
                      }
                    </tr>
                  } @else {
                    <tr>@for (col of visiblePaymentColumns(); track col) { <th [attr.data-col]="col">{{ paymentLabel(col) }}</th> }</tr>
                  }
                </thead>
                <tbody>
                  @for (row of payments(); track row.id) {
                    <tr>@for (col of visiblePaymentColumns(); track col) { <td>{{ paymentCell(row, col) }}</td> }</tr>
                  }
                </tbody>
              </table>
            </div>
          </mat-tab>

          <mat-tab label="Исполнительная надпись">
            <p class="muted tab-note">Новый период создаётся в претензионно-исковой работе, кнопка «Добавить исполнительную надпись». Здесь остаются пакеты этого счёта.</p>
            @if ((writPreview()?.records || []).length > 1) {
              <p class="muted tab-note">По этому счёту несколько пакетов. У каждого свой комплект: почта, документы и архив одного в другом не появляются.</p>
            }
            @for (row of writPreview()?.records || []; track row.id) {
              <article class="writ-pack">
                <div class="writ-pack-head">
                  <button type="button" class="writ-pack-toggle" (click)="toggleWrit(row.id)">
                    <span class="writ-caret" [class.open]="writOpen(row.id)"></span>
                    <span>{{ writTitle(row) }}</span>
                  </button>
                  <a class="writ-pack-go" [routerLink]="['/claims', row.id]" [queryParams]="{ tab: 'pack' }">Перейти в пакет</a>
                  <a class="writ-pack-go" [routerLink]="['/claims', row.id]" [queryParams]="{ tab: 'opi' }">ОПИ</a>
                </div>
                @if (writOpen(row.id)) {
                  <div class="writ-pack-body">
                    @if (!row.debt_from || !row.debt_to) {
                      <span>Его открывает претензионно-исковая работа. Период задолженности здесь не задан.</span>
                    }
                    <span>{{ row.defendant_name }}</span>
                    <span>долг {{ row.principal || '—' }}, пеня {{ row.penalty || '—' }}</span>
                    <span>тариф {{ row.tariff || 'не передано из АИС' }}</span>
                    <span>{{ row.stage_label }}</span>
                    @if (row.opi_number || row.opi_status) {
                      <span>ОПИ: {{ row.opi_number || 'без номера' }} · {{ row.opi_status || 'статус не указан' }}</span>
                    }
                    <span>{{ row.notary_office }}</span>
                    <span>вручение {{ row.warning_delivered_on || '—' }}, акт {{ row.non_delivery_act_on || '—' }}</span>
                    <span>погашение {{ row.repayment_days }} календарных дн.</span>
                    @for (doc of row.documents; track doc.id) { <span>{{ doc.name }}</span> }
                  </div>
                }
              </article>
            } @empty {
              <p class="muted">Пакетов пока нет.</p>
            }
          </mat-tab>

          <mat-tab label="Вложения">
            <p class="muted tab-note">Файлы счёта и документы пакета. «Открыть» показывает файл, «Скачать» сохраняет его. Строка работы без файла остаётся записью.</p>
            @if (auth.canWrite()) {
              <div class="filters">
                <input placeholder="Тип документа" [(ngModel)]="fileType" />
                <input type="file" (change)="onFile($event)" />
              </div>
            }
            <div class="list-pane"><table class="plain" appGridResize="account-files">
              <thead><tr><th data-col="type">Тип</th><th data-col="name">Документ</th><th data-col="when">Когда</th><th data-col="actions"></th></tr></thead>
              <tbody>
                @for (file of files(); track file.id) {
                  <tr>
                    <td>{{ file.doc_type || (file.package ? 'Пакет' : 'Файл') }}</td>
                    <td>{{ file.original_name || 'без имени' }}</td>
                    <td>{{ file.created_at | date: 'dd.MM.yyyy' }}</td>
                    <td>
                      <button type="button" class="text-btn" (click)="openFile(file)">Открыть</button>
                      <button type="button" class="text-btn" (click)="downloadFile(file)">Скачать</button>
                      @if (auth.canWrite() && !file.package) {
                        <button type="button" class="text-btn" (click)="deleteFile(file)">Удалить</button>
                      }
                    </td>
                  </tr>
                }
                @for (row of work(); track row.id) {
                  <tr><td>{{ row.kind_display }}</td><td>{{ row.title }}</td><td>{{ row.started_on | date: 'dd.MM.yyyy' }}</td><td class="muted">запись работы, файла нет</td></tr>
                }
                @if (!files().length && !work().length) {
                  <tr><td colspan="4" class="muted">Вложений пока нет</td></tr>
                }
              </tbody>
            </table></div>
          </mat-tab>

        <mat-tab [label]="'История изменений (' + history().length + ')'">
            <div class="filters">
              <button mat-stroked-button type="button" (click)="historyPane = 'sums'">Суммы задолженности</button>
              <button mat-stroked-button type="button" (click)="historyPane = 'rating'">Группа и рейтинг</button>
              <button mat-stroked-button type="button" (click)="historyPane = 'measure'">Изменение мероприятий</button>
              <button mat-stroked-button type="button" (click)="historyPane = 'other'">Прочие изменения</button>
            </div>
            @if (historyPane === 'sums') {
              <p class="muted tab-note">Текущие остатки по периоду и услуге: основной долг и пеня раздельно. Отдельного журнала «было / стало» по ночным загрузкам нет.</p>
              <div class="list-pane"><table mat-table [dataSource]="balances()" appGridResize="account-balances">
                <ng-container matColumnDef="period"><th mat-header-cell *matHeaderCellDef>Период</th><td mat-cell *matCellDef="let r">{{ r.period | date: 'MM.yyyy' }}</td></ng-container>
                <ng-container matColumnDef="service_name"><th mat-header-cell *matHeaderCellDef>Наименование услуги</th><td mat-cell *matCellDef="let r">{{ r.service_name }}</td></ng-container>
                <ng-container matColumnDef="principal"><th mat-header-cell *matHeaderCellDef>Остаток основного долга <app-byn-sign /></th><td mat-cell *matCellDef="let r"><app-money [value]="r.principal" [blank]="false" /></td></ng-container>
                <ng-container matColumnDef="penalty"><th mat-header-cell *matHeaderCellDef>Остаток пени <app-byn-sign /></th><td mat-cell *matCellDef="let r"><app-money [value]="r.penalty" [blank]="false" /></td></ng-container>
                <tr mat-header-row *matHeaderRowDef="balanceColumns"></tr>
                <tr mat-row *matRowDef="let row; columns: balanceColumns"></tr>
              </table></div>
            } @else {
            <p class="muted tab-note">Группа и рейтинг — отдельно. Этап, сценарий, контакты и остальные изменения — на кнопке «Прочие».</p>
            <div class="list-pane"><table mat-table [dataSource]="historyRows()" appGridResize="account-history">
              <ng-container matColumnDef="created_at"><th mat-header-cell *matHeaderCellDef>Когда</th><td mat-cell *matCellDef="let r">{{ r.created_at | date: 'dd.MM.yyyy HH:mm' }}</td></ng-container>
              <ng-container matColumnDef="kind"><th mat-header-cell *matHeaderCellDef>Что</th><td mat-cell *matCellDef="let r">{{ historyKind(r.kind) }}</td></ng-container>
              <ng-container matColumnDef="old_value"><th mat-header-cell *matHeaderCellDef>Было</th><td mat-cell *matCellDef="let r">{{ historyValue(r.kind, r.old_value) }}</td></ng-container>
              <ng-container matColumnDef="new_value"><th mat-header-cell *matHeaderCellDef>Стало</th><td mat-cell *matCellDef="let r">{{ historyValue(r.kind, r.new_value) }}</td></ng-container>
              <ng-container matColumnDef="reason"><th mat-header-cell *matHeaderCellDef>Основание</th><td mat-cell *matCellDef="let r">{{ r.reason }}@if (r.author_name) { · {{ r.author_name }} }</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="historyColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: historyColumns"></tr>
            </table></div>
            }
          </mat-tab>
        </mat-tab-group>

        @if (sharesOpen()) {
          <div class="backdrop" (click)="sharesOpen.set(false)">
            <div class="dialog" (click)="$event.stopPropagation()" role="dialog" aria-label="Состав долга">
              <h3>Кому должен лицевой счёт {{ a.client_account }}</h3>
              <div class="list-pane"><table class="shares" appGridResize="account-shares">
                <thead><tr><th data-col="supplier">Краткое наименование поставщика</th><th data-col="principal">Исходящее сальдо с пенями <app-byn-sign /></th><th data-col="penalty">Исходящее сальдо пени <app-byn-sign /></th><th data-col="total">Итого <app-byn-sign /></th></tr></thead>
                <tbody>
                  @for (row of shares(); track row.provider_name + row.principal + row.penalty) {
                    <tr>
                      <td>{{ row.provider_name }}</td>
                      <td><app-money [value]="row.principal" [blank]="false" /></td>
                      <td [class.amount-danger]="+row.penalty > 0"><app-money [value]="row.penalty" [blank]="false" /></td>
                      <td><app-money [value]="row.total" [blank]="false" /></td>
                    </tr>
                  }
                  @if (!shares().length) {
                    <tr><td colspan="4">Долг по поставщикам не разложен</td></tr>
                  }
                </tbody>
              </table></div>
              <div class="dialog-actions">
                <button mat-stroked-button type="button" (click)="sharesOpen.set(false)">Закрыть</button>
              </div>
            </div>
          </div>
        }
      }
      <app-funnel-gate-dialog [gate]="gate()" (go)="openGate()" (closed)="gate.set(null)" />
    </div>
  `,
  styles: `
    .crumbs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; color: var(--erip-muted); margin-bottom: 12px; }
    .uen { margin: 0 0 8px; color: #6b7280; font-size: 13px; }
    .contact-add { align-items: center; }
    .framed { border: 1px solid var(--erip-border); border-radius: 8px; padding: 12px; margin-top: 12px; }
    .invalid { outline: 2px solid #c62828; border-radius: 4px; }
    .step-no {
      width: 28px; height: 28px; border-radius: 50%; border: 2px solid #1d4f63; background: #fff; color: #1d4f63;
      font-weight: 700; cursor: pointer;
    }
    .step-no.on { background: #1d4f63; color: #fff; }
    .contact-mode { margin-left: auto; }
    .writ-pack { border: 1px solid var(--erip-border); border-radius: 8px; margin: 8px 0; background: #fff; }
    .writ-pack-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }
    .writ-pack-toggle { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; padding: 0; border: 0; background: transparent; cursor: pointer; font: inherit; font-weight: 700; text-align: left; color: inherit; }
    .writ-caret { width: 0; height: 0; border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 7px solid currentColor; flex: 0 0 auto; }
    .writ-caret.open { transform: rotate(90deg); }
    .writ-pack-go { flex: 0 0 auto; padding: 4px 10px; border: 1px solid var(--erip-border); border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 600; color: var(--erip-link); background: #fff; }
    .writ-pack-body { display: flex; flex-direction: column; gap: 4px; padding: 0 12px 10px 34px; }
    .step { border: 1px solid var(--erip-border); border-radius: 8px; margin: 8px 0; padding: 8px 12px; background: #fff; }
    .step summary { cursor: pointer; font-weight: 600; }
    .step-measure { display: flex; flex-direction: column; align-items: stretch; gap: 4px; margin: 8px 0; }
    .step-measure.focus { background: #e7f4f1; border-radius: 8px; padding: 4px 8px; }
    .step-head, .check-line, .step-summary { display: flex; gap: 12px; align-items: center; margin: 6px 0; }
    button.check-go { width: 100%; border: 0; background: transparent; padding: 0; cursor: pointer; font: inherit; text-align: left; color: var(--erip-link); text-decoration: underline; }
    .pause-btn { margin-left: auto; }
    .pause-box { position: fixed; z-index: 40; left: 50%; top: 20vh; transform: translateX(-50%); background: #fff; border: 1px solid var(--erip-border); border-radius: 8px; padding: 16px; display: grid; gap: 8px; min-width: 320px; }
    .table-settings { margin: 0 0 8px; }
    .sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px 16px; }
    .sheet dt { color: var(--erip-muted); font-size: 12px; }
    .sheet dd { margin: 0; }
    .picker { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 8px 0 12px; }
    .picker label { display: flex; gap: 6px; align-items: center; }
    .columns-wrap { position: relative; display: inline-block; margin: 8px 0; }
    .picker-back { position: fixed; inset: 0; z-index: 20; }
    .picker-menu {
      position: fixed; z-index: 21; width: 360px; overflow: auto; background: #fff;
      border: 1px solid var(--erip-border); border-radius: 6px;
      box-shadow: 0 8px 24px rgba(16, 42, 67, .16); padding: 6px 0;
    }
    .picker-actions { display: flex; gap: 8px; padding: 4px 12px 8px; }
    .picker-actions button { border: 0; background: transparent; color: var(--erip-link); cursor: pointer; font: inherit; }
    .picker-menu label { display: flex; gap: 8px; align-items: center; padding: 4px 12px; font-size: 13px; }
    .picker-menu label span { flex: 1; }
    .picker-menu label button { border: 0; background: transparent; cursor: pointer; }
    table.plain { border-collapse: collapse; width: max-content; min-width: 100%; }
    table.plain th, table.plain td { border-bottom: 1px solid var(--erip-border); padding: 6px 10px; text-align: left; white-space: nowrap; }
    table.plain th { background: #f7f9fb; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .02em; color: #5c6b7a; }
    .text-btn { border: 0; background: transparent; color: var(--erip-link); cursor: pointer; font: inherit; font-size: 13px; padding: 0 10px 0 0; }
    .crumbs b { color: #1f2933; }
    .sep { opacity: .6; }
    .spacer { flex: 1; }
    .head { padding: 20px 24px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 16px; }
    .stage-line { display: flex; flex-wrap: nowrap; align-items: center; gap: 10px 12px; min-width: 0; overflow-x: auto; }
    .stage-line h2 { margin: 0; font-size: 26px; font-weight: 700; color: #1a2332; white-space: nowrap; flex: 0 0 auto; }
    .title-tools { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; flex: 0 0 auto; }
    .stage-line app-funnel-bar { margin-left: auto; flex: 0 0 auto; }
    .debtor-top { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(280px, .85fr); gap: 12px 40px; align-items: start; }
    .who h2 { margin: 0 0 6px; font-size: 26px; font-weight: 700; color: #1a2332; }
    .identity { margin: 0 0 14px; color: var(--erip-muted); font-size: 13px; }
    .meta { display: flex; flex-direction: column; gap: 2px; margin-top: 12px; }
    .k { font-size: 12px; color: var(--erip-muted); }
    .who-side { display: flex; flex-direction: column; align-items: flex-end; gap: 12px; }
    .who-side .badges { justify-content: flex-end; flex-wrap: wrap; }
    .side-meta { align-items: flex-end; text-align: right; }
    .sum-block { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
    .sum { font-size: 22px; font-weight: 700; color: #1a2332; }
    .penalty-note { margin-left: 6px; font-size: 14px; font-weight: 500; color: #3d4c5c; }
    .pill {
      display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 12px;
      border: 1px solid #c5d0d8; background: #fff; color: #3d4c5c; font-size: 12px; font-weight: 600;
    }
    .pill.job { border-color: transparent; background: #e5f6ea; color: #1b7a3a; }
    .pill.idle { border-color: transparent; background: var(--erip-warning-soft); color: var(--erip-warning); }
    .ls-wrap { padding: 8px 0 4px; }
    table.ls { width: 100%; border-collapse: collapse; font-size: 14px; }
    table.ls th {
      text-align: left; font-size: 12px; font-weight: 600; color: var(--erip-muted);
      text-transform: uppercase; letter-spacing: .02em; padding: 8px 10px; border-bottom: 1px solid var(--erip-border);
    }
    table.ls td { padding: 10px; border-bottom: 1px solid var(--erip-border); vertical-align: middle; }
    table.ls tr.current { background: #f4faf6; }
    table.ls .num { text-align: right; white-space: nowrap; }
    table.ls .total { font-weight: 700; }
    .ls-no { white-space: nowrap; font-weight: 600; }
    .arrow { color: var(--erip-muted); font-weight: 400; }
    .group-pill {
      display: inline-block; padding: 2px 8px; border-radius: 10px; background: #e5f6ea;
      color: #1b7a3a; font-size: 12px; font-weight: 700;
    }
    .split { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 22px; }
    .split h4, .enrich-title { margin: 0 0 10px; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: #5c6b7a; }
    .contact-line { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; flex-wrap: wrap; }
    .contact-line mat-icon { width: 18px; height: 18px; font-size: 18px; color: var(--erip-primary); }
    .contact-value { font-weight: 600; }
    .tag { display: inline-flex; padding: 1px 8px; border-radius: 10px; background: #eef2f5; color: #5c6b7a; font-size: 12px; }
    .tag.hot { background: var(--erip-accent-soft); color: var(--erip-warning); }
    .flag { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 8px; }
    .mark { width: 16px; color: #9aa5b1; font-weight: 700; }
    .flag.bad .mark { color: var(--erip-danger); }
    .mark.ok { color: var(--erip-success); }
    .enrich-title { margin-top: 22px; }
    .enrich-note { margin: 0 0 10px; font-size: 13px; }
    .enrich { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .enrich article { border: 1px solid var(--erip-border); border-radius: 8px; padding: 12px 14px; background: #fff; }
    .enrich h5 { margin: 0 0 8px; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #5c6b7a; font-weight: 700; }
    .foot { margin: 8px 0 0; font-size: 12px; color: var(--erip-muted); }
    @media (max-width: 960px) {
      .debtor-top, .split, .enrich { grid-template-columns: 1fr; }
      .who-side, .side-meta, .sum-block { align-items: flex-start; text-align: left; }
    }
    .title-row { display: flex; align-items: flex-start; gap: 16px; }
    .title-row > div:first-child { flex: 1; }
    .title-row h2 { margin: 0 0 4px; font-size: 22px; color: var(--erip-primary-dark); }
    .sub { font-size: 13px; }
    .badges { display: flex; align-items: center; gap: 8px; }
    .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 0 48px; }
    .fact { display: flex; flex-direction: column; align-items: flex-start; padding: 6px 0; }
    .fact span { font-size: 12px; color: var(--erip-muted); }
    .fact b, .fact .sum-btn {
      font-family: inherit; font-size: 15px; font-weight: 600; font-style: normal;
      line-height: 1.3; letter-spacing: normal;
    }
    dd.money-line, dd.money-line .sum-btn {
      font-family: inherit; font-size: inherit; font-weight: 600; font-style: normal;
      line-height: inherit; letter-spacing: normal;
    }
    .fact b.link { color: var(--erip-link); }
    .sum-btn {
      appearance: none; display: inline; box-sizing: border-box; width: auto; min-width: 0;
      margin: 0; padding: 0; border: 0; background: transparent; color: inherit;
      text-align: left; vertical-align: baseline; cursor: pointer;
      text-decoration: underline; text-underline-offset: 2px;
    }
    .tab-note { margin: 12px 0 8px; font-size: 13px; line-height: 1.45; max-width: 760px; }
    .service-pane table { width: max-content; min-width: 100%; }
    .service-pane .mat-mdc-header-cell,
    .service-pane .mat-mdc-cell { white-space: nowrap; }
    .backdrop {
      position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center;
      background: rgba(20, 40, 55, .35);
    }
    .dialog { width: min(560px, calc(100vw - 32px)); background: #fff; border-radius: 8px; padding: 20px; box-shadow: 0 12px 32px rgba(16, 42, 67, .2); }
    .dialog h3 { margin: 0 0 12px; color: var(--erip-primary-dark); }
    .shares { width: 100%; border-collapse: collapse; font-size: 14px; }
    .shares th, .shares td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--erip-border); }
    .shares th:not(:first-child), .shares td:not(:first-child) { text-align: right; }
    .dialog-actions { display: flex; justify-content: flex-end; margin-top: 12px; }
    .tabs { padding: 4px 16px 16px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px 0; }
    .grid mat-card { border: 1px solid var(--erip-border); box-shadow: none; }
    dl { display: grid; grid-template-columns: 220px 1fr; row-gap: 6px; margin: 0; }
    dt { color: var(--erip-muted); } dd { margin: 0; }
    .amount-paid { color: var(--erip-success); font-weight: 600; }
    .checklist { padding: 16px 0; display: flex; flex-direction: column; gap: 4px; }
    .progress-label { font-size: 13px; color: var(--erip-muted); }
    .progress { height: 6px; border-radius: 3px; background: #e5e9ee; margin: 6px 0 10px; overflow: hidden; }
    .progress > div { height: 100%; background: var(--erip-accent); transition: width .3s; }
    .check { border-bottom: 1px solid var(--erip-border); padding: 4px 0; }
    .check.done { color: var(--erip-muted); }
    .checklist .alert { margin-top: 12px; }
    .reason { min-width: 280px; }
    .category-field { min-width: min(640px, 100%); flex: 1 1 420px; }
    .notify { display: flex; gap: 12px; align-items: center; padding: 16px 0; }
  `,
})
export class AccountDetailComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly auth = inject(AuthService);
  protected skipReason = '';
  private readonly snack = inject(MatSnackBar);
  readonly id = input.required<string>();

  protected readonly tabIndex = signal(0);
  protected readonly account = signal<AccountDetail | null>(null);
  protected readonly peers = signal<AccountRow[] | null>(null);
  protected readonly shares = signal<DebtShare[]>([]);
  protected readonly sharesOpen = signal(false);
  protected readonly services = signal<AccountService[]>([]);
  protected readonly payments = signal<Payment[]>([]);
  protected readonly registrations = signal<Registration[]>([]);
  protected readonly templates = signal<MessageTemplate[]>([]);
  protected readonly error = signal('');
  protected readonly gate = signal<FunnelGateInfo | null>(null);
  protected readonly sending = signal(false);
  protected readonly activities = signal<ActivityBoard | null>(null);
  protected readonly activitiesLoading = signal(false);
  protected readonly focusMeasure = signal<number | null>(null);
  protected readonly focusActivity = signal('');
  protected readonly serviceColumns = this.accountServiceColumns();
  protected readonly paymentColumns = ['pay_date', 'service_name', 'pay_service_summ', 'pay_mulct_summ', 'bank_name', 'payment_type_display'];
  protected readonly registrationColumns = ['full_name', 'debtor_role', 'birthday', 'relation_degree_name', 'reg_type_name', 'contacts'];
  protected readonly balanceColumns = ['period', 'service_name', 'principal', 'penalty'];
  protected readonly historyColumns = ['created_at', 'kind', 'old_value', 'new_value', 'reason'];
  protected readonly workColumns = ['kind_display', 'title', 'started_on', 'ended_on', 'principal', 'penalty', 'paid_principal'];
  protected readonly contactColumns = ['kind', 'value', 'source', 'priority', 'actions'];
  protected readonly fileColumns = ['doc_type', 'original_name'];
  protected assigneeInitials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
  }

  protected assigneeTone(name: string): number {
    let sum = 0;
    for (const ch of name) sum += ch.charCodeAt(0);
    return sum % 5;
  }
  protected readonly balances = signal<BalanceRow[]>([]);
  protected readonly history = signal<HistoryRow[]>([]);
  protected readonly work = signal<WorkItem[]>([]);
  protected readonly contacts = signal<ContactRow[]>([]);
  protected readonly files = signal<AttachmentRow[]>([]);
  protected readonly categories = signal<DebtorCategory[]>([]);
  protected readonly categoryGroups = categoryGroups;
  protected readonly measures = signal<MeasureRow[]>([]);
  protected readonly scenario = signal<ScenarioBoard | null>(null);
  protected readonly writ = signal<WritDraft | null>(null);
  private readonly openWrits = signal<ReadonlySet<number>>(new Set());
  protected readonly checks = signal<{ code: string; title: string; done: boolean }[]>([]);
  protected workTab = 'docs';
  protected workPrincipal = '';
  protected workPenalty = '';
  protected workPaid = '';
  protected workFrom = '';
  protected workTo = '';
  protected contactMode = 'combined';
  protected contactValue = '';
  protected contactKind = 'mobile';
  protected editingContactId: number | null = null;
  protected categoryId: number | null = null;
  protected newCategory = '';
  protected categoryText = '';
  protected groupInvalid = false;
  protected contactInvalid = false;
  protected historyPane: 'sums' | 'rating' | 'measure' | 'other' = 'sums';
  protected readonly extraCatalog = signal<{ id: number; name: string }[]>([]);
  protected extraCatalogId: number | null = null;
  protected pauseFor: ScenarioMeasure | null = null;
  protected pauseUntil = '';
  protected pauseReason = '';
  protected residence = '';
  protected inheritance = false;
  protected inheritanceUntil = '';
  protected fileType = 'Скан';
  protected manualGroup: number | null = null;
  protected manualReason = '';
  protected templateId: number | null = null;
  protected columnMenu = '';
  protected columnMenuTop = 0;
  protected columnMenuLeft = 0;
  protected warningDelivered = '';
  protected warningFile: File | null = null;
  protected readonly serviceCatalog = this.accountServiceColumns();
  private serviceHidden = new Set(['months_debt', 'supplier', 'debt_group']);
  private paymentHidden = new Set<string>();

  private accountServiceColumns(): string[] {
    return [
      'service_list_id', 'service_id', 'service_name', 'provider_id', 'shot_name',
      'start_date', 'stop_date', 'tarrif', 'spent_fact', 'calc_sum', 'calc_result_sum',
      'calc_priv_sum', 'mulct_sum', 'recalc_sum', 'netting_sum',
      'balance_in', 'balance_mulct_in', 'balance_mulct_out', 'balance_out',
      'subs_pay', 'calc_date', 'mulct_recalc_sum', 'overdue_debt', 'debt_period',
      'share_service_summ', 'share_mulct_summ',
      'report_group_id', 'netting_mulct_sum', 'ais_account_id', 'calculation_id',
      'sort_code', 'service_name_report', 'full_name',
      'months_debt', 'supplier', 'debt_group',
    ];
  }

  protected skipStep(): void {
    const reason = this.skipReason.trim();
    if (!reason) {
      this.snack.open('Укажите причину пропуска', 'OK');
      return;
    }
    const id = Number(this.id());
    this.api.skipScenarioStep(id, reason).subscribe({
      next: () => {
        this.skipReason = '';
        this.snack.open('Шаг сценария пропущен', 'OK', { duration: 2500 });
        this.api.accountMeasures(id).subscribe({ next: (page) => this.measures.set(page.results) });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private readonly loadedParts = new Set<string>();

  ngOnInit(): void {
    const id = Number(this.id());
    const started = performance.now();
    this.api.account(id).subscribe({
      next: (account) => {
        this.applyAccount(account);
        agentDbg('A', 'account-detail.component.ts:ngOnInit', 'card visible', {
          ms: Math.round(performance.now() - started),
        });
        const tab = this.route.snapshot.queryParamMap.get('tab');
        const measure = Number(this.route.snapshot.queryParamMap.get('measure') || '');
        const activity = this.route.snapshot.queryParamMap.get('activity') || '';
        this.loadHeader(id);
        const named = this.tabIndexOf(tab);
        if (measure) this.focusMeasure.set(measure);
        if (activity) this.focusActivity.set(activity);
        this.tabIndex.set(named);
        this.ensureTab(named);
      },
      error: (e) => {
        agentDbg('A', 'account-detail.component.ts:ngOnInit', 'card forkJoin failed', {
          totalMs: Math.round(performance.now() - started),
          marks: {},
        });
        this.error.set(errorMessage(e));
      },
    });
  }

  protected openTab(index: number): void {
    this.tabIndex.set(index);
    this.ensureTab(index);
  }

  protected openAssignedMeasure(id: number): void {
    this.focusMeasure.set(id);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: 'measures', measure: id },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.openTab(3);
    this.scrollMeasure(id);
  }

  private scrollMeasure(id: number): void {
    setTimeout(() => document.getElementById(`measure-${id}`)?.scrollIntoView({ block: 'nearest' }), 0);
  }

  private applyAccount(account: AccountDetail): void {
    this.account.set(account);
    this.manualGroup = account.debt_group_manual;
    this.manualReason = account.debt_group_manual_reason;
    this.contactMode = account.contact_source_mode || 'combined';
    this.categoryId = account.debtor_category;
    this.residence = account.residence_note;
    this.inheritance = account.inheritance_case;
    this.inheritanceUntil = this.showDate(account.inheritance_until);
  }

  private loadHeader(id: number): void {
    if (this.loadedParts.has('header')) return;
    this.loadedParts.add('header');
    const started = performance.now();
    const marks: Record<string, number> = {};
    const timed = <T>(name: string, source: Observable<T>): Observable<T> => {
      const mark = performance.now();
      return source.pipe(finalize(() => {
        marks[name] = Math.round(performance.now() - mark);
      }));
    };
    forkJoin({
      services: timed('services', this.api.accountServices(id, false)),
      registrations: timed('registrations', this.api.accountRegistrations(id)),
      categories: timed('categories', this.api.categories()),
    }).subscribe({
      next: (r) => {
        agentDbg('A', 'account-detail.component.ts:ngOnInit', 'card forkJoin', {
          totalMs: Math.round(performance.now() - started),
          marks,
        });
        this.services.set(r.services.results);
        this.registrations.set(r.registrations.results);
        this.categories.set(r.categories.results);
        if (!this.categoryText) {
          const saved = this.account()?.debtor_category_name?.trim() || '';
          this.categoryText = r.categories.results.find((item) => item.id === this.categoryId)?.name ?? saved;
        }
        const account = this.account();
        if (account) this.loadPeers(account);
      },
      error: () => {
        this.loadedParts.delete('header');
        agentDbg('A', 'account-detail.component.ts:ngOnInit', 'card forkJoin failed', {
          totalMs: Math.round(performance.now() - started),
          marks,
        });
      },
    });
  }

  private ensureTab(index: number): void {
    const id = Number(this.id());
    if (!id) return;
    const key = `tab-${index}`;
    if (this.loadedParts.has(key)) return;
    const started = performance.now();
    const marks: Record<string, number> = {};
    const timed = <T>(name: string, source: Observable<T>): Observable<T> => {
      const mark = performance.now();
      return source.pipe(finalize(() => {
        marks[name] = Math.round(performance.now() - mark);
      }));
    };
    const batch = this.tabBatch(index, id, timed);
    if (!batch) return;
    if (index === 0) this.activitiesLoading.set(true);
    this.loadedParts.add(key);
    forkJoin(batch).subscribe({
      next: (result) => {
        agentDbg('A', 'account-detail.component.ts:ensureTab', 'card forkJoin', {
          totalMs: Math.round(performance.now() - started),
          tab: index,
          marks,
        });
        this.applyTab(index, result);
      },
      error: () => {
        if (index === 0) this.activitiesLoading.set(false);
        this.loadedParts.delete(key);
        agentDbg('A', 'account-detail.component.ts:ensureTab', 'card forkJoin failed', {
          totalMs: Math.round(performance.now() - started),
          tab: index,
          marks,
        });
      },
    });
  }

  private tabBatch(
    index: number,
    id: number,
    timed: <T>(name: string, source: Observable<T>) => Observable<T>,
  ): Record<string, Observable<unknown>> | null {
    if (index === 0) return { activities: timed('activities', this.api.accountActivities(id)) };
    if (index === 3) {
      const batch: Record<string, Observable<unknown>> = {
        scenario: timed('scenario', this.api.accountScenario(id)),
        measures: timed('measures', this.api.accountMeasures(id)),
        templates: timed('templates', this.api.templates({ is_active: true, page_size: 100 })),
      };
      if (this.auth.canWrite()) batch['extra'] = timed('extra', this.api.extraMeasureCatalog());
      return batch;
    }
    if (index === 4) return { contacts: timed('contacts', this.api.accountContacts(id)) };
    if (index === 5) return { serviceColumns: timed('serviceColumns', this.api.cardColumns('services')) };
    if (index === 6) {
      return {
        payments: timed('payments', this.api.accountPayments(id)),
        paymentColumns: timed('paymentColumns', this.api.cardColumns('payments')),
      };
    }
    if (index === 7) {
      return {
        writ: timed('writ', this.api.writDraft(id)),
        checks: timed('checks', this.api.writChecks(id)),
      };
    }
    if (index === 8) {
      return {
        files: timed('files', this.api.accountFiles(id)),
        work: timed('work', this.api.accountWork(id)),
      };
    }
    if (index === 9) {
      return {
        history: timed('history', this.api.accountHistory(id)),
        balances: timed('balances', this.api.accountBalances(id)),
      };
    }
    return null;
  }

  private applyTab(index: number, result: Record<string, unknown>): void {
    if (index === 0) {
      this.activities.set(result['activities'] as ActivityBoard);
      this.activitiesLoading.set(false);
    } else if (index === 3) {
      const scenario = result['scenario'] as ScenarioBoard;
      const measures = result['measures'] as { results: MeasureRow[] };
      const templates = result['templates'] as { results: MessageTemplate[] };
      this.scenario.set(scenario);
      this.measures.set(measures.results);
      const group = this.account()?.effective_group;
      const list = templates.results.filter((item) => (['email', 'sms', 'voice'] as Channel[]).includes(item.channel));
      const forGroup = group == null ? [] : list.filter((item) => item.debt_group === group);
      this.templates.set(forGroup.length ? forGroup : list);
      this.templateId = (forGroup[0] ?? list[0])?.id ?? null;
      const extra = result['extra'] as { results: { id: number; name: string }[] } | undefined;
      if (extra) {
        this.extraCatalog.set(extra.results);
        this.extraCatalogId = extra.results[0]?.id ?? null;
      }
      const focused = this.focusMeasure();
      if (focused) this.scrollMeasure(focused);
    } else if (index === 4) {
      this.contacts.set((result['contacts'] as { results: ContactRow[] }).results);
    } else if (index === 5) {
      this.applyCardColumns('services', result['serviceColumns'] as ColumnPrefs);
    } else if (index === 6) {
      this.payments.set((result['payments'] as { results: Payment[] }).results);
      this.applyCardColumns('payments', result['paymentColumns'] as ColumnPrefs);
    } else if (index === 7) {
      this.writ.set(result['writ'] as WritDraft);
      this.checks.set(result['checks'] as { code: string; title: string; done: boolean }[]);
    } else if (index === 8) {
      this.files.set((result['files'] as { results: AttachmentRow[] }).results);
      this.work.set((result['work'] as { results: WorkItem[] }).results);
    } else if (index === 9) {
      this.history.set((result['history'] as { results: HistoryRow[] }).results);
      this.balances.set((result['balances'] as { results: BalanceRow[] }).results);
    }
  }

  refreshNow(): void {
    const a = this.account();
    if (!a) return;
    this.api.refreshAccount(a.id).subscribe({
      next: () => {
        this.api.account(a.id).subscribe({ next: (row) => this.applyAccount(row) });
        this.loadedParts.delete('tab-0');
        if (this.tabIndex() === 0) this.ensureTab(0);
        this.snack.open('Данные ЛС пересчитаны по последней загруженной выгрузке АИС', 'OK', { duration: 4000 });
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  protected canChangeStage(): boolean {
    return this.auth.canSkip() && this.auth.me()?.contour !== 'supplier';
  }

  protected canAct(): boolean {
    const role = this.auth.me()?.role ?? '';
    return ['superadmin', 'local_admin', 'specialist', 'legal'].includes(role);
  }

  protected changeStage(stage: string): void {
    const account = this.account();
    if (!account || !this.canChangeStage()) return;
    this.api.updateAccount(account.id, { funnel_stage: stage }).subscribe({
      next: (saved) => {
        this.applyAccount(saved);
        this.loadedParts.delete('tab-0');
        this.loadedParts.delete('tab-3');
        if (this.tabIndex() === 0) this.ensureTab(0);
        this.snack.open('Этап изменён', 'OK', { duration: 2000 });
      },
      error: (e) => {
        const blocked = funnelGate(e);
        if (blocked) {
          this.gate.set(blocked.accountId ? blocked : { ...blocked, accountId: account.id });
          return;
        }
        this.snack.open(errorMessage(e), 'OK');
      },
    });
  }

  protected openGate(): void {
    const blocked = this.gate();
    this.gate.set(null);
    if (!blocked) return;
    const target = gateTarget(blocked);
    if (!target) return;
    const here = this.account()?.id;
    const stays = target.path[0] === '/accounts' && here && Number(target.path[1]) === here;
    if (!stays) {
      this.router.navigate(target.path, { queryParams: target.query });
      return;
    }
    if (target.query['activity']) this.focusActivity.set(target.query['activity']);
    if (target.query['measure']) this.focusMeasure.set(Number(target.query['measure']));
    const index = this.tabIndexOf(target.query['tab'] || 'activities');
    this.loadedParts.delete(`tab-${index}`);
    this.openTab(index);
  }

  private tabIndexOf(tab: string | null): number {
    if (tab === 'measures') return 3;
    if (tab === 'writ') return 7;
    return 0;
  }

  protected changeParallel(stage: string): void {
    const account = this.account();
    if (!account || !this.canChangeStage()) return;
    this.api.updateAccount(account.id, { parallel_stage: stage }).subscribe({
      next: (saved) => {
        this.applyAccount(saved);
        this.loadedParts.delete('tab-0');
        if (this.tabIndex() === 0) this.ensureTab(0);
      },
      error: (e) => {
        const blocked = funnelGate(e);
        if (blocked) {
          this.gate.set(blocked.accountId ? blocked : { ...blocked, accountId: account.id });
          return;
        }
        this.snack.open(errorMessage(e), 'OK');
      },
    });
  }

  protected actOn(event: { id: number; note: string; file?: File }): void {
    const account = this.account();
    if (!account) return;
    this.api.actOnActivity(account.id, event.id, event.note, event.file).subscribe({
      next: (board) => this.activities.set(board),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  protected historyValue(kind: string, value: string): string {
    if (!value) return '—';
    if (kind === 'funnel') return funnelTitle(value);
    return value;
  }

  loadWork(): void {
    const a = this.account();
    if (!a) return;
    const kinds: Record<string, string> = {
      docs: 'warning,disconnect,writ,claim,closure',
      impossibility: 'impossibility',
      calculation: 'calculation',
      payment: 'enforcement_payment',
    };
    this.api.accountWork(a.id, {
      kinds: kinds[this.workTab] ?? '',
      principal_min: this.workPrincipal,
      penalty_min: this.workPenalty,
      paid_min: this.workPaid,
      started_from: this.workFrom,
      started_to: this.workTo,
    }).subscribe((page) => this.work.set(page.results));
  }

  addWork(): void {
    const a = this.account();
    if (!a) return;
    const kind = this.workTab === 'impossibility' ? 'impossibility'
      : this.workTab === 'calculation' ? 'calculation'
      : this.workTab === 'payment' ? 'enforcement_payment' : 'warning';
    this.api.saveWork({ account: a.id, kind, title: 'Документ' }).subscribe({
      next: () => this.loadWork(),
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
    if (this.editingContactId) {
      const row = this.contacts().find((item) => item.id === this.editingContactId);
      if (row) this.editContact(row);
      return;
    }
    const a = this.account();
    if (!a || !this.contactValue.trim()) {
      this.contactInvalid = true;
      return;
    }
    this.contactInvalid = false;
    this.api.saveContact({ account: a.id, kind: this.contactKind, value: this.contactValue.trim() }).subscribe({
      next: () => {
        this.contactValue = '';
        this.api.accountContacts(a.id).subscribe((page) => this.contacts.set(page.results));
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  editContact(row: ContactRow): void {
    if (this.editingContactId !== row.id) {
      this.editingContactId = row.id;
      this.contactValue = row.value;
      this.contactKind = row.kind;
      return;
    }
    const value = this.contactValue.trim();
    if (!value) return;
    this.api.saveContact({ id: row.id, account: this.account()?.id, kind: this.contactKind, value }).subscribe({
      next: () => {
        this.contactValue = '';
        this.editingContactId = null;
        const a = this.account();
        if (a) this.api.accountContacts(a.id).subscribe((page) => this.contacts.set(page.results));
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  removeContact(row: ContactRow): void {
    const a = this.account();
    if (!a) return;
    this.api.deleteContact(row.id).subscribe({
      next: () => this.api.accountContacts(a.id).subscribe((page) => this.contacts.set(page.results)),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  protected categoryMatches() {
    const text = this.categoryText.trim().toLowerCase();
    const rows = this.categories();
    if (!text) return rows;
    return rows.filter((item) => item.name.toLowerCase().includes(text));
  }

  protected pickCategory(name: string): void {
    const found = this.categories().find((item) => item.name === name);
    this.categoryId = found?.id ?? null;
    this.categoryText = name;
  }

  protected applyCategory(): void {
    const name = this.categoryText.trim();
    if (!name) return;
    const found = this.categories().find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (found) {
      this.categoryId = found.id;
      this.categoryText = found.name;
      return;
    }
    const saved = this.account()?.debtor_category_name?.trim() || '';
    if (this.categoryId && saved.toLowerCase() === name.toLowerCase()) return;
    this.newCategory = name;
    this.addCategory();
  }

  protected clearCategory(): void {
    this.categoryId = null;
    this.categoryText = '';
  }

  addCategory(): void {
    const name = this.newCategory.trim();
    if (!name) return;
    const code = name.toLowerCase().replace(/\s+/g, '-').slice(0, 40);
    this.api.saveCategory({ code, name }).subscribe({
      next: (row) => {
        this.categories.update((items) => [...items, row]);
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
        this.categories.update((items) => items.filter((item) => item.id !== this.categoryId));
        this.categoryId = null;
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  toggleCheck(code: string, done: boolean): void {
    const a = this.account();
    if (!a) return;
    this.api.saveWritCheck(a.id, code, done).subscribe({
      next: (rows) => this.checks.set(rows),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  protected stageTitle(code: string): string {
    return funnelTitle(code);
  }

  protected shownAccounts(): AccountRow[] {
    const current = this.currentAccountRow();
    const loaded = this.peers();
    if (!loaded) return current ? [current] : [];
    if (!current || loaded.some((row) => row.id === current.id)) return loaded;
    return [current, ...loaded];
  }

  protected rowTotal(row: AccountRow): number {
    if (row.obligation_total != null && row.obligation_total !== '') return Number(row.obligation_total);
    return Number(row.debt_total ?? 0) + Number(row.mulct_total ?? 0);
  }

  protected portfolioPenalty(): number {
    return this.shownAccounts().reduce((sum, row) => sum + Number(row.mulct_total ?? 0), 0);
  }

  protected portfolioTotal(): number {
    return this.shownAccounts().reduce((sum, row) => sum + this.rowTotal(row), 0);
  }

  protected mainPerson(): Registration | undefined {
    const people = this.registrations();
    return people.find((row) => row.subj_is_main) ?? people[0];
  }

  protected isLegal(): boolean {
    const person = this.mainPerson();
    if (person) return person.subj_legal_entity;
    const account = this.account();
    return !!account?.payer_unp && !account.payer_identifier;
  }

  protected personKind(): string {
    return this.isLegal() ? 'Юридическое лицо' : 'Физическое лицо';
  }

  protected personKindPlural(): string {
    return this.isLegal() ? 'Юридические лица' : 'Физические лица';
  }

  protected personName(): string {
    const account = this.account();
    const person = this.mainPerson();
    if (person?.full_name?.trim()) return person.full_name.trim();
    return account?.short_fio || (account ? `ЛС ${account.client_account}` : '');
  }

  protected identityNumber(): string {
    const account = this.account();
    if (!account) return '';
    return this.isLegal() ? account.payer_unp : account.payer_identifier;
  }

  protected identityCaption(): string {
    return this.isLegal() ? 'УНП' : 'идентификационный №';
  }

  protected categoryName(): string {
    const saved = this.account()?.debtor_category_name?.trim();
    if (saved) return saved;
    const id = this.account()?.debtor_category;
    if (!id) return '—';
    return this.categories().find((item) => item.id === id)?.name || '—';
  }

  protected documentLine(): string {
    const person = this.mainPerson();
    if (!person || this.isLegal()) return '—';
    const title = [person.maindoc_type_name, person.maindoc_snum].filter(Boolean).join(' ').trim();
    if (!title && !person.maindoc_date) return '—';
    const issued = person.maindoc_date ? `, выдан ${this.formatDay(person.maindoc_date)}` : '';
    return `${title}${issued}`.trim() || '—';
  }

  protected ownershipChip(): string {
    const name = this.account()?.ownership_type_name?.trim() || '';
    if (!name) return '';
    return /собствен/i.test(name) ? 'Собственник' : name;
  }

  protected mainIdle(): boolean {
    return !!this.mainPerson()?.idler_val;
  }

  protected employmentLabel(): string | null {
    const person = this.mainPerson();
    if (!person || person.subj_legal_entity) return null;
    const female = /жен/i.test(person.sex_name || '');
    if (person.idler_val) return female ? 'Не занята в экономике' : 'Не занят в экономике';
    return female ? 'Занята в экономике' : 'Занят в экономике';
  }

  protected employmentFact(): string {
    return this.employmentLabel() || 'Сведений о занятости нет';
  }

  protected employmentMark(): string {
    if (!this.mainPerson() || this.isLegal()) return '×';
    return this.mainIdle() ? '!' : '✓';
  }

  protected deathMark(): string {
    if (!this.mainPerson()) return '×';
    return this.mainPerson()?.subj_death_date ? '!' : '✓';
  }

  protected deathFact(): string {
    const died = this.mainPerson()?.subj_death_date;
    if (died) return `Дата смерти ${this.formatDay(died)}`;
    if (!this.mainPerson()) return 'Сведений нет';
    return 'Сведений о смерти нет';
  }

  protected registeredCount(): number {
    const people = this.registrations();
    if (people.length) return people.filter((row) => !row.subj_is_check_out).length;
    return this.account()?.subj_count ?? 0;
  }

  protected enrichmentFoot(): string {
    const updated = this.formatDay(this.account()?.ais_updated_at);
    return updated ? `Обновлено ${updated} · выгрузка АИС` : 'Дата обновления из АИС не указана';
  }

  protected aisFoot(): string {
    const updated = this.account()?.ais_updated_at;
    if (!updated) return 'Дата синхронизации не указана';
    const day = this.formatDay(updated);
    const time = updated.length >= 16 ? updated.slice(11, 16) : '';
    return time ? `Обновлено ${day}, ${time} · синхронизация` : `Обновлено ${day} · синхронизация`;
  }

  protected solidarityLine(): string {
    const people = this.registrations().filter((row) => row.solidary && row.full_name?.trim());
    if (!people.length) return 'нет';
    return people.map((row) => {
      const relation = row.relation_degree_name?.trim();
      return relation ? `${row.full_name} (${relation})` : row.full_name;
    }).join(' · ');
  }

  protected inheritanceText(): string {
    const account = this.account();
    if (!account?.inheritance_case && !account?.heritage_from_file) return 'не открыто';
    const until = account.inheritance_until ? ` до ${this.formatDay(account.inheritance_until)}` : '';
    return `открыто, автоматические мероприятия остановлены${until}`;
  }

  protected riskOn(): boolean {
    const account = this.account();
    if (!account) return false;
    if (account.bankruptcy || account.legal_status === 'liquidation' || account.legal_status === 'bankruptcy') return true;
    return this.registrations().some((row) => row.unfit_for_work);
  }

  protected dialLines(): { icon: string; value: string; tags: string[] }[] {
    const rows = [...this.contacts()].sort((a, b) => b.priority - a.priority || a.id - b.id);
    if (rows.length) {
      return rows.map((row) => ({
        icon: row.kind === 'email' ? 'mail' : 'call',
        value: row.value,
        tags: this.contactTags(row),
      }));
    }
    const lines: { icon: string; value: string; tags: string[] }[] = [];
    const account = this.account();
    if (account?.contact_phone) lines.push({ icon: 'call', value: account.contact_phone, tags: ['телефон ЛС'] });
    if (account?.phone && account.phone !== account.contact_phone) {
      lines.push({ icon: 'call', value: account.phone, tags: ['телефон'] });
    }
    for (const person of this.registrations()) {
      if (person.contact_phone && !lines.some((line) => line.value === person.contact_phone)) {
        lines.push({ icon: 'call', value: person.contact_phone, tags: ['регистрация'] });
      }
      if (person.email) lines.push({ icon: 'mail', value: person.email, tags: ['e-mail'] });
    }
    return lines;
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

  private loadPeers(account: AccountDetail): void {
    const identifier = account.payer_identifier?.trim();
    const unp = account.payer_unp?.trim();
    const params = identifier
      ? { payer_identifier: identifier, page_size: 100 }
      : unp
        ? { payer_unp: unp, page_size: 100 }
        : null;
    if (!params) {
      this.peers.set(null);
      return;
    }
    this.api.accounts(params).subscribe({
      next: (page) => this.peers.set(page.results),
      error: () => this.peers.set(null),
    });
  }

  private currentAccountRow(): AccountRow | null {
    const account = this.account();
    if (!account) return null;
    return {
      ...account,
      debt_total: this.principalTotal().toFixed(2),
      mulct_total: this.penaltyTotal().toFixed(2),
      obligation_total: this.obligationTotal().toFixed(2),
    };
  }

  private contactTags(row: ContactRow): string[] {
    const tags: string[] = [];
    if (row.priority > 0) tags.push('приоритетный');
    if (row.kind === 'city') tags.push('городской');
    if (row.kind === 'mobile') tags.push('мобильный');
    if (row.kind === 'email') tags.push('e-mail');
    if (row.source === 'ais' && row.ais_updated_at) tags.push(this.formatDay(row.ais_updated_at));
    else if (row.source === 'pm') tags.push('внесено в ПМ');
    return tags;
  }

  private formatDay(value: string | null | undefined): string {
    if (!value) return '';
    const [year, month, date] = value.slice(0, 10).split('-');
    if (!year || !month || !date || year.length !== 4) return value;
    return `${date}.${month}.${year}`;
  }

  protected openShares(): void {
    const id = this.account()?.id;
    if (!id) return;
    this.api.debtShares(id).subscribe({
      next: (rows) => {
        this.shares.set(rows);
        this.sharesOpen.set(true);
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  protected penaltyTotal(): number {
    return this.services().reduce((sum, row) => sum + Number(row.balance_mulct_out ?? 0), 0);
  }

  protected principalTotal(): number {
    const fromServices = this.services().reduce((sum, row) => sum + Number(row.balance_out ?? 0), 0);
    if (this.services().length) return fromServices;
    return Number(this.account()?.balance_out ?? 0);
  }

  protected obligationTotal(): number {
    return this.principalTotal() + this.penaltyTotal();
  }

  protected checksDone(): number {
    return this.checks().filter((row) => row.done).length;
  }

  checksReady(): boolean {
    const rows = this.checks();
    return rows.length > 0 && rows.every((row) => row.done);
  }

  openWritCase(): void {
    const a = this.account();
    if (!a) return;
    this.api.openClaim(a.id).subscribe({
      next: (row) => this.router.navigate(['/claims', row.id]),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  saveMode(): void {
    const a = this.account();
    if (!a || (a.contact_source_mode || 'combined') === this.contactMode) return;
    this.api.updateAccount(a.id, { contact_source_mode: this.contactMode }).subscribe({
      next: (updated) => {
        this.account.set(updated);
        this.api.accountContacts(a.id).subscribe((page) => this.contacts.set(page.results));
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  saveProfile(): void {
    const a = this.account();
    if (!a) return;
    this.api.updateAccount(a.id, {
      debtor_category: this.categoryId,
      residence_note: this.residence,
      inheritance_case: this.inheritance,
      inheritance_until: this.isoDate(this.inheritanceUntil),
    }).subscribe({
      next: (updated) => {
        this.account.set(updated);
        this.snack.open('Сохранено', 'OK', { duration: 3000 });
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  onFile(event: Event): void {
    const a = this.account();
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!a || !file) return;
    this.api.uploadFile(a.id, this.fileType || 'Документ', file).subscribe({
      next: () => this.api.accountFiles(a.id).subscribe((page) => this.files.set(page.results)),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  saveGroup(): void {
    const a = this.account();
    if (!a) return;
    if (this.manualGroup != null && !this.manualReason.trim()) {
      this.groupInvalid = true;
      return;
    }
    this.groupInvalid = false;
    this.api.updateAccountGroup(a.id, this.manualGroup, this.manualReason).subscribe({
      next: (updated) => {
        this.account.set(updated);
        this.snack.open('Группа сохранена', 'OK', { duration: 3000 });
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  protected filledPreview(): string {
    const account = this.account();
    const template = this.templates().find((t) => t.id === this.templateId);
    if (!account || !template) return '';
    const values: Record<string, string> = {
      fio: account.short_fio,
      account: account.client_account,
      amount: account.balance_out ?? '',
      address: account.account_address,
      debt_group: account.effective_group == null ? '' : String(account.effective_group),
      group_name: account.group_name ?? '',
    };
    return template.body.replace(/\{(\w+)\}/g, (token, key: string) => values[key] ?? token);
  }

  notify(): void {
    const a = this.account();
    const template = this.templates().find((t) => t.id === this.templateId);
    if (!a || !template || this.sending()) return;
    this.sending.set(true);
    this.api.createNotification({ channel: template.channel, template: template.id, account: a.id }).pipe(
      finalize(() => this.sending.set(false)),
    ).subscribe({
      next: (n) => this.snack.open(`Оповещение: ${n.status_display}`, 'OK', { duration: 4000 }),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  protected showDate(value: string | null | undefined): string {
    if (!value) return '';
    const iso = value.slice(0, 10);
    const parts = iso.split('-');
    return parts.length === 3 && parts[0].length === 4 ? `${parts[2]}.${parts[1]}.${parts[0]}` : value;
  }

  protected isoDate(value: string): string | null {
    const text = (value || '').trim();
    if (!text) return null;
    const ru = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    return null;
  }

  protected accountPeriod(account: AccountDetail): string {
    if (!account.start_date) return '—';
    const start = this.formatDay(account.start_date);
    if (!account.stop_date || account.stop_date.startsWith('2100-01-01')) return `с ${start}`;
    return `с ${start} по ${this.formatDay(account.stop_date)}`;
  }

  protected tariff(value: string | number | null | undefined): string {
    if (value == null || value === '') return '—';
    const number = Number(value);
    if (Number.isNaN(number)) return String(value);
    return String(Math.round(number * 10000) / 10000);
  }

  protected quantity(value: string | null): string {
    if (value == null || value === '') return '—';
    const number = Number(value);
    if (Number.isNaN(number)) return value;
    return number.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
  }

  protected stepDone(step: ScenarioStep): boolean {
    return step.measures.some((row) => row.stopped || !!row.finished_on);
  }

  protected stepSpan(step: ScenarioStep): string {
    const row = step.measures[0];
    if (!row) return '';
    const start = this.showDate(row.started_on);
    const end = this.showDate(row.finished_on);
    if (!start && !end) return '';
    return `${start || '…'} — ${end || '…'}`;
  }

  protected toggleStep(step: ScenarioStep): void {
    const row = step.measures.find((item) => !item.stopped && !item.finished_on) || step.measures[0];
    const account = this.account();
    if (!row || !account || !this.auth.canWrite()) return;
    const started = performance.now();
    this.api.stopMeasure(account.id, row.id).subscribe({
      next: () => {
        agentDbg('B', 'account-detail.component.ts:toggleStep', 'stop measure', {
          ms: Math.round(performance.now() - started),
        });
        this.reloadScenario();
      },
      error: (err) => {
        agentDbg('B', 'account-detail.component.ts:toggleStep', 'stop measure failed', {
          ms: Math.round(performance.now() - started),
        });
        this.snack.open(errorMessage(err), 'OK');
      },
    });
  }

  protected showDateTime(value: string | null | undefined): string {
    if (!value) return '—';
    const day = this.showDate(value);
    const time = value.length > 11 ? value.slice(11, 16) : '';
    return time ? `${day} ${time}` : day;
  }

  protected historyRows(): HistoryRow[] {
    const rows = this.history();
    if (this.historyPane === 'rating') return rows.filter((row) => row.kind === 'group' || row.kind === 'rating');
    if (this.historyPane === 'measure') return rows.filter((row) => row.kind === 'measure');
    if (this.historyPane === 'other') return rows.filter((row) => row.kind !== 'group' && row.kind !== 'rating' && row.kind !== 'measure');
    return [];
  }

  protected scenarioName(): string {
    return this.scenario()?.scenario_name || this.account()?.scenario_brief || '';
  }

  protected scenarioSteps(): ScenarioStep[] {
    return this.scenario()?.steps || [];
  }

  protected scenarioManual() {
    return this.scenario()?.manual || [];
  }

  protected activeRegistrationCount(): number {
    return this.registrations().filter((person) => this.regCell(person, 'registered') === 'да').length;
  }

  protected canHold(): boolean {
    return this.auth.canWrite() && this.auth.me()?.contour !== 'supplier';
  }

  protected askPause(row: ScenarioMeasure): void {
    if (row.status === 'paused') {
      this.api.releaseMeasure(row.id).subscribe({
        next: () => this.reloadScenario(),
        error: (e) => this.snack.open(errorMessage(e), 'OK'),
      });
      return;
    }
    this.pauseUntil = '';
    this.pauseReason = '';
    this.pauseFor = row;
  }

  protected confirmPause(): void {
    const row = this.pauseFor;
    if (!row || !this.pauseUntil || !this.pauseReason.trim()) return;
    this.api.holdMeasure(row.id, this.pauseUntil, this.pauseReason.trim()).subscribe({
      next: () => {
        this.pauseFor = null;
        this.reloadScenario();
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  protected addExtra(): void {
    const account = this.account();
    if (!account || this.extraCatalogId == null) return;
    this.api.addExtraMeasures({ catalog_id: this.extraCatalogId, account_ids: [account.id] }).subscribe({
      next: () => this.reloadScenario(),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  protected dragReg(shift: { from: string; to: string }): void {
    this.reorderCatalog(this.regCatalog, shift);
    this.api.saveCardColumns('registration', this.visibleRegColumns(), this.regCatalog).subscribe();
  }

  protected dragService(shift: { from: string; to: string }): void {
    this.reorderCatalog(this.serviceCatalog, shift);
    this.persistCard('services');
  }

  protected dragPayment(shift: { from: string; to: string }): void {
    this.reorderCatalog(this.paymentCatalog, shift);
    this.persistCard('payments');
  }

  private reorderCatalog(catalog: string[], shift: { from: string; to: string }): void {
    const from = catalog.indexOf(shift.from);
    const to = catalog.indexOf(shift.to);
    if (from < 0 || to < 0 || from === to) return;
    const [item] = catalog.splice(from, 1);
    catalog.splice(to, 0, item);
  }

  protected stepOpen(step: ScenarioStep): boolean {
    return step.measures.length > 0;
  }

  protected manualOpen(): boolean {
    const id = this.focusMeasure();
    return !!id && this.scenarioManual().some((row) => row.id === id);
  }

  protected writPreview(): WritDraft | null {
    return this.writ();
  }

  protected serviceLabel(col: string): string {
    const labels: Record<string, string> = {
      service_list_id: 'Код договора на услугу', service_id: 'Код услуги', service_name: 'Наименование услуги',
      provider_id: 'Код поставщика услуги', shot_name: 'Наименование поставщика', start_date: 'Дата с',
      stop_date: 'Дата по', tarrif: 'Тариф', spent_fact: 'Количество', calc_sum: 'Всего начислено',
      calc_result_sum: 'Начислено', calc_priv_sum: 'Сумма льготы', mulct_sum: 'Начислено пени',
      recalc_sum: 'Перерасчёт', netting_sum: 'Взаимозачет по услуге', balance_in: 'Вх. сальдо без пени',
      balance_mulct_in: 'Вх. сальдо пени', balance_mulct_out: 'Исх. сальдо пени', balance_out: 'Исх. сальдо с пеней',
      subs_pay: 'Сумма субсидии', calc_date: 'Дата расчёта', mulct_recalc_sum: 'Перерасчет по пене',
      overdue_debt: 'Просроченная задолженность', debt_period: 'Кол-во периодов долга',
      share_service_summ: 'Распределённая оплата услуг', share_mulct_summ: 'Распределённая оплата пени',
      months_debt: 'Кол-во месяцев долга', supplier: 'Поставщик услуги', debt_group: 'Группа задолженности',
      report_group_id: 'ID группы отчёта', netting_mulct_sum: 'Взаимозачет пени', ais_account_id: 'Код ЛС',
      calculation_id: 'Код операции расчета', sort_code: 'Код сортировки',
      service_name_report: 'Наименование услуги в извещении', full_name: 'Полное наименование поставщика',
    };
    return labels[col] || col;
  }

  protected visibleServiceColumns(): string[] {
    const shown = this.serviceCatalog.filter((col) => !this.serviceHidden.has(col));
    return shown.length ? shown : ['service_name'];
  }

  protected serviceVisible(col: string): boolean {
    return !this.serviceHidden.has(col);
  }

  protected toggleColumnMenu(name: string, event: Event): void {
    if (this.columnMenu === name) {
      this.columnMenu = '';
      return;
    }
    const button = event.currentTarget as HTMLElement;
    const box = button.getBoundingClientRect();
    this.columnMenuTop = box.bottom + 4;
    this.columnMenuLeft = Math.min(Math.max(8, box.left), window.innerWidth - 376);
    this.columnMenu = name;
  }

  protected toggleServiceColumn(col: string, on: boolean): void {
    if (on) this.serviceHidden.delete(col);
    else this.serviceHidden.add(col);
    if (this.serviceCatalog.every((item) => this.serviceHidden.has(item))) this.serviceHidden.delete('service_name');
    this.persistCard('services');
  }

  protected setServiceColumns(on: boolean): void {
    this.serviceHidden = on ? new Set() : new Set(this.serviceCatalog.filter((col) => col !== 'service_name'));
    this.persistCard('services');
  }

  protected moveServiceColumn(index: number, shift: number): void {
    const next = index + shift;
    if (next < 0 || next >= this.serviceCatalog.length) return;
    const [item] = this.serviceCatalog.splice(index, 1);
    this.serviceCatalog.splice(next, 0, item);
    this.persistCard('services');
  }

  protected regHidden = new Set<string>();
  protected readonly regCatalog = [
    'payer', 'registered', 'beneficiary', 'fam', 'im', 'ot', 'check_in_date', 'check_out_date',
    'date_registration', 'passport_out', 'move_reason', 'reg_type_name', 'relation', 'family',
    'birthday', 'death', 'sex', 'doc', 'doc_num', 'doc_date', 'doc_organ', 'doc_basis', 'doc_code',
    'personal_num', 'citizenship', 'nationality', 'address', 'work', 'position', 'tab_number', 'salary',
    'account_id', 'person_id', 'registration_id', 'legal', 'unp', 'parent_id', 'parent_name',
    'social_note', 'marital', 'rent', 'social_category', 'unemployed', 'left_country',
    'bank_code', 'bank_name', 'bank_account', 'payer_reg_id', 'payer_name', 'payer_share', 'payer_type',
    'tenant_free', 'doc1', 'share1', 'doc2', 'share2', 'doc3', 'share3', 'heritage',
    'heritage_accept', 'heritage_open', 'heritage_close', 'phone', 'email', 'joint_owner',
    'cnt_benefit', 'cnt_rent', 'cnt_minor', 'cnt_temp', 'cnt_unreg', 'cnt_absent',
    'cnt_distant', 'cnt_close', 'cnt_people', 'cnt_payers', 'cnt_pets',
  ];

  protected regLabel(col: string): string {
    const labels: Record<string, string> = {
      payer: 'Плательщик', registered: 'Зарегистрирован', beneficiary: 'Льготник',
      fam: 'Фамилия', im: 'Имя', ot: 'Отчество', check_in_date: 'Дата прибытия', check_out_date: 'Дата убытия',
      date_registration: 'Дата регистрации по паспорту', passport_out: 'Дата снятия с учёта по паспорту',
      move_reason: 'Причина прибытия/выбытия', reg_type_name: 'Тип регистрации', relation: 'Родственные отношения',
      family: 'Является членом семьи', birthday: 'Дата рождения', death: 'Дата смерти', sex: 'Пол',
      doc: 'Осн. документ', doc_num: 'Серия и номер', doc_date: 'Дата выдачи', doc_organ: 'Кем выдан',
      doc_basis: 'Основание выдачи паспорта', doc_code: 'Цифровой код органа', personal_num: 'Идентификационный номер паспорта (ИДН)',
      citizenship: 'Гражданство', nationality: 'Национальность', address: 'Адрес местожительства',
      work: 'Наименование предприятия', position: 'Должность', tab_number: 'Табельный номер', salary: 'Зачислять оплату из зарплаты',
      account_id: 'ID ЛС', person_id: 'ID лица', registration_id: 'ID регистрации лица', legal: 'Юр.лицо', unp: 'УНП',
      parent_id: 'ID родителя', parent_name: 'ФИО родителя', social_note: 'Социальное примечание', marital: 'Семейное положение',
      rent: 'Наличие договора найма', social_category: 'Социальная категория граждан', unemployed: 'Незанятые в экономике',
      left_country: 'Незанятые, выехавшие за пределы РБ', bank_code: 'Код банка', bank_name: 'Наименование банка',
      bank_account: 'Расчетный счет', payer_reg_id: 'Код регистрации плательщика', payer_name: 'ФИО плательщика',
      payer_share: 'Доля плательщика', payer_type: 'Наименование типа плательщика', tenant_free: 'Является нанимателем без оплаты ЖКУ',
      doc1: 'Наименование документа 1', share1: 'Доля по документу 1', doc2: 'Наименование документа 2', share2: 'Доля по документу 2',
      doc3: 'Наименование документа 3', share3: 'Доля по документу 3', heritage: 'Способ перехода прав',
      heritage_accept: 'Дата принятия наследства', heritage_open: 'Дата начала открытия наследства',
      heritage_close: 'Дата окончания открытия наследства', phone: 'Контактный телефон', email: 'E-mail',
      joint_owner: 'ФИО участника совместной собственности', cnt_benefit: 'Кол-во льготников',
      cnt_rent: 'Кол-во проживающих по договору найма', cnt_minor: 'Кол-во несовершеннолетних',
      cnt_temp: 'Кол-во зарег. по месту пребывания', cnt_unreg: 'Кол-во проживающих без регистрации',
      cnt_absent: 'Кол-во временно отсутствующих', cnt_distant: 'Кол-во зарег. неблизких родственников',
      cnt_close: 'Кол-во зарег. близких родственников', cnt_people: 'Кол-во человек (всех)',
      cnt_payers: 'Кол-во плательщиков', cnt_pets: 'Кол-во домашних питомцев',
    };
    return labels[col] || col;
  }

  protected visibleRegColumns(): string[] {
    const shown = this.regCatalog.filter((col) => !this.regHidden.has(col));
    return shown.length ? shown : ['payer'];
  }

  protected regVisible(col: string): boolean { return !this.regHidden.has(col); }

  protected toggleRegColumn(col: string, on: boolean): void {
    if (on) this.regHidden.delete(col);
    else this.regHidden.add(col);
    this.api.saveCardColumns('registration', this.visibleRegColumns(), this.regCatalog).subscribe();
  }

  protected setRegColumns(on: boolean): void {
    this.regHidden = on ? new Set() : new Set(this.regCatalog.filter((col) => col !== 'payer'));
    this.api.saveCardColumns('registration', this.visibleRegColumns(), this.regCatalog).subscribe();
  }

  protected moveRegColumn(index: number, shift: number): void {
    const next = index + shift;
    if (next < 0 || next >= this.regCatalog.length) return;
    const [item] = this.regCatalog.splice(index, 1);
    this.regCatalog.splice(next, 0, item);
    this.api.saveCardColumns('registration', this.visibleRegColumns(), this.regCatalog).subscribe();
  }

  protected regCell(person: Registration, col: string): string {
    const account = this.account();
    const yn = (value: boolean | number | null | undefined) => value ? 'да' : 'нет';
    const sheet = (label: string) => (person.sheet || []).find((field) => field.label.toLowerCase().includes(label.toLowerCase()))?.value || '';
    if (col === 'payer') return yn(person.subj_is_main);
    if (col === 'registered') {
      const removed = person.subj_is_check_out || sheet('снят').startsWith('1') || sheet('снят') === 'да';
      if (removed) return 'нет';
      const status = sheet('статус регистрации');
      if (status === '0' || status === 'нет') return 'нет';
      return 'да';
    }
    if (col === 'beneficiary') return yn(sheet('льгот').startsWith('1') || sheet('льгот') === 'да');
    if (col === 'fam') return person.full_name.split(' ')[0] || sheet('фамилия') || '—';
    if (col === 'im') return person.full_name.split(' ')[1] || '—';
    if (col === 'ot') return person.full_name.split(' ').slice(2).join(' ') || '—';
    if (col === 'relation') return person.relation_degree_name || '—';
    if (col === 'family') return yn(person.is_close_relative);
    if (col === 'birthday') return this.showDate(person.birthday) || '—';
    if (col === 'doc') return person.maindoc_type_name || '—';
    if (col === 'account_id') return account ? String(account.account_id) : '—';
    if (col === 'person_id') return sheet('код лица') || '—';
    if (col === 'registration_id') return sheet('код регистрации') || '—';
    if (col === 'legal') return yn(person.subj_legal_entity);
    if (col === 'unp') return sheet('унп') || sheet('учетный номер') || '—';
    if (col === 'parent_id') return sheet('код родителя') || '—';
    if (col === 'phone') return person.contact_phone || '—';
    if (col === 'email') return person.email || '—';
    if (col === 'cnt_benefit') return account?.priv_acc_count == null ? '—' : String(account.priv_acc_count);
    if (col === 'cnt_people') return account?.subj_count == null ? '—' : String(account.subj_count);
    if (col === 'cnt_payers') return String(this.registrations().filter((row) => row.subj_is_main).length);
    if (col === 'cnt_pets') return sheet('питом') || '—';
    const needles: Record<string, string> = {
      check_in_date: 'прибытия', check_out_date: 'убытия', date_registration: 'регистрации по паспорту',
      passport_out: 'снятия с учёта', move_reason: 'причина', death: 'смерти', sex: 'пол',
      doc_num: 'серия', doc_date: 'выдачи', doc_organ: 'кем выдан', doc_basis: 'основание выдачи',
      doc_code: 'цифровой код', personal_num: 'идентификационный', citizenship: 'гражданство',
      nationality: 'национальность', address: 'местожительства', work: 'предприятия', position: 'должность',
      tab_number: 'табельный', salary: 'зарплат', parent_name: 'фио родителя', social_note: 'социальное примечание',
      marital: 'семейное', rent: 'найма', unemployed: 'незанятые в экономике', left_country: 'выехав',
      bank_code: 'код банка', bank_name: 'наименование банка', bank_account: 'расчетный',
      payer_reg_id: 'код регистрации плательщика', payer_name: 'фио плательщика', payer_share: 'доля плательщика',
      payer_type: 'типа плательщика', tenant_free: 'нанимателем', doc1: 'документа 1', share1: 'документу 1',
      doc2: 'документа 2', share2: 'документу 2', doc3: 'документа 3', share3: 'документу 3',
      heritage: 'перехода прав', heritage_accept: 'принятия наследства', heritage_open: 'начала открытия',
      heritage_close: 'окончания открытия', joint_owner: 'совместной', cnt_rent: 'договору найма',
      cnt_minor: 'несовершеннолет', cnt_temp: 'пребывания', cnt_unreg: 'без регистрации',
      cnt_absent: 'отсутств', cnt_distant: 'неблизк', cnt_close: 'близких',
    };
    const found = sheet(needles[col] || this.regLabel(col));
    if (!found) return '—';
    if (found === '1') return 'да';
    if (found === '0') return 'нет';
    return found;
  }

  protected readonly paymentCatalog = [
    'execution_id', 'source_receipt_id', 'receipt_id', 'ais_account_id', 'package_id',
    'otdel', 'pp_num', 'house_address', 'account_address', 'payer_address_file',
    'bank_id', 'bank_name', 'pay_date', 'bank_date', 'client_account', 'client_account_file',
    'provider_short_name', 'account_provider_id', 'acc_oper_date',
    'pay_mulct_summ', 'pay_service_summ', 'provider_id', 'notes',
    'share_mulct_sum', 'share_service_sum', 'receipt_id_ges', 'share_status', 'package_status',
    'refund_sum', 'commission_summ', 'service_id', 'service_name',
    'payer_reg_name', 'client_name', 'payment_type_display',
  ];

  protected paymentLabel(col: string): string {
    const labels: Record<string, string> = {
      receipt_id: 'ID квитанции', source_receipt_id: 'ID исх. квитанции', receipt_id_ges: 'Связь с квитанцией',
      ais_account_id: 'ID ЛС',
      execution_id: 'ID документа на взыскание', package_id: 'ID пачки', package_status: 'Статус пачки',
      otdel: '№ операции в ЦУ', pp_num: '№ ПП', client_account: 'Лицевой счет', client_account_file: 'Лицевой счет из файла',
      house_address: 'Адрес дома', account_address: 'Адрес', payer_address_file: 'Адрес плательщика из файла',
      payer_reg_name: 'ФИО', client_name: 'ФИО плательщика из файла', bank_id: 'Банк - ID', bank_name: 'Банк - Наименование',
      pay_date: 'Дата оплаты', bank_date: 'Дата оплаты по банку', acc_oper_date: 'Операционная дата',
      account_provider_id: 'обсл. организация ЛС — ID', provider_short_name: 'обсл. организация ЛС — Наименование',
      provider_id: 'Поставщик услуг — ID', supplier_name: 'Поставщик услуг — Наименование',
      service_id: 'Услуга — ID', service_name: 'Услуга — Наименование',
      pay_service_summ: 'Оплата услуг по квитанции', pay_mulct_summ: 'Оплата пени по квитанции',
      pay_total: 'Итого оплачено', unshared_sum: 'Нераспределенный остаток оплаты в текущем периоде',
      share_service_sum: 'Распределено по услуге', share_mulct_sum: 'Распределено по пене', share_status: 'Способ распределения',
      refund_sum: 'Возврат', commission_summ: 'Комиссия', notes: 'Примечание', payment_type_display: 'Тип оплаты',
    };
    return labels[col] || col;
  }

  protected visiblePaymentColumns(): string[] {
    const shown = this.paymentCatalog.filter((col) => !this.paymentHidden.has(col));
    return shown.length ? shown : ['receipt_id'];
  }

  protected paymentVisible(col: string): boolean {
    return !this.paymentHidden.has(col);
  }

  protected togglePaymentColumn(col: string, on: boolean): void {
    if (on) this.paymentHidden.delete(col);
    else this.paymentHidden.add(col);
    if (this.paymentCatalog.every((item) => this.paymentHidden.has(item))) this.paymentHidden.delete('receipt_id');
    this.persistCard('payments');
  }

  protected setPaymentColumns(on: boolean): void {
    this.paymentHidden = on ? new Set() : new Set(this.paymentCatalog.filter((col) => col !== 'receipt_id'));
    this.persistCard('payments');
  }

  protected movePaymentColumn(index: number, shift: number): void {
    const next = index + shift;
    if (next < 0 || next >= this.paymentCatalog.length) return;
    const [item] = this.paymentCatalog.splice(index, 1);
    this.paymentCatalog.splice(next, 0, item);
    this.persistCard('payments');
  }

  protected paymentSub(col: string): string {
    if (col === 'account_provider_id' || col === 'provider_id' || col === 'service_id') return 'ID';
    if (col === 'provider_short_name' || col === 'supplier_name' || col === 'service_name') return 'Наименование';
    return '';
  }

  protected paymentHasGroups(): boolean {
    return this.paymentGroups().some((cell) => cell.span > 1);
  }

  protected paymentGroupChildren(): string[] {
    const cols = this.visiblePaymentColumns();
    const children: string[] = [];
    let index = 0;
    for (const cell of this.paymentGroups()) {
      if (cell.span > 1) children.push(...cols.slice(index, index + cell.span));
      index += cell.span;
    }
    return children;
  }

  protected paymentGroups(): { key: string; title: string; span: number }[] {
    const cols = this.visiblePaymentColumns();
    const groups: Record<string, string> = {
      account_provider_id: 'Обслуживающая организация ЛС',
      provider_short_name: 'Обслуживающая организация ЛС',
      provider_id: 'Поставщик услуг',
      supplier_name: 'Поставщик услуг',
      service_id: 'Услуга',
      service_name: 'Услуга',
    };
    const cells: { key: string; title: string; span: number }[] = [];
    for (const col of cols) {
      const title = groups[col] || this.paymentLabel(col);
      const prev = cells[cells.length - 1];
      if (prev && groups[col] && prev.title === title) prev.span += 1;
      else cells.push({ key: col, title: groups[col] ? title : this.paymentLabel(col), span: 1 });
    }
    return cells;
  }

  protected paymentCell(row: Payment, col: string): string {
    if (col === 'pay_total') {
      const sum = Number(row['pay_service_summ'] || 0) + Number(row['pay_mulct_summ'] || 0);
      return Number.isFinite(sum) ? sum.toFixed(2) : '—';
    }
    if (col === 'pay_date' || col === 'bank_date') return this.showDate(String(row[col] || '')) || '—';
    const value = row[col];
    if (value != null && value !== '') return String(value);
    const extra = (row.file_fields || []).find((field) => field.label === this.paymentLabel(col));
    return extra?.value || '—';
  }

  protected onWarningFile(event: Event): void {
    this.warningFile = (event.target as HTMLInputElement).files?.[0] || null;
  }

  protected saveWarningProof(): void {
    const account = this.account();
    if (!account || !this.warningFile) return;
    this.api.uploadFile(account.id, 'Подтверждение вручения предупреждения', this.warningFile).subscribe({
      next: () => {
        this.warningFile = null;
        this.api.accountFiles(account.id).subscribe((page) => this.files.set(page.results));
        this.snack.open('Файл добавлен во вложения', 'OK', { duration: 2500 });
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  protected writOpen(id: number): boolean {
    return this.openWrits().has(id);
  }

  protected toggleWrit(id: number): void {
    const next = new Set(this.openWrits());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.openWrits.set(next);
  }

  protected writTitle(row: { debt_from: string | null; debt_to: string | null }): string {
    if (row.debt_from && row.debt_to) {
      return `Пакет за период ${this.writPeriod(row.debt_from)}–${this.writPeriod(row.debt_to)}`;
    }
    return 'Пакет без периода';
  }

  protected writPeriod(value: string | null): string {
    const [year, month, day] = (value || '').slice(0, 10).split('-');
    return day && month && year ? `${day}.${month}.${year}` : '—';
  }

  protected openFile(row: AttachmentRow): void {
    this.fileBlob(row).subscribe({
      next: (blob) => {
        const type = previewType(row.original_name, blob.type);
        const url = URL.createObjectURL(type === blob.type ? blob : new Blob([blob], { type }));
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  protected downloadFile(row: AttachmentRow): void {
    this.fileBlob(row).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = row.original_name || 'document';
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  private fileBlob(row: AttachmentRow) {
    if (row.package && row.claim_id && row.doc_id) return this.api.downloadClaimFile(row.claim_id, row.doc_id);
    return this.api.downloadAttachment(Number(row.id));
  }

  protected deleteFile(row: AttachmentRow): void {
    const account = this.account();
    if (!account || row.package) return;
    this.api.deleteAttachment(Number(row.id)).subscribe({
      next: () => this.api.accountFiles(account.id).subscribe((page) => this.files.set(page.results)),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  protected reloadScenario(): void {
    const account = this.account();
    if (!account) return;
    const started = performance.now();
    this.api.accountScenario(account.id).subscribe((board) => {
      const measures = (board.steps || []).reduce((count, step) => count + (step.measures?.length || 0), 0);
      agentDbg('B', 'account-detail.component.ts:reloadScenario', 'scenario board', {
        ms: Math.round(performance.now() - started),
        steps: board.steps?.length ?? 0,
        measures,
      });
      this.scenario.set(board);
    });
  }

  private applyCardColumns(board: 'services' | 'payments', prefs: ColumnPrefs): void {
    const catalog = board === 'services' ? this.serviceCatalog : this.paymentCatalog;
    const known = new Set(catalog);
    const order = (prefs.order || []).filter((name) => known.has(name));
    for (const name of [...catalog]) {
      if (!order.includes(name)) order.push(name);
    }
    catalog.splice(0, catalog.length, ...order);
    const visible = new Set(prefs.columns?.length ? prefs.columns : catalog);
    const hidden = new Set(catalog.filter((name) => !visible.has(name)));
    if (board === 'services') this.serviceHidden = hidden;
    else this.paymentHidden = hidden;
  }

  private persistCard(board: 'services' | 'payments'): void {
    const catalog = board === 'services' ? this.serviceCatalog : this.paymentCatalog;
    const hidden = board === 'services' ? this.serviceHidden : this.paymentHidden;
    const visible = catalog.filter((name) => !hidden.has(name));
    this.api.saveCardColumns(board, visible, [...catalog]).subscribe({
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }
}

function previewType(name: string, current: string): string {
  if (current && current !== 'application/octet-stream') return current;
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'txt') return 'text/plain';
  return current || 'application/octet-stream';
}

function agentDbg(hypothesisId: string, location: string, message: string, data: Record<string, unknown>): void {
  // #region agent log
  fetch('http://127.0.0.1:7711/ingest/f24f302c-2e56-43dc-abb2-a6fe7c5a2f70',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cb728a'},body:JSON.stringify({sessionId:'cb728a',runId:'pre-fix',hypothesisId,location,message,data,timestamp:Date.now()})}).catch(()=>{});
  // #endregion
}
