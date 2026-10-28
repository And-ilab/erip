import {
  AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output,
  inject, signal, viewChild,
} from '@angular/core';
import { FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';

import { FIELD_LABELS, FlowBlock, SheetBlock, fontCss } from './document-flow';

export interface ActiveInsertionTarget {
  blockKey: string;
  kind: 'text' | 'cell' | 'col';
  selectionStart?: number;
  selectionEnd?: number;
  row?: number;
  col?: number;
}

@Component({
  selector: 'app-print-sheet',
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule],
  template: `
    <div class="desk" #desk>
      <div class="stage" [style.width.px]="stageWidth()" [style.height.px]="stageHeight()">
        <div class="clip">
          <article class="a4" #page [style.transform]="'scale(' + scale() + ')'">
            @for (row of laidRows(); track $index) {
              <div class="doc-row" [class.split]="row.length > 1">
                @for (block of row; track block.key) {
                  <section
                    class="doc-block"
                    [class.letterhead]="block.key === 'logo'"
                    [class.sign]="block.key === 'signatory'"
                    [class.on]="selectedKey === block.key"
                    [class.drag-over-top]="dragOverBlockKey() === block.key && dragOverZone() === 'top'"
                    [class.drag-over-bottom]="dragOverBlockKey() === block.key && dragOverZone() === 'bottom'"
                    [class.drag-over-side]="dragOverBlockKey() === block.key && dragOverZone() === 'side'"
                    [style.font-family]="fontFamilyCss(block.font_family)"
                    [style.font-size.pt]="block.font_size"
                    [style.text-align]="block.align"
                    [style.font-weight]="block.bold ? 700 : 400"
                    [style.font-style]="block.italic ? 'italic' : 'normal'"
                    [style.width.%]="row.length === 1 && block.w < 92 ? block.w : null"
                    [style.flex]="row.length > 1 ? ('0 0 ' + shareBlock(row, block) + '%') : null"
                    (pointerdown)="selectBlock(block.key)"
                    (dragover)="onBlockDragOver($event, block)"
                    (dragleave)="onBlockDragLeave(block)"
                    (drop)="onBlockDrop($event, block)">
                    <div class="block-bar" (pointerdown)="$event.stopPropagation()">
                      <span
                        class="block-drag"
                        draggable="true"
                        title="Перетащите блок для изменения расположения"
                        (dragstart)="onBlockDragStart($event, block)"
                        (dragend)="onBlockDragEnd()">⋮⋮</span>
                      <input
                        class="block-title-input"
                        [(ngModel)]="block.title"
                        [ngModelOptions]="{ standalone: true }"
                        (focus)="selectBlock(block.key)"
                        placeholder="Название блока"
                        [attr.aria-label]="'Название блока'" />
                      <button type="button" class="mini-btn" title="В одну строку с соседним / на всю ширину" (click)="toggleSideBySide(block)">⇔</button>
                      @if (blocks.length > 1) {
                        <button type="button" class="mini-btn danger" title="Удалить блок" (click)="deleteBlock(block)">×</button>
                      }
                    </div>

                    @if (block.text || !block.columns.length || selectedKey === block.key) {
                      <textarea
                        class="block-editor"
                        [rows]="rowsOf(block.text)"
                        [(ngModel)]="block.text"
                        [ngModelOptions]="{ standalone: true }"
                        [placeholder]="block.columns.length ? '' : 'Введите текст...'"
                        (focus)="onTextFocus(block, $event)"
                        (click)="onTextCursor(block, $event)"
                        (keyup)="onTextCursor(block, $event)"
                        [attr.aria-label]="block.title || 'Текст блока'"></textarea>
                    }

                    @if (block.columns.length) {
                      <div class="table-wrap">
                        <table class="grid" #gridTable>
                          <colgroup>
                            @for (col of block.columns; track $index) {
                              <col [style.width.%]="share(block, col.width)" />
                            }
                          </colgroup>
                          <thead>
                            <tr>
                              @for (col of block.columns; track $index; let c = $index) {
                                <th
                                  [class.col-active]="isColActive(block.key, c)"
                                  [class.col-drop-target]="dragOverCol()?.blockKey === block.key && dragOverCol()?.col === c"
                                  (click)="selectCol(block.key, c); $event.stopPropagation()"
                                  (dragover)="onColDragOver($event, block, c)"
                                  (dragleave)="onColDragLeave(block, c)"
                                  (drop)="onColDrop($event, block, c)">
                                  <div class="th-inner">
                                    <span
                                      class="col-drag"
                                      draggable="true"
                                      title="Перетащите столбец для смены расположения"
                                      (dragstart)="onColDragStart($event, block, c)"
                                      (dragend)="onColDragEnd()">⋮⋮</span>
                                    <input
                                      class="head-cell"
                                      [(ngModel)]="col.title"
                                      [ngModelOptions]="{ standalone: true }"
                                      (focus)="onColFocus(block.key, c)"
                                      placeholder="Столбец"
                                      [attr.aria-label]="'Колонка ' + (c + 1)" />
                                  </div>
                                  <span
                                    class="col-resizer"
                                    title="Потяните за край для изменения ширины столбца"
                                    (pointerdown)="startColResize($event, block, c, gridTable)"></span>
                                </th>
                              }
                            </tr>
                          </thead>
                          <tbody>
                            @for (rRow of block.rows; track $index; let r = $index) {
                              <tr>
                                @for (cell of rRow; track $index; let c = $index) {
                                  <td [class.col-active]="isColActive(block.key, c)">
                                    <input
                                      class="cell"
                                      autocomplete="off"
                                      [(ngModel)]="block.rows[r][c]"
                                      [ngModelOptions]="{ standalone: true }"
                                      (focus)="onCellFocus(block.key, r, c, $event)"
                                      (click)="onCellFocus(block.key, r, c, $event)"
                                      (keyup)="onCellFocus(block.key, r, c, $event)"
                                      placeholder=""
                                      [attr.aria-label]="'Ячейка ' + (r + 1) + ':' + (c + 1)" />
                                  </td>
                                }
                              </tr>
                            }
                          </tbody>
                        </table>
                      </div>
                    }

                    <span
                      class="block-resizer"
                      title="Потяните за правый край для изменения ширины блока"
                      (pointerdown)="startBlockResize($event, block, page)"></span>
                  </section>
                }
              </div>
            }
          </article>
        </div>
      </div>
    </div>
  `,
  styleUrl: './print-sheet.component.scss',
})
export class PrintSheetComponent implements AfterViewInit, OnChanges, OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly desk = viewChild<ElementRef<HTMLElement>>('desk');
  private readonly page = viewChild<ElementRef<HTMLElement>>('page');
  private observer: ResizeObserver | null = null;

  @Input({ required: true }) blocks: SheetBlock[] = [];
  @Input() flows: FlowBlock[] = [];
  @Input() form?: FormGroup;
  @Input() selectedKey = '';
  @Output() readonly pick = new EventEmitter<string>();
  @Output() readonly blocksChange = new EventEmitter<SheetBlock[]>();
  @Output() readonly targetChange = new EventEmitter<ActiveInsertionTarget>();

  protected readonly scale = signal(1);
  protected readonly stageWidth = signal(794);
  protected readonly stageHeight = signal(1123);

  protected readonly activeCol = signal<{ blockKey: string; col: number } | null>(null);
  protected readonly dragCol = signal<{ blockKey: string; col: number } | null>(null);
  protected readonly dragOverCol = signal<{ blockKey: string; col: number } | null>(null);

  protected readonly dragBlockKey = signal<string>('');
  protected readonly dragOverBlockKey = signal<string>('');
  protected readonly dragOverZone = signal<'top' | 'bottom' | 'side' | ''>('');

  ngAfterViewInit(): void {
    const desk = this.desk()?.nativeElement;
    const page = this.page()?.nativeElement;
    if (!desk) return;
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(desk);
    if (page) this.observer.observe(page);
    this.fit();
  }

  ngOnChanges(): void {
    queueMicrotask(() => this.fit());
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  protected fontFamilyCss(family?: string): string {
    return fontCss(family);
  }

  protected laidRows(): SheetBlock[][] {
    const blocks = [...this.blocks].filter((block) => block.enabled).sort((a, b) => a.y - b.y || a.x - b.x);
    const rows: SheetBlock[][] = [];
    for (const block of blocks) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(last[0].y - block.y) < 8) last.push(block);
      else rows.push([block]);
    }
    for (const row of rows) row.sort((a, b) => a.x - b.x);
    return rows;
  }

  protected shareBlock(row: SheetBlock[], block: SheetBlock): number {
    const total = row.reduce((sum, item) => sum + Math.max(item.w || 46, 20), 0) || 100;
    return Math.round((Math.max(block.w || 46, 20) / total) * 960) / 10;
  }

  protected labelOf(token: string): string {
    return FIELD_LABELS[token] || 'Поле';
  }

  protected rowsOf(value: string | null): number {
    const text = value || '';
    if (!text) return 2;
    const rows = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 76)), 0);
    return Math.min(Math.max(rows, 2), 22);
  }

  protected share(block: SheetBlock, width: number): number {
    const total = block.columns.reduce((sum, col) => sum + Math.max(col.width, 5), 0) || 1;
    return Math.round((Math.max(width, 5) / total) * 1000) / 10;
  }

  protected selectBlock(key: string): void {
    if (this.selectedKey !== key) {
      this.pick.emit(key);
    }
  }

  protected onTextFocus(block: SheetBlock, event: Event): void {
    this.selectBlock(block.key);
    this.onTextCursor(block, event);
  }

  protected onTextCursor(block: SheetBlock, event: Event): void {
    const el = event.target as HTMLTextAreaElement | null;
    this.targetChange.emit({
      blockKey: block.key,
      kind: 'text',
      selectionStart: el?.selectionStart ?? block.text.length,
      selectionEnd: el?.selectionEnd ?? block.text.length,
    });
  }

  protected onColFocus(blockKey: string, col: number): void {
    this.selectBlock(blockKey);
    this.selectCol(blockKey, col);
    this.targetChange.emit({ blockKey, kind: 'col', col });
  }

  protected onCellFocus(blockKey: string, row: number, col: number, event: Event): void {
    this.selectBlock(blockKey);
    this.selectCol(blockKey, col);
    const el = event.target as HTMLInputElement | null;
    this.targetChange.emit({
      blockKey,
      kind: 'cell',
      row,
      col,
      selectionStart: el?.selectionStart ?? undefined,
      selectionEnd: el?.selectionEnd ?? undefined,
    });
  }

  protected selectCol(blockKey: string, col: number): void {
    this.activeCol.set({ blockKey, col });
  }

  protected isColActive(blockKey: string, col: number): boolean {
    const cur = this.activeCol();
    return !!cur && cur.blockKey === blockKey && cur.col === col;
  }

  protected activeColIndex(blockKey: string): number {
    const cur = this.activeCol();
    return cur && cur.blockKey === blockKey ? cur.col + 1 : 0;
  }

  protected initTable(block: SheetBlock): void {
    this.selectBlock(block.key);
    block.columns = [
      { title: 'Наименование', width: 40 },
      { title: 'Сумма долга', width: 30 },
      { title: 'Пеня', width: 30 },
    ];
    block.rows = [['{services}', '{amount}', '{penalty}']];
    this.activeCol.set({ blockKey: block.key, col: 0 });
    this.blocksChange.emit(this.blocks);
  }

  protected addColumn(block: SheetBlock): void {
    this.selectBlock(block.key);
    const nextIdx = block.columns.length + 1;
    block.columns = [...block.columns, { title: `Столбец ${nextIdx}`, width: 20 }];
    block.rows = block.rows.length
      ? block.rows.map((row) => [...row, ''])
      : [block.columns.map(() => '')];
    this.activeCol.set({ blockKey: block.key, col: block.columns.length - 1 });
    this.blocksChange.emit(this.blocks);
  }

  protected removeColumnAt(block: SheetBlock, colIndex: number): void {
    this.selectBlock(block.key);
    if (colIndex < 0 || colIndex >= block.columns.length) return;
    block.columns = block.columns.filter((_, idx) => idx !== colIndex);
    if (!block.columns.length) {
      block.rows = [];
      this.activeCol.set(null);
    } else {
      block.rows = block.rows.map((row) => row.filter((_, idx) => idx !== colIndex));
      this.activeCol.set({ blockKey: block.key, col: Math.max(0, Math.min(colIndex, block.columns.length - 1)) });
    }
    this.blocksChange.emit(this.blocks);
  }

  protected removeLastColumn(block: SheetBlock): void {
    if (!block.columns.length) return;
    const cur = this.activeCol();
    const target = cur && cur.blockKey === block.key && cur.col < block.columns.length
      ? cur.col
      : block.columns.length - 1;
    this.removeColumnAt(block, target);
  }

  protected addRow(block: SheetBlock): void {
    this.selectBlock(block.key);
    if (!block.columns.length) {
      this.initTable(block);
      return;
    }
    block.rows = [...block.rows, block.columns.map(() => '')];
    this.blocksChange.emit(this.blocks);
  }

  protected removeRowAt(block: SheetBlock, rowIndex: number): void {
    this.selectBlock(block.key);
    if (block.rows.length <= 1) {
      block.rows = [block.columns.map(() => '')];
    } else {
      block.rows = block.rows.filter((_, idx) => idx !== rowIndex);
    }
    this.blocksChange.emit(this.blocks);
  }

  protected clearTable(block: SheetBlock): void {
    this.selectBlock(block.key);
    block.columns = [];
    block.rows = [];
    this.activeCol.set(null);
    this.blocksChange.emit(this.blocks);
  }

  protected moveBlockVertical(block: SheetBlock, delta: number): void {
    this.selectBlock(block.key);
    const ordered = [...this.blocks].sort((a, b) => a.y - b.y || a.x - b.x);
    const idx = ordered.findIndex((item) => item.key === block.key);
    const other = ordered[idx + delta];
    if (!other) return;
    const tmpY = block.y;
    block.y = other.y;
    other.y = tmpY === other.y ? tmpY + delta * 40 : tmpY;
    this.normalizeBlockY();
    this.blocksChange.emit(this.blocks);
  }

  protected toggleSideBySide(block: SheetBlock): void {
    this.selectBlock(block.key);
    const ordered = [...this.blocks].filter((b) => b.enabled).sort((a, b) => a.y - b.y || a.x - b.x);
    const sameRow = ordered.filter((b) => b.key !== block.key && Math.abs(b.y - block.y) < 8);
    if (sameRow.length) {
      block.x = 4;
      block.w = 92;
      block.y = sameRow[0].y + 60;
      for (const peer of sameRow) {
        if (sameRow.length === 1) {
          peer.x = 4;
          peer.w = 92;
        }
      }
      this.normalizeBlockY();
    } else {
      const idx = ordered.findIndex((b) => b.key === block.key);
      const neighbor = ordered[idx + 1] || ordered[idx - 1];
      if (neighbor) {
        const y = Math.min(block.y, neighbor.y);
        block.y = y;
        neighbor.y = y;
        if (idx < ordered.indexOf(neighbor)) {
          block.x = 4;
          block.w = 46;
          neighbor.x = 52;
          neighbor.w = 46;
        } else {
          neighbor.x = 4;
          neighbor.w = 46;
          block.x = 52;
          block.w = 46;
        }
      }
    }
    this.blocksChange.emit(this.blocks);
  }

  protected deleteBlock(block: SheetBlock): void {
    if (this.blocks.length <= 1) return;
    const idx = this.blocks.findIndex((b) => b.key === block.key);
    if (idx === -1) return;
    this.blocks.splice(idx, 1);
    const next = this.blocks[Math.max(0, idx - 1)] || this.blocks[0];
    if (next) this.pick.emit(next.key);
    this.blocksChange.emit(this.blocks);
  }

  // Перетаскивание столбцов таблицы
  protected onColDragStart(event: DragEvent, block: SheetBlock, colIndex: number): void {
    event.stopPropagation();
    this.dragCol.set({ blockKey: block.key, col: colIndex });
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', `col:${block.key}:${colIndex}`);
    }
  }

  protected onColDragOver(event: DragEvent, block: SheetBlock, colIndex: number): void {
    const dragging = this.dragCol();
    if (!dragging || dragging.blockKey !== block.key || dragging.col === colIndex) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dragOverCol.set({ blockKey: block.key, col: colIndex });
  }

  protected onColDragLeave(block: SheetBlock, colIndex: number): void {
    const over = this.dragOverCol();
    if (over && over.blockKey === block.key && over.col === colIndex) {
      this.dragOverCol.set(null);
    }
  }

  protected onColDrop(event: DragEvent, block: SheetBlock, targetCol: number): void {
    const dragging = this.dragCol();
    this.dragOverCol.set(null);
    this.dragCol.set(null);
    if (!dragging || dragging.blockKey !== block.key || dragging.col === targetCol) return;
    event.preventDefault();
    event.stopPropagation();
    const from = dragging.col;
    const cols = [...block.columns];
    const [movedCol] = cols.splice(from, 1);
    cols.splice(targetCol, 0, movedCol);
    block.columns = cols;
    block.rows = block.rows.map((row) => {
      const copy = [...row];
      const [movedCell] = copy.splice(from, 1);
      copy.splice(targetCol, 0, movedCell ?? '');
      return copy;
    });
    this.activeCol.set({ blockKey: block.key, col: targetCol });
    this.blocksChange.emit(this.blocks);
  }

  protected onColDragEnd(): void {
    this.dragCol.set(null);
    this.dragOverCol.set(null);
  }

  // Изменение ширины столбца перетаскиванием
  protected startColResize(event: PointerEvent, block: SheetBlock, colIndex: number, tableEl: HTMLElement): void {
    event.preventDefault();
    event.stopPropagation();
    this.selectBlock(block.key);
    this.selectCol(block.key, colIndex);
    const total = block.columns.reduce((sum, c) => sum + Math.max(c.width, 5), 0) || 100;
    block.columns.forEach((c) => {
      c.width = Math.max(5, Math.round((Math.max(c.width, 5) / total) * 100));
    });
    const rect = tableEl.getBoundingClientRect();
    const tablePx = Math.max(rect.width, 120);
    const startX = event.clientX;
    const startWidth = block.columns[colIndex].width;
    const nextCol = block.columns[colIndex + 1];
    const startNextWidth = nextCol ? nextCol.width : 0;

    const onMove = (moveEvent: PointerEvent) => {
      const deltaPx = moveEvent.clientX - startX;
      const deltaPct = Math.round((deltaPx / tablePx) * 100);
      if (nextCol) {
        const combined = startWidth + startNextWidth;
        const nextW = Math.min(combined - 6, Math.max(6, startWidth + deltaPct));
        block.columns[colIndex].width = nextW;
        nextCol.width = Math.max(6, combined - nextW);
      } else {
        block.columns[colIndex].width = Math.min(95, Math.max(6, startWidth + deltaPct));
      }
      this.cdr.markForCheck();
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.blocksChange.emit(this.blocks);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // Изменение ширины самого блока перетаскиванием
  protected startBlockResize(event: PointerEvent, block: SheetBlock, pageEl: HTMLElement): void {
    event.preventDefault();
    event.stopPropagation();
    this.selectBlock(block.key);
    const rect = pageEl.getBoundingClientRect();
    const pagePx = Math.max(rect.width, 200);
    const startX = event.clientX;
    const startW = block.w || 92;

    const onMove = (moveEvent: PointerEvent) => {
      const deltaPx = moveEvent.clientX - startX;
      const deltaPct = Math.round((deltaPx / pagePx) * 100);
      block.w = Math.min(100, Math.max(24, startW + deltaPct));
      this.cdr.markForCheck();
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.blocksChange.emit(this.blocks);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // Перетаскивание блоков на листе
  protected onBlockDragStart(event: DragEvent, block: SheetBlock): void {
    event.stopPropagation();
    this.dragBlockKey.set(block.key);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', `block:${block.key}`);
    }
  }

  protected onBlockDragOver(event: DragEvent, target: SheetBlock): void {
    const sourceKey = this.dragBlockKey();
    if (!sourceKey || sourceKey === target.key) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const el = event.currentTarget as HTMLElement | null;
    if (el) {
      const rect = el.getBoundingClientRect();
      const relY = (event.clientY - rect.top) / Math.max(rect.height, 1);
      const relX = (event.clientX - rect.left) / Math.max(rect.width, 1);
      if (relX > 0.72) {
        this.dragOverZone.set('side');
      } else if (relY < 0.5) {
        this.dragOverZone.set('top');
      } else {
        this.dragOverZone.set('bottom');
      }
    } else {
      this.dragOverZone.set('bottom');
    }
    this.dragOverBlockKey.set(target.key);
  }

  protected onBlockDragLeave(target: SheetBlock): void {
    if (this.dragOverBlockKey() === target.key) {
      this.dragOverBlockKey.set('');
      this.dragOverZone.set('');
    }
  }

  protected onBlockDrop(event: DragEvent, target: SheetBlock): void {
    const sourceKey = this.dragBlockKey();
    const zone = this.dragOverZone() || 'bottom';
    this.dragBlockKey.set('');
    this.dragOverBlockKey.set('');
    this.dragOverZone.set('');
    if (!sourceKey || sourceKey === target.key) return;
    event.preventDefault();
    event.stopPropagation();
    const source = this.blocks.find((b) => b.key === sourceKey);
    if (!source) return;
    if (zone === 'side') {
      source.y = target.y;
      target.x = 4;
      target.w = 46;
      source.x = 52;
      source.w = 46;
    } else {
      const ordered = [...this.blocks].sort((a, b) => a.y - b.y || a.x - b.x).filter((b) => b.key !== source.key);
      const targetIdx = ordered.findIndex((b) => b.key === target.key);
      const insertAt = zone === 'top' ? Math.max(0, targetIdx) : targetIdx + 1;
      source.x = 4;
      ordered.splice(insertAt, 0, source);
      ordered.forEach((b, idx) => {
        b.y = 12 + idx * 80;
      });
    }
    this.blocksChange.emit(this.blocks);
  }

  protected onBlockDragEnd(): void {
    this.dragBlockKey.set('');
    this.dragOverBlockKey.set('');
    this.dragOverZone.set('');
  }

  private normalizeBlockY(): void {
    const rows = this.laidRows();
    rows.forEach((row, idx) => {
      const y = 12 + idx * 80;
      for (const b of row) b.y = y;
    });
  }

  private fit(): void {
    const desk = this.desk()?.nativeElement;
    const page = this.page()?.nativeElement;
    if (!desk || !page) return;
    const natural = (210 / 25.4) * 96;
    const available = Math.max(desk.clientWidth - 40, 180);
    const scale = Math.min(1, Math.round((available / natural) * 100) / 100);
    const height = Math.max(page.offsetHeight, (297 / 25.4) * 96);
    const stageWidth = Math.ceil(natural * scale);
    const stageHeight = Math.ceil(height * scale) + 8;
    if (Math.abs(scale - this.scale()) < 0.01 && Math.abs(stageHeight - this.stageHeight()) < 2) return;
    this.zone.run(() => {
      this.scale.set(scale);
      this.stageWidth.set(stageWidth);
      this.stageHeight.set(stageHeight);
      this.cdr.markForCheck();
    });
  }
}
