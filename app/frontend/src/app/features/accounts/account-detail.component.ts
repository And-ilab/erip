import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
import { AccountDetail, AccountService, Channel, MessageTemplate, Payment, Registration } from '../../core/models';

@Component({
  selector: 'app-account-detail',
  standalone: true,
  imports: [
    DatePipe, DecimalPipe, FormsModule, RouterLink, MatTabsModule, MatTableModule, MatCardModule, MatButtonModule,
    MatFormFieldModule, MatSelectModule, MatInputModule, MatSnackBarModule,
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
                  <dt>Обновлено</dt><dd>{{ a.updated_at | date: 'dd.MM.yyyy HH:mm' }}</dd>
                </dl>
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
              <ng-container matColumnDef="shot_name"><th mat-header-cell *matHeaderCellDef>Поставщик</th><td mat-cell *matCellDef="let s">{{ s.shot_name }}</td></ng-container>
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
              <ng-container matColumnDef="contacts"><th mat-header-cell *matHeaderCellDef>Контакты</th><td mat-cell *matCellDef="let r">{{ r.contact_phone }} {{ r.email }}</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="registrationColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: registrationColumns"></tr>
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
  protected readonly registrationColumns = ['full_name', 'birthday', 'relation_degree_name', 'reg_type_name', 'contacts'];
  protected manualGroup: number | null = null;
  protected manualReason = '';
  protected templateId: number | null = null;

  ngOnInit(): void {
    const id = Number(this.id());
    forkJoin({
      account: this.api.account(id),
      services: this.api.accountServices(id),
      payments: this.api.accountPayments(id),
      registrations: this.api.accountRegistrations(id),
      templates: this.api.templates({ is_active: true, page_size: 100 }),
    }).subscribe({
      next: (r) => {
        this.account.set(r.account);
        this.manualGroup = r.account.debt_group_manual;
        this.manualReason = r.account.debt_group_manual_reason;
        this.services.set(r.services.results);
        this.payments.set(r.payments.results);
        this.registrations.set(r.registrations.results);
        const group = r.account.effective_group;
        const list = r.templates.results.filter((t) => (['email', 'sms', 'voice'] as Channel[]).includes(t.channel));
        const forGroup = group == null ? [] : list.filter((t) => t.debt_group === group);
        this.templates.set(forGroup.length ? forGroup : list);
        this.templateId = (forGroup[0] ?? list[0])?.id ?? null;
      },
      error: (e) => this.error.set(errorMessage(e)),
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
