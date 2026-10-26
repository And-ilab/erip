import { Directive, ElementRef, OnDestroy, inject, input, output } from '@angular/core';

/** Перетаскивание карточки целиком: копия следует за курсором, сброс — в любое место столбца. */
@Directive({
  selector: '[appKanbanDrag]',
  standalone: true,
  host: {
    '[class.kanban-draggable]': '!dragDisabled()',
  },
})
export class KanbanDragDirective implements OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly dragId = input.required<string | number>({ alias: 'appKanbanDrag' });
  readonly dragDisabled = input(false);
  readonly kanbanDrop = output<{ id: string; stage: string }>();

  private ghost: HTMLElement | null = null;
  private origin: DOMRect | null = null;
  private pressTarget: Element | null = null;
  private pointer = 0;
  private tracking = false;
  private moved = false;
  private dragToken = 0;
  private blockTrustedClick = false;
  private releaseTrustedTimer = 0;
  private startX = 0;
  private startY = 0;
  private offsetX = 0;
  private offsetY = 0;
  private highlighted: HTMLElement | null = null;
  private moveListener = (event: PointerEvent) => this.move(event);
  private upListener = (event: PointerEvent) => this.up(event);
  private cancelListener = (event: PointerEvent) => this.cancel(event);
  private clickListener = (event: MouseEvent) => this.swallow(event);
  private blockSelect = (event: Event) => event.preventDefault();
  private blockNativeDrag = (event: DragEvent) => event.preventDefault();
  private blockHostDrag = (event: DragEvent) => {
    if (!this.dragDisabled()) event.preventDefault();
  };

  constructor() {
    const el = this.host.nativeElement;
    el.addEventListener('pointerdown', (event: PointerEvent) => this.down(event));
    el.addEventListener('click', this.clickListener, true);
    el.addEventListener('dragstart', this.blockHostDrag, true);
  }

  ngOnDestroy(): void {
    window.clearTimeout(this.releaseTrustedTimer);
    this.detachPointer();
    this.clear();
    const el = this.host.nativeElement;
    el.removeEventListener('click', this.clickListener, true);
    el.removeEventListener('dragstart', this.blockHostDrag, true);
  }

  private down(event: PointerEvent): void {
    if (this.dragDisabled() || event.button !== 0 || this.tracking) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button, a, input, textarea, select, label')) return;
    // Иначе браузер выделяет текст и тащит его как копию всей страницы.
    event.preventDefault();
    this.dragToken += 1;
    this.highlighted?.classList.remove('drop');
    this.highlighted = null;
    this.ghost?.remove();
    this.ghost = null;
    this.host.nativeElement.classList.remove('kanban-source');
    this.pressTarget = target;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.pointer = event.pointerId;
    this.tracking = true;
    this.moved = false;
    const rect = this.host.nativeElement.getBoundingClientRect();
    this.origin = rect;
    this.offsetX = event.clientX - rect.left;
    this.offsetY = event.clientY - rect.top;
    document.documentElement.classList.add('kanban-dragging');
    window.getSelection()?.removeAllRanges();
    document.addEventListener('pointermove', this.moveListener);
    document.addEventListener('pointerup', this.upListener);
    document.addEventListener('pointercancel', this.cancelListener);
    document.addEventListener('selectstart', this.blockSelect, true);
    document.addEventListener('dragstart', this.blockNativeDrag, true);
    try {
      this.host.nativeElement.setPointerCapture(event.pointerId);
    } catch {
      // Указатель уже неактивен — жест всё равно ведут слушатели document.
    }
  }

  private move(event: PointerEvent): void {
    if (!this.tracking || event.pointerId !== this.pointer) return;
    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;
    if (!this.moved && Math.hypot(dx, dy) < 5) return;
    if (!this.moved) this.begin();
    this.moved = true;
    event.preventDefault();
    if (!this.ghost || !this.origin) return;
    this.ghost.style.left = `${event.clientX - this.offsetX}px`;
    this.ghost.style.top = `${event.clientY - this.offsetY}px`;
    this.mark(event.clientX, event.clientY);
    this.nudgeScroll(event.clientX, event.clientY);
  }

  private up(event: PointerEvent): void {
    if (!this.tracking || event.pointerId !== this.pointer) return;
    this.detachPointer();
    const stage = this.moved ? this.stageAt(event.clientX, event.clientY) : '';
    const id = String(this.dragId());
    if (this.moved && stage) {
      this.holdTrustedClick();
      this.kanbanDrop.emit({ id, stage });
      this.clear();
      return;
    }
    if (this.moved) {
      this.holdTrustedClick();
      this.flyBack();
      return;
    }
    this.clear();
    this.replayClick(event);
  }

  private cancel(event: PointerEvent): void {
    if (!this.tracking || event.pointerId !== this.pointer) return;
    this.detachPointer();
    if (this.moved) {
      this.holdTrustedClick();
      this.clear();
      return;
    }
    this.clear();
  }

  private swallow(event: MouseEvent): void {
    if (!this.blockTrustedClick || !event.isTrusted) return;
    event.preventDefault();
    event.stopPropagation();
    this.blockTrustedClick = false;
  }

  private holdTrustedClick(): void {
    this.blockTrustedClick = true;
    window.clearTimeout(this.releaseTrustedTimer);
    this.releaseTrustedTimer = window.setTimeout(() => {
      this.blockTrustedClick = false;
    }, 50);
  }

  private replayClick(event: PointerEvent): void {
    const node = this.pressTarget ?? this.host.nativeElement;
    this.blockTrustedClick = true;
    node.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: event.clientX,
      clientY: event.clientY,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      button: 0,
    }));
    this.holdTrustedClick();
  }

  private begin(): void {
    window.getSelection()?.removeAllRanges();
    const source = this.host.nativeElement;
    const rect = this.origin || source.getBoundingClientRect();
    const ghost = source.cloneNode(true) as HTMLElement;
    ghost.classList.add('kanban-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.draggable = false;
    ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    ghost.style.position = 'fixed';
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.overflow = 'hidden';
    ghost.style.margin = '0';
    ghost.style.zIndex = '80';
    ghost.style.pointerEvents = 'none';
    ghost.style.userSelect = 'none';
    ghost.style.opacity = '1';
    ghost.style.boxShadow = '0 10px 28px rgba(16, 42, 67, .28)';
    ghost.style.transform = 'rotate(1.5deg)';
    document.body.appendChild(ghost);
    this.ghost = ghost;
    source.classList.add('kanban-source');
    document.documentElement.classList.add('kanban-moving');
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
    const hit = node?.closest('[data-kanban-stage]');
    if (hit instanceof HTMLElement) return hit;
    const board = this.host.nativeElement.closest('.k-board');
    if (!(board instanceof HTMLElement)) return null;
    for (const item of Array.from(board.querySelectorAll('[data-kanban-stage]'))) {
      if (!(item instanceof HTMLElement)) continue;
      const rect = item.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return item;
    }
    return null;
  }

  private nudgeScroll(x: number, y: number): void {
    const board = this.host.nativeElement.closest('.k-board');
    if (board instanceof HTMLElement) {
      const rect = board.getBoundingClientRect();
      if (x > rect.right - 36) board.scrollLeft += 18;
      else if (x < rect.left + 36) board.scrollLeft -= 18;
    }
    const cards = this.columnAt(x, y)?.querySelector(':scope > .k-cards');
    if (!(cards instanceof HTMLElement)) return;
    const rect = cards.getBoundingClientRect();
    if (y > rect.bottom - 48) cards.scrollTop += 16;
    else if (y < rect.top + 48) cards.scrollTop -= 16;
  }

  private flyBack(): void {
    const ghost = this.ghost;
    const origin = this.origin;
    const token = this.dragToken;
    if (!ghost || !origin) {
      this.clear();
      return;
    }
    ghost.style.transition = 'left .18s ease, top .18s ease, opacity .18s ease';
    ghost.style.left = `${origin.left}px`;
    ghost.style.top = `${origin.top}px`;
    ghost.style.opacity = '0.2';
    window.setTimeout(() => {
      ghost.remove();
      if (token !== this.dragToken) return;
      if (this.ghost === ghost) this.ghost = null;
      this.clear();
    }, 180);
  }

  private detachPointer(): void {
    this.tracking = false;
    document.removeEventListener('pointermove', this.moveListener);
    document.removeEventListener('pointerup', this.upListener);
    document.removeEventListener('pointercancel', this.cancelListener);
    document.removeEventListener('selectstart', this.blockSelect, true);
    document.removeEventListener('dragstart', this.blockNativeDrag, true);
    const el = this.host.nativeElement;
    if (el.hasPointerCapture(this.pointer)) {
      try {
        el.releasePointerCapture(this.pointer);
      } catch {
        // Захват уже снят вместе с указателем.
      }
    }
  }

  private clear(): void {
    this.highlighted?.classList.remove('drop');
    this.highlighted = null;
    this.ghost?.remove();
    this.ghost = null;
    this.origin = null;
    this.pressTarget = null;
    this.host.nativeElement.classList.remove('kanban-source');
    document.documentElement.classList.remove('kanban-dragging', 'kanban-moving');
    window.getSelection()?.removeAllRanges();
  }
}
