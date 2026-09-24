import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';

import { ApiService, errorMessage } from '../../core/api.service';
import { Notification } from '../../core/models';

@Component({
  selector: 'app-notifications-page',
  standalone: true,
  imports: [DatePipe, FormsModule, MatTableModule, MatPaginatorModule, MatFormFieldModule, MatSelectModule, MatButtonModule],
  template: `
    <div class="page">
      <div class="page-header">
        <h2>Оповещения</h2>
        <button mat-stroked-button (click)="reload(1)">Обновить</button>
      </div>
      <div class="filters">
        <mat-form-field>
          <mat-label>Статус</mat-label>
          <mat-select [(ngModel)]="status" (selectionChange)="reload(1)">
            <mat-option [value]="''">Все</mat-option>
            <mat-option value="queued">Передано в шлюз</mat-option>
            <mat-option value="sent">Доставлено</mat-option>
            <mat-option value="failed">Ошибка</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Канал</mat-label>
          <mat-select [(ngModel)]="channel" (selectionChange)="reload(1)">
            <mat-option [value]="''">Все</mat-option>
            <mat-option value="inbox">Панель ПМ</mat-option>
            <mat-option value="email">E-mail</mat-option>
            <mat-option value="sms">SMS</mat-option>
            <mat-option value="voice">Голосовой звонок</mat-option>
          </mat-select>
        </mat-form-field>
      </div>
      @if (error()) { <p class="status-failed">{{ error() }}</p> }
      <table mat-table [dataSource]="rows()" class="mat-elevation-z1">
        <ng-container matColumnDef="created_at"><th mat-header-cell *matHeaderCellDef>Создано</th><td mat-cell *matCellDef="let n">{{ n.created_at | date: 'dd.MM.yyyy HH:mm' }}</td></ng-container>
        <ng-container matColumnDef="channel"><th mat-header-cell *matHeaderCellDef>Канал</th><td mat-cell *matCellDef="let n">{{ n.channel_display }}</td></ng-container>
        <ng-container matColumnDef="recipient"><th mat-header-cell *matHeaderCellDef>Получатель</th><td mat-cell *matCellDef="let n">{{ n.recipient_name }} <span class="muted">{{ n.recipient_address }}</span></td></ng-container>
        <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>Статус</th>
          <td mat-cell *matCellDef="let n"><span class="status-{{ n.status }}">{{ n.status_display }}</span> <span class="muted">{{ n.error }}</span></td></ng-container>
        <ng-container matColumnDef="request_id"><th mat-header-cell *matHeaderCellDef>ID запроса</th><td mat-cell *matCellDef="let n" class="muted">{{ n.request_id }}</td></ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns" class="clickable-row" (click)="selected.set(row)"></tr>
      </table>
      <mat-paginator [length]="total()" [pageSize]="50" (page)="pageChanged($event)" />
      @if (selected(); as n) {
        <h3>Итоговый текст</h3>
        <pre class="message">{{ n.rendered_text || 'Текст появится после доставки (ответ шлюза)' }}</pre>
      }
    </div>
  `,
})
export class NotificationsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly columns = ['created_at', 'channel', 'recipient', 'status', 'request_id'];
  protected readonly rows = signal<Notification[]>([]);
  protected readonly total = signal(0);
  protected readonly error = signal('');
  protected readonly selected = signal<Notification | null>(null);
  protected status = '';
  protected channel = '';

  ngOnInit(): void {
    this.reload(1);
  }

  pageChanged(event: PageEvent): void {
    this.reload(event.pageIndex + 1);
  }

  reload(page: number): void {
    this.api.notifications({ page, status: this.status, channel: this.channel, ordering: '-created_at' }).subscribe({
      next: (r) => {
        this.rows.set(r.results);
        this.total.set(r.count);
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }
}
