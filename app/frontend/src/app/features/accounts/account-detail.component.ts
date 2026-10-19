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
import { finalize, forkJoin } from 'rxjs';

import { ApiService, ColumnPrefs, NotaryOffice, errorMessage } from '../../core/api.service';
import { BynSignComponent, MoneyComponent } from '../../core/money.component';
import { AuthService } from '../../core/auth.service';
import {
  AccountDetail, AccountRow, AccountService, AttachmentRow, BalanceRow, Channel, ContactRow, DebtorCategory, DebtShare, HistoryRow, MeasureRow, MessageTemplate, Payment, Registration, ScenarioBoard, ScenarioStep, WorkItem, WritDraft,
} from '../../core/models';
import { MeasureTasksComponent } from '../measures/measure-tasks.component';

@Component({
  selector: 'app-account-detail',
  standalone: true,
  imports: [
    DatePipe, FormsModule, RouterLink, MatTabsModule, MatTableModule, MatCardModule, MatButtonModule, MoneyComponent, BynSignComponent,
    MatFormFieldModule, MatSelectModule, MatInputModule, MatSnackBarModule, MatCheckboxModule, MatIconModule, MatAutocompleteModule,
    MeasureTasksComponent,
  ],
  template: `
    <div class="page">
      @if (error()) { <p class="alert danger"><mat-icon>error_outline</mat-icon>{{ error() }}</p> }

      @if (account(); as a) {
        <div class="crumbs">
          <a routerLink="/accounts">Реестр ЛС</a>
          <span class="sep">›</span>
          <span>{{ personKindPlural() }}</span>
          <span class="sep">›</span>
          <b>{{ a.client_account }}</b>
        </div>

        <section class="surface head debtor">
          <div class="debtor-top">
            <div class="who">
              <h2>{{ a.client_account }}</h2>
              <p class="uen">УЕН {{ a.unified_account || 'не передан' }}</p>
              <div class="meta">
                <span class="k">Плательщик</span>
                <b>{{ personName() }}</b>
              </div>
              <div class="meta">
                <span class="k">Адрес</span>
                <b>{{ a.account_address || a.house_address || '—' }}</b>
              </div>
            </div>
            <div class="who-side">
              <div class="badges">
                @if (a.uniq_attr_name) { <span class="pill" title="Тип уникальности ЛС">{{ a.uniq_attr_name }}</span> }
                @if (a.rating_label) { <span class="rating-badge r{{ a.rating_label[0] }}" title="Рейтинг">{{ a.rating_label }}</span> }
                @if (auth.canWrite()) {
                  <button mat-stroked-button (click)="refreshNow()"><mat-icon>sync</mat-icon> Обновить сейчас</button>
                }
              </div>
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

        <mat-tab-group class="surface tabs" [selectedIndex]="tabIndex()" (selectedIndexChange)="tabIndex.set($event)">
        <mat-tab label="Общие">
            <div class="grid">
              <mat-card><mat-card-content>
                <dl>
                  <dt>Код ЛС</dt><dd>{{ a.account_id }}</dd>
                  <dt>Обслуживающая организация</dt><dd>{{ a.provider_short_name || '—' }}</dd>
                  <dt>Код обслуживающей организации</dt><dd>{{ a.provider_id ?? '—' }}</dd>
                  @if (auth.showSchema()) { <dt>Код схемы</dt><dd>{{ a.schema_name || a.schema_label || '—' }}</dd> }
                  <dt>ЧУП</dt><dd>{{ a.is_private_enterprise ? 'есть' : 'нет' }}</dd>
                  <dt>Код дома</dt><dd>{{ a.house_id ?? '—' }}</dd>
                  <dt>Адрес дома</dt><dd>{{ a.house_address || '—' }}</dd>
                  <dt>Номер квартиры</dt><dd>{{ a.flat_number || '—' }}</dd>
                  <dt>Общая площадь</dt><dd>{{ a.acc_total_space ?? '—' }}</dd>
                  <dt>Кол-во комнат</dt><dd>{{ a.room_count ?? '—' }}</dd>
                  <dt>Кол-во проживающих</dt><dd>{{ a.subj_count ?? '—' }}</dd>
                  <dt>Кол-во льготников</dt><dd>{{ a.priv_acc_count ?? '—' }}</dd>
                  <dt>id типа объекта</dt><dd>{{ a.acc_category_id ?? '—' }}</dd>
                  <dt>Тип объекта жилфонда</dt><dd>{{ a.acc_category_full || a.acc_category_short || '—' }}</dd>
                  <dt>Код категории жилого фонда</dt><dd>{{ a.housing_category_code ?? '—' }}</dd>
                  <dt>Категория жилого фонда</dt><dd>{{ a.category_name || a.category_short_name || '—' }}</dd>
                  <dt>Код типа собственности</dt><dd>{{ a.ownership_type_code ?? '—' }}</dd>
                  <dt>Тип собственности</dt><dd>{{ a.ownership_type_name || '—' }}</dd>
                  <dt>ID признака уникальности</dt><dd>{{ a.uniq_attr ?? '—' }}</dd>
                  <dt>ID доп. информации 1</dt><dd>{{ a.info_param_id1 ?? '—' }}</dd>
                  <dt>Доп. информация 1</dt><dd>{{ a.info_param_value1 || '—' }}</dd>
                  <dt>ID доп. информации 2</dt><dd>{{ a.info_param_id2 ?? '—' }}</dd>
                  <dt>Доп. информация 2</dt><dd>{{ a.info_param_value2 || '—' }}</dd>
                  <dt>Телефон</dt><dd>{{ a.phone || '—' }}</dd>
                  <dt>Контактный телефон</dt><dd>{{ a.contact_phone || '—' }}</dd>
                  <dt>Период действия ЛС</dt><dd>{{ accountPeriod(a) }}</dd>
                </dl>
              </mat-card-content></mat-card>
              <mat-card><mat-card-content>
                <dl>
                  <dt>Входящее сальдо <app-byn-sign /></dt><dd><app-money [value]="a.balance_in" [blank]="false" /></dd>
                  <dt>Начислено <app-byn-sign /></dt><dd><app-money [value]="a.total_calc_sum" [blank]="false" /></dd>
                  <dt>Распределенная оплата <app-byn-sign /></dt><dd><app-money [value]="a.pay_sum" [blank]="false" /></dd>
                  <dt>В т.ч. списано <app-byn-sign /></dt><dd><app-money [value]="a.pay_sum_writeoff" [blank]="false" /></dd>
                  <dt>Исходящее сальдо <app-byn-sign /></dt><dd><app-money [value]="a.balance_out" [blank]="false" /></dd>
                  <dt>Квит. оплата <app-byn-sign /></dt><dd><app-money [value]="a.receipt_pay" [blank]="false" /></dd>
                  <dt>Нераспределенный остаток <app-byn-sign /></dt><dd><app-money [value]="a.unshared_sum" [blank]="false" /></dd>
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
                @if (auth.canWrite() && auth.me()?.contour !== 'supplier') {
                  <h4>Ручная группа</h4>
                  <div class="filters">
                    <mat-form-field>
                      <mat-label>Группа задолженности</mat-label>
                      <mat-select [(ngModel)]="manualGroup">
                        <mat-option [value]="null">По расчёту</mat-option>
                        @for (g of [1, 2, 3, 4, 5, 6]; track g) { <mat-option [value]="g">{{ g }}</mat-option> }
                      </mat-select>
                    </mat-form-field>
                    <mat-form-field class="reason"><mat-label>Причина</mat-label><input matInput [(ngModel)]="manualReason" /></mat-form-field>
                    <button mat-stroked-button (click)="saveGroup()">Сохранить</button>
                  </div>
                }
                @if (auth.canWrite()) {
                  <div class="filters">
                    <mat-form-field>
                      <mat-label>Категория</mat-label>
                      <mat-select [(ngModel)]="categoryId">
                        <mat-option [value]="null">Не задана</mat-option>
                        @for (item of categories(); track item.id) { <mat-option [value]="item.id">{{ item.name }}</mat-option> }
                      </mat-select>
                    </mat-form-field>
                    <mat-form-field class="reason"><mat-label>Фактическое проживание</mat-label><input matInput [(ngModel)]="residence" /></mat-form-field>
                    <mat-checkbox [(ngModel)]="inheritance">Наследственное дело</mat-checkbox>
                    <mat-form-field><mat-label>Приостановка до</mat-label><input matInput type="date" [(ngModel)]="inheritanceUntil" /></mat-form-field>
                    <button mat-stroked-button (click)="saveProfile()">Сохранить</button>
                    <mat-form-field><mat-label>Новая категория</mat-label><input matInput [(ngModel)]="newCategory" /></mat-form-field>
                    <button mat-stroked-button (click)="addCategory()">Добавить в справочник</button>
                    <button mat-stroked-button (click)="removeCategory()">Удалить выбранную</button>
                  </div>
                }
              </mat-card-content></mat-card>
            </div>
          </mat-tab>

          <mat-tab label="Регистрация ({{ registrations().length }})">
            <p class="muted tab-note">Все поля файла регистрации. Роль «Солидарный должник» не ставится лицу, которое на дату возникновения долга уже снято с учёта.</p>
            @for (person of registrations(); track person.id) {
              <details class="step" [open]="person.subj_is_main">
                <summary>{{ person.full_name }} — {{ person.debtor_role }}</summary>
                <dl class="sheet">
                  @for (field of person.sheet || []; track field.label) {
                    <div><dt>{{ field.label }}</dt><dd>{{ field.value || '—' }}</dd></div>
                  }
                </dl>
              </details>
            }
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
                <summary>{{ step.title }}</summary>
                @for (item of step.checklist; track item) {
                  <p class="check-line">{{ item }}</p>
                }
                @for (row of step.measures; track row.id) {
                  <div class="step-measure">
                    <div class="step-head">
                      <a [routerLink]="['/measures', row.id]">{{ row.kind_label }}</a>
                      <span class="status-pill {{ row.status }}">{{ row.status_label }}</span>
                    </div>
                    <app-measure-tasks [measureId]="row.id" [tasks]="row.tasks" [canWrite]="auth.canWrite()" (changed)="reloadScenario()" />
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
            <details class="step">
              <summary>Инициировано вручную</summary>
              @for (row of scenarioManual(); track row.id) {
                <div class="step-measure">
                  <div class="step-head">
                    <a [routerLink]="['/measures', row.id]">{{ row.kind_label }}</a>
                    <span class="status-pill {{ row.status }}">{{ row.status_label }}</span>
                  </div>
                  <app-measure-tasks [measureId]="row.id" [tasks]="row.tasks" [canWrite]="auth.canWrite()" (changed)="reloadScenario()" />
                </div>
              } @empty { <p class="muted">Отдельных мероприятий нет.</p> }
            </details>
          </mat-tab>

          <mat-tab label="Контактные данные">
            <p class="muted">Приоритет ставит режим: выбранный источник получает 1, другой — 0. Телефон и e-mail добавляются отдельно, без источника и без приоритета.</p>
            @if (auth.canWrite()) {
            <div class="filters contact-add">
              <mat-form-field><mat-label>Телефон или e-mail</mat-label><input matInput [(ngModel)]="contactValue" /></mat-form-field>
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
            <div class="list-pane"><table mat-table [dataSource]="contacts()">
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
              <button mat-stroked-button type="button" (click)="toggleServicePicker($event)">Столбцы</button>
              @if (servicePicker) {
                <div class="picker-back" (click)="servicePicker = false"></div>
                <div class="picker-menu" role="listbox" aria-label="Столбцы услуг"
                     [style.top.px]="serviceMenuTop" [style.left.px]="serviceMenuLeft"
                     [style.max-height]="'calc(100vh - ' + (serviceMenuTop + 12) + 'px)'">
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
            <div class="list-pane service-pane"><table mat-table [dataSource]="services()">
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
              <ng-container matColumnDef="service_list_id"><th mat-header-cell *matHeaderCellDef>Код договора на услугу (ID Договора)</th><td mat-cell *matCellDef="let s">{{ s.service_list_id }}</td></ng-container>
              <ng-container matColumnDef="ais_account_id"><th mat-header-cell *matHeaderCellDef>Код ЛС (ID ЛС)</th><td mat-cell *matCellDef="let s">{{ s.ais_account_id }}</td></ng-container>
              <ng-container matColumnDef="calculation_id"><th mat-header-cell *matHeaderCellDef>Код операции расчета (ID Расчёта)</th><td mat-cell *matCellDef="let s">{{ s.calculation_id ?? '—' }}</td></ng-container>
              <ng-container matColumnDef="provider_id"><th mat-header-cell *matHeaderCellDef>Код поставщика услуги</th><td mat-cell *matCellDef="let s">{{ s.provider_id ?? '—' }}</td></ng-container>
              <ng-container matColumnDef="sort_code"><th mat-header-cell *matHeaderCellDef>Код сортировки</th><td mat-cell *matCellDef="let s">{{ s.sort_code ?? '—' }}</td></ng-container>
              <ng-container matColumnDef="service_id"><th mat-header-cell *matHeaderCellDef>Код услуги (ID Услуги)</th><td mat-cell *matCellDef="let s">{{ s.service_id }}</td></ng-container>
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
              <ng-container matColumnDef="tarrif"><th mat-header-cell *matHeaderCellDef>Тариф</th><td mat-cell *matCellDef="let s">{{ s.tarrif ?? '—' }}</td></ng-container>
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
            <div class="filters">
              <button mat-stroked-button type="button" (click)="paymentPicker = !paymentPicker">Столбцы</button>
              @if (paymentPicker) {
                <button mat-button type="button" (click)="setPaymentColumns(true)">Отметить все</button>
                <button mat-button type="button" (click)="setPaymentColumns(false)">Снять все</button>
              }
            </div>
            @if (paymentPicker) {
              <div class="picker">
                @for (col of paymentCatalog; track col; let i = $index) {
                  <label>
                    <input type="checkbox" [checked]="paymentVisible(col)" (change)="togglePaymentColumn(col, $any($event.target).checked)" />
                    {{ paymentLabel(col) }}
                    <button type="button" (click)="$event.preventDefault(); movePaymentColumn(i, -1)">↑</button>
                    <button type="button" (click)="$event.preventDefault(); movePaymentColumn(i, 1)">↓</button>
                  </label>
                }
              </div>
            }
            <div class="list-pane">
              <table class="plain">
                <thead><tr>@for (col of visiblePaymentColumns(); track col) { <th>{{ paymentLabel(col) }}</th> }</tr></thead>
                <tbody>
                  @for (row of payments(); track row.id) {
                    <tr>@for (col of visiblePaymentColumns(); track col) { <td>{{ paymentCell(row, col) }}</td> }</tr>
                  }
                </tbody>
              </table>
            </div>
          </mat-tab>

          <mat-tab label="Исполнительная надпись">
            <p class="muted tab-note">Надпись создаётся по этому лицевому счёту. Период можно сузить до свободных предъявленных месяцев: предыдущий и текущий месяц в долг не входят. Долг, пеня, ФИО и тариф за выбранный период читаются из выгрузки и не правятся. Дата вручения или дата акта о невручении подставляется из мероприятия и правится. Срок погашения — 7 календарных дней и тоже правится. Нотариальную контору выбирают из справочника Белорусской нотариальной палаты или вписывают, если её там нет. Тарифа в файле АИС нет.</p>
            @for (msg of writBlockers(); track msg) { <p class="alert danger">{{ msg }}</p> }
            @if (writError()) { <p class="alert danger">{{ writError() }}</p> }
            <div class="filters">
              <mat-form-field><mat-label>Период с</mat-label><input matInput type="date" [(ngModel)]="writFrom" (change)="refreshWritWindow()" /></mat-form-field>
              <mat-form-field><mat-label>Период по</mat-label><input matInput type="date" [(ngModel)]="writTo" (change)="refreshWritWindow()" /></mat-form-field>
              <mat-form-field><mat-label>Дата вручения предупреждения</mat-label><input matInput type="date" [(ngModel)]="writWarning" (change)="refreshWritWindow()" /></mat-form-field>
              <mat-form-field><mat-label>Дата акта о невручении</mat-label><input matInput type="date" [(ngModel)]="writAct" (change)="refreshWritWindow()" /></mat-form-field>
              <mat-form-field><mat-label>Дней на погашение</mat-label><input matInput type="number" [(ngModel)]="writDays" /></mat-form-field>
              <mat-form-field class="reason"><mat-label>Нотариальная контора</mat-label>
                <input matInput [(ngModel)]="writOffice" [matAutocomplete]="officeList" />
                <mat-autocomplete #officeList="matAutocomplete">
                  @for (row of officeChoices(); track row.code) {
                    <mat-option [value]="row.name">{{ row.name }}@if (row.district) { — {{ row.district }} }</mat-option>
                  }
                </mat-autocomplete>
              </mat-form-field>
            </div>
            <dl class="sheet">
              <div><dt>Долг по услугам</dt><dd>{{ writPreview()?.principal || '—' }}</dd></div>
              <div><dt>Пеня</dt><dd>{{ writPreview()?.penalty || '—' }}</dd></div>
              <div><dt>Тариф нотариуса</dt><dd>{{ writPreview()?.tariff || 'не передано из АИС' }}</dd></div>
              <div><dt>ФИО ответчика</dt><dd>{{ writPreview()?.defendant_name || '—' }}</dd></div>
            </dl>
            @if (auth.canWrite()) {
              <button mat-flat-button color="primary" (click)="saveWrit()">Сохранить и открыть пакет документов</button>
            }
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
                    <span>{{ row.notary_office }}</span>
                    <span>вручение {{ row.warning_delivered_on || '—' }}, акт {{ row.non_delivery_act_on || '—' }}</span>
                    <span>погашение {{ row.repayment_days }} календарных дн.</span>
                    @for (doc of row.documents; track doc.id) { <span>{{ doc.name }}</span> }
                  </div>
                }
              </article>
            }
          </mat-tab>

          <mat-tab label="История сумм задолженности">
            <p class="muted tab-note">Остаток основного долга и пени по каждой услуге и каждому периоду задолженности. Цифры из АИС «Расчет-ЖКУ»: это непогашенный остаток, а не список оплат и не журнал смены группы или рейтинга.</p>
            <div class="list-pane"><table mat-table [dataSource]="balances()">
              <ng-container matColumnDef="period"><th mat-header-cell *matHeaderCellDef>Период</th><td mat-cell *matCellDef="let r">{{ r.period | date: 'MM.yyyy' }}</td></ng-container>
              <ng-container matColumnDef="service_name"><th mat-header-cell *matHeaderCellDef>Наименование услуги</th><td mat-cell *matCellDef="let r">{{ r.service_name }}</td></ng-container>
              <ng-container matColumnDef="principal"><th mat-header-cell *matHeaderCellDef>Остаток основного долга <app-byn-sign /></th><td mat-cell *matCellDef="let r"><app-money [value]="r.principal" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="penalty"><th mat-header-cell *matHeaderCellDef>Остаток пени <app-byn-sign /></th><td mat-cell *matCellDef="let r"><app-money [value]="r.penalty" [blank]="false" /></td></ng-container>
              <tr mat-header-row *matHeaderRowDef="balanceColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: balanceColumns"></tr>
            </table></div>
          </mat-tab>

          <mat-tab label="Работа с задолженностью">
            <p class="muted tab-note">Документы мероприятий по этому лицевому счёту: предупреждение, отключение, исполнительная надпись, иск, закрытие. Внутри лежат невозможность взыскания, расчёт и оплата по исполнительному документу. Это не файл оплат и не журнал рейтинга.</p>
            <div class="filters">
              <button mat-stroked-button (click)="workTab = 'docs'; loadWork()">Документы</button>
              <button mat-stroked-button (click)="workTab = 'impossibility'; loadWork()">Невозможность взыскания</button>
              <button mat-stroked-button (click)="workTab = 'calculation'; loadWork()">Расчёт задолженности</button>
              <button mat-stroked-button (click)="workTab = 'payment'; loadWork()">Оплата по взысканию</button>
            </div>
            <div class="filters">
              <mat-form-field><mat-label>Долг от</mat-label><input matInput [(ngModel)]="workPrincipal" (change)="loadWork()" /><span matTextSuffix><app-byn-sign /></span></mat-form-field>
              <mat-form-field><mat-label>Пеня от</mat-label><input matInput [(ngModel)]="workPenalty" (change)="loadWork()" /><span matTextSuffix><app-byn-sign /></span></mat-form-field>
              <mat-form-field><mat-label>Оплата от</mat-label><input matInput [(ngModel)]="workPaid" (change)="loadWork()" /><span matTextSuffix><app-byn-sign /></span></mat-form-field>
              <mat-form-field><mat-label>Начало с</mat-label><input matInput type="date" [(ngModel)]="workFrom" (change)="loadWork()" /></mat-form-field>
              <mat-form-field><mat-label>Начало по</mat-label><input matInput type="date" [(ngModel)]="workTo" (change)="loadWork()" /></mat-form-field>
              @if (auth.canWrite()) {
                <button mat-stroked-button (click)="addWork()">Добавить документ</button>
              }
            </div>
            <div class="list-pane"><table mat-table [dataSource]="work()">
              <ng-container matColumnDef="kind_display"><th mat-header-cell *matHeaderCellDef>Вид</th><td mat-cell *matCellDef="let r">{{ r.kind_display }}</td></ng-container>
              <ng-container matColumnDef="title"><th mat-header-cell *matHeaderCellDef>Наименование</th><td mat-cell *matCellDef="let r">{{ r.title }}</td></ng-container>
              <ng-container matColumnDef="started_on"><th mat-header-cell *matHeaderCellDef>Начало</th><td mat-cell *matCellDef="let r">{{ r.started_on | date: 'dd.MM.yyyy' }}</td></ng-container>
              <ng-container matColumnDef="ended_on"><th mat-header-cell *matHeaderCellDef>Окончание</th><td mat-cell *matCellDef="let r">{{ r.ended_on | date: 'dd.MM.yyyy' }}</td></ng-container>
              <ng-container matColumnDef="principal"><th mat-header-cell *matHeaderCellDef>Долг <app-byn-sign /></th><td mat-cell *matCellDef="let r"><app-money [value]="r.principal" /></td></ng-container>
              <ng-container matColumnDef="penalty"><th mat-header-cell *matHeaderCellDef>Пеня <app-byn-sign /></th><td mat-cell *matCellDef="let r"><app-money [value]="r.penalty" /></td></ng-container>
              <ng-container matColumnDef="paid_principal"><th mat-header-cell *matHeaderCellDef>Оплата <app-byn-sign /></th><td mat-cell *matCellDef="let r"><app-money [value]="r.paid_principal" /></td></ng-container>
              <tr mat-header-row *matHeaderRowDef="workColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: workColumns"></tr>
            </table></div>
          </mat-tab>

        <mat-tab [label]="'История изменений (' + history().length + ')'">
            <p class="muted tab-note">Журнал пишет смену группы, рейтинга, этапа воронки, сценария, контакта, категории должника, наследственного дела, регистрации, фактического проживания и юридического статуса. Кто изменил, когда и какое было основание, видно в строке.</p>
            <div class="list-pane"><table mat-table [dataSource]="history()">
              <ng-container matColumnDef="created_at"><th mat-header-cell *matHeaderCellDef>Когда</th><td mat-cell *matCellDef="let r">{{ r.created_at | date: 'dd.MM.yyyy HH:mm' }}</td></ng-container>
              <ng-container matColumnDef="kind"><th mat-header-cell *matHeaderCellDef>Что</th><td mat-cell *matCellDef="let r">{{ historyKind(r.kind) }}</td></ng-container>
              <ng-container matColumnDef="old_value"><th mat-header-cell *matHeaderCellDef>Было</th><td mat-cell *matCellDef="let r">{{ r.old_value || '—' }}</td></ng-container>
              <ng-container matColumnDef="new_value"><th mat-header-cell *matHeaderCellDef>Стало</th><td mat-cell *matCellDef="let r">{{ r.new_value || '—' }}</td></ng-container>
              <ng-container matColumnDef="reason"><th mat-header-cell *matHeaderCellDef>Основание</th><td mat-cell *matCellDef="let r">{{ r.reason }}@if (r.author_name) { · {{ r.author_name }} }</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="historyColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: historyColumns"></tr>
            </table></div>
          </mat-tab>
        </mat-tab-group>

        @if (sharesOpen()) {
          <div class="backdrop" (click)="sharesOpen.set(false)">
            <div class="dialog" (click)="$event.stopPropagation()" role="dialog" aria-label="Состав долга">
              <h3>Кому должен лицевой счёт {{ a.client_account }}</h3>
              <div class="list-pane"><table class="shares">
                <thead><tr><th>Краткое наименование поставщика</th><th>Исходящее сальдо с пенями <app-byn-sign /></th><th>Исходящее сальдо пени <app-byn-sign /></th><th>Итого <app-byn-sign /></th></tr></thead>
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
    </div>
  `,
  styles: `
    .crumbs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; color: var(--erip-muted); margin-bottom: 12px; }
    .uen { margin: 0 0 8px; color: #6b7280; font-size: 13px; }
    .contact-add { align-items: flex-end; }
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
    .step-head, .check-line { display: flex; gap: 12px; align-items: center; margin: 6px 0; }
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
    .crumbs b { color: #1f2933; }
    .sep { opacity: .6; }
    .spacer { flex: 1; }
    .head { padding: 20px 24px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 16px; }
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
  protected readonly sending = signal(false);
  protected readonly stages = [
    { code: 'new', title: 'Новый должник' },
    { code: 'prevention', title: 'Автообзвон/уведомления' },
    { code: 'warning', title: 'Предупреждение вручено' },
    { code: 'disconnect', title: 'Отключение услуг' },
    { code: 'enforcement', title: 'Исполнительная надпись / иск' },
    { code: 'court', title: 'ОПИ' },
    { code: 'closed', title: 'Не должник' },
  ];
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
  protected residence = '';
  protected inheritance = false;
  protected inheritanceUntil = '';
  protected fileType = 'Скан';
  protected manualGroup: number | null = null;
  protected manualReason = '';
  protected templateId: number | null = null;
  protected servicePicker = false;
  protected serviceMenuTop = 0;
  protected serviceMenuLeft = 0;
  protected paymentPicker = false;
  protected warningDelivered = '';
  protected warningFile: File | null = null;
  protected writFrom = '';
  protected writTo = '';
  protected writWarning = '';
  protected writAct = '';
  protected writDays = 7;
  protected writOffice = '';
  protected readonly notaryOffices = signal<NotaryOffice[]>([]);
  protected writError = signal('');
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

  ngOnInit(): void {
    this.api.notaryOffices().subscribe({
      next: (page) => this.notaryOffices.set(page.results),
      error: () => this.notaryOffices.set([]),
    });
    const id = Number(this.id());
    forkJoin({
      account: this.api.account(id),
      services: this.api.accountServices(id, false),
      scenario: this.api.accountScenario(id),
      writ: this.api.writDraft(id),
      payments: this.api.accountPayments(id),
      registrations: this.api.accountRegistrations(id),
      templates: this.api.templates({ is_active: true, page_size: 100 }),
      balances: this.api.accountBalances(id),
      history: this.api.accountHistory(id),
      work: this.api.accountWork(id),
      contacts: this.api.accountContacts(id),
      files: this.api.accountFiles(id),
      categories: this.api.categories(),
      measures: this.api.accountMeasures(id),
      checks: this.api.writChecks(id),
      serviceColumns: this.api.cardColumns('services'),
      paymentColumns: this.api.cardColumns('payments'),
    }).subscribe({
      next: (r) => {
        this.account.set(r.account);
        this.manualGroup = r.account.debt_group_manual;
        this.manualReason = r.account.debt_group_manual_reason;
        this.contactMode = r.account.contact_source_mode || 'combined';
        this.categoryId = r.account.debtor_category;
        this.residence = r.account.residence_note;
        this.inheritance = r.account.inheritance_case;
        this.inheritanceUntil = r.account.inheritance_until || '';
        this.services.set(r.services.results);
        this.payments.set(r.payments.results);
        this.registrations.set(r.registrations.results);
        this.balances.set(r.balances.results);
        this.history.set(r.history.results);
        this.work.set(r.work.results);
        this.contacts.set(r.contacts.results);
        this.files.set(r.files.results);
        this.categories.set(r.categories.results);
        this.measures.set(r.measures.results);
        this.checks.set(r.checks);
        this.scenario.set(r.scenario);
        this.writ.set(r.writ);
        this.writFrom = r.writ.eligible_from || '';
        this.writTo = r.writ.eligible_to || '';
        this.writWarning = r.writ.warning_delivered_on || '';
        this.writAct = r.writ.non_delivery_act_on || '';
        this.writDays = r.writ.repayment_days || 7;
        this.applyCardColumns('services', r.serviceColumns);
        this.applyCardColumns('payments', r.paymentColumns);
        if (this.route.snapshot.queryParamMap.get('tab') === 'writ') this.tabIndex.set(6);
        const group = r.account.effective_group;
        const list = r.templates.results.filter((t) => (['email', 'sms', 'voice'] as Channel[]).includes(t.channel));
        const forGroup = group == null ? [] : list.filter((t) => t.debt_group === group);
        this.templates.set(forGroup.length ? forGroup : list);
        this.templateId = (forGroup[0] ?? list[0])?.id ?? null;
        this.loadPeers(r.account);
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  refreshNow(): void {
    const a = this.account();
    if (!a) return;
    this.api.refreshAccount(a.id).subscribe({
      next: () => this.snack.open('Данные ЛС пересчитаны по последней загруженной выгрузке АИС', 'OK', { duration: 4000 }),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
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
    if (!a || !this.contactValue.trim()) return;
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
    return this.stages.find((stage) => stage.code === code)?.title || code || '—';
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
      inheritance_until: this.inheritanceUntil || null,
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

  protected accountPeriod(account: AccountDetail): string {
    if (!account.start_date) return '—';
    const start = this.formatDay(account.start_date);
    if (!account.stop_date || account.stop_date.startsWith('2100-01-01')) return `с ${start}`;
    return `с ${start} по ${this.formatDay(account.stop_date)}`;
  }

  protected quantity(value: string | null): string {
    if (value == null || value === '') return '—';
    const number = Number(value);
    if (Number.isNaN(number)) return value;
    return number.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
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

  protected stepOpen(step: ScenarioStep): boolean {
    return step.measures.length > 0;
  }

  protected writPreview(): WritDraft | null {
    return this.writ();
  }

  protected officeChoices(): NotaryOffice[] {
    const query = this.writOffice.trim().toLowerCase();
    const catalog = this.notaryOffices();
    const rows = catalog.length
      ? catalog
      : (this.writPreview()?.offices || []).map((name) => ({ code: name, name, district: '', address: '', phones: '' }));
    const matched = query
      ? rows.filter((row) => `${row.name} ${row.district} ${row.address}`.toLowerCase().includes(query))
      : rows;
    return matched.slice(0, 30);
  }

  protected writBlockers(): string[] {
    return this.writ()?.blockers || [];
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

  protected toggleServicePicker(event: Event): void {
    const button = event.currentTarget as HTMLElement;
    const box = button.getBoundingClientRect();
    this.serviceMenuTop = box.bottom + 4;
    this.serviceMenuLeft = Math.min(box.left, window.innerWidth - 376);
    this.servicePicker = !this.servicePicker;
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
      account_provider_id: 'Код обслуживающей', provider_id: 'Код поставщика', provider_short_name: 'Поставщик',
      service_id: 'Код услуги', service_name: 'Услуга', pay_service_summ: 'Оплата услуг', pay_mulct_summ: 'Оплата пени',
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

  protected paymentCell(row: Payment, col: string): string {
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

  protected refreshWritWindow(): void {
    const account = this.account();
    if (!account) return;
    this.api.writDraft(account.id, {
      debt_from: this.writFrom,
      debt_to: this.writTo,
      warning_delivered_on: this.writWarning,
      non_delivery_act_on: this.writAct,
    }).subscribe({
      next: (draft) => this.writ.set(draft),
      error: (e) => this.writError.set(errorMessage(e)),
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

  protected saveWrit(): void {
    const account = this.account();
    if (!account) return;
    this.writError.set('');
    this.api.createWrit(account.id, {
      debt_from: this.writFrom, debt_to: this.writTo, warning_delivered_on: this.writWarning,
      non_delivery_act_on: this.writAct, repayment_days: this.writDays, notary_office: this.writOffice,
    }).subscribe({
      next: (row) => this.router.navigate(['/claims', row.id], { queryParams: { tab: 'pack' } }),
      error: (e) => this.writError.set(errorMessage(e)),
    });
  }

  protected downloadFile(row: AttachmentRow): void {
    const request = row.package && row.claim_id && row.doc_id
      ? this.api.downloadClaimFile(row.claim_id, row.doc_id)
      : this.api.downloadAttachment(Number(row.id));
    request.subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = row.original_name;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
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
    this.api.accountScenario(account.id).subscribe((board) => this.scenario.set(board));
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
