import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
      <input matInput [matDatepicker]="picker" [ngModel]="asDate()" (ngModelChange)="commit($event)" />
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
export class DateFieldComponent {
  readonly label = input.required<string>();
  readonly required = input(false);
  readonly value = input('');
  readonly valueChange = output<string>();

  protected asDate(): Date | null {
    const raw = this.value();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw || '');
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  protected commit(value: Date | null): void {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      this.valueChange.emit('');
      return;
    }
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    this.valueChange.emit(`${value.getFullYear()}-${month}-${day}`);
  }
}
