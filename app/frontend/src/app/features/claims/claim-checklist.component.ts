import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ApiService, BnpDocument, ClaimCase, ClaimPackage, PrintFormRow, errorMessage } from '../../core/api.service';

interface Slot {
  code: string;
  title: string;
  docType: string | null;
  formKind: string | null;
  mode: 'date' | 'tariff' | 'ais' | 'doc' | 'scan';
}

const SLOTS: Slot[] = [
  { code: 'warning', title: 'Предупреждение о задолженности', docType: 'other_document', formKind: 'warning', mode: 'date' },
  { code: 'ais', title: 'Расчёт задолженности из АИС', docType: 'debt_calculation', formKind: 'calculation', mode: 'ais' },
  { code: 'tariff', title: 'Нотариальный тариф', docType: null, formKind: null, mode: 'tariff' },
  { code: 'application', title: 'Заявление на исполнительную надпись', docType: 'application', formKind: 'writ', mode: 'doc' },
  { code: 'calc-file', title: 'Файл расчёта с карточки', docType: 'debt_calculation', formKind: null, mode: 'doc' },
  { code: 'proxy', title: 'Доверенность', docType: 'proxy', formKind: 'proxy', mode: 'doc' },
  { code: 'scan', title: 'Скан постановления или отказа', docType: 'other_document', formKind: null, mode: 'scan' },
];

