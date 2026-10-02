import { Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, inject, signal } from '@angular/core';

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

interface DayCell {
  iso: string;
  day: number;
  inMonth: boolean;
}

interface WeekRow {
  index: number;
  days: DayCell[];
}

@Component({
  selector: 'app-date-span',
  standalone: true,
  template: `
    <div class="span" (click)="$event.stopPropagation()">
      <button type="button" class="span-btn" (click)="open.set(!open())" [attr.aria-expanded]="open()">
        {{ caption() }}
      </button>
      @if (open()) {
        <div class="panel" role="dialog" aria-label="Календарь">
          <div class="nav">
            <button type="button" (click)="showMonth(viewYear, viewMonth - 1)" aria-label="Предыдущий месяц">‹</button>
            <select [value]="viewMonth" (change)="showMonth(viewYear, +$any($event.target).value)" aria-label="Месяц">
              @for (name of months; track name; let i = $index) {
                <option [value]="i + 1" [selected]="viewMonth === i + 1">{{ name }}</option>
              }
            </select>
            <select [value]="viewYear" (change)="showMonth(+$any($event.target).value, viewMonth)" aria-label="Год">
              @for (year of years; track year) {
                <option [value]="year" [selected]="viewYear === year">{{ year }}</option>
              }
            </select>
            <button type="button" (click)="showMonth(viewYear, viewMonth + 1)" aria-label="Следующий месяц">›</button>
          </div>
          <table>
            <thead>
              <tr>
                <th class="week"></th>
                @for (name of weekdays; track name) {
                  <th>{{ name }}</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (week of weeks(); track week.index) {
                <tr>
                  <th class="week">{{ week.index }}</th>
                  @for (day of week.days; track day.iso) {
                    <td>
                      <button
                        type="button"
                        class="day"
                        [class.out]="!day.inMonth"
                        [class.edge]="marked(day.iso)"
                        [class.in]="inside(day.iso)"
                        [class.today]="day.iso === today"
                        (click)="pick(day.iso)"
                      >{{ day.day }}</button>
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
          <p class="hint">Первый щелчок — один день, второй — конец диапазона.</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .span { position: relative; display: inline-block; }
    .span-btn {
      min-width: 220px; height: 40px; padding: 0 14px; border: 1px solid #d5dde5; border-radius: 8px;
      background: #fff; font: inherit; font-weight: 600; color: #1f2933; cursor: pointer; text-align: left;
    }
    .panel {
      position: absolute; z-index: 30; top: 44px; left: 0; width: 320px; padding: 12px;
      background: #fff; border: 1px solid #d5dde5; border-radius: 12px; box-shadow: 0 8px 24px rgba(16, 42, 67, .16);
    }
    .nav { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
    .nav button {
      width: 28px; height: 28px; border: 0; border-radius: 6px; background: #f3f6f8; cursor: pointer; font-size: 18px;
    }
    .nav select { flex: 1; height: 32px; border: 1px solid #d5dde5; border-radius: 6px; background: #fff; font: inherit; }
    table { width: 100%; border-collapse: collapse; }
    th { font-size: 11px; font-weight: 600; color: #6b7280; padding: 4px 0; }
    th.week, td { width: 36px; }
    th.week { color: #9aa5b1; font-weight: 500; }
    .day {
      width: 32px; height: 32px; margin: 1px; border: 0; border-radius: 8px; background: transparent;
      font: inherit; cursor: pointer; color: #1f2933;
    }
    .day.out { color: #c5ced6; }
    .day.in { background: #e7f2f4; }
    .day.edge { background: #0f6e78; color: #fff; }
    .day.today { box-shadow: inset 0 0 0 1px #0f6e78; }
    .day.edge.today { box-shadow: none; }
    .hint { margin: 8px 0 0; font-size: 12px; color: #6b7280; }
  `],
})
export class DateSpanComponent implements OnChanges {
  private readonly host = inject(ElementRef);

