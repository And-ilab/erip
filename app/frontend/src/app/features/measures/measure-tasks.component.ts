import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ApiService, errorMessage } from '../../core/api.service';
import { MeasureTaskRow } from '../../core/models';

/** Один блок заданий: карточка партии и вкладка «Мероприятия» на лицевом счёте. */
@Component({
  selector: 'app-measure-tasks',
  standalone: true,
  imports: [
    FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSnackBarModule,
  ],
  template: `
    @if (tasks().length || canWrite()) {
      <div class="tasks">
        @for (task of tasks(); track task.id) {
          <div class="task">
            <div class="task-head">
              <strong>{{ task.title }}</strong>
              <span class="status-pill" [class.done]="task.status === 'done'">{{ task.status === 'done' ? 'Выполнено' : 'Открыто' }}</span>
              @if (task.due_on) { <span class="muted">до {{ dueLabel(task.due_on) }}</span> }
              @if (task.assignee_name) { <span class="muted">{{ task.assignee_name }}</span> }
              @if (canWrite()) {
                <button mat-stroked-button type="button" [disabled]="busy()" (click)="toggleTask(task)">
                  {{ task.status === 'done' ? 'Вернуть в работу' : 'Выполнено' }}
                </button>
              }
            </div>
          </div>
        }
        @if (canWrite()) {
          <div class="filters">
            <mat-form-field class="wide"><mat-label>Новое задание</mat-label><input matInput [(ngModel)]="taskTitle" /></mat-form-field>
            <mat-form-field><mat-label>Срок</mat-label><input matInput type="date" [(ngModel)]="taskDue" /></mat-form-field>
            <button mat-stroked-button type="button" [disabled]="busy()" (click)="addTask()">Добавить задание</button>
          </div>
        }
      </div>
    }
  `,
  styles: `
    .tasks { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
    .task { padding: 8px 0; border-top: 1px solid var(--erip-border); }
    .task-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .wide { min-width: 220px; }
    .muted { color: var(--erip-muted); font-size: 13px; }
  `,
})
export class MeasureTasksComponent {
  private readonly api = inject(ApiService);
  private readonly snack = inject(MatSnackBar);

  readonly measureId = input.required<number>();
  readonly tasks = input<MeasureTaskRow[]>([]);
  readonly canWrite = input(false);
  readonly changed = output<void>();

  protected readonly busy = signal(false);
  protected dueLabel(value: string): string {
    const [year, month, day] = value.slice(0, 10).split('-');
    return day && month && year ? `${day}.${month}.${year}` : value;
  }

  protected taskTitle = '';
  protected taskDue = '';

  protected addTask(): void {
    const title = this.taskTitle.trim();
    if (!title) {
      this.snack.open('Укажите задание', 'OK');
      return;
    }
    this.busy.set(true);
    this.api.addMeasureTask(this.measureId(), title, this.taskDue).subscribe({
      next: () => {
        this.busy.set(false);
        this.taskTitle = '';
        this.taskDue = '';
        this.snack.open('Задание добавлено', 'OK', { duration: 2500 });
        this.changed.emit();
      },
      error: (err) => this.fail(err),
    });
  }

  protected toggleTask(task: MeasureTaskRow): void {
    const status = task.status === 'done' ? 'open' : 'done';
    this.busy.set(true);
    this.api.setMeasureTaskStatus(this.measureId(), task.id, status).subscribe({
      next: () => {
        this.busy.set(false);
        this.changed.emit();
      },
      error: (err) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.busy.set(false);
    this.snack.open(errorMessage(err), 'OK');
  }
}
