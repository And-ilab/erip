import {
  AfterViewInit, ChangeDetectorRef, Component, ElementRef, Input, NgZone, OnChanges, OnDestroy, Output,
  EventEmitter, inject, signal, viewChild,
} from '@angular/core';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';

import { FIELD_LABELS, FlowBlock, SheetBlock, bareToken, cellKey } from './document-flow';

@Component({
  selector: 'app-print-sheet',
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule],
  template: `
    <form class="desk" #desk [formGroup]="form" (submit)="$event.preventDefault()">
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
                [style.font-size.pt]="block.font_size"
                [style.text-align]="block.align"
                [style.font-weight]="block.bold ? 700 : 400"
                [style.font-style]="block.italic ? 'italic' : 'normal'"
                (pointerdown)="pick.emit(block.key)">
                @if (block.key === 'signatory') { <div class="sign-caption">Подпись</div> }
                @for (node of nodesOf(block.key); track $index) {
                  @if (node.kind === 'gap') {
                    <div class="gap"></div>
                  } @else if (node.kind === 'title') {
                    <input class="doc-title" [formControl]="piece(node.control)" [attr.aria-label]="'Заголовок'" />
                  } @else if (node.kind === 'fields') {
                    <div [class.frame]="node.framed" [class.panel]="!node.framed">
                      <div class="fields">
                        @for (item of node.items; track item.token + $index) {
                          <div class="field" [class.wide]="wide(item.bare ? labelOf(item.token) : piece(item.labelControl).value)">
                            @if (item.bare) {
                              <span class="field-label">{{ labelOf(item.token) }}</span>
                            } @else {
                              <input class="field-label" [formControl]="piece(item.labelControl)" [attr.aria-label]="'Подпись поля'" />
                            }
                            <input class="blank" autocomplete="off" [formControl]="valueControl(item.token)" [attr.placeholder]="labelOf(item.token)" [attr.aria-label]="item.label" />
                          </div>
                        }
                      </div>
                    </div>
                  } @else {
                    <p class="prose" [class.mixed]="mixed(node.parts)">
                      @for (part of node.parts; track $index) {
                        @if (part.kind === 'text') {
                          @if (long(piece(part.control).value)) {
                            <textarea class="prose-text" [rows]="rowsOf(piece(part.control).value)" [formControl]="piece(part.control)" [attr.aria-label]="'Текст документа'"></textarea>
                          } @else {
                            <input class="prose-inline" [style.width.ch]="widthCh(piece(part.control).value)" [formControl]="piece(part.control)" [attr.aria-label]="'Текст документа'" />
                          }
                        } @else {
                          <input class="blank inline" autocomplete="off" [formControl]="valueControl(part.token)" [attr.placeholder]="labelOf(part.token)" [attr.aria-label]="labelOf(part.token)" />
                        }
                      }
                    </p>
                  }
                }
                @if (block.columns.length && block.rows.length) {
                  <table class="grid">
                    <colgroup>
                      @for (col of block.columns; track $index) {
                        <col [style.width.%]="share(block, col.width)" />
                      }
                    </colgroup>
                    <thead>
                      <tr>
                        @for (col of block.columns; track $index) {
                          <th><input class="head-cell" [(ngModel)]="col.title" [ngModelOptions]="{standalone: true}" [attr.aria-label]="'Колонка'" /></th>
                        }
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of block.rows; track $index; let r = $index) {
                        <tr>
                          @for (cell of row; track $index; let c = $index) {
                            <td>
                              @if (tokenOf(cell); as token) {
                                <input class="blank" autocomplete="off" [formControl]="valueControl(token)" [attr.placeholder]="labelOf(token)" [attr.aria-label]="labelOf(token)" />
                              } @else {
                                <input class="cell" autocomplete="off" [formControl]="cellControl(block.key, r, c)" [attr.aria-label]="'Ячейка'" />
                              }
                            </td>
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                }
              </section>
              }
              </div>
            }
          </article>
        </div>
      </div>
    </form>
  `,
  styleUrl: './print-sheet.component.scss',
})
export class PrintSheetComponent implements AfterViewInit, OnChanges, OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly desk = viewChild<ElementRef<HTMLElement>>('desk');
  private readonly page = viewChild<ElementRef<HTMLElement>>('page');
  private observer: ResizeObserver | null = null;
  private readonly fallback = new FormControl('', { nonNullable: true });

  @Input({ required: true }) blocks: SheetBlock[] = [];
  @Input({ required: true }) flows: FlowBlock[] = [];
  @Input({ required: true }) form!: FormGroup;
  @Input() selectedKey = '';
  @Output() readonly pick = new EventEmitter<string>();

  protected readonly scale = signal(1);
  protected readonly stageWidth = signal(794);
  protected readonly stageHeight = signal(1123);

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

  protected nodesOf(key: string): FlowBlock['nodes'] {
    return this.flows.find((flow) => flow.key === key)?.nodes || [];
  }

  protected labelOf(token: string): string {
    return FIELD_LABELS[token] || 'Поле';
  }

  protected tokenOf(cell: string): string | null {
    return bareToken(cell);
  }

  protected wide(label: string | null): boolean {
    return (label || '').trim().length > 28;
  }

  protected mixed(parts: { kind: string }[]): boolean {
    return parts.some((part) => part.kind === 'field');
  }

  protected long(value: string | null): boolean {
    return (value || '').length > 60 || (value || '').includes('\n');
  }

  protected rowsOf(value: string | null): number {
    const text = value || '';
    const rows = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 78)), 0);
    return Math.min(Math.max(rows, 1), 16);
  }

  protected widthCh(value: string | null): number {
    return Math.min(Math.max((value || '').length, 1), 80);
  }

  protected share(block: SheetBlock, width: number): number {
    const total = block.columns.reduce((sum, col) => sum + Math.max(col.width, 1), 0) || 1;
    return Math.round(Math.max(width, 1) / total * 1000) / 10;
  }

  protected valueControl(token: string): FormControl<string> {
    return this.control('values', token);
  }

  protected piece(name: string): FormControl<string> {
    return this.control('pieces', name);
  }

  protected cellControl(blockKey: string, row: number, col: number): FormControl<string> {
    return this.control('cells', cellKey(blockKey, row, col));
  }

  private control(group: string, name: string): FormControl<string> {
    return (this.form?.get([group, name]) as FormControl<string>) || this.fallback;
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
