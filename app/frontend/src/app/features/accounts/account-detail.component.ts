import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import { finalize, forkJoin } from 'rxjs';

import { ApiService, errorMessage } from '../../core/api.service';
import {
  AccountDetail, AccountService, AttachmentRow, BalanceRow, Channel, ContactRow,   DebtorCategory, HistoryRow, MeasureRow, MessageTemplate, Payment, Registration, WorkItem,
} from '../../core/models';

@Component({
  selector: 'app-account-detail',
  standalone: true,
  imports: [
    DatePipe, DecimalPipe, FormsModule, RouterLink, MatTabsModule, MatTableModule, MatCardModule, MatButtonModule,
    MatFormFieldModule, MatSelectModule, MatInputModule, MatSnackBarModule, MatCheckboxModule,
  ],
  template: `
    <div class="page">
      <div class="page-header">
        <a mat-button routerLink="/accounts">← Реестр</a>
        <h2>Карточка ЛС {{ account()?.client_account }}</h2>
        @if (account()?.effective_group; as g) { <span class="group-badge g{{ g }}">Группа {{ g }}</span> }
      </div>
      @if (error()) { <p class="status-failed">{{ error() }}</p> }

      @if (account(); as a) {
        <mat-tab-group>
          <mat-tab label="Общие">
            <div class="grid">
              <mat-card><mat-card-content>
                <dl>
                  <dt>Плательщик</dt><dd>{{ a.short_fio }}</dd>
                  <dt>Адрес</dt><dd>{{ a.account_address || a.house_address }}</dd>
                  <dt>Обслуживающая организация</dt><dd>{{ a.provider_short_name }}</dd>
                  <dt>УЕН ЛС</dt><dd>{{ a.unified_account }}</dd>
                  <dt>Тип собственности</dt><dd>{{ a.ownership_type_name }}</dd>
                  <dt>Площадь / комнат / проживающих</dt><dd>{{ a.acc_total_space }} / {{ a.room_count }} / {{ a.subj_count }}</dd>
                  <dt>Телефон</dt><dd>{{ a.contact_phone || a.phone }}</dd>
                  <dt>Период действия</dt><dd>{{ a.start_date | date: 'dd.MM.yyyy' }} — {{ a.stop_date | date: 'dd.MM.yyyy' }}</dd>
                </dl>
              </mat-card-content></mat-card>
              <mat-card><mat-card-content>
                <dl>
                  <dt>Входящее сальдо</dt><dd>{{ a.balance_in | number: '1.2-2' }}</dd>
                  <dt>Итого начислено</dt><dd>{{ a.total_calc_sum | number: '1.2-2' }}</dd>
                  <dt>Распределённая оплата</dt><dd>{{ a.pay_sum | number: '1.2-2' }}</dd>
                  <dt>Исходящее сальдо</dt><dd><b>{{ a.balance_out | number: '1.2-2' }}</b></dd>
                  <dt>Обновлено из АИС</dt><dd>{{ a.ais_updated_at | date: 'dd.MM.yyyy HH:mm' }}</dd>
                  <dt>Операционная дата</dt><dd>{{ a.operational_date | date: 'dd.MM.yyyy' }}</dd>
                  <dt>Рейтинг</dt><dd>{{ a.rating_label || '—' }}</dd>
                  <dt>Дата возникновения</dt><dd>{{ a.debt_started_on | date: 'dd.MM.yyyy' }}</dd>
                  <dt>Сценарий</dt><dd>{{ a.scenario_name }}</dd>
                  <dt>ИН/УНП</dt><dd>{{ a.payer_identifier }}</dd>
                </dl>
                <button mat-stroked-button (click)="refreshNow()">Обновить сейчас</button>
                <h4>Ручная корректировка группы</h4>
                <div class="filters">
                  <mat-form-field>
                    <mat-label>Группа</mat-label>
                    <mat-select [(ngModel)]="manualGroup">
                      <mat-option [value]="null">По расчёту</mat-option>
                      @for (g of [1, 2, 3, 4, 5, 6]; track g) { <mat-option [value]="g">{{ g }}</mat-option> }
                    </mat-select>
                  </mat-form-field>
                  <mat-form-field class="reason"><mat-label>Причина</mat-label><input matInput [(ngModel)]="manualReason" /></mat-form-field>
                  <button mat-stroked-button (click)="saveGroup()">Сохранить</button>
                </div>
              </mat-card-content></mat-card>
            </div>
          </mat-tab>

          <mat-tab label="Услуги ({{ services().length }})">
            <table mat-table [dataSource]="services()">
              <ng-container matColumnDef="service_name"><th mat-header-cell *matHeaderCellDef>Услуга</th><td mat-cell *matCellDef="let s">{{ s.service_name }}</td></ng-container>
              <ng-container matColumnDef="shot_name"><th mat-header-cell *matHeaderCellDef>Поставщик</th>
                <td mat-cell *matCellDef="let s"><a [routerLink]="['/contracts', s.id]">{{ s.shot_name }}</a></td></ng-container>
              <ng-container matColumnDef="balance_out"><th mat-header-cell *matHeaderCellDef>Долг (с пенями)</th><td mat-cell *matCellDef="let s">{{ s.balance_out | number: '1.2-2' }}</td></ng-container>
              <ng-container matColumnDef="balance_mulct_out"><th mat-header-cell *matHeaderCellDef>Пеня</th><td mat-cell *matCellDef="let s">{{ s.balance_mulct_out | number: '1.2-2' }}</td></ng-container>
              <ng-container matColumnDef="debt_period"><th mat-header-cell *matHeaderCellDef>Мес. долга</th><td mat-cell *matCellDef="let s">{{ s.debt_period }}</td></ng-container>
              <ng-container matColumnDef="debt_group"><th mat-header-cell *matHeaderCellDef>Группа</th>
                <td mat-cell *matCellDef="let s">@if (s.debt_group) { <span class="group-badge g{{ s.debt_group }}">{{ s.debt_group }}</span> }</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="serviceColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: serviceColumns"></tr>
            </table>
          </mat-tab>

          <mat-tab label="Оплаты ({{ payments().length }})">
            <table mat-table [dataSource]="payments()">
              <ng-container matColumnDef="pay_date"><th mat-header-cell *matHeaderCellDef>Дата</th><td mat-cell *matCellDef="let p">{{ p.pay_date | date: 'dd.MM.yyyy' }}</td></ng-container>
              <ng-container matColumnDef="service_name"><th mat-header-cell *matHeaderCellDef>Услуга</th><td mat-cell *matCellDef="let p">{{ p.service_name }}</td></ng-container>
              <ng-container matColumnDef="pay_service_summ"><th mat-header-cell *matHeaderCellDef>Оплата услуг</th><td mat-cell *matCellDef="let p">{{ p.pay_service_summ | number: '1.2-2' }}</td></ng-container>
              <ng-container matColumnDef="pay_mulct_summ"><th mat-header-cell *matHeaderCellDef>Оплата пени</th><td mat-cell *matCellDef="let p">{{ p.pay_mulct_summ | number: '1.2-2' }}</td></ng-container>
              <ng-container matColumnDef="bank_name"><th mat-header-cell *matHeaderCellDef>Банк</th><td mat-cell *matCellDef="let p">{{ p.bank_name }}</td></ng-container>
              <ng-container matColumnDef="payment_type_display"><th mat-header-cell *matHeaderCellDef>Тип</th><td mat-cell *matCellDef="let p">{{ p.payment_type_display }}</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="paymentColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: paymentColumns"></tr>
            </table>
          </mat-tab>

          <mat-tab label="Регистрация ({{ registrations().length }})">
            <table mat-table [dataSource]="registrations()">
              <ng-container matColumnDef="full_name"><th mat-header-cell *matHeaderCellDef>ФИО</th><td mat-cell *matCellDef="let r">{{ r.full_name }} @if (r.subj_is_main) { <b>(плательщик)</b> }</td></ng-container>
              <ng-container matColumnDef="birthday"><th mat-header-cell *matHeaderCellDef>Дата рождения</th><td mat-cell *matCellDef="let r">{{ r.birthday | date: 'dd.MM.yyyy' }}</td></ng-container>
              <ng-container matColumnDef="relation_degree_name"><th mat-header-cell *matHeaderCellDef>Родство</th><td mat-cell *matCellDef="let r">{{ r.relation_degree_name }}</td></ng-container>
              <ng-container matColumnDef="reg_type_name"><th mat-header-cell *matHeaderCellDef>Регистрация</th><td mat-cell *matCellDef="let r">{{ r.reg_type_name }}</td></ng-container>
              <ng-container matColumnDef="debtor_role"><th mat-header-cell *matHeaderCellDef>Роль</th><td mat-cell *matCellDef="let r">{{ r.debtor_role }}</td></ng-container>
              <ng-container matColumnDef="contacts"><th mat-header-cell *matHeaderCellDef>Контакты</th><td mat-cell *matCellDef="let r">{{ r.contact_phone }} {{ r.email }}</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="registrationColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: registrationColumns"></tr>
            </table>
          </mat-tab>

          <mat-tab label="История сумм">
            <table mat-table [dataSource]="balances()">
              <ng-container matColumnDef="period"><th mat-header-cell *matHeaderCellDef>Период</th><td mat-cell *matCellDef="let r">{{ r.period | date: 'MM.yyyy' }}</td></ng-container>
              <ng-container matColumnDef="service_name"><th mat-header-cell *matHeaderCellDef>Услуга</th><td mat-cell *matCellDef="let r">{{ r.service_name }}</td></ng-container>
              <ng-container matColumnDef="principal"><th mat-header-cell *matHeaderCellDef>Долг</th><td mat-cell *matCellDef="let r">{{ r.principal | number: '1.2-2' }}</td></ng-container>
              <ng-container matColumnDef="penalty"><th mat-header-cell *matHeaderCellDef>Пеня</th><td mat-cell *matCellDef="let r">{{ r.penalty | number: '1.2-2' }}</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="balanceColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: balanceColumns"></tr>
            </table>
          </mat-tab>

          <mat-tab label="Группа и рейтинг">
            <table mat-table [dataSource]="history()">
              <ng-container matColumnDef="created_at"><th mat-header-cell *matHeaderCellDef>Когда</th><td mat-cell *matCellDef="let r">{{ r.created_at | date: 'dd.MM.yyyy HH:mm' }}</td></ng-container>
              <ng-container matColumnDef="kind"><th mat-header-cell *matHeaderCellDef>Что</th><td mat-cell *matCellDef="let r">{{ r.kind }}</td></ng-container>
              <ng-container matColumnDef="old_value"><th mat-header-cell *matHeaderCellDef>Было</th><td mat-cell *matCellDef="let r">{{ r.old_value }}</td></ng-container>
              <ng-container matColumnDef="new_value"><th mat-header-cell *matHeaderCellDef>Стало</th><td mat-cell *matCellDef="let r">{{ r.new_value }}</td></ng-container>
              <ng-container matColumnDef="reason"><th mat-header-cell *matHeaderCellDef>Основание</th><td mat-cell *matCellDef="let r">{{ r.reason }}</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="historyColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: historyColumns"></tr>
            </table>
          </mat-tab>

          <mat-tab label="Работа с задолженностью">
            <div class="filters">
              <button mat-stroked-button (click)="workTab = 'docs'; loadWork()">Документы</button>
              <button mat-stroked-button (click)="workTab = 'impossibility'; loadWork()">Невозможность взыскания</button>
              <button mat-stroked-button (click)="workTab = 'calculation'; loadWork()">Расчёт задолженности</button>
              <button mat-stroked-button (click)="workTab = 'payment'; loadWork()">Оплата по взысканию</button>
            </div>
            <div class="filters">
              <mat-form-field><mat-label>Долг от</mat-label><input matInput [(ngModel)]="workPrincipal" (change)="loadWork()" /></mat-form-field>
              <mat-form-field><mat-label>Пеня от</mat-label><input matInput [(ngModel)]="workPenalty" (change)="loadWork()" /></mat-form-field>
              <mat-form-field><mat-label>Оплата от</mat-label><input matInput [(ngModel)]="workPaid" (change)="loadWork()" /></mat-form-field>
              <mat-form-field><mat-label>Начало с</mat-label><input matInput type="date" [(ngModel)]="workFrom" (change)="loadWork()" /></mat-form-field>
              <mat-form-field><mat-label>Начало по</mat-label><input matInput type="date" [(ngModel)]="workTo" (change)="loadWork()" /></mat-form-field>
              <button mat-stroked-button (click)="addWork()">Добавить документ</button>
            </div>
            <table mat-table [dataSource]="work()">
              <ng-container matColumnDef="kind_display"><th mat-header-cell *matHeaderCellDef>Вид</th><td mat-cell *matCellDef="let r">{{ r.kind_display }}</td></ng-container>
              <ng-container matColumnDef="title"><th mat-header-cell *matHeaderCellDef>Наименование</th><td mat-cell *matCellDef="let r">{{ r.title }}</td></ng-container>
              <ng-container matColumnDef="started_on"><th mat-header-cell *matHeaderCellDef>Начало</th><td mat-cell *matCellDef="let r">{{ r.started_on | date: 'dd.MM.yyyy' }}</td></ng-container>
              <ng-container matColumnDef="ended_on"><th mat-header-cell *matHeaderCellDef>Окончание</th><td mat-cell *matCellDef="let r">{{ r.ended_on | date: 'dd.MM.yyyy' }}</td></ng-container>
              <ng-container matColumnDef="principal"><th mat-header-cell *matHeaderCellDef>Долг</th><td mat-cell *matCellDef="let r">{{ r.principal }}</td></ng-container>
              <ng-container matColumnDef="penalty"><th mat-header-cell *matHeaderCellDef>Пеня</th><td mat-cell *matCellDef="let r">{{ r.penalty }}</td></ng-container>
              <ng-container matColumnDef="paid_principal"><th mat-header-cell *matHeaderCellDef>Оплата</th><td mat-cell *matCellDef="let r">{{ r.paid_principal }}</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="workColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: workColumns"></tr>
            </table>
          </mat-tab>

          <mat-tab label="Контакты">
            <div class="filters">
              <mat-form-field>
                <mat-label>Источник обзвона</mat-label>
                <mat-select [(ngModel)]="contactMode" (selectionChange)="saveMode()">
                  <mat-option value="pm">Только ПМ</mat-option>
                  <mat-option value="ais">Только АИС</mat-option>
                  <mat-option value="combined">Комбинированный</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field><mat-label>Телефон или e-mail</mat-label><input matInput [(ngModel)]="contactValue" /></mat-form-field>
              <mat-form-field><mat-label>Приоритет</mat-label><input matInput type="number" [(ngModel)]="contactPriority" /></mat-form-field>
              <mat-form-field>
                <mat-label>Тип</mat-label>
                <mat-select [(ngModel)]="contactKind">
                  <mat-option value="mobile">Мобильный</mat-option>
                  <mat-option value="city">Городской</mat-option>
                  <mat-option value="email">E-mail</mat-option>
                  <mat-option value="messenger">Мессенджер</mat-option>
                </mat-select>
              </mat-form-field>
              <button mat-stroked-button (click)="addContact()">Добавить</button>
            </div>
            <table mat-table [dataSource]="contacts()">
              <ng-container matColumnDef="kind"><th mat-header-cell *matHeaderCellDef>Тип</th><td mat-cell *matCellDef="let r">{{ r.kind }}</td></ng-container>
              <ng-container matColumnDef="value"><th mat-header-cell *matHeaderCellDef>Значение</th><td mat-cell *matCellDef="let r">{{ r.value }}</td></ng-container>
              <ng-container matColumnDef="source"><th mat-header-cell *matHeaderCellDef>Источник</th><td mat-cell *matCellDef="let r">{{ r.source }} {{ r.ais_updated_at | date: 'dd.MM.yyyy' }}</td></ng-container>
              <ng-container matColumnDef="priority"><th mat-header-cell *matHeaderCellDef>Приоритет</th><td mat-cell *matCellDef="let r">{{ r.priority }}</td></ng-container>
              <ng-container matColumnDef="actions"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let r">
                @if (r.source === 'pm') {
                  <button mat-button (click)="editContact(r)">Изменить</button>
                  <button mat-button (click)="removeContact(r)">Удалить</button>
                }
              </td></ng-container>
              <tr mat-header-row *matHeaderRowDef="contactColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: contactColumns"></tr>
            </table>
          </mat-tab>

          <mat-tab label="Категория и наследство">
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
              <button mat-stroked-button (click)="saveProfile()">Сохранить</button>
              <mat-form-field><mat-label>Новая категория</mat-label><input matInput [(ngModel)]="newCategory" /></mat-form-field>
              <button mat-stroked-button (click)="addCategory()">Добавить в справочник</button>
              <button mat-stroked-button (click)="removeCategory()">Удалить выбранную</button>
            </div>
          </mat-tab>

          <mat-tab label="Мероприятия">
            <p><a routerLink="/measures">Реестр мероприятий</a></p>
            <table mat-table [dataSource]="measures()">
              <ng-container matColumnDef="kind_display"><th mat-header-cell *matHeaderCellDef>Вид</th><td mat-cell *matCellDef="let r">{{ r.kind_display }}</td></ng-container>
              <ng-container matColumnDef="status_display"><th mat-header-cell *matHeaderCellDef>Статус</th><td mat-cell *matCellDef="let r">{{ r.status_display }}</td></ng-container>
              <ng-container matColumnDef="due_on"><th mat-header-cell *matHeaderCellDef>Срок</th><td mat-cell *matCellDef="let r">{{ r.due_on }}</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="measureColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: measureColumns"></tr>
            </table>
          </mat-tab>

          <mat-tab label="Исполнительная надпись">
            @for (item of checks(); track item.code) {
              <div>
                <mat-checkbox [checked]="item.done" (change)="toggleCheck(item.code, $event.checked)">{{ item.title }}</mat-checkbox>
              </div>
            }
            <button mat-stroked-button [disabled]="!checksReady()" (click)="addWorkPack()">Сформировать пакет документов</button>
          </mat-tab>

          <mat-tab label="Вложения">
            <div class="filters">
              <mat-form-field><mat-label>Тип документа</mat-label><input matInput [(ngModel)]="fileType" /></mat-form-field>
              <input type="file" (change)="onFile($event)" />
            </div>
            <table mat-table [dataSource]="files()">
              <ng-container matColumnDef="doc_type"><th mat-header-cell *matHeaderCellDef>Тип</th><td mat-cell *matCellDef="let r">{{ r.doc_type }}</td></ng-container>
              <ng-container matColumnDef="original_name"><th mat-header-cell *matHeaderCellDef>Файл</th><td mat-cell *matCellDef="let r">{{ r.original_name }}</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="fileColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: fileColumns"></tr>
            </table>
          </mat-tab>

          <mat-tab label="Оповестить">
            <div class="notify">
              <p class="muted">Группа задолженности: {{ account()?.effective_group ?? 'не рассчитана' }}. Каркас подбирается по ней и заполняется данными ЛС.</p>
              <mat-form-field>
                <mat-label>Каркас</mat-label>
                <mat-select [(ngModel)]="templateId">
                  @for (t of templates(); track t.id) { <mat-option [value]="t.id">{{ t.name }} ({{ t.channel_display }})</mat-option> }
                </mat-select>
              </mat-form-field>
              <button mat-flat-button color="primary" [disabled]="!templateId || sending()" (click)="notify()">Отправить через шлюз</button>
            </div>
            @if (filledPreview()) { <pre class="message">{{ filledPreview() }}</pre> }
          </mat-tab>
        </mat-tab-group>
      }
    </div>
  `,
  styles: `
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px 0; }
    dl { display: grid; grid-template-columns: 220px 1fr; row-gap: 6px; margin: 0; }
    dt { color: #6b7280; } dd { margin: 0; }
    .reason { min-width: 280px; }
    .notify { display: flex; gap: 12px; align-items: center; padding: 16px 0; }
  `,
})
export class AccountDetailComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly snack = inject(MatSnackBar);
  readonly id = input.required<string>();

  protected readonly account = signal<AccountDetail | null>(null);
  protected readonly services = signal<AccountService[]>([]);
  protected readonly payments = signal<Payment[]>([]);
  protected readonly registrations = signal<Registration[]>([]);
  protected readonly templates = signal<MessageTemplate[]>([]);
  protected readonly error = signal('');
  protected readonly sending = signal(false);
  protected readonly serviceColumns = ['service_name', 'shot_name', 'balance_out', 'balance_mulct_out', 'debt_period', 'debt_group'];
  protected readonly paymentColumns = ['pay_date', 'service_name', 'pay_service_summ', 'pay_mulct_summ', 'bank_name', 'payment_type_display'];
  protected readonly registrationColumns = ['full_name', 'debtor_role', 'birthday', 'relation_degree_name', 'reg_type_name', 'contacts'];
  protected readonly balanceColumns = ['period', 'service_name', 'principal', 'penalty'];
  protected readonly historyColumns = ['created_at', 'kind', 'old_value', 'new_value', 'reason'];
  protected readonly workColumns = ['kind_display', 'title', 'started_on', 'ended_on', 'principal', 'penalty', 'paid_principal'];
  protected readonly contactColumns = ['kind', 'value', 'source', 'priority', 'actions'];
  protected readonly fileColumns = ['doc_type', 'original_name'];
  protected readonly measureColumns = ['kind_display', 'status_display', 'due_on'];
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
  protected contactPriority = 1;
  protected categoryId: number | null = null;
  protected newCategory = '';
  protected residence = '';
  protected inheritance = false;
  protected fileType = 'Скан';
  protected manualGroup: number | null = null;
  protected manualReason = '';
  protected templateId: number | null = null;

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

  addContact(): void {
    const a = this.account();
    if (!a || !this.contactValue.trim()) return;
    this.api.saveContact({ account: a.id, kind: this.contactKind, value: this.contactValue.trim(), priority: this.contactPriority }).subscribe({
      next: () => this.api.accountContacts(a.id).subscribe((page) => this.contacts.set(page.results)),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  editContact(row: ContactRow): void {
    const value = this.contactValue.trim() || row.value;
    this.api.saveContact({ id: row.id, account: this.account()?.id, kind: this.contactKind, value, priority: this.contactPriority }).subscribe({
      next: () => {
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
    if (!a) return;
    this.api.updateAccount(a.id, { contact_source_mode: this.contactMode }).subscribe({
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
