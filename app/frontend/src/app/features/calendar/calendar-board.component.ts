import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
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
      <div class="modes">
        @for (item of modes; track item.id) {
          <button type="button" [class.on]="mode === item.id" (click)="switchMode(item.id)">{{ item.label }}</button>
        }
      </div>
      <button type="button" (click)="shift(-1)" aria-label="Назад">‹</button>
      <strong>{{ caption() }}</strong>
      <button type="button" (click)="shift(1)" aria-label="Вперёд">›</button>
      <button type="button" (click)="goToday()">Сегодня</button>
      <button type="button" (click)="filters.emit()">Фильтры</button>
      @if (canCreate) {
        <button type="button" class="add" (click)="begin(createAnchor())">Событие</button>
      }
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
        <section class="day">
          <h3>{{ long(anchor()) }}</h3>
          @for (event of on(anchor()); track track(event)) {
            <button type="button" class="ev" (click)="openEvent.emit(event)">
              <b>{{ event.kind }}</b> {{ event.title }}
            </button>
          } @empty {
            <p class="muted">В этот день событий нет.</p>
          }
        </section>
      }
      @case ('week') {
        <div class="week">
          @for (day of weekDays(); track day) {
            <section>
              <button type="button" class="num" (click)="begin(day)">{{ long(day) }}</button>
              @for (event of on(day); track track(event)) {
                <button type="button" class="ev" (click)="openEvent.emit(event)">{{ event.kind }} · {{ event.title }}</button>
              }
            </section>
          }
        </div>
      }
      @case ('month') {
        <table class="month">
          <thead>
            <tr>
              @for (name of weekdays; track name) { <th>{{ name }}</th> }
            </tr>
          </thead>
          <tbody>
            @for (week of monthWeeks(); track $index) {
              <tr>
                @for (day of week; track day.iso) {
                  <td [class.out]="!day.inMonth" [class.today]="day.iso === today">
                    <button type="button" class="num" (click)="begin(day.iso)">{{ day.day }}</button>
                    @for (event of on(day.iso).slice(0, 3); track track(event)) {
                      <button type="button" class="ev" (click)="openEvent.emit(event)">{{ event.kind }}</button>
                    }
                    @if (on(day.iso).length > 3) {
                      <button type="button" class="more" (click)="focusDay(day.iso)">ещё {{ on(day.iso).length - 3 }}</button>
                    }
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      }
      @case ('year') {
        <div class="year">
          @for (month of yearMonths(); track month.index) {
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
                        <button type="button" class="dot" [class.out]="!day.inMonth" [class.busy]="on(day.iso).length" (click)="focusDay(day.iso)">{{ day.day }}</button>
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
  `,
  styles: [`
    .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
    .bar button, .draft button, .draft select, .draft input {
      height: 32px; border: 1px solid #d5dde5; border-radius: 6px; background: #fff; font: inherit; cursor: pointer;
    }
    .bar button, .draft button { padding: 0 10px; }
    .modes { display: flex; }
    .modes button { border-radius: 0; }
    .modes button:first-child { border-radius: 6px 0 0 6px; }
    .modes button:last-child { border-radius: 0 6px 6px 0; }
    .modes button.on, .bar .add { background: #0f6e78; color: #fff; border-color: #0f6e78; }
    .draft { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; margin-bottom: 12px; padding: 10px; background: #fff; border: 1px solid #d5dde5; border-radius: 8px; }
    .draft p { flex: 1 1 100%; margin: 0; font-size: 13px; }
    .draft label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #52606d; }
    .draft select, .draft input { min-width: 140px; padding: 0 8px; }
    .fail { color: #c62828; }
    .day, .week section { background: #fff; border: 1px solid #e6ebf0; border-radius: 8px; padding: 10px; }
    .week { display: grid; grid-template-columns: repeat(7, minmax(120px, 1fr)); gap: 8px; }
    .month, .year table { width: 100%; border-collapse: collapse; background: #fff; }
    .month td { vertical-align: top; height: 92px; border: 1px solid #e6ebf0; padding: 4px; }
    .month td.out { background: #f8fafb; }
    .month td.today { box-shadow: inset 0 0 0 1px #0f6e78; }
    .num, .ev, .more, .dot { display: block; width: 100%; border: 0; background: transparent; text-align: left; font: inherit; cursor: pointer; }
    .num { font-weight: 700; color: #1f2933; }
    .ev { margin-top: 2px; padding: 2px 4px; border-radius: 4px; background: #e7f2f4; color: #0f4c54; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .more { font-size: 11px; color: #6b7280; }
    .year { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .year section { background: #fff; border: 1px solid #e6ebf0; border-radius: 8px; padding: 8px; }
    .year h3 { margin: 0 0 6px; font-size: 13px; }
    .year th, .year td { text-align: center; font-size: 11px; }
    .dot { width: 22px; height: 22px; margin: 0 auto; border-radius: 11px; text-align: center; }
    .dot.out { color: #c5ced6; }
    .dot.busy { background: #0f6e78; color: #fff; }
    .muted { color: #6b7280; }
    @media (max-width: 1100px) { .year { grid-template-columns: repeat(2, 1fr); } .week { grid-template-columns: repeat(2, 1fr); } }
  `],
})
export class CalendarBoardComponent implements OnChanges {
  @Input() events: CalendarEvent[] = [];
  @Input() from = '';
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
  protected readonly kinds = KINDS;
  protected readonly today = iso(new Date());
  protected draft = '';
  protected draftError = '';
  protected readonly kind = new FormControl('warning', { nonNullable: true });
  protected readonly templateId = new FormControl('', { nonNullable: true });
  protected readonly channel = new FormControl('sms', { nonNullable: true });
  protected readonly timeFrom = new FormControl('09:00', { nonNullable: true });
  protected readonly timeTo = new FormControl('18:00', { nonNullable: true });
  protected readonly scenarioName = new FormControl('', { nonNullable: true });
  protected readonly assignee = new FormControl('', { nonNullable: true });
  protected readonly services = new FormControl<string[]>([], { nonNullable: true });
  private index = new Map<string, CalendarEvent[]>();

  ngOnChanges(): void {
    const next = new Map<string, CalendarEvent[]>();
    for (const event of this.events) {
      const rows = next.get(event.date) ?? [];
      rows.push(event);
      next.set(event.date, rows);
    }
    this.index = next;
  }

  protected anchor(): string {
    return this.from || this.today;
  }

  protected caption(): string {
    const start = this.anchor();
    if (this.mode === 'day') return longDate(start);
    if (this.mode === 'year') return start.slice(0, 4);
    if (this.mode === 'month') {
      const [year, month] = start.split('-').map(Number);
      return `${MONTHS[month - 1]} ${year}`;
    }
    const days = this.weekDays();
    return `${short(days[0])} — ${short(days[6])}`;
  }

  protected on(date: string): CalendarEvent[] {
    return this.index.get(date) ?? [];
  }

  protected track(event: CalendarEvent): string {
    return `${event.date}:${event.kind}:${event.title}:${event.measure_id ?? ''}:${event.contract_id ?? ''}:${event.account_id ?? ''}`;
  }

  protected long(value: string): string {
    return longDate(value);
  }

  protected switchMode(mode: CalendarMode): void {
    this.modeChange.emit(mode);
    this.spanChange.emit(windowFor(mode, this.anchor()));
  }

  protected shift(step: number): void {
    const [year, month, day] = this.anchor().split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (this.mode === 'day') date.setDate(date.getDate() + step);
    else if (this.mode === 'week') date.setDate(date.getDate() + step * 7);
    else if (this.mode === 'month') date.setMonth(date.getMonth() + step);
    else date.setFullYear(date.getFullYear() + step);
    this.spanChange.emit(windowFor(this.mode, iso(date)));
  }

  protected goToday(): void {
    this.spanChange.emit(windowFor(this.mode, this.today));
  }

  protected focusDay(date: string): void {
    this.modeChange.emit('day');
    this.spanChange.emit({ from: date, to: date });
  }

  protected createAnchor(): string {
    const start = this.anchor();
    if (this.mode === 'year' && this.today.startsWith(start.slice(0, 4))) return this.today;
    if (this.mode === 'month' && this.today.slice(0, 7) === start.slice(0, 7)) return this.today;
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

  protected weekDays(): string[] {
    const [year, month, day] = this.anchor().split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const start = new Date(year, month - 1, day - ((date.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, index) => {
      const cursor = new Date(start);
      cursor.setDate(start.getDate() + index);
      return iso(cursor);
    });
  }

  protected monthWeeks(): DayCell[][] {
    const [year, month] = this.anchor().split('-').map(Number);
    return weeksOf(year, month);
  }

  protected yearMonths(): { index: number; name: string; weeks: DayCell[][] }[] {
    const year = Number(this.anchor().slice(0, 4));
    return MONTHS.map((name, index) => ({ index, name, weeks: weeksOf(year, index + 1) }));
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
  const [year, month, day] = anchor.split('-').map(Number);
  if (mode === 'day') return { from: anchor, to: anchor };
  if (mode === 'week') {
    const date = new Date(year, month - 1, day);
    const start = new Date(year, month - 1, day - ((date.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { from: iso(start), to: iso(end) };
  }
  if (mode === 'year') return { from: `${year}-01-01`, to: `${year}-12-31` };
  const last = new Date(year, month, 0).getDate();
  const pad = String(month).padStart(2, '0');
  return { from: `${year}-${pad}-01`, to: `${year}-${pad}-${String(last).padStart(2, '0')}` };
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
