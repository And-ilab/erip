import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';

import { ApiService, errorMessage } from '../../core/api.service';
import { MeasureRow } from '../../core/models';

@Component({
  selector: 'app-measures-list',
  standalone: true,
  imports: [DatePipe, MatTableModule, RouterLink],
  template: `
    <div class="page">
      <div class="page-header"><h2>Реестр мероприятий</h2></div>
      @if (error()) { <p class="status-failed">{{ error() }}</p> }
      <table mat-table [dataSource]="rows()" class="mat-elevation-z1">
        <ng-container matColumnDef="kind_display"><th mat-header-cell *matHeaderCellDef>Вид</th><td mat-cell *matCellDef="let r">{{ r.kind_display }}</td></ng-container>
        <ng-container matColumnDef="status_display"><th mat-header-cell *matHeaderCellDef>Статус</th><td mat-cell *matCellDef="let r">{{ r.status_display }}</td></ng-container>
        <ng-container matColumnDef="due_on"><th mat-header-cell *matHeaderCellDef>Срок</th><td mat-cell *matCellDef="let r">{{ r.due_on | date: 'dd.MM.yyyy' }}</td></ng-container>
        <ng-container matColumnDef="accounts_count"><th mat-header-cell *matHeaderCellDef>ЛС</th><td mat-cell *matCellDef="let r">{{ r.accounts_count }}</td></ng-container>
        <ng-container matColumnDef="artifact"><th mat-header-cell *matHeaderCellDef>Файл</th><td mat-cell *matCellDef="let r">@if (r.artifact) { <a [href]="r.artifact">Скачать</a> }</td></ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>
    </div>
  `,
})
export class MeasuresListComponent implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly rows = signal<MeasureRow[]>([]);
  protected readonly error = signal('');
  protected readonly columns = ['kind_display', 'status_display', 'due_on', 'accounts_count', 'artifact'];

  ngOnInit(): void {
    this.api.measures().subscribe({
      next: (page) => this.rows.set(page.results),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }
}
