import { Component, input, output } from '@angular/core';

import { FunnelGateInfo } from '../core/api.service';

/** Окно вместо плашки сверху: какие действия закрывают переход и куда их делать. */
@Component({
  selector: 'app-funnel-gate-dialog',
  standalone: true,
  template: `
    @if (gate(); as row) {
      <div class="backdrop" (click)="closed.emit()">
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="funnel-gate-title" (click)="$event.stopPropagation()">
          <h3 id="funnel-gate-title">Для смены этапа нужны действия</h3>
          <p>{{ row.message }}</p>
          @if (row.actions.length) {
            <ul>
              @for (item of row.actions; track item) { <li>{{ item }}</li> }
            </ul>
          }
          <div class="dialog-actions">
            <button type="button" class="go" (click)="go.emit()">Перейти на вкладку «{{ row.tabLabel }}»</button>
            <button type="button" class="ghost" (click)="closed.emit()">Закрыть</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .backdrop {
      position: fixed; inset: 0; z-index: 90; display: flex; align-items: center; justify-content: center;
      background: rgba(20, 40, 55, .35);
    }
    .dialog {
      width: min(480px, calc(100vw - 32px)); background: #fff; border-radius: 8px; padding: 20px;
      box-shadow: 0 12px 32px rgba(16, 42, 67, .2);
    }
    h3 { margin: 0 0 8px; color: var(--erip-primary-dark); font-size: 18px; }
    p { margin: 0; color: #374151; }
    ul { margin: 10px 0 0; padding-left: 18px; color: #1f2933; }
    li + li { margin-top: 4px; }
    .dialog-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 16px; }
    button { height: 34px; padding: 0 14px; border-radius: 4px; font: inherit; cursor: pointer; }
    .go { border: 0; background: var(--erip-primary); color: #fff; }
    .ghost { border: 1px solid #d8dce0; background: #fff; color: #374151; }
  `,
})
export class FunnelGateDialogComponent {
  readonly gate = input<FunnelGateInfo | null>(null);
  readonly go = output<void>();
  readonly closed = output<void>();
}
