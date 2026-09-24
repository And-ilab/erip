import { DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { Router } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { ApiService, errorMessage } from '../../core/api.service';
import { AccountRow } from '../../core/models';

@Component({
  selector: 'app-accounts-list',
  standalone: true,
  imports: [
    DecimalPipe, ReactiveFormsModule, MatTableModule, MatPaginatorModule, MatSortModule, MatFormFieldModule,
    MatInputModule, MatSelectModule,
  ],
  template: `
    <div class="page">
      <div class="page-header"><h2>Реестр задолженностей по ЛС</h2></div>
      <div class="filters">
        <mat-form-field>
          <mat-label>Поиск: номер ЛС, ФИО, адрес</mat-label>
          <input matInput [formControl]="search" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Группа задолженности</mat-label>
          <mat-select [formControl]="group">
            <mat-option [value]="null">Все</mat-option>
            @for (g of groups; track g) { <mat-option [value]="g">Группа {{ g }}</mat-option> }
          </mat-select>
        </mat-form-field>
      </div>
      @if (error()) { <p class="status-failed">{{ error() }}</p> }

      <table mat-table [dataSource]="rows()" matSort (matSortChange)="sortBy($event)" class="mat-elevation-z1">
        <ng-container matColumnDef="client_account">
          <th mat-header-cell *matHeaderCellDef mat-sort-header>Номер ЛС</th>
          <td mat-cell *matCellDef="let r">{{ r.client_account }}</td>
        </ng-container>
        <ng-container matColumnDef="short_fio">
          <th mat-header-cell *matHeaderCellDef mat-sort-header>Плательщик</th>
          <td mat-cell *matCellDef="let r">{{ r.short_fio }}</td>
        </ng-container>
        <ng-container matColumnDef="account_address">
          <th mat-header-cell *matHeaderCellDef>Адрес</th>
          <td mat-cell *matCellDef="let r">{{ r.account_address }}</td>
        </ng-container>
        <ng-container matColumnDef="provider_short_name">
          <th mat-header-cell *matHeaderCellDef>Обслуживающая организация</th>
          <td mat-cell *matCellDef="let r">{{ r.provider_short_name }}</td>
        </ng-container>
        <ng-container matColumnDef="debt_total">
          <th mat-header-cell *matHeaderCellDef>Долг по услугам, руб.</th>
          <td mat-cell *matCellDef="let r">{{ r.debt_total | number: '1.2-2' }}</td>
        </ng-container>
        <ng-container matColumnDef="debt_group">
          <th mat-header-cell *matHeaderCellDef mat-sort-header>Группа</th>
          <td mat-cell *matCellDef="let r">
            @if (r.effective_group) { <span class="group-badge g{{ r.effective_group }}">{{ r.effective_group }}</span> }
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns" class="clickable-row" (click)="open(row)"></tr>
      </table>
      <mat-paginator [length]="total()" [pageSize]="pageSize" [pageSizeOptions]="[25, 50, 100]" (page)="pageChanged($event)" />
    </div>
  `,
})
export class AccountsListComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  protected readonly columns = ['client_account', 'short_fio', 'account_address', 'provider_short_name', 'debt_total', 'debt_group'];
  protected readonly groups = [1, 2, 3, 4, 5, 6];
  protected readonly rows = signal<AccountRow[]>([]);
  protected readonly total = signal(0);
  protected readonly error = signal('');
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly group = new FormControl<number | null>(null);
  protected pageSize = 50;
  private page = 1;
  private ordering = '';

  ngOnInit(): void {
    this.search.valueChanges.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => this.reload(1));
    this.group.valueChanges.subscribe(() => this.reload(1));
    this.reload(1);
  }

  pageChanged(event: PageEvent): void {
    this.pageSize = event.pageSize;
    this.reload(event.pageIndex + 1);
  }

  sortBy(sort: Sort): void {
    this.ordering = sort.direction ? `${sort.direction === 'desc' ? '-' : ''}${sort.active}` : '';
    this.reload(1);
  }

  open(row: AccountRow): void {
    this.router.navigate(['/accounts', row.id]);
  }

  private reload(page: number): void {
    this.page = page;
    this.api
      .accounts({ page, page_size: this.pageSize, q: this.search.value, debt_group: this.group.value, ordering: this.ordering })
      .subscribe({
        next: (result) => {
          this.rows.set(result.results);
          this.total.set(result.count);
          this.error.set('');
        },
        error: (e) => this.error.set(errorMessage(e)),
      });
  }
}