@Component({
  selector: 'app-claim-checklist',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatSnackBarModule],
  template: `
    <h3>Комплект документов</h3>
    <p class="hint">
      Сборка PDF из шаблона выполняется в ПМ и в кабинет БНП не отправляется. ЭЦП ГосСУОК здесь не проверяется.
      Файл PDF не больше 15 МБ. Рядом с пунктом — состояние и действия.
    </p>
    <div class="split">
      <ul class="checks">
        @for (slot of slots; track slot.code) {
          <li [class.on]="selected() === slot.code" [class.done]="done(slot)">
            <button type="button" class="row" (click)="pick(slot.code)">
              <span class="box" [class.on]="done(slot)" aria-hidden="true"></span>
              <span class="title">{{ slot.title }}</span>
              <span class="state">{{ done(slot) ? 'есть' : 'нет' }}</span>
            </button>
            <span class="acts">
              @if (slot.formKind) {
                <button type="button" (click)="openTemplates(slot, $event)">Из шаблона</button>
              }
              @if (slot.docType && slot.mode !== 'date' && slot.mode !== 'ais') {
                <label>Загрузить<input type="file" accept="application/pdf,.pdf" (change)="onPdf(slot, $event)" /></label>
              }
              @if (slot.mode === 'ais') {
                <button type="button" (click)="openTemplates(slot, $event)">Создать документ</button>
              }
            </span>
          </li>
        }
      </ul>
      <div class="viewer">
        @if (active(); as slot) {
          <h4>{{ slot.title }}</h4>
          @if (slot.mode === 'date') {
            <p>{{ warningDate() ? 'Вручено ' + warningDate() : 'Даты вручения предупреждения нет. Без неё пакет нотариусу не уходит.' }}</p>
          }
          @if (slot.mode === 'tariff') {
            <p>{{ tariff() && +tariff() > 0 ? 'Тариф внесён: ' + tariff() : 'Нотариальный тариф ещё не указан. Его считает АИС, пока поле можно заполнить в деле.' }}</p>
          }
          @if (slot.mode === 'ais') {
            @for (debt of pack()?.debts || []; track debt.source) {
              <p>{{ debt.source === 'penalty' ? 'Пеня' : 'Исходящее сальдо' }}: {{ debt.amount }} {{ debt.currency }}</p>
            }
            @if (!(pack()?.debts || []).length) {
              <p>Суммы появятся после сохранения состава пакета. ПМ берёт их из АИС и не правит.</p>
            }
          }
          @if (templatesFor(); as forms) {
            @if (forms.length) {
              <div class="pick">
                <select [(ngModel)]="templateId">
                  @for (form of forms; track form.id) { <option [value]="form.id">{{ form.name }}</option> }
                </select>
                <button mat-stroked-button type="button" [disabled]="busy()" (click)="createFromTemplate()">Создать</button>
              </div>
            } @else if (picking()) {
              <p>Шаблона этого вида в конструкторе печатных форм нет.</p>
            }
          }
          @if (currentDoc(); as doc) {
            <p class="meta">{{ doc.file_name }} · {{ doc.generated ? 'собран в ПМ' : 'загружен' }} · {{ doc.has_signature ? doc.signature_name : 'файл ЭЦП не приложен' }}</p>
            @if (doc.body) {
              <textarea rows="12" [(ngModel)]="draft"></textarea>
              <div class="acts">
                <button mat-stroked-button type="button" [disabled]="busy()" (click)="saveText(doc)">Сохранить текст</button>
                <button mat-button type="button" (click)="download(doc, 'pdf')">Смотреть PDF</button>
              </div>
              <p class="hint">Сохранение заново собирает PDF. Приложенный файл ЭЦП снимается: подпись была к прежнему файлу.</p>
            } @else {
              <p>Текст загруженного PDF в редакторе не разбирается. Можно заменить файл или скачать его.</p>
              <button mat-button type="button" (click)="download(doc, 'pdf')">Смотреть PDF</button>
            }
            <div class="acts">
              <select [ngModel]="kindOf(doc)" (ngModelChange)="setKind(doc, $event)">
                <option value="p7s">.pdf.p7s</option>
                <option value="sgn">.pdf.sgn</option>
              </select>
              <label>ЭЦП <input type="file" accept=".p7s,.sgn,.pdf.p7s,.pdf.sgn" (change)="onSign(doc, $event)" /></label>
              @if (doc.has_signature) {
                <button mat-button type="button" (click)="download(doc, 'signature')">Скачать ЭЦП</button>
              }
              <button mat-button type="button" (click)="remove(doc)">Удалить</button>
            </div>
          } @else if (slot.mode === 'doc' || slot.mode === 'scan') {
            <p>Документа в комплекте нет. Создайте его из шаблона или загрузите PDF.</p>
          }
        } @else {
          <p>Выберите пункт слева, чтобы посмотреть документ или его состояние.</p>
        }
      </div>
    </div>
  `,
  styles: `
    h3, h4 { margin: 0 0 8px; color: var(--erip-primary-dark); }
    .hint, .meta { color: var(--erip-muted); font-size: 13px; }
    .split { display: grid; grid-template-columns: minmax(280px, 1fr) minmax(280px, 1fr); gap: 12px; margin-top: 8px; }
    .checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .checks li { border: 1px solid var(--erip-border); border-radius: 8px; background: #fff; padding: 6px 8px; }
    .checks li.on { border-color: var(--erip-primary); background: var(--erip-primary-soft); }
    .row {
      display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: transparent;
      text-align: left; font: inherit; cursor: pointer; padding: 2px 0;
    }
    .box {
      width: 16px; height: 16px; border: 1.5px solid #8aa0ad; border-radius: 3px; flex: 0 0 16px; background: #fff;
    }
    .box.on { background: var(--erip-success); border-color: var(--erip-success); box-shadow: inset 0 0 0 2px #fff; }
    .title { flex: 1; font-size: 14px; }
    .state { font-size: 12px; color: var(--erip-muted); }
    .acts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 4px; }
    .acts button, .acts label {
      border: 0; background: transparent; color: var(--erip-link); font: inherit; font-size: 12px; cursor: pointer; padding: 0;
    }
    .acts input[type="file"] { display: none; }
    .viewer { border: 1px solid var(--erip-border); border-radius: 8px; padding: 12px; background: #fff; min-height: 180px; }
    .viewer textarea, .viewer select, .pick select {
      width: 100%; box-sizing: border-box; font: inherit; border: 1px solid var(--erip-border); border-radius: 6px; padding: 8px;
    }
    .pick { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
    .pick select { width: auto; flex: 1; }
    @media (max-width: 900px) { .split { grid-template-columns: 1fr; } }
  `,
})
export class ClaimChecklistComponent implements OnInit {
  readonly claimId = input.required<number>();
  readonly pack = input<ClaimPackage | null>(null);
  readonly warningDate = input('');
  readonly tariff = input('');
  readonly changed = output<ClaimCase>();

  private readonly api = inject(ApiService);
  private readonly snack = inject(MatSnackBar);

  protected readonly slots = SLOTS;
  protected readonly selected = signal('application');
  protected readonly forms = signal<PrintFormRow[]>([]);
  protected readonly busy = signal(false);
  protected readonly picking = signal(false);
  protected templateId: number | null = null;
  protected draft = '';

  ngOnInit(): void {
    this.api.printForms().subscribe({
      next: (page) => this.forms.set(page.results),
      error: () => this.forms.set([]),
    });
  }

  protected active(): Slot | undefined {
    return this.slots.find((slot) => slot.code === this.selected());
  }

