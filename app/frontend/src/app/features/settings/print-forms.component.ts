import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';

import { ApiService, ClaimCase, PrintFormRow, errorMessage } from '../../core/api.service';
import { KNOWN_TOKENS, SheetBlock, SheetEditor, normalizeBlock } from './document-flow';
import { PrintSheetComponent } from './print-sheet.component';

@Component({
  selector: 'app-print-forms',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, MatButtonModule, MatSnackBarModule, PrintSheetComponent],
  template: `
    <header class="head">
      <div>
        <h2>Конструктор печатных форм</h2>
        <p>Лист A4, как в просмотре PDF. Поле счёта на листе — подчёркнутая строка, таблица — с рамкой. Скачанный PDF повторяет этот лист.</p>
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
          <button type="button" (click)="stepForm(-1)">← Назад</button>
          <button type="button" (click)="stepForm(1)">Вперёд →</button>
          @if (pane() === 'pdf' && pdfReady()) {
            <button type="button" (click)="downloadPdf()">Скачать PDF</button>
          }
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
          <p class="muted">Значение в поле нужно для просмотра и для документа дела. В шаблоне остаётся метка счёта, на листе она не пишется. Блоки меняются местами стрелками.</p>
          <div class="work">
            <aside class="blocks">
              <h3>Блоки</h3>
              @for (block of orderedBlocks(); track block.key) {
                <div class="check-row">
                  <label class="check" [class.need]="block.key === 'body' && bodyBlank()">
                    <input type="checkbox" [(ngModel)]="block.enabled" /> {{ block.title }}
                  </label>
                  <button type="button" (click)="moveBlock(block, -1)" [attr.aria-label]="'Выше'">↑</button>
                  <button type="button" (click)="moveBlock(block, 1)" [attr.aria-label]="'Ниже'">↓</button>
                </div>
              }
              <div class="tokens">
                @for (token of tokens; track token) {
                  <button type="button" (click)="insert(token)">{{ labelOf(token) }}</button>
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
                  @if (!block.columns.length) { <button type="button" (click)="addServiceTable(block)">Таблица услуг</button> }
                </div>
              }
              <app-print-sheet
                [blocks]="blocks"
                [flows]="editor.flows"
                [form]="editor.form"
                [selectedKey]="selectedKey"
                (pick)="focusBlock($event)" />
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
          <h3 class="preview-title">Предпросмотр</h3>
          <p class="doc-title">{{ name || current()?.name || 'Документ' }}</p>
          @if (pdfReady()) { <p class="ok">Предпросмотр PDF обновлён</p> }
          @if (pdfUrl(); as url) {
            <iframe class="pdf-frame" title="Предпросмотр PDF" [src]="url"></iframe>
          } @else {
            <p class="muted">Предпросмотр появится здесь.</p>
          }
        }
      </section>
    </div>
  `,
  styles: `
    .head, .line, .actions, .panes { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .head { justify-content: space-between; margin-bottom: 12px; }
    h2, h3 { margin: 0; color: var(--erip-primary-dark); }
    h3 { margin: 12px 0 6px; font-size: 13px; }
    .muted, .head p, .note { color: var(--erip-muted); margin: 4px 0 0; font-size: 13px; }
    .note { background: #fff8e8; border: 1px solid #e0a106; border-radius: 8px; padding: 8px 10px; }
    .layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 16px; }
    .list, .editor { background: #fff; border: 1px solid var(--erip-border); border-radius: 12px; padding: 12px; min-width: 0; }
    .list { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
    .list button, .panes button {
      text-align: left; border: 1px solid var(--erip-border); background: #fff; border-radius: 8px;
      padding: 8px 10px; cursor: pointer; font: inherit;
    }
    .list button.on, .panes button.on { border-color: var(--erip-primary); background: var(--erip-primary-soft); }
    .list small { display: block; color: var(--erip-muted); }
    .grow { flex: 1; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--erip-muted); }
    input, select { font: inherit; color: inherit; border: 1px solid var(--erip-border); border-radius: 6px; padding: 6px 8px; }
    .check { flex-direction: row; align-items: center; color: inherit; font-size: 14px; }
    .check-row { display: flex; gap: 4px; align-items: center; }
    .check-row .check { flex: 1; }
    .check-row button {
      border: 1px solid var(--erip-border); background: #fff; border-radius: 6px; cursor: pointer; font: inherit; padding: 2px 6px;
    }
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
    .sheet-wrap { min-width: 0; }
    .preview-title { margin: 12px 0 2px; font-size: 16px; color: #1f2933; }
    .doc-title { margin: 0 0 8px; color: var(--erip-muted); }
    .ok { margin: 0 0 8px; padding: 8px 12px; border-radius: 6px; background: #e7f6ec; color: #1b7f4e; }
    .pdf-frame { width: 100%; height: min(80vh, 900px); border: 0; background: #525659; }
    @media (max-width: 900px) { .layout, .work { grid-template-columns: 1fr; } }
  `,
})
export class PrintFormsComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly snack = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly fb = inject(FormBuilder);

  protected readonly editor = new SheetEditor(this.fb);
  protected readonly forms = signal<PrintFormRow[]>([]);
  protected readonly current = signal<PrintFormRow | null>(null);
  protected readonly pane = signal<'layout' | 'pdf'>('layout');
  protected readonly pdfUrl = signal<SafeResourceUrl | null>(null);
  protected readonly pdfReady = signal(false);
  protected readonly note = signal('');
  protected readonly tokens = KNOWN_TOKENS;
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
  protected blocks: SheetBlock[] = [];
  protected selectedKey = 'body';
  protected claimId: number | null = null;
  protected docId: number | null = null;
  private requestedForm: number | null = null;
  private rawUrl = '';

  protected systemForms(): PrintFormRow[] {
    return this.forms().filter((form) => form.organization == null);
  }

  protected ownForms(): PrintFormRow[] {
    return this.forms().filter((form) => form.organization != null);
  }

  protected orderedBlocks(): SheetBlock[] {
    return [...this.blocks].sort((a, b) => a.y - b.y);
  }

  protected bodyBlank(): boolean {
    const flow = this.editor.flows.find((item) => item.key === 'body');
    if (!flow) return true;
    for (const node of flow.nodes) {
      if (node.kind === 'title' && this.pieceText(node.control)) return false;
      if (node.kind === 'fields' && node.items.length) return false;
      if (node.kind === 'paragraph') {
        for (const part of node.parts) {
          if (part.kind === 'field') return false;
          if (part.kind === 'text' && this.pieceText(part.control)) return false;
        }
      }
    }
    return !this.blocks.find((block) => block.key === 'body')?.columns.length;
  }

  private pieceText(name: string): string {
    return String(this.editor.form.get(['pieces', name])?.value || '').trim();
  }

  protected labelOf(token: string): string {
    const names: Record<string, string> = {
      fio: 'Должник', account: 'Лицевой счёт', amount: 'Задолженность', penalty: 'Пеня', address: 'Адрес',
      services: 'Услуги', last_payment: 'Оплата', organization: 'Организация', due_days: 'Срок',
      tariff: 'Тариф', debt_group: 'Группа', rating: 'Рейтинг', months_debt: 'Месяцы',
      personal_id: 'Идентификационный номер', unp: 'УНП', warning_date: 'Вручение', debt_started: 'Начало долга',
    };
    return names[token] || token;
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
    this.selectedKey = 'body';
    this.pdfUrl.set(null);
    this.pdfReady.set(false);
    if (this.claimId) this.fillClaim();
    else this.openSheet();
  }

  protected create(): void {
    this.current.set(null);
    this.code = '';
    this.name = '';
    this.kind = 'writ';
    this.addressee = 'notary';
    this.blocks = [normalizeBlock({ key: 'body', title: 'Текст', text: '', enabled: true }, 0)];
    this.selectedKey = 'body';
    this.claimId = null;
    this.docId = null;
    this.pane.set('layout');
    this.pdfUrl.set(null);
    this.pdfReady.set(false);
    this.openSheet();
  }

  protected insert(token: string): void {
    const keep = this.currentValues();
    this.editor.commit(this.blocks, 'template');
    const block = this.blocks.find((item) => item.key === this.selectedKey) || this.blocks.find((item) => item.key === 'body');
    if (!block) return;
    const glue = block.text && !block.text.endsWith('\n') ? '\n' : '';
    block.text = `${block.text}${glue}{${token}}`;
    this.reopen(keep);
  }

  protected chosen(): SheetBlock | undefined {
    return this.blocks.find((block) => block.key === this.selectedKey && block.enabled) || this.blocks.find((block) => block.enabled);
  }

  protected focusBlock(key: string): void {
    this.selectedKey = key;
  }

  protected moveBlock(block: SheetBlock, delta: number): void {
    const keep = this.currentValues();
    this.editor.commit(this.blocks, 'template');
    const ordered = this.orderedBlocks();
    const index = ordered.findIndex((item) => item.key === block.key);
    const other = ordered[index + delta];
    if (!other) return;
    const y = block.y;
    block.y = other.y;
    other.y = y === other.y ? y + delta * 10 : y;
    this.reopen(keep);
  }

  protected addColumn(block: SheetBlock): void {
    const keep = this.currentValues();
    this.editor.commit(this.blocks, 'template');
    block.columns = [...block.columns, { title: `Колонка ${block.columns.length + 1}`, width: 20 }];
    block.rows = block.rows.map((row) => [...row, '']);
    if (!block.rows.length) block.rows = [block.columns.map(() => '')];
    this.reopen(keep);
  }

  protected addRow(block: SheetBlock): void {
    const keep = this.currentValues();
    this.editor.commit(this.blocks, 'template');
    block.rows = [...block.rows, block.columns.map(() => '')];
    this.reopen(keep);
  }

  protected addServiceTable(block: SheetBlock): void {
    const keep = this.currentValues();
    this.editor.commit(this.blocks, 'template');
    block.columns = [
      { title: 'Услуга', width: 40 },
      { title: 'Задолженность', width: 30 },
      { title: 'Пеня', width: 30 },
    ];
    block.rows = [['{services}', '{amount}', '{penalty}']];
    this.reopen(keep);
  }

  protected onScan(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.api.recognizePrintForm(file).subscribe({
      next: (draft) => {
        this.blocks = draft.blocks.length
          ? draft.blocks.map((block, index) => normalizeBlock(block, index))
          : [normalizeBlock({ key: 'body', title: 'Текст', text: '', enabled: true }, 0)];
        if (!this.name.trim()) this.name = draft.name;
        if (!this.code.trim()) this.code = 'scan-' + Date.now().toString().slice(-6);
        this.note.set(draft.note);
        this.pane.set('layout');
        this.openSheet();
        this.snack.open(draft.recognized ? 'Скан разобран в макет' : 'Скан загружен как черновик', 'OK', { duration: 3000 });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected save(): void {
    this.editor.commit(this.blocks, 'template');
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
    const blocks = this.previewBlocks();
    const body = blocks.find((block) => block.key === 'body')?.text || '';
    this.api.claimAction(this.claimId, `package/documents/${this.docId}/layout`, { body, blocks }).subscribe({
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

  protected stepForm(delta: number): void {
    const rows = [...this.systemForms(), ...this.ownForms()];
    const index = rows.findIndex((form) => form.id === this.current()?.id);
    const next = rows[index + delta];
    if (next) this.select(next);
  }

  protected showPdf(): void {
    this.pane.set('pdf');
    this.pdfReady.set(false);
    const blocks = this.previewBlocks();
    const body = blocks.find((block) => block.key === 'body')?.text || '';
    this.api.previewPrintForm({ blocks, body }).subscribe({
      next: (blob) => {
        blob.slice(0, 5).arrayBuffer().then((head) => {
          const magic = String.fromCharCode(...new Uint8Array(head));
          const file = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
          this.revoke();
          this.rawUrl = URL.createObjectURL(file);
          this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.rawUrl));
          this.pdfReady.set(magic.startsWith('%PDF'));
        });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected downloadPdf(): void {
    if (!this.rawUrl) return;
    const link = document.createElement('a');
    link.href = this.rawUrl;
    link.download = `${(this.code || 'document').trim() || 'document'}.pdf`;
    link.click();
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
        if (saved?.length) this.blocks = saved.map((block, index) => normalizeBlock(block, index));
        this.openSheet(claim);
      },
      error: () => {
        this.note.set('Дело не найдено, макет открыт без подстановки');
        this.openSheet();
      },
    });
  }

  private openSheet(claim?: ClaimCase): void {
    this.editor.load(this.blocks);
    if (claim) this.editor.fillEmpty(this.claimValues(claim));
    if (this.pane() === 'pdf') this.showPdf();
  }

  private reopen(keep: Record<string, string>): void {
    this.editor.load(this.blocks);
    this.editor.fillEmpty(keep);
  }

  private currentValues(): Record<string, string> {
    return { ...(this.editor.form.get('values')?.getRawValue() as Record<string, string> | undefined) };
  }

  private previewBlocks(): SheetBlock[] {
    const copy = this.blocks.map((block) => ({
      ...block,
      columns: block.columns.map((col) => ({ ...col })),
      rows: block.rows.map((row) => [...row]),
    }));
    this.editor.commit(copy, 'filled');
    return copy;
  }

  private claimValues(claim: ClaimCase): Record<string, string> {
    const clean = (value: string | null | undefined) => (!value || value === '—') ? '' : value;
    return {
      fio: clean(claim.short_fio),
      account: clean(claim.client_account),
      address: clean(claim.account_address),
      amount: clean(claim.balance_out),
      penalty: clean(claim.penalty),
      tariff: clean(claim.notary_tariff),
      warning_date: clean(claim.warning_delivered_on),
      debt_group: claim.debt_group == null ? '' : String(claim.debt_group),
      rating: clean(claim.rating),
    };
  }

  private copyBlocks(form: PrintFormRow): SheetBlock[] {
    if (form.blocks?.length) return form.blocks.map((block, index) => normalizeBlock(block, index));
    const size = form.font_size || 12;
    const rows: SheetBlock[] = [normalizeBlock({ key: 'body', title: 'Текст', text: form.body, font_size: size, y: 160 }, 2)];
    if (form.logo_text) rows.unshift(normalizeBlock({ key: 'logo', title: 'Логотип', text: form.logo_text, font_size: size, y: 12 }, 0));
    if (form.requisites) rows.splice(1, 0, normalizeBlock({ key: 'requisites', title: 'Реквизиты', text: form.requisites, font_size: size, y: 80 }, 1));
    if (form.signatory) rows.push(normalizeBlock({ key: 'signatory', title: 'Подпись', text: form.signatory, font_size: size, y: 420 }, 3));
    return rows;
  }

  private revoke(): void {
    if (this.rawUrl) URL.revokeObjectURL(this.rawUrl);
    this.rawUrl = '';
  }
}
