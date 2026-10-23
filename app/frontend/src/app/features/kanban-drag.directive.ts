import { Directive, ElementRef, OnDestroy, inject, input, output } from '@angular/core';

/** Перетаскивание карточки целиком: копия следует за курсором, сброс — в любое место столбца. */
@Directive({
  selector: '[appKanbanDrag]',
  standalone: true,
})
export class KanbanDragDirective implements OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly dragId = input.required<string | number>({ alias: 'appKanbanDrag' });
  readonly dragDisabled = input(false);
  readonly kanbanDrop = output<{ id: string; stage: string }>();

  private skipClick = false;
  private ghost: HTMLElement | null = null;
  private origin: DOMRect | null = null;
  private pointer = 0;
  private moved = false;
  private startX = 0;
  private startY = 0;
  private offsetX = 0;
  private offsetY = 0;
  private highlighted: HTMLElement | null = null;
  private moveListener = (event: PointerEvent) => this.move(event);
  private upListener = (event: PointerEvent) => this.up(event);
  private clickListener = (event: MouseEvent) => this.swallow(event);

  constructor() {
    this.host.nativeElement.addEventListener('pointerdown', (event: PointerEvent) => this.down(event));
    this.host.nativeElement.addEventListener('click', this.clickListener, true);
  }

  ngOnDestroy(): void {
    this.clear();
    this.host.nativeElement.removeEventListener('click', this.clickListener, true);
  }

  private down(event: PointerEvent): void {
    if (this.dragDisabled() || event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, textarea, select, label')) return;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.pointer = event.pointerId;
    this.moved = false;
    const rect = this.host.nativeElement.getBoundingClientRect();
    this.origin = rect;
    this.offsetX = event.clientX - rect.left;
    this.offsetY = event.clientY - rect.top;
    document.addEventListener('pointermove', this.moveListener);
    document.addEventListener('pointerup', this.upListener);
  }

  private move(event: PointerEvent): void {
    if (event.pointerId !== this.pointer) return;
    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;
    if (!this.moved && Math.hypot(dx, dy) < 5) return;
    if (!this.moved) this.begin();
    this.moved = true;
    if (!this.ghost || !this.origin) return;
    this.ghost.style.left = `${event.clientX - this.offsetX}px`;
    this.ghost.style.top = `${event.clientY - this.offsetY}px`;
    this.mark(event.clientX, event.clientY);
    this.nudgeScroll(event.clientX, event.clientY);
  }

  private up(event: PointerEvent): void {
    if (event.pointerId !== this.pointer) return;
    document.removeEventListener('pointermove', this.moveListener);
    document.removeEventListener('pointerup', this.upListener);
    const stage = this.moved ? this.stageAt(event.clientX, event.clientY) : '';
    const id = String(this.dragId());
    if (this.moved && stage) {
      this.skipClick = true;
      this.kanbanDrop.emit({ id, stage });
      this.clear();
      return;
    }
    if (this.moved) {
      this.skipClick = true;
      this.flyBack();
      return;
    }
    this.clear();
  }

  private swallow(event: MouseEvent): void {
    if (!this.skipClick) return;
    event.preventDefault();
    event.stopPropagation();
    this.skipClick = false;
  }

  private begin(): void {
    const source = this.host.nativeElement;
    const rect = this.origin || source.getBoundingClientRect();
    const ghost = source.cloneNode(true) as HTMLElement;
    ghost.classList.add('kanban-ghost');
    ghost.style.position = 'fixed';
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.margin = '0';
    ghost.style.zIndex = '80';
    ghost.style.pointerEvents = 'none';
    ghost.style.opacity = '1';
    ghost.style.boxShadow = '0 10px 28px rgba(16, 42, 67, .28)';
    ghost.style.transform = 'rotate(1.5deg)';
    document.body.appendChild(ghost);
    this.ghost = ghost;
    source.classList.add('kanban-source');
  }

  private mark(x: number, y: number): void {
    const column = this.columnAt(x, y);
    if (column === this.highlighted) return;
    this.highlighted?.classList.remove('drop');
    column?.classList.add('drop');
    this.highlighted = column;
  }

  private stageAt(x: number, y: number): string {
    return this.columnAt(x, y)?.getAttribute('data-kanban-stage') || '';
  }

  private columnAt(x: number, y: number): HTMLElement | null {
    if (this.ghost) this.ghost.style.visibility = 'hidden';
    const node = document.elementFromPoint(x, y);
    if (this.ghost) this.ghost.style.visibility = '';
    const column = node?.closest('[data-kanban-stage]');
    return column instanceof HTMLElement ? column : null;
  }

  private nudgeScroll(x: number, y: number): void {
    const board = this.host.nativeElement.closest('.k-board');
    if (board instanceof HTMLElement) {
      const rect = board.getBoundingClientRect();
      if (x > rect.right - 36) board.scrollLeft += 18;
      else if (x < rect.left + 36) board.scrollLeft -= 18;
    }
    const scroller = this.scrollParent();
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    if (y > rect.bottom - 48) scroller.scrollTop += 16;
    else if (y < rect.top + 48) scroller.scrollTop -= 16;
  }

  private scrollParent(): HTMLElement | null {
    let node: HTMLElement | null = this.host.nativeElement.parentElement;
    while (node) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY)) return node;
      node = node.parentElement;
    }
    return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
  }

  private flyBack(): void {
    const ghost = this.ghost;
    const origin = this.origin;
    if (!ghost || !origin) {
      this.clear();
      return;
    }
    ghost.style.transition = 'left .18s ease, top .18s ease, opacity .18s ease';
    ghost.style.left = `${origin.left}px`;
    ghost.style.top = `${origin.top}px`;
    ghost.style.opacity = '0.2';
    window.setTimeout(() => this.clear(), 180);
  }

  private clear(): void {
    this.highlighted?.classList.remove('drop');
    this.highlighted = null;
    this.ghost?.remove();
    this.ghost = null;
    this.origin = null;
    this.host.nativeElement.classList.remove('kanban-source');
  }
}
