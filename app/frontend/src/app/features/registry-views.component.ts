import { Component, EventEmitter, Input, Output } from '@angular/core';

/** Одинаковые виды на реестрах: список, канбан, календарь и та же графика. */
@Component({
  selector: 'app-registry-views',
  standalone: true,
  template: `
    <div class="switch" role="group" aria-label="Вид отображения">
      @if (mockup) {
        <button type="button" class="view-btn" [class.on]="mode === 'kanban'" title="Канбан" (click)="pick('kanban')">▦</button>
        <button type="button" class="view-btn" [class.on]="mode === 'list'" title="Список" (click)="pick('list')">≡</button>
        <button type="button" class="view-btn" [class.on]="mode === 'calendar'" title="Календарь" (click)="pick('calendar')">▤</button>
        <button type="button" class="view-btn" [class.on]="mode === 'charts'" title="Граф. аналитика" (click)="pick('charts')">▮</button>
      } @else {
        <button type="button" class="view-btn" [class.on]="mode === 'list'" title="Список" (click)="pick('list')">≡</button>
        <button type="button" class="view-btn" [class.on]="mode === 'kanban'" title="Канбан" (click)="pick('kanban')">▦</button>
        <button type="button" class="view-btn" [class.on]="mode === 'calendar'" title="Календарь" (click)="pick('calendar')">▤</button>
        @if (map) {
          <button type="button" class="view-btn" [class.on]="mode === 'map'" title="Карта" (click)="pick('map')">⌖</button>
        }
        <button type="button" class="charts" [class.on]="mode === 'charts'" (click)="pick('charts')">Граф. аналитика</button>
      }
    </div>
  `,
  styles: `
    :host { margin-left: auto; }
    .switch { display: flex; align-items: center; gap: 4px; }
    .view-btn, .charts {
      height: 32px; border: 1px solid #c9d4dc; background: #fff; border-radius: 6px; color: var(--erip-primary);
      font: inherit; cursor: pointer;
    }
    .view-btn { width: 32px; font-size: 14px; }
    .charts { padding: 0 10px; font-size: 13px; margin-left: 6px; }
    .view-btn.on, .charts.on { background: var(--erip-primary); color: #fff; border-color: var(--erip-primary); }
  `,
})
export class RegistryViewsComponent {
  @Input() mode = 'list';
  @Input() map = false;
  /** Как на макете реестра мероприятий: канбан, список, календарь и значок графика. */
  @Input() mockup = false;
  @Output() readonly modeChange = new EventEmitter<string>();

  protected pick(mode: string): void {
    this.modeChange.emit(mode);
  }
}
