import { Component, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { CalendarEvent, MessageTemplate, ServiceChoice } from '../../core/models';

export type CalendarMode = 'day' | 'week' | 'month' | 'year';

export interface CalendarDraft {
  date: string;
  kind: string;
  template_name?: string;
  channel?: string;
  time_from?: string;
  time_to?: string;
  days?: number;
  scenario_name?: string;
  assignee?: string;
  catalog_service_ids?: number[];
}

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const KINDS = [
  { id: 'call', label: 'Автообзвон' },
  { id: 'notice', label: 'Уведомление' },
  { id: 'warning', label: 'Предупреждение' },
  { id: 'disconnect', label: 'Отключение' },
  { id: 'collection', label: 'Взыскание' },
  { id: 'scenario', label: 'Смена сценария' },
];

interface DayCell {
  iso: string;
  day: number;
  inMonth: boolean;
}

@Component({
  selector: 'app-calendar-board',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="bar">
      <strong>{{ caption() }}</strong>
      <span class="legend"><i class="swatch"></i> срок впереди</span>
      <span class="legend"><i class="swatch soon"></i> 1–2 дня</span>
      <span class="legend"><i class="swatch overdue"></i> срок прошёл, действие не сделано</span>
      <button type="button" [class.on]="drawer" [attr.aria-expanded]="drawer" (click)="drawer = true">Календарь</button>
    </div>

    @if (draft) {
      <form class="draft" (submit)="$event.preventDefault(); save()">
        <p>Новое событие на {{ long(draft) }}. Оно попадёт в текущий фильтр реестра.</p>
        <label>Вид
          <select [formControl]="kind">
            @for (item of kinds; track item.id) { <option [value]="item.id">{{ item.label }}</option> }
          </select>
        </label>
        @if (needsTemplate()) {
          <label>Шаблон
            <select [formControl]="templateId">
              <option value="">Выберите</option>
              @for (item of shownTemplates(); track item.id) {
                <option [value]="item.id">{{ item.name }}</option>
              }
            </select>
          </label>
        }
        @if (needsServices()) {
          <label>Услуги
            <select [formControl]="services" multiple>
              @for (item of serviceChoices; track item.service_id) {
                <option [value]="item.service_id">{{ item.service_name }}</option>
              }
            </select>
          </label>
        }
        @if (kind.value === 'notice') {
          <label>Канал
            <select [formControl]="channel">
              <option value="sms">SMS</option>
              <option value="email">E-mail</option>
            </select>
          </label>
        }
        @if (kind.value === 'call') {
          <label>С <input type="time" [formControl]="timeFrom" /></label>
          <label>По <input type="time" [formControl]="timeTo" /></label>
        }
        @if (kind.value === 'scenario') {
          <label>Сценарий <input [formControl]="scenarioName" /></label>
        }
        @if (kind.value === 'collection') {
          <label>Исполнитель (id) <input [formControl]="assignee" /></label>
        }
        @if (draftError) { <p class="fail">{{ draftError }}</p> }
        <button type="submit">Создать</button>
        <button type="button" (click)="draft = ''">Отмена</button>
      </form>
    }

    @switch (mode) {
      @case ('day') {
        @if (hiddenDays()) {
          <p class="muted">В диапазоне {{ caption() }} показаны дни, где есть события.</p>
        }
        @for (day of coveredDays(); track day) {
          <section class="day">
            <h3>{{ long(day) }}</h3>
            @for (event of named(day); track track(event)) {
              <button type="button" class="ev" [class.overdue]="event.urgency === 'overdue'" [class.soon]="event.urgency === 'soon'" [class.done]="event.urgency === 'done'" [title]="event.title" (click)="openEvent.emit(event)">
                {{ event.title }}
              </button>
            } @empty {
              <p class="muted">В этот день сроков нет.</p>
            }
          </section>
        }
      }
      @case ('week') {
        @for (week of coveredWeeks(); track week[0]) {
          <div class="week">
            @for (day of week; track day) {
              <section [class.dim]="!inSpan(day)">
                <button type="button" class="num" (click)="begin(day)">{{ long(day) }}</button>
                @for (event of named(day).slice(0, 3); track track(event)) {
                  <button type="button" class="ev" [class.overdue]="event.urgency === 'overdue'" [class.soon]="event.urgency === 'soon'" [class.done]="event.urgency === 'done'" [title]="event.title" (click)="openEvent.emit(event)">{{ event.title }}</button>
                }
                @if (named(day).length > 3) {
                  <button type="button" class="more" (click)="focusDay(day)">ещё {{ named(day).length - 3 }}</button>
                }
              </section>
            }
          </div>
        }
      }
      @case ('month') {
        @for (month of coveredMonths(); track month.key) {
          <section class="month-block">
            @if (coveredMonths().length > 1) { <h3>{{ month.name }}</h3> }
            <table class="month">
              <thead>
                <tr>
                  @for (name of weekdays; track name) { <th>{{ name }}</th> }
                </tr>
              </thead>
              <tbody>
                @for (week of month.weeks; track $index) {
                  <tr>
                    @for (day of week; track day.iso) {
                      <td [class.out]="!day.inMonth" [class.dim]="day.inMonth && !inSpan(day.iso)" [class.mark]="marked(day.iso)" [class.today]="day.iso === today">
                        <button type="button" class="num" (click)="begin(day.iso)">{{ day.day }}</button>
                        @for (event of named(day.iso).slice(0, 2); track track(event)) {
                          <button type="button" class="ev" [class.overdue]="event.urgency === 'overdue'" [class.soon]="event.urgency === 'soon'" [class.done]="event.urgency === 'done'" [title]="event.title" (click)="openEvent.emit(event)">{{ event.title }}</button>
                        }
                        @if (named(day.iso).length > 2) {
                          <button type="button" class="more" (click)="focusDay(day.iso)">ещё {{ named(day.iso).length - 2 }}</button>
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </section>
        }
      }
      @case ('year') {
        @for (year of coveredYears(); track year) {
          <div class="year">
            @for (month of yearMonths(year); track month.index) {
              <section>
                <h3>{{ month.name }}</h3>
                <table>
                  <tr>
                    @for (name of weekdays; track name) { <th>{{ name[0] }}</th> }
                  </tr>
                  @for (week of month.weeks; track $index) {
                    <tr>
                      @for (day of week; track day.iso) {
                        <td>
                          <button type="button" class="dot" [class.out]="!day.inMonth || !inSpan(day.iso)" [class.busy]="tone(day.iso) === 'busy'" [class.soon]="tone(day.iso) === 'soon'" [class.overdue]="tone(day.iso) === 'overdue'" (click)="focusDay(day.iso)">{{ day.day }}</button>
                        </td>
                      }
                    </tr>
                  }
                </table>
              </section>
            }
          </div>
        }
      }
    }

    @if (drawer) {
      <div class="scrim" (click)="drawer = false"></div>
      <aside class="drawer" role="dialog" aria-label="Календарь" (click)="$event.stopPropagation()">
        <header>
          <strong>Календарь</strong>
          <button type="button" (click)="drawer = false" aria-label="Закрыть">×</button>
        </header>
        <section>
          <h3>Виды отображения</h3>
          <div class="modes">
            @for (item of modes; track item.id) {
              <button type="button" [class.on]="mode === item.id" (click)="switchMode(item.id)">{{ item.label }}</button>
            }
          </div>
        </section>
        <section>
          <h3>Выбор дня/диапазона</h3>
          <div class="tools">
            <button type="button" (click)="shift(-1)" aria-label="Назад">‹</button>
            <button type="button" (click)="goToday()">Сегодня</button>
            <button type="button" (click)="shift(1)" aria-label="Вперёд">›</button>
            <button type="button" (click)="openFilters($event)">Фильтры</button>
          </div>
          <div class="pick-nav">
            <button type="button" (click)="pickShift(-1)" aria-label="Предыдущий месяц">‹</button>
            <select (change)="onPickMonth($event)">
              @for (name of months; track name; let index = $index) {
                <option [value]="index + 1" [selected]="pickMonth === index + 1">{{ name }}</option>
              }
            </select>
            <select (change)="onPickYear($event)">
              @for (year of years(); track year) {
                <option [value]="year" [selected]="pickYear === year">{{ year }}</option>
              }
            </select>
            <button type="button" (click)="pickShift(1)" aria-label="Следующий месяц">›</button>
          </div>
          <table class="matrix">
            <thead>
              <tr>
                @for (name of weekdays; track name) { <th>{{ name }}</th> }
              </tr>
            </thead>
            <tbody>
              @for (week of pickWeeks(); track $index) {
                <tr>
                  @for (day of week; track day.iso) {
                    <td>
                      <button
                        type="button"
                        class="cell"
                        [class.out]="!day.inMonth"
                        [class.in]="inPick(day.iso)"
                        [class.start]="day.iso === pickStart"
                        [class.end]="rangeDone && day.iso === pickEnd && pickEnd !== pickStart"
                        [class.today]="day.iso === today"
                        (click)="pick(day.iso)">{{ day.day }}</button>
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
          <p class="hint">{{ pickHint() }}</p>
        </section>
        <section>
          <h3>Сроки</h3>
          <p class="hint">Запись — крайний срок действия по конкретному лицевому счёту или договору: что сделать и по какому счёту. Если дата прошла, а действие не выполнено, запись остаётся и подсвечивается красным. До срока один или два дня — жёлтым. Кнопки, которая прячет события и оставляет пустую подпись, нет.</p>
        </section>
      </aside>
    }
  `,
  styles: [`
    .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
    .legend { display: inline-flex; align-items: center; gap: 6px; color: #52606d; font-size: 12px; }
    .swatch { width: 12px; height: 12px; border-radius: 3px; background: #e7f2f4; }
    .swatch.soon { background: #fff4d6; }
    .swatch.overdue { background: #fde8e8; }
    .bar button, .draft button, .draft select, .draft input, .drawer button:not(.cell), .drawer select {
      height: 32px; border: 1px solid #d5dde5; border-radius: 6px; background: #fff; color: #1f2933; font: inherit; cursor: pointer;
    }
    .bar button, .draft button, .drawer header button { padding: 0 10px; }
    .bar button.on, .bar .add, .modes button.on { background: #0f6e78; color: #fff; border-color: #0f6e78; }
    .draft { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; margin-bottom: 12px; padding: 10px; background: #fff; border: 1px solid #d5dde5; border-radius: 8px; }
    .draft p { flex: 1 1 100%; margin: 0; font-size: 13px; }
    .draft label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #52606d; }
    .draft select, .draft input { min-width: 140px; padding: 0 8px; }
    .fail { color: #c62828; }
    .day, .week section { background: #fff; border: 1px solid #e6ebf0; border-radius: 8px; padding: 10px; }
    .day + .day, .week + .week, .month-block + .month-block { margin-top: 12px; }
    .week { display: grid; grid-template-columns: repeat(7, minmax(120px, 1fr)); gap: 8px; }
    .week section.dim { background: #f8fafb; }
    .month, .year table, .matrix { width: 100%; border-collapse: collapse; background: #fff; }
    .month td { vertical-align: top; height: 88px; border: 1px solid #e6ebf0; padding: 4px; }
    .month td.out, .month td.dim { background: #f8fafb; }
    .month td.mark { background: #e7f2f4; }
    .month td.today { box-shadow: inset 0 0 0 1px #0f6e78; }
    .month-block h3, .day h3 { margin: 0 0 8px; font-size: 15px; }
    .num, .ev, .more, .dot { display: block; width: 100%; border: 0; background: transparent; text-align: left; font: inherit; cursor: pointer; }
    .num { font-weight: 700; color: #1f2933; }
    .ev { margin-top: 2px; padding: 2px 4px; border-radius: 4px; background: #e7f2f4; color: #0f4c54; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ev.soon { background: #fff4d6; color: #8a5a00; }
    .ev.overdue { background: #fde8e8; color: #9b1c1c; }
    .ev.done { background: #f4f6f8; color: #52606d; }
    .more { font-size: 11px; color: #6b7280; }
    .year { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .year + .year { margin-top: 12px; }
    .year section { background: #fff; border: 1px solid #e6ebf0; border-radius: 8px; padding: 8px; }
    .year h3 { margin: 0 0 6px; font-size: 13px; }
    .year th, .year td, .matrix th, .matrix td { text-align: center; font-size: 11px; }
    .dot { width: 22px; height: 22px; margin: 0 auto; border-radius: 11px; text-align: center; }
    .dot.out { color: #c5ced6; }
    .dot.busy { background: #0f6e78; color: #fff; }
    .dot.soon { background: #c48a00; color: #fff; }
    .dot.overdue { background: #9b1c1c; color: #fff; }
    .muted, .hint { color: #6b7280; font-size: 13px; }
    .scrim { position: fixed; top: 64px; right: 0; bottom: 0; left: 0; z-index: 50; background: rgba(15, 23, 42, 0.28); }
    .drawer {
      position: fixed; top: 64px; right: 0; z-index: 51; width: 360px; max-width: 100%; height: calc(100vh - 64px);
      overflow: auto; background: #fff; box-shadow: -8px 0 24px rgba(15, 23, 42, 0.12); padding: 16px 18px 28px;
    }
    .drawer header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .drawer header button { width: 32px; padding: 0; font-size: 18px; line-height: 1; }
    .drawer section + section { margin-top: 18px; padding-top: 16px; border-top: 1px solid #e6ebf0; }
    .drawer h3 { margin: 0 0 10px; font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: #52606d; }
    .modes { display: flex; }
    .modes button { flex: 1; border-radius: 0; }
    .modes button:first-child { border-radius: 6px 0 0 6px; }
    .modes button:last-child { border-radius: 0 6px 6px 0; }
    .tools, .pick-nav { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
    .tools button { flex: 1; }
    .pick-nav select { flex: 1; padding: 0 6px; }
    .pick-nav button { width: 32px; padding: 0; }
    .cell { width: 36px; height: 32px; margin: 1px auto; border: 0; border-radius: 6px; background: transparent; color: #1f2933; font: inherit; cursor: pointer; }
    .cell.out { color: #8b97a3; }
    .cell.in { background: #e7f2f4; color: #1f2933; }
    .cell.start, .cell.end { background: #0f6e78; color: #fff; }
    .cell.today { box-shadow: inset 0 0 0 1px #0f6e78; }
    @media (max-width: 1100px) { .year { grid-template-columns: repeat(2, 1fr); } .week { grid-template-columns: repeat(2, 1fr); } }
  `],
})
export class CalendarBoardComponent implements OnChanges {
  @Input() events: CalendarEvent[] = [];
  @Input() from = '';
  @Input() to = '';
  @Input() mode: CalendarMode = 'month';
  @Input() canCreate = false;
  @Input() supplier = false;
  @Input() templates: MessageTemplate[] = [];
  @Input() serviceChoices: ServiceChoice[] = [];
  @Output() readonly modeChange = new EventEmitter<CalendarMode>();
  @Output() readonly spanChange = new EventEmitter<{ from: string; to: string }>();
  @Output() readonly openEvent = new EventEmitter<CalendarEvent>();
  @Output() readonly createEvent = new EventEmitter<CalendarDraft>();
  @Output() readonly filters = new EventEmitter<void>();

  protected readonly modes = [
    { id: 'day' as const, label: 'День' },
    { id: 'week' as const, label: 'Неделя' },
    { id: 'month' as const, label: 'Месяц' },
    { id: 'year' as const, label: 'Год' },
  ];
  protected readonly weekdays = WEEKDAYS;
  protected readonly months = MONTHS;
  protected readonly kinds = KINDS;
  protected readonly today = iso(new Date());
  protected drawer = false;
  protected draft = '';
  protected draftError = '';
  protected pickYear = new Date().getFullYear();
  protected pickMonth = new Date().getMonth() + 1;
  protected pickStart = '';
  protected pickEnd = '';
  protected rangeDone = true;
  protected readonly kind = new FormControl('warning', { nonNullable: true });
  protected readonly templateId = new FormControl('', { nonNullable: true });
  protected readonly channel = new FormControl('sms', { nonNullable: true });
  protected readonly timeFrom = new FormControl('09:00', { nonNullable: true });
  protected readonly timeTo = new FormControl('18:00', { nonNullable: true });
  protected readonly scenarioName = new FormControl('', { nonNullable: true });
  protected readonly assignee = new FormControl('', { nonNullable: true });
  protected readonly services = new FormControl<string[]>([], { nonNullable: true });
  private index = new Map<string, CalendarEvent[]>();
  private pickerBrowsing = false;

  @HostListener('document:keydown.escape')
  closeOnEscape(): void {
    this.drawer = false;
  }

  ngOnChanges(changes: SimpleChanges): void {
    const next = new Map<string, CalendarEvent[]>();
    for (const event of this.events) {
      const rows = next.get(event.date) ?? [];
      rows.push(event);
      next.set(event.date, rows);
    }
    this.index = next;
    if (!changes['from'] && !changes['to']) return;
    if (this.pickStart && !this.rangeDone) return;
    this.pickStart = this.anchor();
    this.pickEnd = this.spanEnd();
    this.rangeDone = true;
    if (!this.pickerBrowsing) {
      const [year, month] = this.pickStart.split('-').map(Number);
      this.pickYear = year;
      this.pickMonth = month;
    }
  }

  protected anchor(): string {
    return this.from || this.today;
  }

  protected spanEnd(): string {
    return this.to || this.anchor();
  }

  protected caption(): string {
    const start = this.anchor();
    const end = this.spanEnd();
    const natural = windowFor(this.mode, start);
    if (natural.from === start && natural.to === end) {
      if (this.mode === 'day') return longDate(start);
      if (this.mode === 'year') return start.slice(0, 4);
      if (this.mode === 'month') {
        const [year, month] = start.split('-').map(Number);
        return `${MONTHS[month - 1]} ${year}`;
      }
      return `${short(start)} — ${short(end)}`;
    }
    if (start === end) return longDate(start);
    const left = start.slice(0, 4) === end.slice(0, 4) ? short(start) : `${short(start)}.${start.slice(0, 4)}`;
    return `${left} — ${short(end)}.${end.slice(0, 4)}`;
  }

  protected on(date: string): CalendarEvent[] {
    return this.index.get(date) ?? [];
  }

  protected named(date: string): CalendarEvent[] {
    return this.on(date).filter((event) => (event.title || '').trim().length > 0);
  }

  protected tone(date: string): string {
    if (!this.inSpan(date)) return '';
    const events = this.named(date);
    if (!events.length) return '';
    if (events.some((event) => event.urgency === 'overdue')) return 'overdue';
    if (events.some((event) => event.urgency === 'soon')) return 'soon';
    return 'busy';
  }

  protected track(event: CalendarEvent): string {
    return `${event.date}:${event.kind}:${event.title}:${event.measure_id ?? ''}:${event.contract_id ?? ''}:${event.account_id ?? ''}`;
  }

  protected long(value: string): string {
    return longDate(value);
  }

  protected inSpan(date: string): boolean {
    return date >= this.anchor() && date <= this.spanEnd();
  }

  protected marked(date: string): boolean {
    if (!this.inSpan(date)) return false;
    const natural = windowFor(this.mode, this.anchor());
    return natural.from !== this.anchor() || natural.to !== this.spanEnd();
  }

  protected switchMode(mode: CalendarMode): void {
    const start = this.anchor();
    const end = this.spanEnd();
    const previous = windowFor(this.mode, start);
    const custom = previous.from !== start || previous.to !== end;
    this.mode = mode;
    this.modeChange.emit(mode);
    if (custom) return;
    this.followWindow();
    this.spanChange.emit(windowFor(mode, start));
  }

  protected shift(step: number): void {
    this.followWindow();
    const start = this.anchor();
    const end = this.spanEnd();
    const natural = windowFor(this.mode, start);
    if (natural.from === start && natural.to === end) {
      this.spanChange.emit(windowFor(this.mode, shiftIso(start, this.mode, step)));
      return;
    }
    this.spanChange.emit({ from: shiftIso(start, this.mode, step), to: shiftIso(end, this.mode, step) });
  }

  protected openFilters(event: Event): void {
    event.stopPropagation();
    this.drawer = false;
    this.filters.emit();
  }

  protected goToday(): void {
    this.followWindow();
    this.spanChange.emit(windowFor(this.mode, this.today));
  }

  protected focusDay(date: string): void {
    this.followWindow();
    this.mode = 'day';
    this.modeChange.emit('day');
    this.spanChange.emit({ from: date, to: date });
  }

  protected createAnchor(): string {
    const start = this.anchor();
    const end = this.spanEnd();
    if (this.today >= start && this.today <= end) return this.today;
    return start;
  }

  protected begin(date: string): void {
    if (!this.canCreate) {
      this.focusDay(date);
      return;
    }
    this.draft = date;
    this.draftError = '';
  }

  protected coveredDays(): string[] {
    const days = eachDay(this.anchor(), this.spanEnd());
    const busy = days.filter((day) => this.on(day).length);
    return busy.length ? busy : days.slice(0, 1);
  }

  protected hiddenDays(): number {
    const days = eachDay(this.anchor(), this.spanEnd());
    return Math.max(0, days.length - this.coveredDays().length);
  }

  protected coveredWeeks(): string[][] {
    const end = this.spanEnd();
    const weeks: string[][] = [];
    let cursor = monday(this.anchor());
    while (cursor <= end && weeks.length < 60) {
      weeks.push(Array.from({ length: 7 }, (_, index) => addDays(cursor, index)));
      cursor = addDays(cursor, 7);
    }
    return weeks.length ? weeks : [this.weekOf(this.anchor())];
  }

  protected coveredMonths(): { key: string; name: string; weeks: DayCell[][] }[] {
    const [startYear, startMonth] = this.anchor().split('-').map(Number);
    const [endYear, endMonth] = this.spanEnd().split('-').map(Number);
    const months: { key: string; name: string; weeks: DayCell[][] }[] = [];
    let year = startYear;
    let month = startMonth;
    while ((year < endYear || (year === endYear && month <= endMonth)) && months.length < 24) {
      months.push({
        key: `${year}-${month}`,
        name: `${MONTHS[month - 1]} ${year}`,
        weeks: weeksOf(year, month),
      });
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    return months;
  }

  protected coveredYears(): number[] {
    const start = Number(this.anchor().slice(0, 4));
    const end = Number(this.spanEnd().slice(0, 4));
    const years: number[] = [];
    for (let year = start; year <= end && years.length < 6; year += 1) years.push(year);
    return years;
  }

  protected yearMonths(year: number): { index: number; name: string; weeks: DayCell[][] }[] {
    return MONTHS.map((name, index) => ({ index, name, weeks: weeksOf(year, index + 1) }));
  }

  protected years(): number[] {
    const now = new Date().getFullYear();
    const values = new Set<number>();
    for (let year = now - 5; year <= now + 5; year += 1) values.add(year);
    values.add(this.pickYear);
    values.add(Number(this.anchor().slice(0, 4)));
    return [...values].sort((left, right) => left - right);
  }

  protected pickWeeks(): DayCell[][] {
    return weeksOf(this.pickYear, this.pickMonth);
  }

  protected pickShift(step: number): void {
    const cursor = new Date(this.pickYear, this.pickMonth - 1 + step, 1);
    this.pickYear = cursor.getFullYear();
    this.pickMonth = cursor.getMonth() + 1;
    this.pickerBrowsing = true;
  }

  protected onPickMonth(event: Event): void {
    this.pickMonth = Number((event.target as HTMLSelectElement).value);
    this.pickerBrowsing = true;
  }

  protected onPickYear(event: Event): void {
    this.pickYear = Number((event.target as HTMLSelectElement).value);
    this.pickerBrowsing = true;
  }

  protected pick(date: string): void {
    if (!this.pickStart || this.rangeDone) {
      this.pickStart = date;
      this.pickEnd = date;
      this.rangeDone = false;
      this.spanChange.emit({ from: date, to: date });
      return;
    }
    const from = this.pickStart <= date ? this.pickStart : date;
    const to = this.pickStart <= date ? date : this.pickStart;
    this.pickStart = from;
    this.pickEnd = to;
    this.rangeDone = true;
    this.pickerBrowsing = true;
    this.spanChange.emit({ from, to });
  }

  protected inPick(date: string): boolean {
    if (!this.pickStart) return false;
    if (!this.rangeDone) return date === this.pickStart;
    const from = this.pickStart <= this.pickEnd ? this.pickStart : this.pickEnd;
    const to = this.pickStart <= this.pickEnd ? this.pickEnd : this.pickStart;
    return date >= from && date <= to;
  }

  protected pickHint(): string {
    if (this.pickStart && !this.rangeDone) {
      return `Начало: ${longDate(this.pickStart)}. Выберите конец диапазона.`;
    }
    if (this.pickStart && this.pickEnd && this.pickStart !== this.pickEnd) {
      return `${longDate(this.pickStart)} — ${longDate(this.pickEnd)}`;
    }
    return 'Первый щелчок — день, второй — конец диапазона.';
  }

  protected needsTemplate(): boolean {
    return this.kind.value === 'call' || this.kind.value === 'notice' || this.kind.value === 'warning';
  }

  protected needsServices(): boolean {
    if (this.kind.value === 'scenario') return false;
    if (this.supplier) return true;
    return this.kind.value === 'disconnect' || this.kind.value === 'collection';
  }

  protected shownTemplates(): MessageTemplate[] {
    if (this.kind.value !== 'notice') return this.templates;
    const matched = this.templates.filter((item) => item.channel === this.channel.value);
    return matched.length ? matched : this.templates;
  }

  protected save(): void {
    const template = this.templates.find((item) => String(item.id) === this.templateId.value);
    if (this.needsTemplate() && !template) {
      this.draftError = 'Выберите шаблон';
      return;
    }
    const serviceIds = this.services.value.map((item) => Number(item)).filter((item) => item > 0);
    if (this.needsServices() && !serviceIds.length) {
      this.draftError = 'Выберите услуги';
      return;
    }
    if (this.kind.value === 'scenario' && !this.scenarioName.value.trim()) {
      this.draftError = 'Укажите сценарий';
      return;
    }
    if (this.kind.value === 'collection' && !this.assignee.value.trim()) {
      this.draftError = 'Назначьте исполнителя';
      return;
    }
    const draft: CalendarDraft = { date: this.draft, kind: this.kind.value };
    if (template) draft.template_name = template.name;
    if (serviceIds.length) draft.catalog_service_ids = serviceIds;
    if (this.kind.value === 'notice') draft.channel = this.channel.value;
    if (this.kind.value === 'call') {
      draft.time_from = this.timeFrom.value;
      draft.time_to = this.timeTo.value;
      draft.days = 1;
    }
    if (this.kind.value === 'scenario') draft.scenario_name = this.scenarioName.value.trim();
    if (this.kind.value === 'collection') draft.assignee = this.assignee.value.trim();
    this.draftError = '';
    this.draft = '';
    this.createEvent.emit(draft);
  }

  private followWindow(): void {
    this.pickerBrowsing = false;
    this.rangeDone = true;
  }

  private weekOf(anchor: string): string[] {
    const start = monday(anchor);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }
}

function weeksOf(year: number, month: number): DayCell[][] {
  const first = new Date(year, month - 1, 1);
  const cursor = new Date(year, month - 1, 1 - ((first.getDay() + 6) % 7));
  const rows: DayCell[][] = [];
  for (let index = 0; index < 6; index += 1) {
    const days: DayCell[] = [];
    for (let column = 0; column < 7; column += 1) {
      days.push({ iso: iso(cursor), day: cursor.getDate(), inMonth: cursor.getMonth() === month - 1 });
      cursor.setDate(cursor.getDate() + 1);
    }
    if (days.some((day) => day.inMonth)) rows.push(days);
  }
  return rows;
}

function windowFor(mode: CalendarMode, anchor: string): { from: string; to: string } {
  const [year, month] = anchor.split('-').map(Number);
  if (mode === 'day') return { from: anchor, to: anchor };
  if (mode === 'week') {
    const start = monday(anchor);
    return { from: start, to: addDays(start, 6) };
  }
  if (mode === 'year') return { from: `${year}-01-01`, to: `${year}-12-31` };
  const last = new Date(year, month, 0).getDate();
  const pad = String(month).padStart(2, '0');
  return { from: `${year}-${pad}-01`, to: `${year}-${pad}-${String(last).padStart(2, '0')}` };
}

function monday(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return iso(new Date(year, month - 1, day - ((date.getDay() + 6) % 7)));
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  return iso(new Date(year, month - 1, day + days));
}

function shiftIso(value: string, mode: CalendarMode, step: number): string {
  const [year, month, day] = value.split('-').map(Number);
  if (mode === 'month' || mode === 'year') {
    const moved = new Date(year, month - 1 + (mode === 'year' ? step * 12 : step), 1);
    const last = new Date(moved.getFullYear(), moved.getMonth() + 1, 0).getDate();
    moved.setDate(Math.min(day, last));
    return iso(moved);
  }
  return addDays(value, mode === 'week' ? step * 7 : step);
}

function eachDay(from: string, to: string): string[] {
  const end = to < from ? from : to;
  const days: string[] = [];
  let cursor = from;
  while (cursor <= end && days.length < 400) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

function iso(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function longDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return `${day} ${MONTHS_GENITIVE[month - 1]} ${year}`;
}

function short(value: string): string {
  const [, month, day] = value.split('-');
  return `${Number(day)}.${month}`;
}