  @Input() from = '';
  @Input() to = '';
  @Output() readonly spanChange = new EventEmitter<{ from: string; to: string }>();

  protected readonly open = signal(false);
  protected readonly months = MONTHS;
  protected readonly weekdays = WEEKDAYS;
  protected viewYear = new Date().getFullYear();
  protected viewMonth = new Date().getMonth() + 1;
  protected readonly today = iso(new Date());
  private anchor: string | null = null;
  private rangeDone = false;

  ngOnChanges(): void {
    const source = this.from || this.today;
    const [year, month] = source.split('-').map(Number);
    if (year && month) {
      this.viewYear = year;
      this.viewMonth = month;
    }
  }

  protected get years(): number[] {
    const now = new Date().getFullYear();
    const values = [];
    for (let year = now - 6; year <= now + 6; year += 1) values.push(year);
    if (!values.includes(this.viewYear)) values.push(this.viewYear);
    return values.sort((a, b) => a - b);
  }

  @HostListener('document:click', ['$event'])
  closeOutside(event: MouseEvent): void {
    if (!this.open()) return;
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  protected caption(): string {
    if (!this.from) return 'Выберите дату';
    if (!this.to || this.from === this.to) return longDate(this.from);
    if (this.isWholeMonth()) return `${MONTHS[this.viewMonth - 1]} ${this.viewYear}`;
    return `${shortDate(this.from)} — ${shortDate(this.to)}`;
  }

  protected weeks(): WeekRow[] {
    const first = new Date(this.viewYear, this.viewMonth - 1, 1);
    const cursor = new Date(this.viewYear, this.viewMonth - 1, 1 - ((first.getDay() + 6) % 7));
    const rows: WeekRow[] = [];
    for (let index = 1; index <= 6; index += 1) {
      const days: DayCell[] = [];
      for (let column = 0; column < 7; column += 1) {
        days.push({
          iso: iso(cursor),
          day: cursor.getDate(),
          inMonth: cursor.getMonth() === this.viewMonth - 1,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      if (days.some((day) => day.inMonth)) rows.push({ index, days });
      if (!days.some((day) => day.inMonth) && rows.length) break;
    }
    return rows;
  }

  protected inside(value: string): boolean {
    if (!this.from || !this.to || this.isWholeMonth()) return false;
    return value > this.from && value < this.to;
  }

  protected marked(value: string): boolean {
    if (!this.from || !this.to || this.isWholeMonth()) return false;
    return value === this.from || value === this.to;
  }

  protected showMonth(year: number, month: number): void {
    const shifted = new Date(year, month - 1, 1);
    this.viewYear = shifted.getFullYear();
    this.viewMonth = shifted.getMonth() + 1;
    this.anchor = null;
    this.rangeDone = false;
    this.spanChange.emit(monthBounds(this.viewYear, this.viewMonth));
  }

  protected pick(value: string): void {
    const [year, month] = value.split('-').map(Number);
    this.viewYear = year;
    this.viewMonth = month;
    if (!this.anchor || this.rangeDone) {
      this.anchor = value;
      this.rangeDone = false;
      this.spanChange.emit({ from: value, to: value });
      return;
    }
    const [start, finish] = this.anchor <= value ? [this.anchor, value] : [value, this.anchor];
    this.anchor = null;
    this.rangeDone = true;
    this.spanChange.emit({ from: start, to: finish });
    this.open.set(false);
  }

  private isWholeMonth(): boolean {
    const bounds = monthBounds(this.viewYear, this.viewMonth);
    return this.from === bounds.from && this.to === bounds.to;
  }
}

function iso(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function monthBounds(year: number, month: number): { from: string; to: string } {
  const last = new Date(year, month, 0).getDate();
  const pad = String(month).padStart(2, '0');
  return { from: `${year}-${pad}-01`, to: `${year}-${pad}-${String(last).padStart(2, '0')}` };
}

function longDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return `${day} ${MONTHS_GENITIVE[month - 1]} ${year}`;
}

function shortDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${Number(day)}.${month}.${year}`;
}
