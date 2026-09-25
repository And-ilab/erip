import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';

import { ApiService, errorMessage } from '../../core/api.service';
import { AccountService, Registration } from '../../core/models';

@Component({
  selector: 'app-contract-detail',
  standalone: true,
  imports: [
    DatePipe, DecimalPipe, FormsModule, RouterLink, MatCardModule, MatButtonModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatSnackBarModule,
  ],
  template: `
    <div class="page">
      <div class="page-header">
        <a mat-button routerLink="/contracts">← Реестр договоров</a>
        <h2>Договор {{ contract()?.service_list_id }} · {{ contract()?.service_name }}</h2>
      </div>
      @if (error()) { <p class="status-failed">{{ error() }}</p> }
      @if (contract(); as c) {
        <div class="grid">
          <mat-card><mat-card-content>
            <dl>
              <dt>Должник</dt><dd>{{ c.payer }}</dd>
              <dt>ИН/УНП</dt><dd>{{ c.payer_identifier }}</dd>
              <dt>Адрес</dt><dd>{{ c.address }}</dd>
              <dt>ЛС</dt><dd><a [routerLink]="['/accounts', c.account]">{{ c.account_number }}</a></dd>
              <dt>Поставщик</dt><dd>{{ c.full_name || c.shot_name }}</dd>
              <dt>Договор</dt><dd>{{ c.service_list_id }} с {{ c.start_date | date: 'dd.MM.yyyy' }}</dd>
              <dt>Категория</dt><dd>{{ c.category_name || '—' }}</dd>
              <dt>Рейтинг</dt><dd>{{ c.rating_label || '—' }}</dd>
            </dl>
          </mat-card-content></mat-card>
          <mat-card><mat-card-content>
            <dl>
              <dt>Первоначальный долг</dt><dd>{{ c.initial_principal | number: '1.2-2' }}</dd>
              <dt>Первоначальная пеня</dt><dd>{{ c.initial_penalty | number: '1.2-2' }}</dd>
              <dt>Остаток долга</dt><dd><b>{{ c.balance_out | number: '1.2-2' }}</b></dd>
              <dt>Остаток пени</dt><dd>{{ c.balance_mulct_out | number: '1.2-2' }}</dd>
              <dt>Возникновение</dt><dd>{{ c.debt_started_on | date: 'dd.MM.yyyy' }}</dd>
              <dt>Последняя оплата</dt><dd>{{ c.last_payment_date | date: 'dd.MM.yyyy' }}</dd>
              <dt>Группа услуги</dt><dd>{{ c.effective_group }}</dd>
              <dt>Сценарий</dt><dd>{{ c.scenario_name }}</dd>
            </dl>
            <h4>Ручная группа этого договора</h4>
            <div class="filters">
              <mat-form-field>
                <mat-label>Группа</mat-label>
                <mat-select [(ngModel)]="manualGroup">
                  <mat-option [value]="null">По расчёту</mat-option>
                  @for (g of [1, 2, 3, 4, 5, 6]; track g) { <mat-option [value]="g">{{ g }}</mat-option> }
                </mat-select>
              </mat-form-field>
              <mat-form-field class="reason"><mat-label>Причина</mat-label><input matInput [(ngModel)]="reason" /></mat-form-field>
              <button mat-stroked-button (click)="save()">Сохранить</button>
            </div>
          </mat-card-content></mat-card>
        </div>
        <h3>Зарегистрированные лица</h3>
        @for (person of people(); track person.id) {
          <p>
            {{ person.full_name }}
            @if (person.subj_is_main) { <b>(плательщик)</b> }
            · {{ person.relation_degree_name }}
            · {{ person.birthday | date: 'dd.MM.yyyy' }}
            · {{ person.contact_phone }} {{ person.email }}
          </p>
        }
      }
    </div>
  `,
  styles: `
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    dl { display: grid; grid-template-columns: 220px 1fr; row-gap: 6px; }
    dt { color: #6b7280; } dd { margin: 0; }
    .reason { min-width: 240px; }
  `,
})
export class ContractDetailComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly snack = inject(MatSnackBar);
  readonly id = input.required<string>();
  protected readonly contract = signal<AccountService | null>(null);
  protected readonly people = signal<Registration[]>([]);
  protected readonly error = signal('');
  protected manualGroup: number | null = null;
  protected reason = '';

  ngOnInit(): void {
    this.api.contract(Number(this.id())).subscribe({
      next: (row) => {
        this.contract.set(row);
        this.api.accountRegistrations(row.account).subscribe((page) => this.people.set(page.results));
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  save(): void {
    const row = this.contract();
    if (!row) return;
    this.api.httpPatchContract(row.id, this.manualGroup, this.reason).subscribe({
      next: (updated) => {
        this.contract.set(updated);
        this.snack.open('Группа договора сохранена', 'OK', { duration: 3000 });
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }
}