  protected done(slot: Slot): boolean {
    if (slot.mode === 'date') return !!this.warningDate();
    if (slot.mode === 'tariff') return Number(this.tariff()) > 0;
    if (slot.mode === 'ais') return (this.pack()?.debts || []).some((debt) => !!debt.amount);
    if (slot.mode === 'scan') return this.docs('other_document').some((doc) => !doc.generated);
    if (slot.code === 'calc-file') return this.docs('debt_calculation').some((doc) => !doc.generated);
    if (slot.code === 'ais') return this.docs('debt_calculation').some((doc) => doc.generated);
    return this.docs(slot.docType || '').length > 0;
  }

  protected currentDoc(): BnpDocument | null {
    return this.documentFor(this.selected());
  }

  private documentFor(code: string): BnpDocument | null {
    const slot = this.slots.find((item) => item.code === code);
    if (!slot?.docType) return null;
    const rows = this.docs(slot.docType);
    if (slot.mode === 'scan') return rows.find((doc) => !doc.generated) || null;
    if (slot.code === 'calc-file') return rows.find((doc) => !doc.generated) || null;
    if (slot.code === 'warning') return rows.find((doc) => doc.generated) || null;
    if (slot.code === 'ais') return rows.find((doc) => doc.generated) || rows[0] || null;
    return rows[0] || null;
  }

  protected pick(code: string): void {
    this.selected.set(code);
    this.picking.set(false);
    this.draft = this.documentFor(code)?.body || '';
  }

  protected templatesFor(): PrintFormRow[] | null {
    if (!this.picking()) return null;
    const slot = this.active();
    if (!slot?.formKind) return [];
    return this.forms().filter((form) => form.doc_kind === slot.formKind);
  }

  protected openTemplates(slot: Slot, event: Event): void {
    event.stopPropagation();
    this.selected.set(slot.code);
    this.picking.set(true);
    const forms = this.forms().filter((form) => form.doc_kind === slot.formKind);
    this.templateId = forms[0]?.id ?? null;
  }

  protected createFromTemplate(): void {
    if (!this.templateId) return;
    this.busy.set(true);
    this.api.claimAction(this.claimId(), 'package/from-template', { form: this.templateId }).subscribe({
      next: (row) => {
        this.busy.set(false);
        this.picking.set(false);
        this.changed.emit(row);
        const type = this.active()?.docType;
        this.draft = row.package?.documents.find((doc) => doc.doc_type === type && doc.body)?.body || '';
        this.snack.open('Документ собран из шаблона. В кабинет БНП он не отправлен.', 'OK', { duration: 3000 });
      },
      error: (err) => this.fail(err),
    });
  }

  protected onPdf(slot: Slot, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !slot.docType) return;
    this.selected.set(slot.code);
    const existing = slot.mode === 'scan' || slot.code === 'calc-file' ? undefined : this.docs(slot.docType)[0]?.id;
    this.api.uploadClaimDocument(this.claimId(), slot.docType, file, null, 'p7s', existing).subscribe({
      next: (row) => {
        this.draft = '';
        this.changed.emit(row);
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected saveText(doc: BnpDocument): void {
    this.busy.set(true);
    this.api.claimAction(this.claimId(), `package/documents/${doc.id}/text`, { body: this.draft }).subscribe({
      next: (row) => {
        this.busy.set(false);
        this.changed.emit(row);
        this.snack.open('Текст сохранён, PDF собран заново', 'OK', { duration: 2500 });
      },
      error: (err) => this.fail(err),
    });
  }

  protected onSign(doc: BnpDocument, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.api.uploadClaimDocument(this.claimId(), doc.doc_type, null, file, this.kindOf(doc), doc.id).subscribe({
      next: (row) => this.changed.emit(row),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected setKind(doc: BnpDocument, kind: string): void {
    this.api.uploadClaimDocument(this.claimId(), doc.doc_type, null, null, kind, doc.id).subscribe({
      next: (row) => this.changed.emit(row),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected remove(doc: BnpDocument): void {
    this.api.deleteClaimDocument(this.claimId(), doc.id).subscribe({
      next: (row) => {
        this.draft = '';
        this.changed.emit(row);
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected download(doc: BnpDocument, kind: 'pdf' | 'signature'): void {
    this.api.claimPackageFile(this.claimId(), doc.id, kind).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = kind === 'pdf' ? doc.file_name : doc.signature_name;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected kindOf(doc: BnpDocument): string {
    return doc.signature_name.endsWith('.pdf.sgn') ? 'sgn' : 'p7s';
  }

  private docs(type: string): BnpDocument[] {
    return (this.pack()?.documents || []).filter((doc) => doc.doc_type === type);
  }

  private fail(err: unknown): void {
    this.busy.set(false);
    this.snack.open(errorMessage(err), 'OK');
  }
}
