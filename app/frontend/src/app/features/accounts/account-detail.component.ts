import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
import { RouterLink } from '@angular/router';
import { finalize, forkJoin } from 'rxjs';

import { ApiService, errorMessage } from '../../core/api.service';
import { BynSignComponent, MoneyComponent } from '../../core/money.component';
import { AuthService } from '../../core/auth.service';
import {
  AccountDetail, AccountService, AttachmentRow, BalanceRow, Channel, ContactRow, DebtorCategory, DebtShare, HistoryRow, MeasureRow, MessageTemplate, Payment, Registration, WorkItem,
} from '../../core/models';

@Component({
  selector: 'app-account-detail',
  standalone: true,
  imports: [
    DatePipe, FormsModule, RouterLink, MatTabsModule, MatTableModule, MatCardModule, MatButtonModule, MoneyComponent, BynSignComponent,
    MatFormFieldModule, MatSelectModule, MatInputModule, MatSnackBarModule, MatCheckboxModule, MatIconModule,
  ],
  template: `
    <div class="page">
      @if (error()) { <p class="alert danger"><mat-icon>error_outline</mat-icon>{{ error() }}</p> }

      @if (account(); as a) {
        <div class="crumbs">
          <a routerLink="/accounts">Реестр ЛС</a>
          @if (a.effective_group) { <span class="sep">›</span><span>Группа {{ a.effective_group }}</span> }
          <span class="sep">›</span><b>{{ a.short_fio || a.client_account }}</b>
          <span class="spacer"></span>
          <div class="stages">
            @for (stage of stages; track stage.code; let i = $index) {
              <span class="stage" [class.done]="i < stageIndex()" [class.current]="i === stageIndex()">{{ stage.title }}</span>
            }
          </div>
        </div>

        <section class="surface head">
          <div class="title-row">
            <div>
              <h2>{{ a.short_fio || 'ЛС ' + a.client_account }}</h2>
              <div class="muted sub">
                Лицевой счёт (Номер ЛС) {{ a.client_account }}
                @if (a.account_address || a.house_address) { · {{ a.account_address || a.house_address }} }
                @if (auth.showServiceOrg() && a.provider_short_name) { · {{ a.provider_short_name }} }
                @if (a.ownership_type_name) { · {{ a.ownership_type_name }} }
                @if (a.acc_total_space) { · {{ a.acc_total_space }} м² }
              </div>
            </div>
            <div class="badges">
              @if (a.effective_group) {
                <span class="group-badge g{{ a.effective_group }}">Группа {{ a.effective_group }}@if (a.group_name) { · {{ a.group_name }} }</span>
              }
              @if (a.rating_label) { <span class="rating-badge r{{ a.rating_label[0] }}" title="Рейтинг">{{ a.rating_label }}</span> }
              @if (auth.canWrite()) {
                <button mat-stroked-button (click)="refreshNow()"><mat-icon>sync</mat-icon> Обновить сейчас</button>
              }
            </div>
          </div>

          <div class="facts">
            <div>
              <div class="fact"><span>ФИО плательщика / Наименование юридического лица</span><b class="link">{{ a.short_fio || '—' }}</b></div>
              <div class="fact"><span>Кол-во проживающих</span><b>{{ a.subj_count ?? '—' }}</b></div>
              <div class="fact"><span>Дата возникновения долга</span><b>{{ (a.debt_started_on | date: 'dd.MM.yyyy') || '—' }}</b></div>
              <div class="fact"><span>Закреплённый специалист</span><b>{{ a.assigned_name || '—' }}</b></div>
            </div>
            <div>
              <div class="fact"><span>Сумма основного долга</span><b class="money-line"><button type="button" class="sum-btn" (click)="openShares()"><app-money [value]="principalTotal()" [blank]="false" /></button></b></div>
              <div class="fact"><span>Сумма пени</span><b class="money-line amount-danger"><app-money [value]="penaltyTotal()" [blank]="false" /></b></div>
              <div class="fact"><span>Сумма задолженности</span><b class="money-line"><app-money [value]="obligationTotal()" [blank]="false" /></b></div>
              <div class="fact"><span>Обновлено из АИС</span><b>{{ (a.ais_updated_at | date: 'dd.MM.yyyy HH:mm') || '—' }}</b></div>
              <div class="fact"><span>Сценарий</span><b class="link">{{ a.scenario_brief || a.scenario_name || '—' }}</b></div>
            </div>
          </div>

          @if (a.inheritance_case) {
            <div class="alert warning">
              <mat-icon>flag</mat-icon>
              Наследственное дело: автоматические мероприятия остановлены
              @if (a.inheritance_until) { до {{ a.inheritance_until | date: 'dd.MM.yyyy' }} }
            </div>
          }
          @if (a.bankruptcy) { <div class="alert danger"><mat-icon>gavel</mat-icon>Банкротство должника</div> }
        </section>

        <mat-tab-group class="surface tabs">
          <mat-tab label="Общие">
            <div class="grid">
              <mat-card><mat-card-content>
                <dl>
                  <dt>ФИО плательщика / Наименование юридического лица</dt><dd>{{ a.short_fio }}</dd>
                  <dt>Адрес ЛС запросом (Адрес)</dt><dd>{{ a.account_address || a.house_address }}</dd>
                  @if (auth.showSchema()) { <dt>Наименование схемы</dt><dd>{{ a.schema_label }}</dd> }
                  @if (auth.showServiceOrg()) { <dt>Краткое наименование поставщика или обслуживающей организации</dt><dd>{{ a.provider_short_name }}</dd> }
                  <dt>Уникальный единый номер (УЕН)</dt><dd>{{ a.unified_account }}</dd>
                  <dt>Тип собственности</dt><dd>{{ a.ownership_type_name }}</dd>
                  <dt>Тип объекта жилфонда</dt><dd>{{ a.acc_category_full || '—' }}</dd>
                  <dt>Общая площадь</dt><dd>{{ a.acc_total_space }}</dd>
                  <dt>Кол-во комнат</dt><dd>{{ a.room_count ?? '—' }}</dd>
                  <dt>Кол-во проживающих</dt><dd>{{ a.subj_count ?? '—' }}</dd>
                  <dt>Контактный телефон</dt><dd>{{ a.contact_phone || '—' }}</dd>
                  <dt>Телефон</dt><dd>{{ a.phone || '—' }}</dd>
                  <dt>Дата открытия ЛС (Период действия)</dt><dd>{{ a.start_date | date: 'dd.MM.yyyy' }}</dd>
                  <dt>Дата закрытия ЛС (Период действия)</dt><dd>{{ a.stop_date | date: 'dd.MM.yyyy' }}</dd>
                </dl>
              </mat-card-content></mat-card>
              <mat-card><mat-card-content>
                <dl>
                  <dt>Входящее сальдо</dt><dd><app-money [value]="a.balance_in" [blank]="false" /></dd>
                  <dt>Итого начислено</dt><dd><app-money [value]="a.total_calc_sum" [blank]="false" /></dd>
                  <dt>Распределенная оплата</dt><dd><app-money [value]="a.pay_sum" [blank]="false" /></dd>
                  <dt>Сумма основного долга</dt><dd class="money-line"><button type="button" class="sum-btn" (click)="openShares()"><app-money [value]="principalTotal()" [blank]="false" /></button></dd>
                  <dt>Сумма пени</dt><dd class="money-line amount-danger"><app-money [value]="penaltyTotal()" [blank]="false" /></dd>
                  <dt>Сумма задолженности</dt><dd class="money-line"><app-money [value]="obligationTotal()" [blank]="false" /></dd>
                  <dt>Обновлено из АИС</dt><dd>{{ a.ais_updated_at | date: 'dd.MM.yyyy HH:mm' }}</dd>
                  <dt>Операционная дата</dt><dd>{{ a.operational_date | date: 'dd.MM.yyyy' }}</dd>
                  <dt>Рейтинг должника</dt><dd>{{ a.rating_label || '—' }}</dd>
                  <dt>Дата возникновения</dt><dd>{{ a.debt_started_on | date: 'dd.MM.yyyy' }}</dd>
                  <dt>Сценарий</dt><dd>{{ a.scenario_brief || a.scenario_name || '—' }}</dd>
                  <dt>Идентификационный номер (ИН)</dt><dd>{{ a.payer_identifier || '—' }}</dd>
                  <dt>Учётный номер плательщика (УНП)</dt><dd>{{ a.payer_unp || '—' }}</dd>
                </dl>
                @if (auth.canWrite() && auth.me()?.contour !== 'supplier') {
                <h4>Ручная корректировка группы</h4>
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
              </mat-card-content></mat-card>
            </div>
          </mat-tab>

          <mat-tab label="Регистрация лиц ({{ registrations().length }})">
            <div class="list-pane"><table mat-table [dataSource]="registrations()">
              <ng-container matColumnDef="full_name"><th mat-header-cell *matHeaderCellDef>Фамилия, Имя, Отчество</th><td mat-cell *matCellDef="let r">{{ r.full_name }} @if (r.subj_is_main) { <b>(Является плательщиком)</b> }</td></ng-container>
              <ng-container matColumnDef="birthday"><th mat-header-cell *matHeaderCellDef>Дата рождения</th><td mat-cell *matCellDef="let r">{{ r.birthday | date: 'dd.MM.yyyy' }}</td></ng-container>
              <ng-container matColumnDef="relation_degree_name"><th mat-header-cell *matHeaderCellDef>Наименование степени родства</th><td mat-cell *matCellDef="let r">{{ r.relation_degree_name }}</td></ng-container>
              <ng-container matColumnDef="reg_type_name"><th mat-header-cell *matHeaderCellDef>Тип регистрации</th><td mat-cell *matCellDef="let r">{{ r.reg_type_name }}</td></ng-container>
              <ng-container matColumnDef="debtor_role"><th mat-header-cell *matHeaderCellDef>Роль</th><td mat-cell *matCellDef="let r">{{ r.debtor_role }}</td></ng-container>
              <ng-container matColumnDef="contacts"><th mat-header-cell *matHeaderCellDef>Контактный телефон, E-mail</th><td mat-cell *matCellDef="let r">{{ r.contact_phone }} {{ r.email }}</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="registrationColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: registrationColumns"></tr>
            </table></div>
          </mat-tab>

          <mat-tab label="Услуги ({{ services().length }})">
            <p class="muted tab-note">Колонки совпадают с файлом услуг. «Кол-во месяцев долга» — то же число, что «Кол-во периодов долга»: сколько разных месяцев долга пришло из АИС. «Поставщик услуги» — краткое имя. «Группа задолженности» считает ПМ, в файле её нет.</p>
            <div class="list-pane service-pane"><table mat-table [dataSource]="services()">
              <ng-container matColumnDef="report_group_id"><th mat-header-cell *matHeaderCellDef>ID группы отчёта</th><td mat-cell *matCellDef="let s">{{ s.report_group_id ?? '—' }}</td></ng-container>
              <ng-container matColumnDef="netting_mulct_sum"><th mat-header-cell *matHeaderCellDef>Взаимозачет пени</th><td mat-cell *matCellDef="let s"><app-money [value]="s.netting_mulct_sum" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="netting_sum"><th mat-header-cell *matHeaderCellDef>Взаимозачет по услуге</th><td mat-cell *matCellDef="let s"><app-money [value]="s.netting_sum" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="calc_sum"><th mat-header-cell *matHeaderCellDef>Всего начислено</th><td mat-cell *matCellDef="let s"><app-money [value]="s.calc_sum" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="balance_in"><th mat-header-cell *matHeaderCellDef>Входящее сальдо без пени</th><td mat-cell *matCellDef="let s"><app-money [value]="s.balance_in" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="balance_mulct_in"><th mat-header-cell *matHeaderCellDef>Входящее сальдо пени</th><td mat-cell *matCellDef="let s"><app-money [value]="s.balance_mulct_in" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="start_date"><th mat-header-cell *matHeaderCellDef>Дата начала действия услуги (Дата с)</th><td mat-cell *matCellDef="let s">{{ (s.start_date | date: 'dd.MM.yyyy') || '—' }}</td></ng-container>
              <ng-container matColumnDef="stop_date"><th mat-header-cell *matHeaderCellDef>Дата окончания действия услуги (Дата по)</th><td mat-cell *matCellDef="let s">{{ (s.stop_date | date: 'dd.MM.yyyy') || '—' }}</td></ng-container>
              <ng-container matColumnDef="balance_mulct_out"><th mat-header-cell *matHeaderCellDef>Исходящее сальдо пени</th><td mat-cell *matCellDef="let s" [class.amount-danger]="+s.balance_mulct_out > 0"><app-money [value]="s.balance_mulct_out" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="balance_out"><th mat-header-cell *matHeaderCellDef>Исходящее сальдо с пенями</th><td mat-cell *matCellDef="let s"><app-money [value]="s.balance_out" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="service_list_id"><th mat-header-cell *matHeaderCellDef>Код договора на услугу (ID Договора)</th><td mat-cell *matCellDef="let s">{{ s.service_list_id }}</td></ng-container>
              <ng-container matColumnDef="ais_account_id"><th mat-header-cell *matHeaderCellDef>Код ЛС (ID ЛС)</th><td mat-cell *matCellDef="let s">{{ s.ais_account_id }}</td></ng-container>
              <ng-container matColumnDef="calculation_id"><th mat-header-cell *matHeaderCellDef>Код операции расчета (ID Расчёта)</th><td mat-cell *matCellDef="let s">{{ s.calculation_id ?? '—' }}</td></ng-container>
              <ng-container matColumnDef="provider_id"><th mat-header-cell *matHeaderCellDef>Код поставщика услуги</th><td mat-cell *matCellDef="let s">{{ s.provider_id ?? '—' }}</td></ng-container>
              <ng-container matColumnDef="sort_code"><th mat-header-cell *matHeaderCellDef>Код сортировки</th><td mat-cell *matCellDef="let s">{{ s.sort_code ?? '—' }}</td></ng-container>
              <ng-container matColumnDef="service_id"><th mat-header-cell *matHeaderCellDef>Код услуги (ID Услуги)</th><td mat-cell *matCellDef="let s">{{ s.service_id }}</td></ng-container>
              <ng-container matColumnDef="debt_period"><th mat-header-cell *matHeaderCellDef>Кол-во периодов долга</th><td mat-cell *matCellDef="let s">{{ s.debt_period ?? '—' }}</td></ng-container>
              <ng-container matColumnDef="shot_name"><th mat-header-cell *matHeaderCellDef>Краткое наименование поставщика</th><td mat-cell *matCellDef="let s">{{ s.shot_name || '—' }}</td></ng-container>
              <ng-container matColumnDef="calc_priv_sum"><th mat-header-cell *matHeaderCellDef>Льгота</th><td mat-cell *matCellDef="let s"><app-money [value]="s.calc_priv_sum" [blank]="false" /></td></ng-container>
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
              <ng-container matColumnDef="calc_result_sum"><th mat-header-cell *matHeaderCellDef>Начислено</th><td mat-cell *matCellDef="let s"><app-money [value]="s.calc_result_sum" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="spent_fact"><th mat-header-cell *matHeaderCellDef>Начислено (количество)</th><td mat-cell *matCellDef="let s">{{ s.spent_fact ?? '—' }}</td></ng-container>
              <ng-container matColumnDef="mulct_sum"><th mat-header-cell *matHeaderCellDef>Начислено пени</th><td mat-cell *matCellDef="let s"><app-money [value]="s.mulct_sum" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="recalc_sum"><th mat-header-cell *matHeaderCellDef>Перерасчёт</th><td mat-cell *matCellDef="let s"><app-money [value]="s.recalc_sum" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="mulct_recalc_sum"><th mat-header-cell *matHeaderCellDef>Перерасчет по пене</th><td mat-cell *matCellDef="let s"><app-money [value]="s.mulct_recalc_sum" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="full_name"><th mat-header-cell *matHeaderCellDef>Полное наименование поставщика</th><td mat-cell *matCellDef="let s">{{ s.full_name || '—' }}</td></ng-container>
              <ng-container matColumnDef="overdue_debt"><th mat-header-cell *matHeaderCellDef>Просроченная задолженность</th><td mat-cell *matCellDef="let s"><app-money [value]="s.overdue_debt" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="share_mulct_summ"><th mat-header-cell *matHeaderCellDef>Распределённая оплата пени в текущем опер. периоде</th><td mat-cell *matCellDef="let s"><app-money [value]="s.share_mulct_summ" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="share_service_summ"><th mat-header-cell *matHeaderCellDef>Распределённая оплата услуг в текущем опер. периоде</th><td mat-cell *matCellDef="let s"><app-money [value]="s.share_service_summ" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="subs_pay"><th mat-header-cell *matHeaderCellDef>Субсидия (сумма субсидии)</th><td mat-cell *matCellDef="let s"><app-money [value]="s.subs_pay" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="tarrif"><th mat-header-cell *matHeaderCellDef>Тариф</th><td mat-cell *matCellDef="let s">{{ s.tarrif ?? '—' }}</td></ng-container>
              <ng-container matColumnDef="calc_date"><th mat-header-cell *matHeaderCellDef>Фактическая дата выполнения расчета (Дата расчёта)</th><td mat-cell *matCellDef="let s">{{ (s.calc_date | date: 'dd.MM.yyyy') || '—' }}</td></ng-container>
              <ng-container matColumnDef="months_debt"><th mat-header-cell *matHeaderCellDef>Кол-во месяцев долга</th><td mat-cell *matCellDef="let s">{{ s.debt_period ?? '—' }}</td></ng-container>
              <ng-container matColumnDef="supplier"><th mat-header-cell *matHeaderCellDef>Поставщик услуги</th>
                <td mat-cell *matCellDef="let s"><a [routerLink]="['/contracts', s.id]">{{ s.shot_name || '—' }}</a></td></ng-container>
              <ng-container matColumnDef="debt_group"><th mat-header-cell *matHeaderCellDef>Группа задолженности</th>
                <td mat-cell *matCellDef="let s">@if (s.effective_group) { <span class="group-badge g{{ s.effective_group }}">{{ s.effective_group }}</span> } @else { — }</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="serviceColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: serviceColumns"></tr>
            </table></div>
          </mat-tab>

          <mat-tab label="Оплата ({{ payments().length }})">
            <div class="list-pane"><table mat-table [dataSource]="payments()">
              <ng-container matColumnDef="pay_date"><th mat-header-cell *matHeaderCellDef>Дата оплаты</th><td mat-cell *matCellDef="let p">{{ p.pay_date | date: 'dd.MM.yyyy' }}</td></ng-container>
              <ng-container matColumnDef="service_name"><th mat-header-cell *matHeaderCellDef>Услуга - Наименование</th><td mat-cell *matCellDef="let p">{{ p.service_name }}</td></ng-container>
              <ng-container matColumnDef="pay_service_summ"><th mat-header-cell *matHeaderCellDef>Оплата услуг по квитанции</th><td mat-cell *matCellDef="let p" class="amount-paid"><app-money [value]="p.pay_service_summ" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="pay_mulct_summ"><th mat-header-cell *matHeaderCellDef>Оплата пени по квитанции</th><td mat-cell *matCellDef="let p"><app-money [value]="p.pay_mulct_summ" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="bank_name"><th mat-header-cell *matHeaderCellDef>Банк - Наименование</th><td mat-cell *matCellDef="let p">{{ p.bank_name }}</td></ng-container>
              <ng-container matColumnDef="payment_type_display"><th mat-header-cell *matHeaderCellDef>Тип оплаты</th><td mat-cell *matCellDef="let p">{{ p.payment_type_display }}</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="paymentColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: paymentColumns"></tr>
            </table></div>
          </mat-tab>

          <mat-tab label="История сумм задолженности">
            <p class="muted tab-note">Остаток основного долга и пени по каждой услуге и каждому периоду задолженности. Цифры из АИС «Расчет-ЖКУ»: это непогашенный остаток, а не список оплат и не журнал смены группы или рейтинга.</p>
            <div class="list-pane"><table mat-table [dataSource]="balances()">
              <ng-container matColumnDef="period"><th mat-header-cell *matHeaderCellDef>Период</th><td mat-cell *matCellDef="let r">{{ r.period | date: 'MM.yyyy' }}</td></ng-container>
              <ng-container matColumnDef="service_name"><th mat-header-cell *matHeaderCellDef>Наименование услуги</th><td mat-cell *matCellDef="let r">{{ r.service_name }}</td></ng-container>
              <ng-container matColumnDef="principal"><th mat-header-cell *matHeaderCellDef>Остаток основного долга</th><td mat-cell *matCellDef="let r"><app-money [value]="r.principal" [blank]="false" /></td></ng-container>
              <ng-container matColumnDef="penalty"><th mat-header-cell *matHeaderCellDef>Остаток пени</th><td mat-cell *matCellDef="let r"><app-money [value]="r.penalty" [blank]="false" /></td></ng-container>
              <tr mat-header-row *matHeaderRowDef="balanceColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: balanceColumns"></tr>
            </table></div>
          </mat-tab>

          <mat-tab label="Группа и рейтинг">
            <div class="list-pane"><table mat-table [dataSource]="history()">
              <ng-container matColumnDef="created_at"><th mat-header-cell *matHeaderCellDef>Когда</th><td mat-cell *matCellDef="let r">{{ r.created_at | date: 'dd.MM.yyyy HH:mm' }}</td></ng-container>
              <ng-container matColumnDef="kind"><th mat-header-cell *matHeaderCellDef>Что</th><td mat-cell *matCellDef="let r">{{ r.kind }}</td></ng-container>
              <ng-container matColumnDef="old_value"><th mat-header-cell *matHeaderCellDef>Было</th><td mat-cell *matCellDef="let r">{{ r.old_value }}</td></ng-container>
              <ng-container matColumnDef="new_value"><th mat-header-cell *matHeaderCellDef>Стало</th><td mat-cell *matCellDef="let r">{{ r.new_value }}</td></ng-container>
              <ng-container matColumnDef="reason"><th mat-header-cell *matHeaderCellDef>Основание</th><td mat-cell *matCellDef="let r">{{ r.reason }}</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="historyColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: historyColumns"></tr>
            </table></div>
          </mat-tab>

          <mat-tab label="Работа с задолженностью">
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
              <ng-container matColumnDef="principal"><th mat-header-cell *matHeaderCellDef>Долг</th><td mat-cell *matCellDef="let r"><app-money [value]="r.principal" /></td></ng-container>
              <ng-container matColumnDef="penalty"><th mat-header-cell *matHeaderCellDef>Пеня</th><td mat-cell *matCellDef="let r"><app-money [value]="r.penalty" /></td></ng-container>
              <ng-container matColumnDef="paid_principal"><th mat-header-cell *matHeaderCellDef>Оплата</th><td mat-cell *matCellDef="let r"><app-money [value]="r.paid_principal" /></td></ng-container>
              <tr mat-header-row *matHeaderRowDef="workColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: workColumns"></tr>
            </table></div>
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
            <div class="list-pane"><table mat-table [dataSource]="contacts()">
              <ng-container matColumnDef="kind"><th mat-header-cell *matHeaderCellDef>Тип</th><td mat-cell *matCellDef="let r">{{ contactKindLabel(r.kind) }}</td></ng-container>
              <ng-container matColumnDef="value"><th mat-header-cell *matHeaderCellDef>Значение</th><td mat-cell *matCellDef="let r">{{ r.value }}</td></ng-container>
              <ng-container matColumnDef="source"><th mat-header-cell *matHeaderCellDef>Источник</th><td mat-cell *matCellDef="let r">{{ contactSourceLabel(r.source) }}@if (r.source === 'ais' && r.ais_updated_at) { · {{ r.ais_updated_at | date: 'dd.MM.yyyy' }} }</td></ng-container>
              <ng-container matColumnDef="priority"><th mat-header-cell *matHeaderCellDef>Приоритет</th><td mat-cell *matCellDef="let r">{{ r.priority }}</td></ng-container>
              <ng-container matColumnDef="actions"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let r">
                @if (auth.canWrite() && r.source === 'pm') {
                  <button mat-button (click)="editContact(r)">Изменить</button>
                  <button mat-button (click)="removeContact(r)">Удалить</button>
                }
              </td></ng-container>
              <tr mat-header-row *matHeaderRowDef="contactColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: contactColumns"></tr>
            </table></div>
          </mat-tab>

          <mat-tab label="Категория и наследство">
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
            @if (!auth.canWrite()) {
              <p class="muted">{{ a.residence_note || 'Фактическое проживание не указано' }}@if (a.inheritance_case) { · наследственное дело }</p>
            }
          </mat-tab>

          <mat-tab label="Мероприятия">
            <p><a routerLink="/measures">Реестр мероприятий</a></p>
            <div class="list-pane"><table mat-table [dataSource]="measures()">
              <ng-container matColumnDef="kind_display"><th mat-header-cell *matHeaderCellDef>Вид</th><td mat-cell *matCellDef="let r"><a [routerLink]="['/measures', r.id]"><span class="kind-chip {{ r.kind }}">{{ r.title || r.kind_display }}</span></a>@if (r.owner_name) { · {{ r.owner_name }} }</td></ng-container>
              <ng-container matColumnDef="status_display"><th mat-header-cell *matHeaderCellDef>Статус партии</th><td mat-cell *matCellDef="let r"><span class="status-pill {{ r.status }}">{{ r.status_display }}</span></td></ng-container>
              <ng-container matColumnDef="account_item_status"><th mat-header-cell *matHeaderCellDef>По этому ЛС</th><td mat-cell *matCellDef="let r">{{ r.account_item_status || '—' }}</td></ng-container>
              <ng-container matColumnDef="due_on"><th mat-header-cell *matHeaderCellDef>Срок</th><td mat-cell *matCellDef="let r">{{ r.due_on }}</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="measureColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: measureColumns"></tr>
            </table></div>
          </mat-tab>

          <mat-tab label="Исполнительная надпись">
            <div class="checklist">
              <div class="progress-label">Готово к формированию пакета: <b>{{ checksDone() }} / {{ checks().length }}</b></div>
              <div class="progress"><div [style.width.%]="checks().length ? checksDone() * 100 / checks().length : 0"></div></div>
              @for (item of checks(); track item.code) {
                <div class="check" [class.done]="item.done">
                  <mat-checkbox [checked]="item.done" [disabled]="!auth.canWrite()" (change)="toggleCheck(item.code, $event.checked)">{{ item.title }}</mat-checkbox>
                </div>
              }
              <div class="alert" [class.warning]="!checksReady()" [class.success]="checksReady()">
                <mat-icon>{{ checksReady() ? 'check_circle' : 'flag' }}</mat-icon>
                <span class="spacer">
                  {{ checksReady() ? 'Все пункты выполнены' : 'Пакет на исполнительную надпись недоступен до выполнения всех пунктов чек-листа' }}
                </span>
                @if (auth.canWrite()) {
                  <button mat-flat-button [disabled]="!checksReady()" (click)="addWorkPack()">Сформировать пакет документов</button>
                }
                <a mat-stroked-button [routerLink]="['/claims']" [queryParams]="{ account: account()?.id }">Дело взыскания</a>
              </div>
            </div>
          </mat-tab>

          <mat-tab label="Вложения">
            <div class="filters">
              <mat-form-field><mat-label>Тип документа</mat-label><input matInput [(ngModel)]="fileType" /></mat-form-field>
              @if (auth.canWrite()) {
                <input type="file" (change)="onFile($event)" />
              }
            </div>
            <div class="list-pane"><table mat-table [dataSource]="files()">
              <ng-container matColumnDef="doc_type"><th mat-header-cell *matHeaderCellDef>Тип</th><td mat-cell *matCellDef="let r">{{ r.doc_type }}</td></ng-container>
              <ng-container matColumnDef="original_name"><th mat-header-cell *matHeaderCellDef>Файл</th><td mat-cell *matCellDef="let r">{{ r.original_name }}</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="fileColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: fileColumns"></tr>
            </table></div>
          </mat-tab>

          @if (auth.canWrite()) {
          <mat-tab label="Оповестить">
            <div class="notify">
              <p class="muted">Группа задолженности: {{ account()?.effective_group ?? 'не рассчитана' }}. Каркас подбирается по ней и заполняется данными ЛС.</p>
              <mat-form-field>
                <mat-label>Каркас</mat-label>
                <mat-select [(ngModel)]="templateId">
                  @for (t of templates(); track t.id) { <mat-option [value]="t.id">{{ t.name }} ({{ t.channel_display }})</mat-option> }
                </mat-select>
              </mat-form-field>
              @if (auth.canWrite()) {
              <button mat-flat-button color="primary" [disabled]="!templateId || sending()" (click)="notify()">Отправить через шлюз</button>
              }
            </div>
            @if (filledPreview()) { <pre class="message">{{ filledPreview() }}</pre> }
          </mat-tab>
          }
        </mat-tab-group>

        @if (sharesOpen()) {
          <div class="backdrop" (click)="sharesOpen.set(false)">
            <div class="dialog" (click)="$event.stopPropagation()" role="dialog" aria-label="Состав долга">
              <h3>Кому должен лицевой счёт {{ a.client_account }}</h3>
              <div class="list-pane"><table class="shares">
                <thead><tr><th>Краткое наименование поставщика</th><th>Исходящее сальдо с пенями</th><th>Исходящее сальдо пени</th><th>Итого</th></tr></thead>
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
    .crumbs b { color: #1f2933; }
    .sep { opacity: .6; }
    .spacer { flex: 1; }
    .stages { display: flex; border: 1px solid var(--erip-border); border-radius: 6px; overflow: hidden; background: #fff; }
    .stage { padding: 6px 12px; font-size: 12px; color: var(--erip-muted); border-left: 1px solid var(--erip-border); white-space: nowrap; }
    .stage:first-child { border-left: 0; }
    .stage.done { color: var(--erip-success); background: var(--erip-success-soft); }
    .stage.current { color: #fff; background: var(--erip-primary); font-weight: 600; }
    .head { padding: 20px 24px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 16px; }
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
  protected readonly auth = inject(AuthService);
  private readonly snack = inject(MatSnackBar);
  readonly id = input.required<string>();

  protected readonly account = signal<AccountDetail | null>(null);
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
  protected readonly measureColumns = ['kind_display', 'status_display', 'account_item_status', 'due_on'];
  protected readonly balances = signal<BalanceRow[]>([]);
  protected readonly history = signal<HistoryRow[]>([]);
  protected readonly work = signal<WorkItem[]>([]);
  protected readonly contacts = signal<ContactRow[]>([]);
  protected readonly files = signal<AttachmentRow[]>([]);
  protected readonly categories = signal<DebtorCategory[]>([]);
  protected readonly measures = signal<MeasureRow[]>([]);
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
  protected categoryId: number | null = null;
  protected newCategory = '';
  protected residence = '';
  protected inheritance = false;
  protected inheritanceUntil = '';
  protected fileType = 'Скан';
  protected manualGroup: number | null = null;
  protected manualReason = '';
  protected templateId: number | null = null;

  private accountServiceColumns(): string[] {
    return [
      'report_group_id', 'netting_mulct_sum', 'netting_sum', 'calc_sum', 'balance_in', 'balance_mulct_in',
      'start_date', 'stop_date', 'balance_mulct_out', 'balance_out', 'service_list_id', 'ais_account_id',
      'calculation_id', 'provider_id', 'sort_code', 'service_id', 'debt_period', 'shot_name', 'calc_priv_sum',
      'service_name', 'service_name_report', 'calc_result_sum', 'spent_fact', 'mulct_sum', 'recalc_sum',
      'mulct_recalc_sum', 'full_name', 'overdue_debt', 'share_mulct_summ', 'share_service_summ', 'subs_pay',
      'tarrif', 'calc_date', 'months_debt', 'supplier', 'debt_group',
    ];
  }

  ngOnInit(): void {
    const id = Number(this.id());
    forkJoin({
      account: this.api.account(id),
      services: this.api.accountServices(id, true),
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
        const group = r.account.effective_group;
        const list = r.templates.results.filter((t) => (['email', 'sms', 'voice'] as Channel[]).includes(t.channel));
        const forGroup = group == null ? [] : list.filter((t) => t.debt_group === group);
        this.templates.set(forGroup.length ? forGroup : list);
        this.templateId = (forGroup[0] ?? list[0])?.id ?? null;
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
    const value = this.contactValue.trim() || row.value;
    this.api.saveContact({ id: row.id, account: this.account()?.id, kind: row.kind, value }).subscribe({
      next: () => {
        this.contactValue = '';
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

  protected stageIndex(): number {
    const code = this.account()?.funnel_stage || 'new';
    return this.stages.findIndex((stage) => stage.code === code);
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

  addWorkPack(): void {
    const a = this.account();
    if (!a) return;
    this.api.saveWork({ account: a.id, kind: 'writ', title: 'Пакет документов на исполнительную надпись' }).subscribe({
      next: () => this.snack.open('Пакет добавлен во вкладку «Работа с задолженностью»', 'OK', { duration: 4000 }),
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
}
