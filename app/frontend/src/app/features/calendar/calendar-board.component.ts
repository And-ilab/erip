import { Component, EventEmitter, HostListener, Input, OnChanges, OnInit, Output, SimpleChanges, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { ApiService } from '../../core/api.service';
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
const TYPE_BOXES = [
  { id: 'call', label: 'Автообзвон' },
  { id: 'notice', label: 'Уведомления (e-mail)' },
  { id: 'warning', label: 'Предупреждения' },
  { id: 'disconnect', label: 'Отключение услуг' },
  { id: 'collection', label: 'Испол. надпись / иск / ОПИ' },
];
const DEFAULT_BANDS = [
  { group: 1, label: 'Группа 1 · до 2 месяцев' },
  { group: 2, label: 'Группа 2 · 2–3 месяца' },
  { group: 3, label: 'Группа 3 · 3–6 месяцев' },
  { group: 4, label: 'Группа 4 · 6–12 месяцев' },
  { group: 5, label: 'Группа 5 · 1–3 года' },
  { group: 6, label: 'Группа 6 · свыше 3 лет' },
];

/** Цвет плашки календаря мероприятий: вид, а не срочность. */
export function measureKindBucket(event: CalendarEvent): string {
  const kind = `${event.kind || ''} ${event.title || ''}`.toLowerCase();
  if (kind.includes('обзвон') || kind.includes('голос')) return 'call';
  if (kind.includes('уведом') || kind.includes('e-mail') || kind.includes('email') || kind.includes('sms') || kind.includes('письм')) return 'notice';
  if (kind.includes('предупреж')) return 'warning';
  if (kind.includes('отключ') || kind.includes('приостан')) return 'disconnect';
  if (kind.includes('взыск') || kind.includes('надпис') || kind.includes('нотариус') || kind.includes('иска')) return 'collection';
  return 'other';
}

interface DayCell {
  iso: string;
  day: number;
  inMonth: boolean;
}

@Component({
  selector: 'app-calendar-board',
  standalone: true,
  imports: [ReactiveFormsModule],
  host: { '[class.events]': 'showEvents' },
  template: `
    <div class="cal-main">
    @if (chrome === 'inline') {
      <div class="inline-bar">
        <div class="nav">
          <button type="button" class="step" (click)="shift(-1)" aria-label="Назад">‹</button>
          <button type="button" class="step" (click)="shift(1)" aria-label="Вперёд">›</button>
          <button type="button" class="today" (click)="goToday()">Сегодня</button>
        </div>
        <strong>{{ caption() }}@if (captionTail) { — {{ captionTail }} }</strong>
        <div class="modes">
          @for (item of modes; track item.id) {
            @if (item.id !== 'year') {
              <button type="button" [class.on]="mode === item.id" (click)="switchMode(item.id)">{{ item.label }}</button>
            }
          }
        </div>
      </div>
    } @else {
    <div class="bar">
      <strong>{{ caption() }}</strong>
      <span class="legend"><i class="swatch"></i> срок впереди</span>
      <span class="legend"><i class="swatch soon"></i> 1–2 дня</span>
      <span class="legend"><i class="swatch overdue"></i> срок прошёл, действие не сделано</span>
      <button type="button" [class.on]="drawer" [attr.aria-expanded]="drawer" (click)="drawer = true">Календарь</button>
    </div>
    }

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
            @if (canCreate) {
              <button type="button" class="add" (click)="begin(day)">Создать</button>
            }
            @for (event of named(day); track track(event)) {
              <button type="button" class="ev {{ chipClass(event) }}" [class.overdue]="event.urgency === 'overdue'" [class.soon]="event.urgency === 'soon'" [class.done]="event.urgency === 'done'" [title]="event.title" (click)="openEvent.emit(event)">
                <span class="label">{{ showEvents ? pill(event) : event.title }}</span>
                @if (showEvents && event.urgency !== 'done') { <i class="mark" aria-hidden="true"></i> }
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
                <button type="button" class="num" (click)="focusDay(day)">{{ long(day) }}</button>
                @if (showEvents) {
                  @for (event of preview(day); track track(event)) {
                    <button type="button" class="ev {{ chipClass(event) }}" [class.overdue]="event.urgency === 'overdue'" [class.done]="event.urgency === 'done'" [title]="event.title" (click)="openEvent.emit(event)">
                      <span class="label">{{ pill(event) }}</span>
                      @if (event.urgency !== 'done') { <i class="mark" aria-hidden="true"></i> }
                    </button>
                  }
                  @if (extra(day); as more) {
                    <button type="button" class="more" (click)="focusDay(day)">ещё {{ more }}</button>
                  }
                } @else {
                  @if (brief(day); as card) {
                    <button type="button" class="sum" [class.overdue]="card.tone === 'overdue'" [class.soon]="card.tone === 'soon'" (click)="focusDay(day)">
                      <b>{{ card.total }}</b> {{ eventsWord(card.total) }}{{ tail(card) }}
                    </button>
                  }
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
                        <div class="slot">
                          <button type="button" class="num" (click)="focusDay(day.iso)">{{ day.day }}</button>
                          @if (showEvents) {
                            @for (event of preview(day.iso); track track(event)) {
                              <button type="button" class="ev {{ chipClass(event) }}" [class.overdue]="event.urgency === 'overdue'" [class.done]="event.urgency === 'done'" [title]="event.title" (click)="$event.stopPropagation(); openEvent.emit(event)">
                                <span class="label">{{ pill(event) }}</span>
                                @if (event.urgency !== 'done') { <i class="mark" aria-hidden="true"></i> }
                              </button>
                            }
                            @if (extra(day.iso); as more) {
                              <button type="button" class="more" (click)="focusDay(day.iso)">ещё {{ more }}</button>
                            }
                          } @else {
                            @if (brief(day.iso); as card) {
                              <button type="button" class="sum" [class.overdue]="card.tone === 'overdue'" [class.soon]="card.tone === 'soon'" (click)="focusDay(day.iso)">
                                <b>{{ card.total }}</b> {{ eventsWord(card.total) }}{{ tail(card) }}
                              </button>
                            }
                          }
                        </div>
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
    </div>

    @if (showEvents) {
      <aside class="cal-side">
        <section class="side-card">
          <h4>Группы задолженности</h4>
          @for (item of bands; track item.group) {
            <button type="button" class="legend" [class.on]="groupOn(item.group)" (click)="toggleLegend(item.group)">
              <i class="dot g{{ item.group }}"></i>
              <span>{{ item.label }}</span>
              <b>{{ groupCount(item.group) }}</b>
            </button>
          }
        </section>
        <section class="side-card">
          <h4>Тип мероприятия</h4>
          @for (item of typeBoxes; track item.id) {
            <label class="kind-line">
              <input type="checkbox" [checked]="kindEnabled(item.id)" (change)="toggleKind(item.id)" />
              <span>{{ item.label }}</span>
            </label>
          }
        </section>
        <section class="side-card">
          <h4>Подсказка</h4>
          <p>Мероприятия и дедлайны, жёстко определённые законодательством, отображаются в календаре по датам. Цвет соответствует группе задолженности дела.</p>
        </section>
      </aside>
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
          <p class="hint">В месяце и неделе в клетке только число сроков, чтобы сетка не растягивалась. Щелчок по этому числу открывает день: там каждый срок — действие по лицевому счёту. Красным отмечен просроченный невыполненный срок, жёлтым — срок через один или два дня.</p>
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
    .bar button, .inline-bar button, .draft button, .draft select, .draft input, .drawer button:not(.cell), .drawer select, .day .add {
      height: 32px; border: 1px solid #d5dde5; border-radius: 6px; background: #fff; color: #1f2933; font: inherit; cursor: pointer;
    }
    .bar button, .inline-bar > button, .draft button, .day .add { padding: 0 10px; }
    .bar button.on, .bar .add, .modes button.on { background: #0f6e78; color: #fff; border-color: #0f6e78; }
    .draft { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; margin-bottom: 12px; padding: 10px; background: #fff; border: 1px solid #d5dde5; border-radius: 8px; }
    .draft p { flex: 1 1 100%; margin: 0; font-size: 13px; }
    .draft label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #52606d; }
    .draft select, .draft input { min-width: 140px; padding: 0 8px; }
    .fail { color: #c62828; }
    .day, .week section { background: #fff; border: 1px solid #e6ebf0; border-radius: 8px; padding: 10px; }
    .day + .day, .week + .week, .month-block + .month-block { margin-top: 12px; }
    .week { display: grid; grid-template-columns: repeat(7, minmax(120px, 1fr)); gap: 8px; align-items: start; }
    .week section { height: 88px; overflow: hidden; box-sizing: border-box; }
    .week section.dim { background: #f8fafb; }
    .month, .year table, .matrix { width: 100%; border-collapse: collapse; background: #fff; table-layout: fixed; }
    .month td { vertical-align: top; height: 72px; padding: 0; border: 1px solid #e6ebf0; }
    .month .slot { height: 72px; overflow: hidden; padding: 4px; box-sizing: border-box; }
    .month td.out, .month td.dim { background: #f8fafb; }
    .month td.mark { background: #e7f2f4; }
    .month td.today { box-shadow: inset 0 0 0 1px #0f6e78; }
    .month-block h3, .day h3 { margin: 0 0 8px; font-size: 15px; }
    .day .add { margin: 0 0 8px; }
    .num, .ev, .more, .dot { display: block; width: 100%; border: 0; background: transparent; text-align: left; font: inherit; cursor: pointer; }
    .num { font-weight: 700; color: #1f2933; }
    .ev { margin-top: 2px; padding: 2px 4px; border-radius: 4px; background: #e7f2f4; color: #0f4c54; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ev.soon { background: #fff4d6; color: #8a5a00; }
    .ev.overdue { background: #fde8e8; color: #9b1c1c; }
    .ev.done { background: #f4f6f8; color: #52606d; }
    .ev.k-call { background: #e7f6ea; color: #1b7a3a; }
    .ev.k-notice { background: #e7f1fb; color: #1d4f8a; }
    .ev.k-warning { background: #fff6d8; color: #8a6a12; }
    .ev.k-disconnect { background: #fde8e8; color: #9b1c1c; }
    .ev.k-collection { background: #fff1e0; color: #b45309; }
    .ev.k-other { background: #eef2f5; color: #3d4a57; }
    .ev .label { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ev.overdue { box-shadow: inset 3px 0 0 #c62828; }
    :host.events {
      display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 16px; align-items: start; min-width: 0;
    }
    .cal-main { min-width: 0; }
    .cal-side { display: flex; flex-direction: column; gap: 12px; }
    .side-card {
      background: #fff; border: 1px solid #e6ebf0; border-radius: 8px; padding: 14px 14px 12px;
      box-shadow: 0 1px 2px rgba(16, 42, 67, .04);
    }
    .side-card h4 {
      margin: 0 0 10px; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #8b95a1; font-weight: 700;
    }
    .side-card p { margin: 0; color: #6b7280; font-size: 12px; line-height: 1.45; }
    .cal-side .legend, .cal-side .kind-line {
      display: flex; align-items: center; gap: 8px; width: 100%; margin: 0 0 8px; padding: 0;
      border: 0; background: transparent; font: inherit; font-size: 13px; color: #1f2933; text-align: left;
    }
    .cal-side .legend:last-child, .cal-side .kind-line:last-child { margin-bottom: 0; }
    .cal-side .legend { cursor: pointer; }
    .cal-side .legend span { flex: 1; min-width: 0; }
    .cal-side .legend b { margin-left: auto; color: #8b95a1; font-weight: 600; }
    .cal-side .legend.on span { color: var(--erip-primary); font-weight: 700; }
    .cal-side .dot { width: 10px; height: 10px; margin: 0; border-radius: 2px; flex: 0 0 auto; display: block; }
    .cal-side .dot.g1 { background: #22a35a; }
    .cal-side .dot.g2 { background: #3b78e0; }
    .cal-side .dot.g3 { background: #e09a2b; }
    .cal-side .dot.g4 { background: #e15b5b; }
    .cal-side .dot.g5 { background: #f97316; }
    .cal-side .dot.g6 { background: #7f1d1d; }
    .kind-line { cursor: pointer; }
    .kind-line input { accent-color: #2563eb; width: 15px; height: 15px; }
    @media (max-width: 960px) { :host.events { grid-template-columns: 1fr; } }
    :host.events .month-block {
      flex: 1; min-height: 0; display: flex; flex-direction: column; margin: 0;
      background: #fff; border: 1px solid #e6ebf0; border-radius: 8px; overflow: hidden;
    }
    :host.events .month { height: 100%; border: 0; }
    :host.events .month th {
      text-align: left; text-transform: uppercase; letter-spacing: .05em; color: #9aa3ad;
      font-size: 11px; font-weight: 600; padding: 10px 8px 8px; background: #fff; border-bottom: 1px solid #e8edf2;
    }
    :host.events .month td { height: auto; background: #fff; border-color: #eef2f5; }
    :host.events .month .slot {
      height: 100%; min-height: 104px; padding: 4px 6px 6px; display: flex; flex-direction: column;
      gap: 3px; align-items: stretch;
    }
    :host.events .month td.out,
    :host.events .month td.dim,
    :host.events .month td.mark,
    :host.events .month td.today { background: #fff; box-shadow: none; }
    :host.events .month .num {
      width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
      padding: 0; font-weight: 500; font-size: 12px; color: #6b7280; border-radius: 11px;
    }
    :host.events .week .num { width: auto; font-weight: 600; font-size: 12px; color: #374151; }
    :host.events .month td.out .num,
    :host.events .month td.dim .num { color: #c5ced6; }
    :host.events .month td.today .num { background: #1d4f63; color: #fff; font-weight: 700; }
    :host.events .ev {
      display: flex; align-items: center; gap: 4px; width: 100%; margin: 0; padding: 1px 4px 1px 6px;
      border: 0; border-left: 3px solid transparent; border-radius: 3px; font-size: 11px; line-height: 16px;
    }
    :host.events .ev .label { flex: 1; min-width: 0; }
    :host.events .mark { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: 0 0 6px; display: block; }
    :host.events .ev.overdue,
    :host.events .ev.soon,
    :host.events .ev.done { box-shadow: none; }
    :host.events .ev.g1 { background: #e7f6ec; color: #157a3a; border-left-color: #22a35a; }
    :host.events .ev.g2 { background: #e7f0fc; color: #1d4e89; border-left-color: #3b78e0; }
    :host.events .ev.g3 { background: #fff4e0; color: #9a6208; border-left-color: #e09a2b; }
    :host.events .ev.g4 { background: #fdecec; color: #b42318; border-left-color: #e15b5b; }
    :host.events .ev.g5 { background: #ffedd5; color: #c2410c; border-left-color: #f97316; }
    :host.events .ev.g6 { background: #f8e8e8; color: #7f1d1d; border-left-color: #7f1d1d; }
    :host.events .ev.g0 { background: #f3f4f6; color: #4b5563; border-left-color: #9ca3af; }
    :host.events .week { gap: 0; background: #fff; border: 1px solid #e6ebf0; border-radius: 8px; overflow: hidden; }
    :host.events .week section {
      height: auto; min-height: 148px; border: 0; border-radius: 0; border-left: 1px solid #eef2f5;
    }
    :host.events .week section:first-child { border-left: 0; }
    .inline-bar {
      display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; margin: 0 0 10px;
    }
    .inline-bar .nav { display: flex; align-items: center; gap: 6px; }
    .inline-bar .step { width: 32px; padding: 0; font-size: 18px; line-height: 1; }
    .inline-bar .today { padding: 0 12px; font-size: 13px; }
    .inline-bar strong { text-align: center; font-size: 18px; font-weight: 600; color: #243140; }
    .inline-bar .modes { margin: 0; display: flex; }
    .inline-bar .modes button { flex: none; height: 32px; padding: 0 14px; border-radius: 0; background: #fff; font-size: 13px; }
    .inline-bar .modes button + button { margin-left: -1px; }
    .inline-bar .modes button:first-child { border-radius: 6px 0 0 6px; }
    .inline-bar .modes button:last-child { border-radius: 0 6px 6px 0; }
    .inline-bar .modes button.on { position: relative; z-index: 1; background: #1d6f8c; color: #fff; border-color: #1d6f8c; font-weight: 600; }
    .sum {
      display: block; width: 100%; margin-top: 4px; padding: 4px 6px; border: 0; border-radius: 4px;
      background: #e7f2f4; color: #0f4c54; text-align: left; font: inherit; font-size: 12px; line-height: 1.25; cursor: pointer;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .sum b { font-size: 13px; }
    .sum.soon { background: #fff4d6; color: #8a5a00; }
    .sum.overdue { background: #fde8e8; color: #9b1c1c; }
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
export class CalendarBoardComponent implements OnChanges, OnInit {
  @Input() events: CalendarEvent[] = [];
  @Input() from = '';
  @Input() to = '';
  @Input() mode: CalendarMode = 'month';
  @Input() canCreate = false;
  @Input() supplier = false;
  @Input() templates: MessageTemplate[] = [];
  @Input() serviceChoices: ServiceChoice[] = [];
  /** inline — шапка и сетка как на макете. drawer — старая панель выбора диапазона. */
  @Input() chrome: 'drawer' | 'inline' = 'inline';
  /** В клетке месяца и недели — плашки мероприятий, а не сводка «N событий». */
  @Input() showEvents = true;
  @Input() captionTail = '';
  /** Группы, уже выбранные сквозным фильтром реестра. */
  @Input() selectedGroups: number[] = [];
  @Output() readonly modeChange = new EventEmitter<CalendarMode>();
  @Output() readonly spanChange = new EventEmitter<{ from: string; to: string }>();
  @Output() readonly openEvent = new EventEmitter<CalendarEvent>();
  @Output() readonly createEvent = new EventEmitter<CalendarDraft>();
  @Output() readonly filters = new EventEmitter<void>();
  @Output() readonly groupsChange = new EventEmitter<number[]>();

  protected readonly modes = [
    { id: 'day' as const, label: 'День' },
    { id: 'week' as const, label: 'Неделя' },
    { id: 'month' as const, label: 'Месяц' },
    { id: 'year' as const, label: 'Год' },
  ];
  protected readonly weekdays = WEEKDAYS;
  protected readonly months = MONTHS;
  protected readonly kinds = KINDS;
  protected readonly typeBoxes = TYPE_BOXES;
  protected bands = DEFAULT_BANDS;
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
  private readonly api = inject(ApiService);
  private index = new Map<string, CalendarEvent[]>();
  private pickerBrowsing = false;
  private readonly kindsOn = new Set(TYPE_BOXES.map((item) => item.id));

  @HostListener('document:keydown.escape')
  closeOnEscape(): void {
    this.drawer = false;
  }

  ngOnInit(): void {
    this.api.debtGroups().subscribe({
      next: (page) => {
        const rows = [...page.results].sort((left, right) => left.group - right.group);
        if (!rows.length) return;
        this.bands = rows.map((row) => ({
          group: row.group,
          label: `Группа ${row.group} · ${row.name}`,
        }));
      },
      error: () => undefined,
    });
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
    return this.on(date).filter((event) => (event.title || '').trim().length > 0 && this.kindPasses(event));
  }

  protected kindEnabled(id: string): boolean {
    return this.kindsOn.has(id);
  }

  protected toggleKind(id: string): void {
    if (this.kindsOn.has(id)) this.kindsOn.delete(id);
    else this.kindsOn.add(id);
  }

  protected groupOn(group: number): boolean {
    return this.selectedGroups.includes(group);
  }

  protected toggleLegend(group: number): void {
    const next = this.groupOn(group)
      ? this.selectedGroups.filter((item) => item !== group)
      : [...this.selectedGroups, group].sort((left, right) => left - right);
    this.groupsChange.emit(next);
  }

  protected groupCount(group: number): number {
    let total = 0;
    for (const rows of this.index.values()) {
      total += rows.filter((event) => event.debt_group === group && this.kindPasses(event) && (event.title || '').trim()).length;
    }
    return total;
  }

  private kindPasses(event: CalendarEvent): boolean {
    if (!this.showEvents) return true;
    const bucket = measureKindBucket(event);
    return bucket === 'other' || this.kindsOn.has(bucket);
  }

  protected preview(date: string): CalendarEvent[] {
    return this.named(date).slice(0, 3);
  }

  protected extra(date: string): number {
    return Math.max(this.named(date).length - 3, 0);
  }

  protected chipClass(event: CalendarEvent): string {
    if (!this.showEvents) return `k-${measureKindBucket(event)}`;
    return `g${event.debt_group || 0}`;
  }

  protected pill(event: CalendarEvent): string {
    const title = event.title || '';
    const match = title.match(/^ЛС\s+\S+,\s*(.+?):\s*/);
    const name = match?.[1]?.trim();
    const kind = (event.kind || '').trim();
    if (name && kind) {
      const short = name.split(/\s+/).slice(0, 2).join(' ');
      return `${kind} — ${short}`;
    }
    return title;
  }

  protected brief(date: string): { total: number; overdue: number; soon: number; tone: string } | null {
    const events = this.named(date);
    if (!events.length) return null;
    const overdue = events.filter((event) => event.urgency === 'overdue').length;
    const soon = events.filter((event) => event.urgency === 'soon').length;
    const tone = overdue ? 'overdue' : soon ? 'soon' : 'planned';
    return { total: events.length, overdue, soon, tone };
  }

  protected eventsWord(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return 'событие';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'события';
    return 'событий';
  }

  protected tail(card: { overdue: number; soon: number }): string {
    if (card.overdue) return `, просрочено ${card.overdue}`;
    if (card.soon) return `, в ближайшие дни ${card.soon}`;
    return '';
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
