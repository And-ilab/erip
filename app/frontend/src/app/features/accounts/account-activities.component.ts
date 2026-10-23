import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output, signal } from '@angular/core';

import { ActivityNode } from '../../core/models';

/** Чек-лист этапа: строка раскрывается, «Нужно действие» сразу выполняет шаг. */
@Component({
  selector: 'app-account-activities',
  standalone: true,
  imports: [NgTemplateOutlet],
  template: `
    @if (loading()) {
      <p class="muted">Загрузка активностей…</p>
    } @else {
      <section>
        <h3>Текущий этап</h3>
        @if (!current().length) {
          <p class="muted">Для этого этапа шаги ещё не созданы.</p>
        } @else {
          <table class="acts">
            <thead><tr><th>Название</th><th>Статус</th><th>Действие</th></tr></thead>
            <tbody>
              @for (row of current(); track row.id) {
                <ng-container *ngTemplateOutlet="line; context: { $implicit: row, depth: 0 }" />
              }
            </tbody>
          </table>
        }
      </section>
      @if (parallel().length) {
        <section>
          <h3>Параллельные</h3>
          @for (block of parallel(); track block.stage) {
            <h4>{{ block.title }}</h4>
            <table class="acts">
              <tbody>
                @for (row of block.items; track row.id) {
                  <ng-container *ngTemplateOutlet="line; context: { $implicit: row, depth: 0 }" />
                }
              </tbody>
            </table>
          }
        </section>
      }
    }

    <ng-template #line let-row let-depth="depth">
      <tr [class.focus]="focusMeasure() && row.measure_id === focusMeasure()">
        <td [style.padding-left.px]="12 + depth * 18">
          @if (row.children.length) {
            <button type="button" class="twist" (click)="toggle(row.id)">{{ open().has(row.id) ? '▼' : '▶' }}</button>
          }
          {{ row.title }}
          @if (row.note && row.status === 'done') { <span class="note">{{ row.note }}</span> }
        </td>
        <td><span class="status" [class.work]="row.status === 'running'" [class.done]="row.status === 'done'">{{ row.status_label }}</span></td>
        <td>
          @if (row.needs_action && canAct()) {
            @if (editing() === row.id) {
              @if (row.kind === 'upload') {
                <input type="file" (change)="sendFile(row, $event)" />
              } @else {
                <input [value]="draft()" (input)="draft.set($any($event.target).value)"
                  [placeholder]="row.kind === 'call' ? 'Результат обзвона' : 'Значение'" />
                <button type="button" class="go" (click)="send(row)">Выполнить</button>
              }
              <button type="button" class="go" (click)="editing.set(null)">Отмена</button>
            } @else {
              <button type="button" class="need" (click)="start(row)">Нужно действие</button>
            }
          } @else {
            —
          }
        </td>
      </tr>
      @if (row.children.length && open().has(row.id)) {
        @for (child of row.children; track child.id) {
          <ng-container *ngTemplateOutlet="line; context: { $implicit: child, depth: depth + 1 }" />
        }
      }
    </ng-template>
  `,
  styles: `
    h3 { margin: 8px 0; font-size: 15px; }
    h4 { margin: 12px 0 6px; font-size: 13px; color: #5c6b7a; }
    .muted { color: #6b7280; }
    table.acts { width: 100%; border-collapse: collapse; background: #fff; }
    table.acts th, table.acts td { border-bottom: 1px solid #e6ebf0; padding: 8px 10px; text-align: left; vertical-align: middle; }
    table.acts th { font-size: 12px; text-transform: uppercase; color: #5c6b7a; background: #f7f9fb; }
    tr.focus td { background: #e7f4f1; }
    .twist { border: 0; background: transparent; cursor: pointer; width: 18px; }
    .status { display: inline-block; min-width: 92px; text-align: center; border-radius: 12px; padding: 2px 8px; font-size: 12px; font-weight: 650; }
    .status.work { background: #fff4d6; color: #8a5a00; }
    .status.done { background: #e5f6ea; color: #1b7a3a; }
    .need, .go { border: 0; background: transparent; color: #1d6f8a; cursor: pointer; font: inherit; }
    .note { display: block; color: #6b7280; font-size: 12px; }
    input { font: inherit; margin-right: 6px; }
  `,
})
export class AccountActivitiesComponent {
  readonly current = input<ActivityNode[]>([]);
  readonly parallel = input<{ stage: string; title: string; short: string; items: ActivityNode[] }[]>([]);
  readonly loading = input(false);
  readonly canAct = input(false);
  readonly focusMeasure = input<number | null>(null);
  readonly act = output<{ id: number; note: string; file?: File }>();
  protected readonly open = signal<Set<number>>(new Set());
  protected readonly editing = signal<number | null>(null);
  protected readonly draft = signal('');

  protected toggle(id: number): void {
    const next = new Set(this.open());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.open.set(next);
  }

  protected start(row: ActivityNode): void {
    if (row.kind === 'email') {
      this.act.emit({ id: row.id, note: 'Повтор отправки' });
      return;
    }
    this.editing.set(row.id);
    this.draft.set('');
    if (row.children.length && !this.open().has(row.id)) this.toggle(row.id);
  }

  protected send(row: ActivityNode): void {
    this.act.emit({ id: row.id, note: this.draft().trim() });
    this.editing.set(null);
  }

  protected sendFile(row: ActivityNode, event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.act.emit({ id: row.id, note: '', file });
    this.editing.set(null);
  }
}
