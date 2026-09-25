import { DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTableModule } from '@angular/material/table';
import { Router } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { ApiService, errorMessage } from '../../core/api.service';
import { AccountService } from '../../core/models';

@Component({
  selector: 'app-contracts-list',
  standalone: true,
  imports: [DecimalPipe, ReactiveFormsModule, MatTableModule, MatPaginatorModule, MatFormFieldModule, MatInputModule],
  template: `
    <div class="page">
      <div class="page-header"><h2>Реестр задолженностей по договорам</h2></div>
      <div class="filters">
        <mat-form-field>
          <mat-label>Поиск: ФИО, номер ЛС, услуга, ИН/УНП</mat-label>
          <input matInput [formControl]="search" />
        </mat-form-field>
      </div>
      @if (error()) { <p class="status-failed">{{ error() }}</p> }
      <table mat-table [dataSource]="rows()" class="mat-elevation-z1">
        <ng-container matColumnDef="payer"><th mat-header-cell *matHeaderCellDef>Должник</th><td mat-cell *matCellDef="let r">{{ r.payer }}</td></ng-container>
        <ng-container matColumnDef="payer_identifier"><th mat-header-cell *matHeaderCellDef>ИН/УНП</th><td mat-cell *matCellDef="let r">{{ r.payer_identifier }}</td></ng-container>
        <ng-container matColumnDef="account_number"><th mat-header-cell *matHeaderCellDef>ЛС</th><td mat-cell *matCellDef="let r">{{ r.account_number }}</td></ng-container>
        <ng-container matColumnDef="service_name"><th mat-header-cell *matHeaderCellDef>Услуга</th><td mat-cell *matCellDef="let r">{{ r.service_name }}</td></ng-container>
        <ng-container matColumnDef="shot_name"><th mat-header-cell *matHeaderCellDef>Поставщик</th><td mat-cell *matCellDef="let r">{{ r.shot_name }}</td></ng-container>
        <ng-container matColumnDef="balance_out"><th mat-header-cell *matHeaderCellDef>Долг</th><td mat-cell *matCellDef="let r">{{ r.balance_out | number: '1.2-2' }}</td></ng-container>
        <ng-container matColumnDef="balance_mulct_out"><th mat-header-cell *matHeaderCellDef>Пеня</th><td mat-cell *matCellDef="let r">{{ r.balance_mulct_out | number: '1.2-2' }}</td></ng-container>
        <ng-container matColumnDef="debt_started_on"><th mat-header-cell *matHeaderCellDef>Возникновение</th><td mat-cell *matCellDef="let r">{{ r.debt_started_on }}</td></ng-container>
        <ng-container matColumnDef="effective_group"><th mat-header-cell *matHeaderCellDef>Группа</th><td mat-cell *matCellDef="let r">{{ r.effective_group }}</td></ng-container>
        <ng-container matColumnDef="category_name"><th mat-header-cell *matHeaderCellDef>Категория</th><td mat-cell *matCellDef="let r">{{ r.category_name }}</td></ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns" class="clickable-row" (click)="open(row)"></tr>
      </table>
      <mat-paginator [length]="total()" [pageSize]="50" (page)="pageChanged($event)" />
    </div>
  `,
})
export class ContractsListComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly columns = [
    'payer', 'payer_identifier', 'account_number', 'service_name', 'shot_name',
    'balance_out', 'balance_mulct_out', 'debt_started_on', 'effective_group', 'category_name',
  ];
  protected readonly rows = signal<AccountService[]>([]);
  protected readonly total = signal(0);
  protected readonly error = signal('');
  protected readonly search = new FormControl('', { nonNullable: true });
  private page = 1;

  ngOnInit(): void {
    this.search.valueChanges.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => this.reload(1));
    this.reload(1);
  }

  pageChanged(event: PageEvent): void {
    this.reload(event.pageIndex + 1);
  }

  open(row: AccountService): void {
    this.router.navigate(['/contracts', row.id]);
  }

  private reload(page: number): void {
    this.page = page;
    this.api.contracts({ page, page_size: 50, search: this.search.value }).subscribe({
      next: (result) => {
        this.rows.set(result.results);
        this.total.set(result.count);
        this.error.set('');
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }
}
