import { Directive, OnDestroy, Component, computed, inject, input, output } from '@angular/core';
import { FormsModule, NgModel } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

/** Компактный календарь. Снаружи дата строкой ГГГГ-ММ-ДД, на экране — дд.мм.гггг. */
@Component({
  selector: 'app-date-field',
  standalone: true,
  imports: [FormsModule, MatFormFieldModule, MatInputModule, MatDatepickerModule],
  template: `
    <mat-form-field class="compact" [class.need]="required() && !value()" subscriptSizing="dynamic">
      <mat-label>{{ label() }}@if (required()) { * }</mat-label>
      <input matInput [matDatepicker]="picker" [ngModel]="parsed()" (focus)="arm()" (dateChange)="commit($event.value)" />
      <mat-datepicker-toggle matIconSuffix [for]="picker" />
      <mat-datepicker #picker />
      @if (required() && !value()) { <mat-hint>обязательно</mat-hint> }
    </mat-form-field>
  `,
  styles: `
    :host { display: inline-block; }
    .compact { width: 210px; }
    .need { --mdc-outlined-text-field-outline-color: #c62828; --mdc-outlined-text-field-label-text-color: #c62828; }
  `,
})
export class DateFieldComponent implements OnDestroy {
  readonly label = input.required<string>();
  readonly required = input(false);
  readonly value = input('');
  readonly valueChange = output<string>();

  /** Один и тот же объект, пока строка даты не изменилась. Новый Date на каждый цикл вешает страницу. */
  protected readonly parsed = computed(() => parseIsoDate(this.value()));
  private gone = false;
  private touched = false;
  private pending = '';
  private scheduled = false;

  ngOnDestroy(): void {
    this.gone = true;
  }

  /** Пустое значение до фокуса — это снятие поля с экрана, а не очистка даты. */
  protected arm(): void {
    this.touched = true;
  }

  protected commit(value: Date | null): void {
    if (this.gone) return;
    const next = formatIsoDate(value);
    if (!next && !this.touched) return;
    this.pending = next;
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.gone) return;
      const chosen = this.pending;
      if (!chosen && !this.touched) return;
      if (chosen === (this.value() || '')) return;
      this.valueChange.emit(chosen);
    });
  }
}

/** Снятие поля с экрана не затирает уже введённое значение в модели. */
@Directive({
  selector: '[holdDraft]',
  standalone: true,
})
export class HoldDraftDirective implements OnDestroy {
  private gone = false;

  constructor() {
    const model = inject(NgModel, { self: true });
    const original = model.viewToModelUpdate.bind(model);
    model.viewToModelUpdate = (value: unknown) => {
      queueMicrotask(() => {
        if (this.gone) return;
        original(value);
      });
    };
  }

  ngOnDestroy(): void {
    this.gone = true;
  }
}

function parseIsoDate(raw: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw || '');
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatIsoDate(value: Date | null): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}
