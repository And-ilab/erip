import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';

import { ApiService, IntegrationRow, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-integration-asterisk',
  standalone: true,
  imports: [
    FormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule,
    MatSnackBarModule, RouterLink,
  ],
  template: `
    @if (status(); as item) {
      <section class="card status">
        <div class="head">
          <h3>Asterisk AMI</h3>
          <span class="pill" [class.on]="item.status.ready">{{ item.status.mode === 'ami' ? 'AMI' : 'Заглушка' }}</span>
        </div>
        <p class="muted">{{ item.status.detail || item.stub_detail }}</p>
        <button mat-stroked-button type="button" (click)="loadStatus()">Обновить статус</button>
      </section>
    }

    @if (canEdit()) {
      <section class="card">
        <h3>Номера схемы</h3>
        <p class="muted">Ротация уходит в адаптер. Хост и секрет AMI задаются в окружении шлюза (`GW_VOICE_MODE`, `GW_AMI_*`). Окно обзвона сценария остаётся в <a routerLink="/settings/work/scenario">Сценариях</a>.</p>
        <div class="checks">
          <mat-checkbox [(ngModel)]="orgCallLegal">Звонить юридическим лицам в этой схеме</mat-checkbox>
        </div>
        <mat-form-field class="wide"><mat-label>Исходящие номера, по одному в строке</mat-label>
          <textarea matInput rows="3" [(ngModel)]="outgoingNumbers"></textarea>
        </mat-form-field>
        <div class="checks">
          <mat-checkbox [checked]="false" disabled>Запись разговора</mat-checkbox>
          <mat-checkbox [checked]="false" disabled>Перевод на оператора</mat-checkbox>
        </div>
        <p class="muted">Запись и перевод выключены, пока Asterisk их не отдаёт.</p>
        <button mat-flat-button color="primary" type="button" (click)="save()">Сохранить обзвон схемы</button>
      </section>
    } @else {
      <p class="muted">Номера схемы меняет локальный администратор или суперадминистратор.</p>
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
    .wide { width: 100%; }
    .checks { display: flex; flex-wrap: wrap; gap: 12px; margin: 8px 0; }
    a { color: var(--erip-primary-dark); font-weight: 600; }
    .pill {
      display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700;
      background: #eef2f4; color: var(--erip-muted);
    }
    .pill.on { background: #e7f6ee; color: #1b7a45; }
  `,
})
export class IntegrationAsteriskComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly snack = inject(MatSnackBar);

  protected readonly status = signal<IntegrationRow | null>(null);
  protected orgCallLegal = false;
  protected outgoingNumbers = '';

  ngOnInit(): void {
    this.loadStatus();
    if (this.canEdit()) {
      this.api.scenarioCalling().subscribe({
        next: (row) => {
          this.orgCallLegal = row.call_legal;
          this.outgoingNumbers = (row.outgoing_numbers || []).join('\n');
        },
        error: (err) => this.snack.open(errorMessage(err), 'OK'),
      });
    }
  }

  protected canEdit(): boolean {
    return this.auth.canManageTemplates();
  }

  protected loadStatus(): void {
    this.api.integration('asterisk').subscribe({
      next: (row) => this.status.set(row),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected save(): void {
    const numbers = this.outgoingNumbers
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    this.api.saveScenarioCalling({
      call_legal: this.orgCallLegal,
      outgoing_numbers: numbers,
    }).subscribe({
      next: (row) => {
        this.orgCallLegal = row.call_legal;
        this.outgoingNumbers = (row.outgoing_numbers || []).join('\n');
        this.snack.open('Обзвон схемы сохранён', 'OK', { duration: 2500 });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }
}
