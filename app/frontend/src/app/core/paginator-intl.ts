import { Injectable } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';

@Injectable()
export class RuPaginatorIntl extends MatPaginatorIntl {
  override itemsPerPageLabel = 'На странице:';
  override nextPageLabel = 'Следующая';
  override previousPageLabel = 'Предыдущая';
  override firstPageLabel = 'Первая';
  override lastPageLabel = 'Последняя';
  override getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0) return `0 из 0`;
    const start = page * pageSize + 1;
    const end = Math.min(start + pageSize - 1, length);
    return `${start}–${end} из ${length}`;
  };
}
