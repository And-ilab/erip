import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ApiService, IntegrationRow, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-integration-smtp',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSnackBarModule],
  template: `
    @if (status(); as item) {
      <section class="card status">
        <div class="head">
          <h3>SMTP</h3>
          <span class="pill" [class.on]="item.status.ready">{{ item.status.mode === 'smtp' ? 'SMTP' : 'Заглушка' }}</span>
        </div>
        <p class="muted">{{ item.status.detail || item.stub_detail }}</p>
        <button mat-stroked-button type="button" (click)="loadStatus()">Обновить статус</button>
      </section>
    }

    @if (canEdit()) {
      <section class="card">
        <h3>Почта схемы</h3>
        <p class="muted">Отправитель, запасная тема и подпись писем этой схемы. Если у шаблона тема заполнена, в письмо идёт она. Прочтение не отмечается. Хост SMTP задаётся в окружении шлюза (GW_EMAIL_MODE, GW_SMTP_HOST).</p>
        <div class="grid">
          <mat-form-field><mat-label>E-mail отправителя</mat-label><input matInput [(ngModel)]="mailFrom" maxlength="254" /></mat-form-field>
          <mat-form-field><mat-label>Имя отправителя</mat-label><input matInput [(ngModel)]="mailFromName" maxlength="250" /></mat-form-field>
          <mat-form-field class="wide"><mat-label>Тема, если у шаблона её нет</mat-label><input matInput [(ngModel)]="mailSubject" maxlength="250" /></mat-form-field>
          <mat-form-field class="wide"><mat-label>Подпись</mat-label><textarea matInput rows="2" [(ngModel)]="mailSignature" maxlength="500"></textarea></mat-form-field>
        </div>
        <button mat-flat-button color="primary" type="button" (click)="save()">Сохранить почту схемы</button>
      </section>
    } @else {
      <p class="muted">Параметры отправителя меняет локальный администратор или суперадминистратор.</p>
    }
  `,
  styles: `
    .card {
      background: #fff; border: 1px solid var(--erip-border); border-radius: 12px; padding: 16px; margin: 0 0 12px; max-width: 720px;
    }
    .head { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
    h3 { margin: 0 0 8px; color: var(--erip-primary-dark); }
    .head h3 { margin: 0; }
    .muted { color: var(--erip-muted); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .wide { grid-column: 1 / -1; }
    .pill {
      display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700;
      background: #eef2f4; color: var(--erip-muted);
    }
    .pill.on { background: #e7f6ee; color: #1b7a45; }
    @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
  `,
})
export class IntegrationSmtpComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly snack = inject(MatSnackBar);

  protected readonly status = signal<IntegrationRow | null>(null);
  protected mailFrom = '';
  protected mailFromName = '';
  protected mailSubject = '';
  protected mailSignature = '';

  ngOnInit(): void {
    this.loadStatus();
    if (this.canEdit()) {
      this.api.scenarioMail().subscribe({
        next: (row) => {
          this.mailFrom = row.mail_from;
          this.mailFromName = row.mail_from_name;
          this.mailSubject = row.mail_subject;
          this.mailSignature = row.mail_signature;
        },
        error: (err) => this.snack.open(errorMessage(err), 'OK'),
      });
    }
  }

  protected canEdit(): boolean {
    return this.auth.canManageTemplates();
  }

  protected loadStatus(): void {
    this.api.integration('smtp').subscribe({
      next: (row) => this.status.set(row),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected save(): void {
    this.api.saveScenarioMail({
      mail_from: this.mailFrom.trim(),
      mail_from_name: this.mailFromName.trim(),
      mail_subject: this.mailSubject.trim(),
      mail_signature: this.mailSignature.trim(),
    }).subscribe({
      next: (row) => {
        this.mailFrom = row.mail_from;
        this.mailFromName = row.mail_from_name;
        this.mailSubject = row.mail_subject;
        this.mailSignature = row.mail_signature;
        this.snack.open('Почта схемы сохранена', 'OK', { duration: 2500 });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }
}
