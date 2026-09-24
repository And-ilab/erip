import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';

import { ApiService, errorMessage } from '../../core/api.service';
import { ErrorLogEntry } from '../../core/models';

@Component({
  selector: 'app-errors',
  standalone: true,
  imports: [DatePipe, FormsModule, MatTableModule, MatPaginatorModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule],
  template: `
    <div class="page">
      <div class="page-header"><h2>Журнал ошибок</h2></div>
      <div class="filters">
        <mat-form-field>
          <mat-label>Сервис</mat-label>
          <mat-select [(ngModel)]="service" (selectionChange)="reload(1)">
            <mat-option [value]="''">Все</mat-option>
            <mat-option value="backend">backend</mat-option>
            <mat-option value="gateway">gateway</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field><mat-label>ID запроса</mat-label><input matInput [(ngModel)]="requestId" (keyup.enter)="reload(1)" /></mat-form-field>
        <button mat-stroked-button (click)="reload(1)">Найти</button>
      </div>
      @if (error()) { <p class="status-failed">{{ error() }}</p> }
      <table mat-table [dataSource]="rows()" class="mat-elevation-z1">
        <ng-container matColumnDef="created_at"><th mat-header-cell *matHeaderCellDef>Время</th><td mat-cell *matCellDef="let e">{{ e.created_at | date: 'dd.MM.yyyy HH:mm:ss' }}</td></ng-container>
        <ng-container matColumnDef="service"><th mat-header-cell *matHeaderCellDef>Сервис</th><td mat-cell *matCellDef="let e">{{ e.service }}</td></ng-container>
        <ng-container matColumnDef="error_type"><th mat-header-cell *matHeaderCellDef>Тип</th><td mat-cell *matCellDef="let e">{{ e.error_type }}</td></ng-container>
        <ng-container matColumnDef="message"><th mat-header-cell *matHeaderCellDef>Сообщение</th><td mat-cell *matCellDef="let e">{{ e.message }}</td></ng-container>
        <ng-container matColumnDef="request_id"><th mat-header-cell *matHeaderCellDef>ID запроса</th><td mat-cell *matCellDef="let e" class="muted">{{ e.request_id }}</td></ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns" class="clickable-row" (click)="selected.set(row)"></tr>
      </table>
      <mat-paginator [length]="total()" [pageSize]="50" (page)="pageChanged($event)" />
      @if (selected(); as e) {
        <h3>{{ e.error_type }} · {{ e.path }}</h3>
        <pre class="message">{{ e.traceback || e.message }}</pre>
      }
    </div>
  `,
})
export class ErrorsComponent implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly columns = ['created_at', 'service', 'error_type', 'message', 'request_id'];
  protected readonly rows = signal<ErrorLogEntry[]>([]);
  protected readonly total = signal(0);
  protected readonly error = signal('');
  protected readonly selected = signal<ErrorLogEntry | null>(null);
  protected service = '';
  protected requestId = '';

  ngOnInit(): void {
    this.reload(1);
  }

  pageChanged(event: PageEvent): void {
    this.reload(event.pageIndex + 1);
  }

  reload(page: number): void {
    this.api.errors({ page, service: this.service, request_id: this.requestId.trim() }).subscribe({
      next: (r) => {
        this.rows.set(r.results);
        this.total.set(r.count);
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }
}
