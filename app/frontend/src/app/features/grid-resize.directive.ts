import { AfterViewInit, Directive, ElementRef, Input, OnDestroy, inject } from '@angular/core';

import { ApiService } from '../core/api.service';

const MIN_WIDTH = 36;
const MAX_WIDTH = 1600;
const SHARED_PREFIX = 'erip.grid-widths.';

/** Правый край заголовка меняет ширину одного столбца. Ширина пишется на учётную запись. */
@Directive({
  selector: 'table[appGridResize]',
  standalone: true,
  host: { class: 'grid-resize' },
})
export class GridResizeDirective implements AfterViewInit, OnDestroy {
  @Input() appGridResize = '';

  private readonly host = inject(ElementRef<HTMLTableElement>);
  private readonly api = inject(ApiService);
  private observer?: MutationObserver;
  private frame = 0;
  private alive = true;
  private touched = false;
  private readonly widths = new Map<string, number>();
  private locked = false;
  private layoutTries = 0;
  private drag: { id: string; index: number; startX: number; startWidth: number; moved: boolean } | null = null;

  private readonly onMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag) return;
    const next = clamp(drag.startWidth + (event.clientX - drag.startX));
    if (next === this.widths.get(drag.id)) return;
    drag.moved = true;
    this.widths.set(drag.id, next);
    this.applyColumn(drag.index, next);
    this.applyTableWidth();
  };

  private readonly onUp = (): void => {
    const moved = this.drag?.moved ?? false;
    this.stopDrag();
    if (!moved) return;
    document.addEventListener('click', this.swallowClick, true);
    this.persist();
  };

  private readonly swallowClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    document.removeEventListener('click', this.swallowClick, true);
  };

  ngAfterViewInit(): void {
    this.forgetSharedBrowser();
    this.loadOwn();
    this.sync();
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(this.host.nativeElement, { childList: true, subtree: true });
  }

  ngOnDestroy(): void {
    this.alive = false;
    this.observer?.disconnect();
    cancelAnimationFrame(this.frame);
    this.stopDrag();
    document.removeEventListener('click', this.swallowClick, true);
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.sync();
    });
  }

  private sync(): void {
    const headers = this.headerCells();
    if (!headers.length) return;
    headers.forEach((cell, index) => this.attachGrip(cell, this.columnId(cell, index)));
    if (this.locked || this.hasWidth(headers)) this.paintAll(headers);
  }

  private headerCells(): HTMLTableCellElement[] {
    const row = this.host.nativeElement.querySelector('thead tr');
    if (!row) return [];
    return (Array.from(row.children) as Element[]).filter((cell): cell is HTMLTableCellElement => cell.tagName === 'TH');
  }

  private columnId(cell: HTMLElement, index: number): string {
    const marked = cell.getAttribute('data-col');
    if (marked) return marked;
    for (let i = 0; i < cell.classList.length; i += 1) {
      const name = cell.classList.item(i) ?? '';
      if (name.startsWith('mat-column-')) return name.slice('mat-column-'.length);
    }
    return `col-${index}`;
  }

  private hasWidth(headers: readonly HTMLTableCellElement[]): boolean {
    return headers.some((cell, index) => this.widths.has(this.columnId(cell, index)));
  }

  private attachGrip(cell: HTMLTableCellElement, id: string): void {
    if (getComputedStyle(cell).position === 'static') cell.style.position = 'relative';
    if (cell.querySelector(':scope > .col-resize')) return;
    const handle = document.createElement('span');
    handle.className = 'col-resize';
    handle.title = 'Потяните, чтобы изменить ширину столбца';
    handle.draggable = false;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', 'Ширина столбца');
    handle.addEventListener('pointerdown', (event) => this.begin(event, id));
    handle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    handle.addEventListener('dragstart', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    cell.appendChild(handle);
  }

  private begin(event: PointerEvent, id: string): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.touched = true;
    const headers = this.headerCells();
    const index = headers.findIndex((cell, cellIndex) => this.columnId(cell, cellIndex) === id);
    if (index < 0 || !this.paintAll(headers)) return;
    const startWidth = this.widths.get(id) ?? MIN_WIDTH;
    this.drag = { id, index, startX: event.clientX, startWidth, moved: false };
    document.body.classList.add('col-resizing');
    document.addEventListener('pointermove', this.onMove);
    document.addEventListener('pointerup', this.onUp);
    document.addEventListener('pointercancel', this.onUp);
  }

  private paintAll(headers: readonly HTMLTableCellElement[]): boolean {
    let pending = false;
    for (const [index, cell] of headers.entries()) {
      const id = this.columnId(cell, index);
      if (this.widths.has(id)) continue;
      const width = Math.round(cell.getBoundingClientRect().width);
      if (width < 8) {
        pending = true;
        continue;
      }
      this.widths.set(id, clamp(width));
    }
    if (pending) {
      if (this.layoutTries < 10) {
        this.layoutTries += 1;
        this.schedule();
      }
      return false;
    }
    this.layoutTries = 0;
    headers.forEach((cell, index) => this.applyColumn(index, this.widths.get(this.columnId(cell, index)) ?? MIN_WIDTH));
    this.applyTableWidth();
    return true;
  }

  private applyColumn(index: number, width: number): void {
    const headers = this.headerCells();
    const used = Math.max(width, headerFloor(headers[index]));
    const id = headers[index] ? this.columnId(headers[index], index) : '';
    if (id) this.widths.set(id, used);
    const px = `${used}px`;
    const cols = this.ensureCols(headers.length);
    const col = cols[index];
    if (col) col.style.width = px;
    for (const cell of this.cellsInColumn(index)) {
      if (cell.style.width === px && cell.style.maxWidth === px) continue;
      cell.style.width = px;
      cell.style.minWidth = px;
      cell.style.maxWidth = px;
    }
  }

  private applyTableWidth(): void {
    const headers = this.headerCells();
    let sum = 0;
    headers.forEach((cell, index) => {
      sum += this.widths.get(this.columnId(cell, index)) ?? 0;
    });
    if (!sum) return;
    const table = this.host.nativeElement;
    table.classList.add('widths-locked');
    table.style.width = `${sum}px`;
    table.style.tableLayout = 'fixed';
    this.locked = true;
  }

  private cellsInColumn(index: number): HTMLTableCellElement[] {
    const cells: HTMLTableCellElement[] = [];
    const rows = Array.from(this.host.nativeElement.rows) as HTMLTableRowElement[];
    for (const row of rows) {
      const rowCells = Array.from(row.cells) as HTMLTableCellElement[];
      if (rowCells.some((cell) => cell.colSpan > 1)) continue;
      const cell = row.cells.item(index);
      if (cell) cells.push(cell);
    }
    return cells;
  }

  private ensureCols(count: number): HTMLTableColElement[] {
    const table = this.host.nativeElement;
    let group = table.querySelector(':scope > colgroup');
    if (!group) {
      group = document.createElement('colgroup');
      table.insertBefore(group, table.firstChild);
    }
    while (group.children.length < count) group.appendChild(document.createElement('col'));
    while (group.children.length > count) group.lastElementChild?.remove();
    return Array.from(group.children) as HTMLTableColElement[];
  }

  private stopDrag(): void {
    this.drag = null;
    document.body.classList.remove('col-resizing');
    document.removeEventListener('pointermove', this.onMove);
    document.removeEventListener('pointerup', this.onUp);
    document.removeEventListener('pointercancel', this.onUp);
  }

  private forgetSharedBrowser(): void {
    try {
      const stale: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && key.startsWith(SHARED_PREFIX)) stale.push(key);
      }
      stale.forEach((key) => localStorage.removeItem(key));
    } catch {
      /* браузер без хранилища оставляет ширину только на экране */
    }
  }

  private loadOwn(): void {
    if (!this.appGridResize) return;
    this.api.boardWidths(this.appGridResize).subscribe({
      next: (widths) => {
        if (!this.alive || this.touched) return;
        this.widths.clear();
        for (const [id, value] of Object.entries(widths)) {
          if (typeof value === 'number' && Number.isFinite(value)) this.widths.set(id, clamp(value));
        }
        if (this.widths.size) this.sync();
      },
    });
  }

  private persist(): void {
    if (!this.appGridResize) return;
    this.touched = true;
    const payload: Record<string, number> = {};
    this.widths.forEach((width, id) => {
      payload[id] = width;
    });
    this.api.saveBoardWidths(this.appGridResize, payload).subscribe({
      error: () => undefined,
    });
  }
}

function clamp(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
}

/** Заголовок остаётся одной строкой: столбец не уже подписи. */
function headerFloor(cell: HTMLTableCellElement | undefined): number {
  if (!cell) return MIN_WIDTH;
  const text = (cell.innerText || '').replace(/\s+/g, ' ').trim();
  if (text.length < 2) return MIN_WIDTH;
  return Math.min(320, Math.max(MIN_WIDTH, Math.ceil(text.length * 7.2 + 28)));
}
