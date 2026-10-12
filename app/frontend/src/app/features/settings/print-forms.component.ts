import { Component, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';

import { ApiService, ClaimCase, PrintFormBlock, PrintFormRow, errorMessage } from '../../core/api.service';

const TOKENS = [
  'fio', 'account', 'amount', 'penalty', 'address', 'services', 'last_payment', 'organization',
  'due_days', 'tariff', 'debt_group', 'rating', 'months_debt', 'personal_id', 'unp', 'warning_date', 'debt_started',
];

@Component({
  selector: 'app-print-forms',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatSnackBarModule],
  template: `
    <header class="head">
      <div>
        <h2>Конструктор печатных форм</h2>
        <p>Макет — блоки с флажками. PDF — как документ будет выглядеть, без скачивания. Шаблон дела остаётся своей версией.</p>
      </div>
      <button mat-stroked-button type="button" (click)="create()">+ Шаблон</button>
    </header>
    @if (note()) { <p class="note">{{ note() }}</p> }
    <div class="layout">
      <section class="list">
        <h3>Системные</h3>
        @for (form of systemForms(); track form.id) {
          <button type="button" [class.on]="current()?.id === form.id" (click)="select(form)">
            {{ form.name }}
            <small>{{ kindLabel(form.doc_kind) }} · v{{ form.version }}</small>
          </button>
        }
        <h3>Мои</h3>
        @for (form of ownForms(); track form.id) {
          <button type="button" [class.on]="current()?.id === form.id" (click)="select(form)">
            {{ form.name }}
            <small>{{ kindLabel(form.doc_kind) }} · v{{ form.version }}</small>
          </button>
        }
        @if (!ownForms().length) { <p class="muted">Своих шаблонов пока нет.</p> }
      </section>
      <section class="editor">
        <div class="panes">
          <button type="button" [class.on]="pane() === 'layout'" (click)="pane.set('layout')">Макет</button>
          <button type="button" [class.on]="pane() === 'pdf'" (click)="showPdf()">PDF</button>
        </div>
        @if (pane() === 'layout') {
          <div class="line">
            <label [class.need]="!code.trim()">Код <input [(ngModel)]="code" [disabled]="!!claimId" /></label>
            <label class="grow" [class.need]="!name.trim()">Название <input [(ngModel)]="name" /></label>
          </div>
          <div class="line">
            <label>Вид
              <select [(ngModel)]="kind">
                @for (item of kinds; track item.id) { <option [value]="item.id">{{ item.label }}</option> }
              </select>
            </label>
            <label>Адресат
              <select [(ngModel)]="addressee">
                <option value="debtor">Должник</option>
                <option value="notary">Нотариус</option>
                <option value="supplier">Поставщик услуги</option>
                <option value="district">Администрация района</option>
              </select>
            </label>
            <label class="scan">Загрузить скан шаблона
              <input type="file" accept="application/pdf,.pdf,image/*" (change)="onScan($event)" />
            </label>
          </div>
          <p class="muted">Флажок включает блок макета. Блок на листе можно перетащить, таблицу — растянуть за угол. Поля счёта дописываются в выбранный блок.</p>
          <div class="work">
            <aside class="blocks">
              <h3>Блоки</h3>
              @for (block of blocks; track block.key) {
                <label class="check" [class.need]="block.key === 'body' && !block.text.trim()">
                  <input type="checkbox" [(ngModel)]="block.enabled" /> {{ block.title }}
                </label>
              }
              <div class="tokens">
                @for (token of tokens; track token) {
                  <button type="button" (click)="insert(token)">{{ '{' + token + '}' }}</button>
                }
              </div>
            </aside>
            <div class="sheet-wrap">
              @if (chosen(); as block) {
                <div class="line tool">
                  <label>Шрифт, пт <input type="number" min="8" max="24" [(ngModel)]="block.font_size" /></label>
                  <label>Выравнивание
                    <select [(ngModel)]="block.align">
                      <option value="left">Слева</option>
                      <option value="center">По центру</option>
                      <option value="right">Справа</option>
                    </select>
                  </label>
                  <label class="check"><input type="checkbox" [(ngModel)]="block.bold" /> Жирный</label>
                  <label class="check"><input type="checkbox" [(ngModel)]="block.italic" /> Курсив</label>
                  <button type="button" (click)="addColumn(block)">Колонка</button>
                  @if (block.columns.length) { <button type="button" (click)="addRow(block)">Строка</button> }
                </div>
              }
              <div class="sheet" (pointermove)="dragMove($event)" (pointerup)="dragEnd()" (pointerleave)="dragEnd()">
                @for (block of blocks; track block.key) {
                  @if (block.enabled) {
                    <article class="piece" [class.on]="selectedKey === block.key" [style.left.%]="block.x" [style.top.px]="block.y" [style.width.%]="block.w" (pointerdown)="focusBlock(block)">
                      <header (pointerdown)="dragStart($event, block, 'move')">{{ block.title }}</header>
                      <textarea rows="4" [(ngModel)]="block.text" [style.text-align]="block.align" [style.font-size.px]="block.font_size" [style.font-weight]="block.bold ? 700 : 400" [style.font-style]="block.italic ? 'italic' : 'normal'"></textarea>
                      @if (block.columns.length) {
                        <div class="grid" [style.grid-template-columns]="gridOf(block)">
                          @for (col of block.columns; track $index) {
                            <input class="head-cell" [(ngModel)]="col.title" />
                          }
                          @for (row of block.rows; track $index) {
                            @for (cell of row; track $index) {
                              <input [(ngModel)]="row[$index]" />
                            }
                          }
                        </div>
                      }
                      <span class="handle" (pointerdown)="dragStart($event, block, 'resize')"></span>
                    </article>
                  }
                }
              </div>
            </div>
          </div>
          <div class="actions">
            @if (claimId && docId) {
              <button mat-flat-button color="primary" type="button" (click)="saveCase()">Сохранить в деле</button>
            } @else {
              <button mat-flat-button color="primary" type="button" (click)="save()">Сохранить шаблон</button>
            }
            @if (current()?.revisions?.length) {
              @for (rev of current()?.revisions; track rev.version) {
                <button mat-stroked-button type="button" (click)="restore(rev.version)" [disabled]="rev.version === current()?.version">
                  Вернуть v{{ rev.version }}
                </button>
              }
            }
          </div>
        } @else {
          <p class="muted">Предпросмотр собран в ПМ. Файл не скачивается.</p>
          @if (pdfUrl(); as url) {
            <iframe class="sheet" title="Предпросмотр PDF" [src]="url"></iframe>
          } @else {
            <p>Предпросмотр появится здесь.</p>
          }
        }
      </section>
    </div>
  `,
  styles: `
    .head, .line, .actions, .panes, .cols { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .head { justify-content: space-between; margin-bottom: 12px; }
    h2, h3 { margin: 0; color: var(--erip-primary-dark); }
    h3 { margin: 12px 0 6px; font-size: 13px; }
    .muted, .head p, .note { color: var(--erip-muted); margin: 4px 0 0; font-size: 13px; }
    .note { background: #fff8e8; border: 1px solid #e0a106; border-radius: 8px; padding: 8px 10px; }
    .layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 16px; }
    .list, .editor { background: #fff; border: 1px solid var(--erip-border); border-radius: 12px; padding: 12px; min-width: 0; }
    .list { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
    .list button, .panes button, .cols button {
      text-align: left; border: 1px solid var(--erip-border); background: #fff; border-radius: 8px;
      padding: 8px 10px; cursor: pointer; font: inherit;
    }
    .list button.on, .panes button.on { border-color: var(--erip-primary); background: var(--erip-primary-soft); }
    .list small { display: block; color: var(--erip-muted); }
    .grow { flex: 1; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--erip-muted); }
    input, select, textarea { font: inherit; color: inherit; border: 1px solid var(--erip-border); border-radius: 6px; padding: 6px 8px; }
    textarea { width: 100%; box-sizing: border-box; min-height: 90px; }
    .check { flex-direction: row; align-items: center; color: inherit; font-size: 14px; }
    .scan input { font-size: 12px; }
    .tokens { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
    .tokens button {
      border: 1px solid var(--erip-border); background: #fff; border-radius: 999px; padding: 2px 8px;
      cursor: pointer; font: inherit; font-size: 12px;
    }
    .need { color: #c62828; }
    .work { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 12px; margin-top: 8px; }
    .blocks { border: 1px solid var(--erip-border); border-radius: 8px; padding: 8px; }
    .tool { margin-bottom: 8px; }
    .sheet-wrap .sheet {
      position: relative; height: 720px; background: #f4f6f8; border: 1px solid var(--erip-border); border-radius: 8px; overflow: auto;
    }
    .piece {
      position: absolute; background: #fff; border: 1px solid #d5dde3; border-radius: 6px; padding: 4px 6px 10px; box-sizing: border-box;
    }
    .piece.on { border-color: var(--erip-primary); box-shadow: 0 0 0 1px var(--erip-primary); }
    .piece header { font-size: 11px; color: var(--erip-muted); cursor: grab; user-select: none; }
    .piece textarea { width: 100%; box-sizing: border-box; min-height: 64px; border: 0; resize: vertical; }
    .grid { display: grid; gap: 2px; }
    .grid input { min-width: 0; font-size: 12px; }
    .head-cell { font-weight: 700; }
    .handle {
      position: absolute; right: 2px; bottom: 2px; width: 12px; height: 12px; cursor: nwse-resize;
      border-right: 2px solid var(--erip-primary); border-bottom: 2px solid var(--erip-primary);
    }
    iframe.sheet { width: 100%; height: 640px; border: 1px solid var(--erip-border); border-radius: 8px; }
    @media (max-width: 900px) { .layout, .work { grid-template-columns: 1fr; } }
  `,
})
export class PrintFormsComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly snack = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly forms = signal<PrintFormRow[]>([]);
  protected readonly current = signal<PrintFormRow | null>(null);
  protected readonly pane = signal<'layout' | 'pdf'>('layout');
  protected readonly pdfUrl = signal<SafeResourceUrl | null>(null);
  protected readonly note = signal('');
  protected readonly tokens = TOKENS;
  protected readonly kinds = [
    { id: 'warning', label: 'Предупреждение' },
    { id: 'writ', label: 'Заявление на исполнительную надпись' },
    { id: 'calculation', label: 'Расчёт задолженности' },
    { id: 'proxy', label: 'Доверенность' },
    { id: 'lawsuit', label: 'Иск о взыскании' },
    { id: 'eviction', label: 'Иск о выселении' },
    { id: 'alienation', label: 'Иск об отчуждении' },
    { id: 'act', label: 'Акт' },
    { id: 'claim', label: 'Иск' },
    { id: 'writeoff', label: 'Акт списания' },
    { id: 'disconnect', label: 'Заказ-наряд на отключение' },
  ];

  protected code = '';
  protected name = '';
  protected kind = 'writ';
  protected addressee = 'notary';
  protected blocks: PrintFormBlock[] = [];
  protected selectedKey = 'body';
  protected claimId: number | null = null;
  protected docId: number | null = null;
  private requestedForm: number | null = null;
  private rawUrl = '';
  private drag: { key: string; mode: 'move' | 'resize'; x: number; y: number; originX: number; originY: number; originW: number } | null = null;

  protected systemForms(): PrintFormRow[] {
    return this.forms().filter((form) => form.organization == null);
  }

  protected ownForms(): PrintFormRow[] {
    return this.forms().filter((form) => form.organization != null);
  }

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      this.claimId = Number(params.get('claim') || 0) || null;
      this.docId = Number(params.get('doc') || 0) || null;
      this.requestedForm = Number(params.get('form') || 0) || null;
      this.pane.set(params.get('pane') === 'pdf' ? 'pdf' : 'layout');
      this.reload();
    });
  }

  ngOnDestroy(): void {
    this.revoke();
  }

  protected kindLabel(id: string): string {
    return this.kinds.find((item) => item.id === id)?.label || id;
  }

  protected select(form: PrintFormRow): void {
    this.current.set(form);
    this.code = form.code;
    this.name = form.name;
    this.kind = form.doc_kind;
    this.addressee = form.addressee || 'debtor';
    this.blocks = this.copyBlocks(form);
    this.pdfUrl.set(null);
    if (this.claimId) this.fillClaim();
    else if (this.pane() === 'pdf') this.showPdf();
  }

  protected create(): void {
    this.current.set(null);
    this.code = '';
    this.name = '';
    this.kind = 'writ';
    this.addressee = 'notary';
    this.blocks = [this.emptyBlock('body', 'Текст', '', 12, 12)];
    this.claimId = null;
    this.docId = null;
    this.pane.set('layout');
    this.pdfUrl.set(null);
  }

  protected insert(token: string): void {
    const block = this.blocks.find((item) => item.key === this.selectedKey) || this.blocks.find((item) => item.key === 'body') || this.blocks[0];
    if (block) block.text = `${block.text}{${token}}`;
  }

  protected chosen(): PrintFormBlock | undefined {
    return this.blocks.find((block) => block.key === this.selectedKey && block.enabled) || this.blocks.find((block) => block.enabled);
  }

  protected focusBlock(block: PrintFormBlock): void {
    this.selectedKey = block.key;
  }

  protected gridOf(block: PrintFormBlock): string {
    const parts = block.columns.map((col) => `${Math.max(col.width, 8)}fr`);
    return parts.join(' ') || '1fr';
  }

  protected dragStart(event: PointerEvent, block: PrintFormBlock, mode: 'move' | 'resize'): void {
    event.stopPropagation();
    this.selectedKey = block.key;
    this.drag = { key: block.key, mode, x: event.clientX, y: event.clientY, originX: block.x, originY: block.y, originW: block.w };
  }

  protected dragMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    const block = this.blocks.find((item) => item.key === drag.key);
    const sheet = event.currentTarget as HTMLElement;
    if (!block || !sheet) return;
    if (drag.mode === 'move') {
      block.x = clamp(drag.originX + (event.clientX - drag.x) / sheet.clientWidth * 100, 0, 70);
      block.y = clamp(drag.originY + (event.clientY - drag.y), 0, 1600);
    } else {
      block.w = clamp(drag.originW + (event.clientX - drag.x) / sheet.clientWidth * 100, 24, 100);
    }
  }

  protected dragEnd(): void {
    this.drag = null;
  }

  @HostListener('document:pointerup')
  protected releaseDrag(): void {
    this.drag = null;
  }

  protected addColumn(block: PrintFormBlock): void {
    block.columns = [...block.columns, { title: `Колонка ${block.columns.length + 1}`, width: 20 }];
    block.rows = block.rows.map((row) => [...row, '']);
    if (!block.rows.length) block.rows = [block.columns.map(() => '')];
  }

  protected addRow(block: PrintFormBlock): void {
    block.rows = [...block.rows, block.columns.map(() => '')];
  }

  protected onScan(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.api.recognizePrintForm(file).subscribe({
      next: (draft) => {
        this.blocks = draft.blocks.length ? draft.blocks.map((block, index) => ({
          ...block, columns: block.columns || [], rows: block.rows || [],
          x: block.x ?? 4, y: block.y ?? 12 + index * 96, w: block.w ?? 92,
        })) : [this.emptyBlock('body', 'Текст')];
        if (!this.name.trim()) this.name = draft.name;
        if (!this.code.trim()) this.code = 'scan-' + Date.now().toString().slice(-6);
        this.note.set(draft.note);
        this.pane.set('layout');
        this.snack.open(draft.recognized ? 'Скан разобран в макет' : 'Скан загружен как черновик', 'OK', { duration: 3000 });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected save(): void {
    const body = this.blocks.find((block) => block.key === 'body')?.text || '';
    if (!this.code.trim() || !this.name.trim()) {
      this.snack.open('Укажите код и название', 'OK');
      return;
    }
    const current = this.current();
    this.api.savePrintForm({
      id: current?.id, code: this.code.trim(), name: this.name.trim(), doc_kind: this.kind,
      addressee: this.addressee, body, blocks: this.blocks, font_size: 12, indent_mm: 0, outdent_mm: 0,
      block_order: this.blocks.filter((block) => block.enabled).map((block) => block.key),
    }).subscribe({
      next: (saved) => {
        this.snack.open('Шаблон сохранён', 'OK', { duration: 2000 });
        this.reload(saved.id);
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected saveCase(): void {
    if (!this.claimId || !this.docId) return;
    const body = this.blocks.find((block) => block.key === 'body')?.text || '';
    this.api.claimAction(this.claimId, `package/documents/${this.docId}/layout`, { body, blocks: this.blocks }).subscribe({
      next: () => this.snack.open('Документ дела сохранён. Подпись пакета снята.', 'OK', { duration: 2500 }),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected restore(version: number): void {
    const form = this.current();
    if (!form) return;
    this.api.restorePrintForm(form.id, version).subscribe({
      next: (saved) => this.reload(saved.id),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected showPdf(): void {
    this.pane.set('pdf');
    const body = this.blocks.find((block) => block.key === 'body')?.text || '';
    this.api.previewPrintForm({ blocks: this.blocks, body }).subscribe({
      next: (blob) => {
        this.revoke();
        this.rawUrl = URL.createObjectURL(blob);
        this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.rawUrl));
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private reload(selectId?: number): void {
    this.api.printForms().subscribe({
      next: (page) => {
        this.forms.set(page.results);
        const wanted = selectId || this.requestedForm || this.current()?.id;
        const picked = page.results.find((item) => item.id === wanted);
        if (picked) this.select(picked);
        else if (this.requestedForm) this.note.set('Шаблон не найден');
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private fillClaim(): void {
    if (!this.claimId) return;
    this.api.claim(this.claimId).subscribe({
      next: (claim) => {
        const saved = claim.package?.documents.find((doc) => doc.id === this.docId)?.layout?.blocks;
        if (saved?.length) this.blocks = saved.map((block, index) => ({
          ...block,
          columns: [...(block.columns || [])],
          rows: (block.rows || []).map((row) => [...row]),
          x: block.x ?? 4,
          y: block.y ?? 12 + index * 96,
          w: block.w ?? 92,
        }));
        else this.blocks = this.blocks.map((block) => ({ ...block, text: this.fillText(block.text, claim) }));
        if (this.pane() === 'pdf') this.showPdf();
      },
      error: () => this.note.set('Дело не найдено, макет открыт без подстановки'),
    });
  }

  private fillText(text: string, claim: ClaimCase): string {
    const map: Record<string, string> = {
      fio: claim.short_fio || '—',
      account: claim.client_account || '—',
      address: claim.account_address || '—',
      amount: claim.balance_out || '—',
      penalty: claim.penalty || '—',
      tariff: claim.notary_tariff || '—',
      warning_date: claim.warning_delivered_on || '—',
      debt_group: claim.debt_group == null ? '—' : String(claim.debt_group),
      rating: claim.rating || '—',
    };
    let next = text;
    for (const [key, value] of Object.entries(map)) next = next.replaceAll(`{${key}}`, value);
    return next;
  }

  private copyBlocks(form: PrintFormRow): PrintFormBlock[] {
    if (form.blocks?.length) {
      return form.blocks.map((block, index) => ({
        ...block,
        columns: (block.columns || []).map((col) => ({ ...col })),
        rows: (block.rows || []).map((row) => [...row]),
        x: block.x ?? 4,
        y: block.y ?? 12 + index * 96,
        w: block.w ?? 92,
      }));
    }
    const size = form.font_size || 12;
    const rows: PrintFormBlock[] = [this.emptyBlock('body', 'Текст', form.body, size, 160)];
    if (form.logo_text) rows.unshift(this.emptyBlock('logo', 'Логотип', form.logo_text, size, 12));
    if (form.requisites) rows.splice(1, 0, this.emptyBlock('requisites', 'Реквизиты', form.requisites, size, 80));
    if (form.signatory) rows.push(this.emptyBlock('signatory', 'Подпись', form.signatory, size, 420));
    return rows;
  }

  private emptyBlock(key: string, title: string, text = '', size = 12, y = 12): PrintFormBlock {
    return {
      key, title, enabled: true, align: 'left', bold: false, italic: false, font_size: size, text,
      columns: [], rows: [], x: 4, y, w: 92,
    };
  }

  private revoke(): void {
    if (this.rawUrl) URL.revokeObjectURL(this.rawUrl);
    this.rawUrl = '';
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Math.round(value)));
}
