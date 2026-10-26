import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ApiService, errorMessage } from '../../core/api.service';

@Component({
  selector: 'app-extra-measures',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSnackBarModule],
  template: `
    <p class="muted">Справочник дополнительных мероприятий. Специалист выбирает строку и добавляет её на лицевой счёт, поставщик — на свою услугу.</p>
    <div class="row">
      <mat-form-field>
        <mat-label>Наименование</mat-label>
        <input matInput [(ngModel)]="name" />
      </mat-form-field>
      <mat-form-field class="wide">
        <mat-label>Пояснение</mat-label>
        <input matInput [(ngModel)]="note" />
      </mat-form-field>
      <button mat-stroked-button type="button" (click)="save()">{{ editing ? 'Сохранить' : 'Добавить' }}</button>
      @if (editing) { <button mat-button type="button" (click)="reset()">Отмена</button> }
    </div>
    <ul>
      @for (row of rows(); track row.id) {
        <li>
          <b>{{ row.name }}</b>
          @if (row.note) { <span class="muted"> — {{ row.note }}</span> }
          <button mat-button type="button" (click)="edit(row)">Изменить</button>
          <button mat-button type="button" (click)="remove(row.id)">Удалить</button>
        </li>
      } @empty { <li class="muted">Справочник пуст.</li> }
    </ul>
  `,
  styles: `
    .muted { color: var(--erip-muted); }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .wide { min-width: 280px; }
    ul { list-style: none; padding: 0; }
    li { padding: 6px 0; border-bottom: 1px solid var(--erip-border); }
  `,
})
export class ExtraMeasuresComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly snack = inject(MatSnackBar);
  protected readonly rows = signal<{ id: number; name: string; note: string }[]>([]);
  protected name = '';
  protected note = '';
  protected editing = 0;

  ngOnInit(): void {
    this.load();
  }

  protected edit(row: { id: number; name: string; note: string }): void {
    this.editing = row.id;
    this.name = row.name;
    this.note = row.note;
  }

  protected reset(): void {
    this.editing = 0;
    this.name = '';
    this.note = '';
  }

  protected save(): void {
    const name = this.name.trim();
    if (!name) return;
    this.api.saveExtraMeasure({ id: this.editing || undefined, name, note: this.note.trim() }).subscribe({
      next: () => {
        this.reset();
        this.load();
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected remove(id: number): void {
    this.api.deleteExtraMeasure(id).subscribe({
      next: () => this.load(),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private load(): void {
    this.api.extraMeasureCatalog().subscribe({
      next: (page) => this.rows.set(page.results),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }
}
