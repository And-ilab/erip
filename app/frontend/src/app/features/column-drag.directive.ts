import { AfterViewInit, Directive, ElementRef, OnDestroy, output, inject } from '@angular/core';

/** Перетаскивание заголовка меняет порядок столбца. Ручка ширины это движение не начинает. */
@Directive({
  selector: 'table[appColumnDrag]',
  standalone: true,
})
export class ColumnDragDirective implements AfterViewInit, OnDestroy {
  readonly columnMove = output<{ from: string; to: string }>();

  private readonly host = inject(ElementRef<HTMLTableElement>);
  private observer?: MutationObserver;
  private from = '';

  ngAfterViewInit(): void {
    this.arm();
    this.observer = new MutationObserver(() => this.arm());
    this.observer.observe(this.host.nativeElement, { childList: true, subtree: true });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private arm(): void {
    const headers = this.host.nativeElement.querySelectorAll('th');
    headers.forEach((cell: Element) => {
      const th = cell as HTMLTableCellElement;
      if (th.dataset['dragReady']) return;
      const id = this.idOf(th);
      if (!id || id === 'select') return;
      th.dataset['dragReady'] = '1';
      th.draggable = true;
      th.addEventListener('dragstart', (event) => {
        const target = event.target as Element | null;
        if (target?.closest('.col-resize')) {
          event.preventDefault();
          return;
        }
        this.from = id;
        event.dataTransfer?.setData('text/plain', id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      th.addEventListener('dragover', (event) => {
        if (this.from) event.preventDefault();
      });
      th.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const to = this.idOf(th);
        const from = this.from;
        this.from = '';
        if (from && to && from !== to) this.columnMove.emit({ from, to });
      });
    });
  }

  private idOf(th: HTMLElement): string {
    if (th.dataset['col']) return th.dataset['col'];
    for (let index = 0; index < th.classList.length; index += 1) {
      const name = th.classList.item(index) ?? '';
      if (name.startsWith('mat-column-')) return name.slice('mat-column-'.length);
    }
    return '';
  }
}
