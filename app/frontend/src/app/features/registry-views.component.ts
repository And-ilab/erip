import { Component, EventEmitter, Input, Output } from '@angular/core';

/** Переключатель видов одной группой иконок: канбан первый. */
@Component({
  selector: 'app-registry-views',
  standalone: true,
  template: `
    <div class="switch" role="group" aria-label="Вид отображения">
      <button type="button" [class.on]="mode === 'kanban'" title="Канбан" (click)="pick('kanban')" aria-label="Канбан">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h6v14H4zm10 0h6v9h-6z"/></svg>
      </button>
      <button type="button" [class.on]="mode === 'list'" title="Список" (click)="pick('list')" aria-label="Список">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14v2H5zm0 5h14v2H5zm0 5h14v2H5z"/></svg>
      </button>
      <button type="button" [class.on]="mode === 'calendar'" title="Календарь" (click)="pick('calendar')" aria-label="Календарь">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h2v2h6V3h2v2h3v16H4V5h3zm12 6H5v10h14z"/></svg>
      </button>
      @if (map) {
        <button type="button" [class.on]="mode === 'map'" title="Карта" (click)="pick('map')" aria-label="Карта">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 9.5A2.5 2.5 0 1 0 12 6a2.5 2.5 0 0 0 0 5.5z"/></svg>
        </button>
      }
      <button type="button" [class.on]="mode === 'charts'" title="Граф. аналитика" (click)="pick('charts')" aria-label="Граф. аналитика">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16v2H4zm2-3h2V9H6zm5 0h2V5h-2zm5 0h2v-6h-2z"/></svg>
      </button>
    </div>
  `,
  styles: `
    :host { margin-left: auto; }
    .switch {
      display: flex; align-items: center; gap: 2px; padding: 3px; background: #eef2f5;
      border-radius: 8px;
    }
    button {
      width: 34px; height: 30px; border: 0; background: transparent; border-radius: 6px;
      color: #5c6b7a; cursor: pointer; display: grid; place-items: center;
    }
    button svg { width: 18px; height: 18px; fill: currentColor; }
    button.on { background: #fff; color: var(--erip-primary); box-shadow: 0 1px 2px rgba(16, 42, 67, .12); }
    button:hover:not(.on) { background: #e4ebf0; }
  `,
})
export class RegistryViewsComponent {
  @Input() mode = 'kanban';
  @Input() map = false;
  /** Оставлено, чтобы вызовы реестров не менять: состав видов тот же. */
  @Input() mockup = false;
  @Output() readonly modeChange = new EventEmitter<string>();

  protected pick(mode: string): void {
    this.modeChange.emit(mode);
  }
}
