import { Component, EventEmitter, HostListener, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { ApiService } from '../core/api.service';
import { SavedFilter } from '../core/models';

export interface RegistryFilterQuery {
  q: string;
  groups: number[];
  ratings: string[];
  stage: string;
  period: string;
  kind?: string;
  groupBy?: string;
}

export interface RegistryChoice {
  id: string;
  label: string;
}

const MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

const MEASURE_KINDS: RegistryChoice[] = [
  { id: 'call', label: 'Автообзвон' },
  { id: 'notice', label: 'Уведомление' },
  { id: 'warning', label: 'Предупреждение' },
  { id: 'disconnect', label: 'Отключение' },
  { id: 'collection', label: 'Взыскание' },
];

const STAGES = [
  { id: 'new', label: 'Новый должник' },
  { id: 'prevention', label: 'Автообзвон/уведомления' },
  { id: 'warning', label: 'Предупреждение вручено' },
  { id: 'disconnect', label: 'Отключение услуг' },
  { id: 'enforcement', label: 'Исполнительная надпись / иск' },
  { id: 'court', label: 'ОПИ' },
  { id: 'closed', label: 'Не должник' },
];

@Component({
  selector: 'app-registry-filter',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="search-wrap" (click)="$event.stopPropagation()">
      <div class="search" (click)="panelOpen.set(true)">
        @if (groups.length) {
          <button type="button" class="fchip" (click)="clearGroups($event)">Группа: {{ groups.join(', ') }} ×</button>
        }
        @if (showRating && ratings.length) {
          <button type="button" class="fchip" (click)="clearRatings($event)">Рейтинг: {{ ratings.join(', ') }} ×</button>
        }
        @if (showStage && stage) {
          <button type="button" class="fchip" (click)="clearStage($event)">Этап: {{ stageLabel(stage) }} ×</button>
        }
        @if (showMonth && period) {
          <button type="button" class="fchip" (click)="clearPeriod($event)">Период: {{ periodLabel(period) }} ×</button>
        }
        @if (showKind && kind) {
          <button type="button" class="fchip" (click)="clearKind($event)">Вид: {{ choiceLabel(kinds, kind) }} ×</button>
        }
        @if (groupBy && groupBy !== 'status') {
          <button type="button" class="fchip" (click)="clearGroupBy($event)">Группировать по: {{ choiceLabel(groupChoices, groupBy) }} ×</button>
        }
        <input [formControl]="search" [placeholder]="placeholder" (focus)="panelOpen.set(true)" />
        @if (showMonth) {
          <input class="month" type="month" [formControl]="month" aria-label="Период" (click)="$event.stopPropagation()" />
        }
        <button type="button" class="chevron" aria-label="Фильтры" [attr.aria-expanded]="panelOpen()" (click)="toggle($event)">▾</button>
      </div>
      @if (panelOpen()) {
        <div class="search-panel" [class.wide]="groupChoices.length" role="dialog" aria-label="Фильтры реестра">
          <div class="col">
            <div class="col-title">Фильтры</div>
            <div class="sub">Группа задолженности</div>
            <div class="pills">
              @for (g of groupNumbers; track g) {
                <button type="button" class="pill" [class.on]="groups.includes(g)" (click)="toggleGroup(g)">{{ g }}</button>
              }
            </div>
            @if (showRating) {
              <div class="sub">Рейтинг</div>
              <div class="pills">
                @for (letter of letters; track letter) {
                  <button type="button" class="pill" [class.on]="ratings.includes(letter)" (click)="toggleRating(letter)">{{ letter }}</button>
                }
              </div>
            }
            @if (showStage) {
              <div class="sub">Этап</div>
              @for (item of stages; track item.id) {
                <button type="button" class="menu-item" [class.on]="stage === item.id" (click)="setStage(item.id)">{{ item.label }}</button>
              }
            }
            @if (showKind) {
              <div class="sub">Вид мероприятия</div>
              @for (item of kinds; track item.id) {
                <button type="button" class="menu-item" [class.on]="kind === item.id" (click)="setKind(item.id)">{{ item.label }}</button>
              }
            }
            <button type="button" class="menu-add" (click)="openCustom($event)">+ Добавить пользовательский фильтр</button>
          </div>
          @if (groupChoices.length) {
            <div class="col">
              <div class="col-title">Группировать по</div>
              @for (item of groupChoices; track item.id) {
                <button type="button" class="menu-item" [class.on]="(groupBy || groupChoices[0].id) === item.id" (click)="setGroupBy(item.id)">{{ item.label }}</button>
              }
            </div>
          }
          <div class="col">
            <div class="col-title">Избранное</div>
            <div class="save-row">
              <input [formControl]="filterName" placeholder="Имя фильтра" (click)="$event.stopPropagation()" />
              <button type="button" (click)="remember()">Сохранить</button>
            </div>
            @for (item of saved(); track item.id) {
              <button type="button" class="menu-item" (click)="apply(item)">★ {{ item.name }}</button>
            }
            @if (!saved().length) {
              <p class="empty">Сохранённых наборов пока нет</p>
            }
          </div>
        </div>
      }
    </div>
    @if (customOpen()) {
      <div class="backdrop" (click)="customOpen.set(false)">
        <div class="dialog" (click)="$event.stopPropagation()" role="dialog" aria-label="Пользовательский фильтр">
          <h3>Добавить пользовательский фильтр</h3>
          <p>Соответствует всем из следующих условий.</p>
          <div class="rule">
            <span>Группа задолженности</span>
            <span class="op">равно</span>
            <span class="values">
              @for (g of groupNumbers; track g) {
                <button type="button" class="pill" [class.on]="draftGroups.includes(g)" (click)="draftToggleGroup(g)">{{ g }}</button>
              }
            </span>
          </div>
          <div class="rule">
            <span>Рейтинг должника</span>
            <span class="op">равно</span>
            <span class="values">
              @for (letter of letters; track letter) {
                <button type="button" class="pill" [class.on]="draftRatings.includes(letter)" (click)="draftToggleRating(letter)">{{ letter }}</button>
              }
            </span>
          </div>
          @if (showStage) {
            <div class="rule">
              <span>Этап воронки</span>
              <span class="op">равно</span>
              <select [value]="draftStage" (change)="draftStage = selectValue($event)">
                <option value="">Любой</option>
                @for (item of stages; track item.id) { <option [value]="item.id">{{ item.label }}</option> }
              </select>
            </div>
          }
          @if (showKind) {
            <div class="rule">
              <span>Вид мероприятия</span>
              <span class="op">равно</span>
              <select [value]="draftKind" (change)="draftKind = selectValue($event)">
                <option value="">Любой</option>
                @for (item of kinds; track item.id) { <option [value]="item.id">{{ item.label }}</option> }
              </select>
            </div>
          }
          <div class="dialog-actions">
            <button type="button" class="primary" (click)="applyDraft()">Добавить</button>
            <button type="button" (click)="customOpen.set(false)">Отмена</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex: 1 1 auto; min-width: 0; align-items: center; }
    .search-wrap { position: relative; flex: 1; width: 100%; min-width: 0; }
    .search {
      display: flex; align-items: center; gap: 6px; width: 100%; height: 34px; padding: 0 8px;
      background: #fff; border: 1px solid #d8dce0; border-radius: 4px; box-sizing: border-box;
    }
    .search input:not([type="month"]) {
      flex: 1; min-width: 80px; border: 0; outline: none; background: transparent;
      font: inherit; font-size: 13px; color: #1f2933;
    }
    .month { border: 0; background: transparent; font: inherit; font-size: 12px; color: #52606d; }
    .fchip {
      border: 0; background: var(--erip-primary-soft); color: var(--erip-primary);
      border-radius: 3px; font-size: 12px; padding: 2px 8px; cursor: pointer; white-space: nowrap;
    }
    .chevron { border: 0; background: transparent; color: var(--erip-muted); cursor: pointer; font-size: 12px; padding: 4px; }
    .search-panel {
      position: absolute; z-index: 30; top: calc(100% + 4px); left: 0; right: 0;
      display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(200px, .8fr); width: 100%;
      background: #fff; border: 1px solid var(--erip-border); border-radius: 6px;
      box-shadow: 0 8px 24px rgba(16, 42, 67, .16);
    }
    .search-panel.wide { grid-template-columns: minmax(0, 1.15fr) minmax(160px, 1fr) minmax(180px, .9fr); }
    @media (max-width: 720px) {
      .search-panel { grid-template-columns: 1fr; }
      .col + .col { border-left: 0; border-top: 1px solid var(--erip-border); }
    }
    .col { padding: 8px 0 12px; min-width: 0; }
    .col + .col { border-left: 1px solid var(--erip-border); }
    .col-title {
      padding: 6px 16px 8px; font-size: 11px; font-weight: 700; letter-spacing: .04em;
      text-transform: uppercase; color: var(--erip-muted);
    }
    .sub { padding: 4px 16px; font-size: 12px; color: var(--erip-muted); }
    .pills { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 8px; }
    .pill, .menu-item, .save-row button { font: inherit; cursor: pointer; }
    .pill {
      min-width: 28px; height: 28px; padding: 0 8px; border: 1px solid var(--erip-border); border-radius: 4px;
      background: #fff; color: #1f2933;
    }
    .pill.on, .menu-item.on { background: var(--erip-primary-soft); color: var(--erip-primary); font-weight: 600; border-color: transparent; }
    .menu-item {
      display: block; width: 100%; text-align: left; border: 0; background: transparent;
      padding: 6px 16px; font-size: 13px; color: #1f2933;
    }
    .menu-item:hover, .menu-add:hover, .pill:hover { background: #f3f6f8; }
    .menu-add {
      display: block; width: 100%; text-align: left; border: 0; background: transparent;
      padding: 8px 16px; font: inherit; font-size: 13px; color: var(--erip-link); cursor: pointer;
    }
    .save-row { display: flex; gap: 6px; padding: 0 12px 8px; }
    .save-row input {
      flex: 1; min-width: 0; height: 30px; border: 1px solid var(--erip-border); border-radius: 4px; padding: 0 8px; font: inherit;
    }
    .save-row button {
      height: 30px; padding: 0 10px; border: 0; border-radius: 4px; background: var(--erip-primary); color: #fff; font-size: 13px;
    }
    .empty { margin: 4px 16px; font-size: 12px; color: var(--erip-muted); }
    .backdrop {
      position: fixed; inset: 0; z-index: 80; background: rgba(15, 23, 42, .45);
      display: grid; place-items: center; padding: 24px;
    }
    .dialog {
      width: min(640px, 100%); background: #fff; border-radius: 8px; padding: 20px 22px 16px;
      box-shadow: 0 16px 40px rgba(16, 42, 67, .24);
    }
    .dialog h3 { margin: 0 0 6px; font-size: 18px; color: #1f2933; }
    .dialog p { margin: 0 0 14px; color: var(--erip-muted); font-size: 13px; }
    .rule { display: grid; grid-template-columns: 180px 72px minmax(0, 1fr); gap: 8px; align-items: center; margin-bottom: 10px; font-size: 13px; }
    .op { color: var(--erip-muted); }
    .values { display: flex; flex-wrap: wrap; gap: 6px; }
    .rule select { height: 32px; border: 1px solid var(--erip-border); border-radius: 4px; font: inherit; padding: 0 8px; background: #fff; }
    .dialog-actions { display: flex; gap: 8px; margin-top: 16px; }
    .dialog-actions button {
      height: 34px; padding: 0 16px; border-radius: 4px; border: 1px solid var(--erip-border);
      background: #fff; font: inherit; cursor: pointer;
    }
    .dialog-actions .primary { background: var(--erip-primary); color: #fff; border-color: var(--erip-primary); }
  `,
})
export class RegistryFilterComponent implements OnInit {
  private readonly api = inject(ApiService);

  @Input() target = 'accounts';
  @Input() placeholder = 'Поиск по ФИО, номеру ЛС, адресу…';
  @Input() showRating = true;
  @Input() showStage = true;
  @Input() showMonth = false;
  @Input() showKind = false;
  @Input() groupChoices: RegistryChoice[] = [];
  @Output() readonly queryChange = new EventEmitter<RegistryFilterQuery>();

  protected readonly groupNumbers = [1, 2, 3, 4, 5, 6];
  protected readonly letters = ['A', 'B', 'C', 'D', 'E'];
  protected readonly stages = STAGES;
  protected readonly kinds = MEASURE_KINDS;
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly month = new FormControl('', { nonNullable: true });
  protected readonly filterName = new FormControl('', { nonNullable: true });
  protected readonly saved = signal<SavedFilter[]>([]);
  protected readonly panelOpen = signal(false);
  protected readonly customOpen = signal(false);
  protected groups: number[] = [];
  protected ratings: string[] = [];
  protected stage = '';
  protected period = '';
  protected kind = '';
  protected groupBy = '';
  protected draftGroups: number[] = [];
  protected draftRatings: string[] = [];
  protected draftStage = '';
  protected draftKind = '';

  ngOnInit(): void {
    this.api.savedFilters(this.target).subscribe({
      next: (page) => this.saved.set(page.results),
      error: () => this.saved.set([]),
    });
    this.search.valueChanges.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => this.emit());
    this.month.valueChanges.subscribe((value) => {
      this.period = value;
      this.emit();
    });
  }

  @HostListener('document:click')
  protected close(): void {
    this.panelOpen.set(false);
  }

  protected toggle(event: Event): void {
    event.stopPropagation();
    this.panelOpen.update((open) => !open);
  }

  protected toggleGroup(group: number): void {
    this.groups = this.groups.includes(group)
      ? this.groups.filter((item) => item !== group)
      : [...this.groups, group].sort();
    this.emit();
  }

  protected toggleRating(letter: string): void {
    this.ratings = this.ratings.includes(letter)
      ? this.ratings.filter((item) => item !== letter)
      : [...this.ratings, letter];
    this.emit();
  }

  protected setStage(id: string): void {
    this.stage = this.stage === id ? '' : id;
    this.emit();
  }

  protected setKind(id: string): void {
    this.kind = this.kind === id ? '' : id;
    this.emit();
  }

  protected setGroupBy(id: string): void {
    this.groupBy = this.groupBy === id ? '' : id;
    this.emit();
  }

  setGroups(groups: number[]): void {
    this.groups = [...groups].sort((left, right) => left - right);
    this.emit();
  }

  protected periodLabel(value: string): string {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match) return value;
    const month = MONTHS[Number(match[2]) - 1];
    return month ? `${month} ${match[1]}` : value;
  }

  protected choiceLabel(choices: RegistryChoice[], id: string): string {
    return choices.find((item) => item.id === id)?.label || id;
  }

  protected openCustom(event: Event): void {
    event.stopPropagation();
    this.draftGroups = [...this.groups];
    this.draftRatings = [...this.ratings];
    this.draftStage = this.stage;
    this.draftKind = this.kind;
    this.panelOpen.set(false);
    this.customOpen.set(true);
  }

  protected draftToggleGroup(group: number): void {
    this.draftGroups = this.draftGroups.includes(group)
      ? this.draftGroups.filter((item) => item !== group)
      : [...this.draftGroups, group].sort();
  }

  protected draftToggleRating(letter: string): void {
    this.draftRatings = this.draftRatings.includes(letter)
      ? this.draftRatings.filter((item) => item !== letter)
      : [...this.draftRatings, letter];
  }

  protected selectValue(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  protected applyDraft(): void {
    this.groups = [...this.draftGroups];
    this.ratings = [...this.draftRatings];
    this.stage = this.draftStage;
    this.kind = this.draftKind;
    this.customOpen.set(false);
    this.emit();
  }

  protected clearGroups(event: Event): void {
    event.stopPropagation();
    this.groups = [];
    this.emit();
  }

  protected clearRatings(event: Event): void {
    event.stopPropagation();
    this.ratings = [];
    this.emit();
  }

  protected clearStage(event: Event): void {
    event.stopPropagation();
    this.stage = '';
    this.emit();
  }

  protected clearPeriod(event: Event): void {
    event.stopPropagation();
    this.period = '';
    this.month.setValue('', { emitEvent: false });
    this.emit();
  }

  protected clearKind(event: Event): void {
    event.stopPropagation();
    this.kind = '';
    this.emit();
  }

  protected clearGroupBy(event: Event): void {
    event.stopPropagation();
    this.groupBy = '';
    this.emit();
  }

  protected stageLabel(id: string): string {
    return this.stages.find((item) => item.id === id)?.label || id;
  }

  protected remember(): void {
    const name = this.filterName.value.trim();
    if (!name) return;
    const query = this.snapshot();
    this.api.saveFilter({
      name,
      target: this.target,
      query: {
        q: query.q,
        groups: query.groups,
        ratings: query.ratings,
        stage: query.stage,
        period: query.period,
        kind: query.kind || '',
        groupBy: query.groupBy || '',
      },
    }).subscribe({
      next: (row) => {
        this.saved.update((items) => [...items.filter((item) => item.id !== row.id), row]);
        this.filterName.setValue('');
      },
    });
  }

  protected apply(item: SavedFilter): void {
    const query = item.query || {};
    this.search.setValue(String(query['q'] || ''), { emitEvent: false });
    this.groups = Array.isArray(query['groups']) ? (query['groups'] as number[]) : [];
    this.ratings = Array.isArray(query['ratings']) ? (query['ratings'] as string[]) : [];
    this.stage = String(query['stage'] || '');
    this.period = String(query['period'] || '');
    this.kind = String(query['kind'] || '');
    this.groupBy = String(query['groupBy'] || '');
    this.month.setValue(this.period, { emitEvent: false });
    this.panelOpen.set(false);
    this.emit();
  }

  private snapshot(): RegistryFilterQuery {
    return {
      q: this.search.value.trim(),
      groups: this.groups,
      ratings: this.ratings,
      stage: this.stage,
      period: this.period,
      kind: this.kind,
      groupBy: this.groupBy,
    };
  }

  private emit(): void {
    this.queryChange.emit(this.snapshot());
  }
}
