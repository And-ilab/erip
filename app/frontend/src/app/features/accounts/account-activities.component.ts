import { NgTemplateOutlet } from '@angular/common';
import { Component, effect, input, output, signal } from '@angular/core';

import { ActivityNode } from '../../core/models';

const WORK_LABEL: Record<string, string> = {
  call: 'К мероприятию',
  notice: 'К мероприятию',
  disconnect: 'К мероприятию',
  p1: 'К мероприятию',
  p2: 'К мероприятию',
  prep: 'К пакету надписи',
  enforcement: 'К пакету надписи',
  notary: 'К нотариусу',
  writ_done: 'К пакету надписи',
  refused: 'К отказу нотариуса',
  lawsuit: 'К иску',
  judgment: 'К решению суда',
  opi: 'К ОПИ',
  opi_measures: 'К мерам ОПИ',
  impossible: 'К актам ОПИ',
  recovered: 'К взысканию',
  writeoff: 'К списанию',
  court: 'К ОПИ',
};

/** Чек-лист этапа. Переход открывает карточку, где этот пункт заполняют. */
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
            <colgroup>
              <col class="col-title" />
              <col class="col-status" />
              <col class="col-action" />
            </colgroup>
            <thead><tr><th>Название</th><th>Статус</th><th>Переход</th></tr></thead>
            <tbody>
              @for (row of current(); track row.id) {
                <ng-container *ngTemplateOutlet="line; context: { $implicit: row, depth: 0, stage: stage() }" />
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
              <colgroup>
                <col class="col-title" />
                <col class="col-status" />
                <col class="col-action" />
              </colgroup>
              <tbody>
                @for (row of block.items; track row.id) {
                  <ng-container *ngTemplateOutlet="line; context: { $implicit: row, depth: 0, stage: block.stage }" />
                }
              </tbody>
            </table>
          }
        </section>
      }
    }

    <ng-template #line let-row let-depth="depth" let-stage="stage">
      <tr [class.focus]="focusMeasure() && row.measure_id === focusMeasure()" [class.gap]="row.mandatory && row.status !== 'done'">
        <td class="cell-title" [style.padding-left.px]="12 + depth * 16">
          <span class="lead">
            @if (row.children.length) {
              <button type="button" class="twist" (click)="toggle(row.id)" [attr.aria-label]="expanded(row) ? 'Свернуть' : 'Развернуть'">{{ expanded(row) ? '▼' : '▶' }}</button>
            } @else {
              <span class="twist spacer" aria-hidden="true"></span>
            }
            <span class="box" [class.on]="row.status === 'done'" [class.need]="row.mandatory && row.status !== 'done'"></span>
          </span>
          <span class="name">{{ row.title }}</span>
          @if (row.mandatory && row.status !== 'done') { <span class="req" title="Обязательный пункт">*</span> }
          @if (row.note && row.status === 'done') { <span class="note">{{ row.note }}</span> }
        </td>
        <td class="cell-status"><span class="status" [class.work]="row.status === 'running'" [class.done]="row.status === 'done'">{{ row.status_label }}</span></td>
        <td class="cell-action">
          @if (labelOf(stage); as label) {
            <button type="button" class="go" (click)="openWork.emit({ stage, measureId: measureLink(row) })">{{ label }}</button>
          } @else if (row.kind === 'check') {
            <span class="muted">По данным дела</span>
          } @else {
            —
          }
        </td>
      </tr>
      @if (expanded(row)) {
        @for (child of row.children; track child.id) {
          <ng-container *ngTemplateOutlet="line; context: { $implicit: child, depth: depth + 1, stage: stage }" />
        }
      }
    </ng-template>
  `,
  styles: `
    h3 { margin: 8px 0; font-size: 15px; }
    h4 { margin: 12px 0 6px; font-size: 13px; color: #5c6b7a; }
    .muted { color: #6b7280; }
    table.acts { width: 100%; table-layout: fixed; border-collapse: collapse; background: #fff; }
    table.acts col.col-title { width: auto; }
    table.acts col.col-status { width: 160px; }
    table.acts col.col-action { width: 220px; }
    table.acts th, table.acts td { border-bottom: 1px solid #e6ebf0; padding: 8px 10px; text-align: left; vertical-align: middle; box-sizing: border-box; }
    table.acts th:nth-child(2), table.acts td.cell-status { width: 160px; text-align: center; }
    table.acts th:nth-child(3), table.acts td.cell-action { width: 220px; text-align: left; }
    table.acts td.cell-title { overflow-wrap: break-word; }
    table.acts th { font-size: 12px; text-transform: uppercase; color: #5c6b7a; background: #f7f9fb; }
    tr.focus td { background: #e7f4f1; }
    .lead { display: inline-flex; align-items: center; gap: 10px; margin-right: 8px; vertical-align: middle; }
    .twist {
      flex: 0 0 16px; width: 16px; height: 16px; margin: 0; padding: 0; border: 0;
      background: transparent; color: #5c6b7a; cursor: pointer; line-height: 16px; font-size: 11px;
    }
    .twist.spacer { visibility: hidden; pointer-events: none; }
    .box {
      flex: 0 0 14px; width: 14px; height: 14px; box-sizing: border-box;
      border: 1.5px solid #8aa0ad; border-radius: 3px; background: #fff;
    }
    .box.on { background: #1b7a3a; border-color: #1b7a3a; box-shadow: inset 0 0 0 2px #fff; }
    .box.need, tr.gap .req { border-color: #c62828; color: #c62828; }
    .name { vertical-align: middle; }
    .req { margin-left: 4px; font-weight: 700; }
    .status { display: inline-block; min-width: 92px; text-align: center; border-radius: 12px; padding: 2px 8px; font-size: 12px; font-weight: 650; }
    .status.work { background: #fff4d6; color: #8a5a00; }
    .status.done { background: #e5f6ea; color: #1b7a3a; }
    button.go { border: 0; background: transparent; color: #1d6f8a; cursor: pointer; font: inherit; padding: 0; text-decoration: underline; text-align: left; }
    .note { display: block; color: #6b7280; font-size: 12px; }
  `,
})
export class AccountActivitiesComponent {
  readonly current = input<ActivityNode[]>([]);
  readonly parallel = input<{ stage: string; title: string; short: string; items: ActivityNode[] }[]>([]);
  readonly loading = input(false);
  readonly stage = input('');
  readonly focusMeasure = input<number | null>(null);
  readonly focusCode = input('');
  readonly openWork = output<{ stage: string; measureId: number | null }>();
  protected readonly closed = signal<Set<number>>(new Set());

  constructor() {
    effect(() => {
      const code = this.focusCode();
      if (!code) return;
      const nodes = [...this.current(), ...this.parallel().flatMap((block) => block.items)];
      this.reveal(nodes, code, []);
    });
  }

  protected expanded(row: ActivityNode): boolean {
    return row.children.length > 0 && !this.closed().has(row.id);
  }

  protected labelOf(stage: string): string {
    return WORK_LABEL[stage] || '';
  }

  private reveal(nodes: ActivityNode[], code: string, parents: number[]): boolean {
    for (const node of nodes) {
      if (node.code === code) {
        const closed = new Set(this.closed());
        parents.forEach((id) => closed.delete(id));
        this.closed.set(closed);
        return true;
      }
      if (node.children.length && this.reveal(node.children, code, [...parents, node.id])) return true;
    }
    return false;
  }

  protected toggle(id: number): void {
    const next = new Set(this.closed());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.closed.set(next);
  }

  protected measureLink(row: ActivityNode): number | null {
    if (row.measure_id) return row.measure_id;
    for (const child of row.children) {
      const found = this.measureLink(child);
      if (found) return found;
    }
    return null;
  }
}
