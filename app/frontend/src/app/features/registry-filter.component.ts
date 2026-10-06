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
}

const STAGES = [
  { id: 'new', label: 'Новый должник' },
  { id: 'prevention', label: 'Автообзвон/уведомления' },
  { id: 'warning', label: 'Предупреждение вручено' },
  { id: 'disconnect', label: 'Отключение услуг' },
  { id: 'enforcement', label: 'Испол. надпись / иск' },
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
          <button type="button" class="fchip" (click)="clearPeriod($event)">Период: {{ period }} ×</button>
        }
        <input [formControl]="search" [placeholder]="placeholder" (focus)="panelOpen.set(true)" />
        @if (showMonth) {
          <input class="month" type="month" [formControl]="month" aria-label="Период" (click)="$event.stopPropagation()" />
        }
        <button type="button" class="chevron" aria-label="Фильтры" [attr.aria-expanded]="panelOpen()" (click)="toggle($event)">▾</button>
      </div>
      @if (panelOpen()) {
        <div class="search-panel" role="dialog" aria-label="Фильтры реестра">
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
          </div>
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
  `,
  styles: `
    .search-wrap { position: relative; flex: 1; min-width: 0; }
    .search {
      display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 8px;
      background: #fff; border: 1px solid #d8dce0; border-radius: 4px;
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
      position: absolute; z-index: 30; top: calc(100% + 4px); left: 0;
      display: grid; grid-template-columns: 1.15fr .9fr; width: min(640px, 100%);
      background: #fff; border: 1px solid var(--erip-border); border-radius: 6px;
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
    .menu-item:hover, .pill:hover { background: #f3f6f8; }
    .save-row { display: flex; gap: 6px; padding: 0 12px 8px; }
    .save-row input {
      flex: 1; min-width: 0; height: 30px; border: 1px solid var(--erip-border); border-radius: 4px; padding: 0 8px; font: inherit;
    }
    .save-row button {
      height: 30px; padding: 0 10px; border: 0; border-radius: 4px; background: var(--erip-primary); color: #fff; font-size: 13px;
    }
    .empty { margin: 4px 16px; font-size: 12px; color: var(--erip-muted); }
  `,
})
export class RegistryFilterComponent implements OnInit {
  private readonly api = inject(ApiService);

  @Input() target = 'accounts';
  @Input() placeholder = 'Поиск по ФИО, номеру ЛС, адресу…';
  @Input() showRating = true;
  @Input() showStage = true;
  @Input() showMonth = false;
  @Output() readonly queryChange = new EventEmitter<RegistryFilterQuery>();

  protected readonly groupNumbers = [1, 2, 3, 4, 5, 6];
  protected readonly letters = ['A', 'B', 'C', 'D', 'E'];
  protected readonly stages = STAGES;
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly month = new FormControl('', { nonNullable: true });
  protected readonly filterName = new FormControl('', { nonNullable: true });
  protected readonly saved = signal<SavedFilter[]>([]);
  protected readonly panelOpen = signal(false);
  protected groups: number[] = [];
  protected ratings: string[] = [];
  protected stage = '';
  protected period = '';

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
    };
  }

  private emit(): void {
    this.queryChange.emit(this.snapshot());
  }
}
