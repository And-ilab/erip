import { NgTemplateOutlet } from '@angular/common';
import { Component, effect, input, output, signal } from '@angular/core';

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
            <colgroup>
              <col class="col-title" />
              <col class="col-status" />
              <col class="col-action" />
            </colgroup>
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
              <colgroup>
                <col class="col-title" />
                <col class="col-status" />
                <col class="col-action" />
              </colgroup>
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
      <tr [class.focus]="focusMeasure() && row.measure_id === focusMeasure()" [class.gap]="row.mandatory && row.status !== 'done'">
        <td class="cell-title" [style.padding-left.px]="12 + depth * 18">
          @if (row.children.length) {
            <button type="button" class="twist" (click)="toggle(row.id)">{{ expanded(row) ? '▼' : '▶' }}</button>
          }
          <span class="box" [class.on]="row.status === 'done'" [class.need]="row.mandatory && row.status !== 'done'"></span>
          {{ row.title }}
          @if (row.mandatory && row.status !== 'done') { <span class="req" title="Обязательный пункт">*</span> }
          @if (depth === 0 && measureLink(row); as measureId) {
            <button type="button" class="go measure-go" (click)="openMeasure.emit(measureId)">К мероприятию</button>
          }
          @if (row.note && row.status === 'done') { <span class="note">{{ row.note }}</span> }
        </td>
        <td class="cell-status"><span class="status" [class.work]="row.status === 'running'" [class.done]="row.status === 'done'">{{ row.status_label }}</span></td>
        <td class="cell-action">
          @if (row.needs_action && canAct()) {
            @if (editing() === row.id) {
              @if (row.kind === 'upload') {
                <input type="file" (change)="sendFile(row, $event)" />
              } @else {
                <input [value]="draft()" (input)="draft.set($any($event.target).value)"
                  [placeholder]="hint(row)" />
                <button type="button" class="go" (click)="send(row)">Выполнить</button>
              }
              <button type="button" class="go" (click)="editing.set(null)">Отмена</button>
            } @else {
              <button type="button" class="need" (click)="start(row)">Нужно действие</button>
            }
          } @else if (row.kind === 'check') {
            <span class="muted">По данным дела</span>
          } @else {
            —
          }
        </td>
      </tr>
      @if (expanded(row)) {
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
    table.acts { width: 100%; table-layout: fixed; border-collapse: collapse; background: #fff; }
    table.acts col.col-title { width: auto; }
    table.acts col.col-status { width: 160px; }
    table.acts col.col-action { width: 260px; }
    table.acts th, table.acts td { border-bottom: 1px solid #e6ebf0; padding: 8px 10px; text-align: left; vertical-align: middle; box-sizing: border-box; }
    table.acts th:nth-child(2), table.acts td.cell-status { width: 160px; text-align: center; }
    table.acts th:nth-child(3), table.acts td.cell-action { width: 260px; text-align: left; }
    table.acts td.cell-title { overflow-wrap: break-word; }
    table.acts th { font-size: 12px; text-transform: uppercase; color: #5c6b7a; background: #f7f9fb; }
    tr.focus td { background: #e7f4f1; }
    .twist { border: 0; background: transparent; cursor: pointer; width: 18px; }
    .box {
      display: inline-block; width: 14px; height: 14px; margin-right: 6px; vertical-align: -2px;
      border: 1.5px solid #8aa0ad; border-radius: 3px; background: #fff;
    }
    .box.on { background: #1b7a3a; border-color: #1b7a3a; box-shadow: inset 0 0 0 2px #fff; }
    .box.need, tr.gap .req { border-color: #c62828; color: #c62828; }
    .req { margin-left: 4px; font-weight: 700; }
    .status { display: inline-block; min-width: 92px; text-align: center; border-radius: 12px; padding: 2px 8px; font-size: 12px; font-weight: 650; }
    .status.work { background: #fff4d6; color: #8a5a00; }
    .status.done { background: #e5f6ea; color: #1b7a3a; }
    button.need, button.go { border: 0; background: transparent; color: #1d6f8a; cursor: pointer; font: inherit; }
    .measure-go { display: inline; margin-left: 8px; text-decoration: underline; }
    .note { display: block; color: #6b7280; font-size: 12px; }
    input { font: inherit; margin-right: 6px; max-width: 150px; }
  `,
})
export class AccountActivitiesComponent {
  readonly current = input<ActivityNode[]>([]);
  readonly parallel = input<{ stage: string; title: string; short: string; items: ActivityNode[] }[]>([]);
  readonly loading = input(false);
  readonly canAct = input(false);
  readonly focusMeasure = input<number | null>(null);
  readonly focusCode = input('');
  readonly act = output<{ id: number; note: string; file?: File }>();
  readonly openMeasure = output<number>();
  protected readonly closed = signal<Set<number>>(new Set());
  protected readonly editing = signal<number | null>(null);
  protected readonly draft = signal('');

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

  private reveal(nodes: ActivityNode[], code: string, parents: number[]): boolean {
    for (const node of nodes) {
      if (node.code === code) {
        const closed = new Set(this.closed());
        parents.forEach((id) => closed.delete(id));
        this.closed.set(closed);
        if (node.needs_action) this.editing.set(node.id);
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

  protected hint(row: ActivityNode): string {
    if (row.code === 'hand') return 'Дата вручения, дд.мм.гггг';
    if (row.code === 'opi_sent' || row.code === 'filed') return 'Дата, дд.мм.гггг';
    if (row.code === 'opi_office') return 'Орган ОПИ';
    if (row.code === 'opi_send') return 'Номер ИП | статус';
    if (row.code === 'duty') return 'Сумма госпошлины';
    if (row.kind === 'call') return 'Результат обзвона';
    return 'Значение';
  }

  protected start(row: ActivityNode): void {
    if (row.kind === 'email') {
      this.act.emit({ id: row.id, note: 'Повтор отправки' });
      return;
    }
    this.editing.set(row.id);
    this.draft.set('');
    if (row.children.length && this.closed().has(row.id)) this.toggle(row.id);
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
