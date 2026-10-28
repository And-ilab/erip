import { Component, OnDestroy, OnInit, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';

import { DateFieldComponent, HoldDraftDirective } from '../../core/date-field.component';
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

const COURT: Slot[] = [
  { code: 'lawsuit', title: 'Исковое заявление о взыскании', docType: 'lawsuit', formKind: 'lawsuit', mode: 'doc' },
  { code: 'eviction', title: 'Исковое заявление о выселении', docType: 'eviction', formKind: 'eviction', mode: 'doc' },
  { code: 'alienation', title: 'Исковое заявление об отчуждении', docType: 'alienation', formKind: 'alienation', mode: 'doc' },
];

@Component({
  selector: 'app-claim-checklist',
  host: { '[class.file-open]': '!!pdfUrl()' },
  standalone: true,
  imports: [
    FormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule,
    MatSnackBarModule, DateFieldComponent, HoldDraftDirective,
  ],
  template: `
    <div class="split" [attr.data-slot]="selected()">
      <ul class="checks">
        @for (slot of visibleSlots(); track slot.code) {
          <li [class.on]="selected() === slot.code" [class.done]="done(slot)" [class.need]="needed(slot) && !done(slot)">
            <button type="button" class="row" (click)="pick(slot.code)">
              <span class="box" [class.on]="done(slot)" aria-hidden="true"></span>
              <span class="title" [attr.title]="slot.title">{{ slot.title }}</span>
              <span class="state">{{ done(slot) ? 'есть' : 'нет' }}</span>
            </button>
          </li>
        }
      </ul>
      <div class="viewer">
        @if (active(); as slot) {
          <div class="head">
            <h4 [attr.title]="slot.title">{{ slot.title }}</h4>
            @if (formsOf(slot).length) {
              <button mat-stroked-button type="button" class="create" [disabled]="busy()" (click)="createFromTemplate(slot)">Создать</button>
            }
            @if (slot.docType && slot.mode !== 'date' && slot.mode !== 'ais') {
              <label class="upload">Загрузить PDF<input type="file" accept="application/pdf,.pdf" (change)="onPdf(slot, $event)" /></label>
            }
          </div>
          @if (scope() === 'court') { <ng-content /> }
          @if (scope() !== 'court') {
            <div [hidden]="slot.mode !== 'date'">
              <app-date-field label="Дата вручения предупреждения" [required]="true" [value]="warningDate()" (valueChange)="warningDateChange.emit($event)" />
            </div>
            <div [hidden]="slot.mode !== 'tariff'">
              <mat-form-field [class.need]="!(tariff() && +tariff() > 0)" subscriptSizing="dynamic">
                <mat-label>Нотариальный тариф *</mat-label>
                <input matInput holdDraft [ngModel]="tariff()" (ngModelChange)="emitTariff($event)" />
              </mat-form-field>
              <mat-checkbox holdDraft [ngModel]="withdrawn()" (ngModelChange)="emitWithdrawn($event)">Заявление отозвано</mat-checkbox>
              <p class="meta">Тариф считает АИС. Отзыв заявления обнуляет тариф при сохранении дела.</p>
            </div>
          }
          @if (slot.mode === 'ais') {
            @for (debt of pack()?.debts || []; track $index) {
              <p>{{ debt.source === 'penalty' ? 'Пеня' : 'Сумма основного долга' }}: {{ debt.amount }} {{ debt.currency }}</p>
            }
            @if (!(pack()?.debts || []).length) {
              <p>Сумм из АИС на деле пока нет. ПМ их не вводит.</p>
            }
          }
          @if (formsOf(slot).length > 1) {
            <select class="template" [(ngModel)]="templateId">
              @for (form of formsOf(slot); track form.id) { <option [value]="form.id">{{ form.name }}</option> }
            </select>
          } @else if (formsOf(slot).length === 1) {
            <p class="doc-name" [attr.title]="formsOf(slot)[0].name">{{ formsOf(slot)[0].name }}</p>
          }
          @if (currentDoc(); as doc) {
            <p class="meta" [attr.title]="doc.file_name">{{ doc.file_name }} · {{ doc.generated ? 'собран в ПМ' : 'загружен' }}</p>
            <div class="acts">
              <button type="button" (click)="viewPdf(doc)">Просмотреть</button>
              <button type="button" (click)="openEditor(doc)">Открыть в редакторе печатных форм</button>
              <button type="button" (click)="remove(doc)">Удалить</button>
            </div>
            @if (pdfUrl(); as url) {
              <iframe class="sheet" title="Просмотр PDF" [src]="url"></iframe>
            }
          } @else if (slot.mode === 'doc' || slot.mode === 'scan') {
            <p class="empty">Документа в комплекте нет. Создайте его из шаблона или загрузите PDF.</p>
          }
        } @else {
          <p>Выберите пункт слева, чтобы посмотреть документ или его состояние.</p>
        }
      </div>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; max-width: 100%; }
    .upload {
      border: 0; background: transparent; color: var(--erip-link); font: inherit; font-size: 13px; cursor: pointer;
    }
    .upload input { display: none; }
    h3, h4 { margin: 0 0 8px; color: var(--erip-primary-dark); }
    .hint, .meta, .empty, .doc-name { overflow-wrap: break-word; }
    .hint, .meta { color: var(--erip-muted); font-size: 13px; }
    .empty, .doc-name, .viewer p { margin: 0; }
    .split {
      display: grid; grid-template-columns: minmax(220px, 300px) minmax(0, 1fr); gap: 12px;
      flex: 1; min-height: 0; min-width: 0; align-items: stretch;
    }
    .checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; min-width: 0; overflow: auto; }
    .checks li {
      border: 1px solid var(--erip-border); border-radius: 8px; background: #fff; padding: 6px 8px;
      display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; min-width: 0;
    }
    .checks li.on { border-color: var(--erip-primary); background: var(--erip-primary-soft); }
    .checks li.need { border-color: #c62828; }
    .need { color: #c62828; }
    .sheet { width: 100%; height: min(420px, 46vh); border: 1px solid #d4d4d4; border-radius: 4px; background: #e6e6e6; }
    :host.file-open { flex: none; min-height: auto; --sheet-max-height: none; --sheet-min-height: 520px; --sheet-height: min(780px, 70vh); }
    :host.file-open .split { flex: none; min-height: auto; align-items: start; }
    :host.file-open .viewer { overflow: visible; min-height: auto; }
    :host.file-open .checks { overflow: visible; }
    :host.file-open .sheet { height: min(780px, 70vh); min-height: 520px; }
    .row {
      display: grid; grid-template-columns: 16px minmax(0, 1fr) 2.75rem; align-items: center; column-gap: 8px;
      width: 100%; min-width: 0; border: 0; background: transparent; text-align: left; font: inherit; cursor: pointer; padding: 2px 0;
    }
    .box {
      width: 16px; height: 16px; border: 1.5px solid #8aa0ad; border-radius: 3px; background: #fff;
    }
    .box.on { background: var(--erip-success); border-color: var(--erip-success); box-shadow: inset 0 0 0 2px #fff; }
    .title { min-width: 0; font-size: 14px; overflow-wrap: break-word; line-height: 1.3; }
    .state { font-size: 12px; color: var(--erip-muted); text-align: right; white-space: nowrap; }
    .checks .acts {
      display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; min-width: 0; margin: 0 0 2px 24px;
    }
    .viewer .acts { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; min-width: 0; max-width: 100%; }
    .acts button, .acts label {
      border: 0; background: transparent; color: var(--erip-link); font: inherit; font-size: 12px; cursor: pointer; padding: 0;
      white-space: nowrap;
    }
    .acts input[type="file"] { display: none; }
    .viewer {
      border: 1px solid var(--erip-border); border-radius: 8px; padding: 12px; background: #fff;
      min-width: 0; max-width: 100%; min-height: 0; box-sizing: border-box; overflow: auto;
      display: flex; flex-direction: column; align-items: stretch; gap: 8px;
    }
    .viewer > button { align-self: flex-start; }
    .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; max-width: 100%; }
    .head h4 { margin: 0; flex: 1 1 auto; min-width: min(100%, max-content); overflow-wrap: break-word; }
    .create { flex: 0 0 auto; }
    .doc-name { font-size: 14px; line-height: 1.35; }
    .template, .viewer .acts select {
      box-sizing: border-box; font: inherit; border: 1px solid var(--erip-border); border-radius: 6px; padding: 8px; max-width: 100%;
    }
    .template { display: block; width: 100%; min-width: 0; }
    .viewer .acts select { width: auto; }
    @media (max-width: 900px) { .split { grid-template-columns: minmax(0, 1fr); overflow: auto; } }
  `,
})
export class ClaimChecklistComponent implements OnInit, OnDestroy {
  readonly claimId = input.required<number>();
  readonly pack = input<ClaimPackage | null>(null);
  readonly warningDate = input('');
  readonly tariff = input('');
  readonly withdrawn = input(false);
  readonly scope = input<'notary' | 'court'>('notary');
  readonly lawsuitKind = input('');
  readonly focus = input('');
  readonly changed = output<ClaimCase>();
  readonly warningDateChange = output<string>();
  readonly tariffChange = output<string>();
  readonly withdrawnChange = output<boolean>();

  private readonly api = inject(ApiService);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly slots = SLOTS;
  protected readonly selected = signal('application');
  protected readonly forms = signal<PrintFormRow[]>([]);
  protected readonly busy = signal(false);
  protected readonly pdfUrl = signal<SafeResourceUrl | null>(null);
  protected templateId: number | null = null;
  private rawUrl = '';
  private lastKind = '';
  private lastFocus = '';
  private alive = true;

  constructor() {
    effect(() => {
      const slots = this.visibleSlots();
      const kind = this.lawsuitKind();
      const focus = this.focus();
      const prefer = this.courtSlot(kind);
      const current = this.selected();
      if (focus && focus !== this.lastFocus && slots.some((slot) => slot.code === focus)) {
        this.lastFocus = focus;
        this.pick(focus);
        return;
      }
      this.lastFocus = focus;
      if (this.scope() === 'court' && kind !== this.lastKind && prefer && slots.some((slot) => slot.code === prefer)) {
        this.lastKind = kind;
        this.pick(prefer);
        return;
      }
      this.lastKind = kind;
      if (!slots.some((slot) => slot.code === current)) {
        this.selected.set(prefer || slots[0]?.code || '');
      }
    }, { allowSignalWrites: true });
  }

  private keepSelection(): void {
    const slots = this.visibleSlots();
    if (slots.some((slot) => slot.code === this.selected())) return;
    const prefer = this.scope() === 'court' ? (this.courtSlot(this.lawsuitKind()) || 'lawsuit') : 'application';
    this.selected.set(slots.some((slot) => slot.code === prefer) ? prefer : (slots[0]?.code || ''));
  }

  ngOnInit(): void {
    this.keepSelection();
    this.api.printForms().subscribe({
      next: (page) => this.forms.set(page.results),
      error: () => this.forms.set([]),
    });
  }

  ngOnDestroy(): void {
    this.alive = false;
    this.revoke();
  }

  /** Снятие пункта с экрана не должно присылать пустой тариф. */
  protected emitTariff(value: string | null): void {
    const next = value ?? '';
    queueMicrotask(() => {
      if (!this.alive) return;
      this.tariffChange.emit(next);
    });
  }

  protected emitWithdrawn(value: boolean): void {
    queueMicrotask(() => {
      if (!this.alive) return;
      this.withdrawnChange.emit(!!value);
    });
  }

  protected visibleSlots(): Slot[] {
    return this.scope() === 'court' ? COURT : this.slots;
  }

  protected needed(slot: Slot): boolean {
    if (this.scope() === 'court') return slot.code === this.courtSlot(this.lawsuitKind());
    return ['warning', 'tariff', 'application', 'ais', 'proxy'].includes(slot.code);
  }

  private courtSlot(kind: string): string {
    if (kind === 'collection') return 'lawsuit';
    if (kind.startsWith('eviction')) return 'eviction';
    if (kind.startsWith('alienation')) return 'alienation';
    return '';
  }

  protected active(): Slot | undefined {
    return this.slotBy(this.selected());
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
    const slot = this.slotBy(code);
    if (!slot?.docType) return null;
    const rows = this.docs(slot.docType);
    if (slot.mode === 'scan') return rows.find((doc) => !doc.generated) || null;
    if (slot.code === 'calc-file') return rows.find((doc) => !doc.generated) || null;
    if (slot.code === 'warning') return rows.find((doc) => doc.generated) || null;
    if (slot.code === 'ais') return rows.find((doc) => doc.generated) || null;
    return rows[0] || null;
  }

  protected pick(code: string): void {
    this.selected.set(code);
    this.pdfUrl.set(null);
    const forms = this.formsOf(this.slotBy(code));
    if (!forms.some((form) => form.id === Number(this.templateId))) this.templateId = forms[0]?.id ?? null;
  }

  protected formsOf(slot: Slot | undefined): PrintFormRow[] {
    if (!slot?.formKind) return [];
    return this.forms().filter((form) => form.doc_kind === slot.formKind);
  }

  protected createFromTemplate(slot: Slot): void {
    const forms = this.formsOf(slot);
    const formId = Number(this.templateId) || forms[0]?.id;
    if (!formId) return;
    this.busy.set(true);
    this.api.claimAction(this.claimId(), 'package/from-template', { form: formId }).subscribe({
      next: (row) => {
        this.busy.set(false);
        this.changed.emit(row);
        const doc = row.package?.documents.find((item) => item.doc_type === slot.docType) || null;
        this.openEditor(doc, formId);
      },
      error: (err) => this.fail(err),
    });
  }

  protected openEditor(doc: BnpDocument | null, formId?: number | null): void {
    const slot = this.active();
    const forms = this.formsOf(slot);
    const resolvedForm = formId
      || Number(doc?.layout?.form || 0)
      || Number(this.templateId || 0)
      || forms[0]?.id
      || null;
    this.router.navigate(['/settings/work/forms'], {
      queryParams: {
        claim: this.claimId(),
        doc: doc?.id || null,
        form: resolvedForm,
        pane: 'layout',
      },
    });
  }

  protected viewPdf(doc: BnpDocument): void {
    this.api.claimPackageFile(this.claimId(), doc.id, 'pdf', true).subscribe({
      next: (blob) => {
        this.revoke();
        this.rawUrl = URL.createObjectURL(blob);
        this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.rawUrl));
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected onPdf(slot: Slot, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !slot.docType) return;
    this.selected.set(slot.code);
    const existing = slot.mode === 'scan' || slot.code === 'calc-file'
      ? this.documentFor(slot.code)?.id
      : this.docs(slot.docType)[0]?.id;
    this.api.uploadClaimDocument(this.claimId(), slot.docType, file, null, 'p7s', existing).subscribe({
      next: (row) => this.changed.emit(row),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected remove(doc: BnpDocument): void {
    this.api.deleteClaimDocument(this.claimId(), doc.id).subscribe({
      next: (row) => this.changed.emit(row),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private slotBy(code: string): Slot | undefined {
    return [...SLOTS, ...COURT].find((slot) => slot.code === code);
  }

  private docs(type: string): BnpDocument[] {
    return (this.pack()?.documents || []).filter((doc) => doc.doc_type === type);
  }

  private fail(err: unknown): void {
    this.busy.set(false);
    this.snack.open(errorMessage(err), 'OK');
  }

  private revoke(): void {
    if (this.rawUrl) URL.revokeObjectURL(this.rawUrl);
    this.rawUrl = '';
  }
}
