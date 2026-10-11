import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ApiService, PrintFormRow, errorMessage } from '../../core/api.service';

const TOKENS = [
  'fio', 'account', 'amount', 'penalty', 'address', 'services', 'last_payment', 'organization',
  'due_days', 'tariff', 'debt_group', 'rating', 'months_debt', 'personal_id', 'unp', 'warning_date', 'debt_started',
];

const SAMPLE: Record<string, string> = {
  fio: 'Иванов И.И.',
  account: '00001001',
  amount: '150.00',
  penalty: '12.50',
  address: 'ул. Примерная, д. 1',
  services: 'Газ, вода',
  last_payment: '2026-03-01',
  organization: 'Организация',
  due_days: '5',
  tariff: '48.00',
  debt_group: '3',
  rating: 'B',
  months_debt: '4',
  personal_id: '0000000A000AA0',
  unp: '000000000',
  warning_date: '2026-03-01',
  debt_started: '2026-01-26',
};

@Component({
  selector: 'app-print-forms',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatSnackBarModule],
  template: `
    <header class="head">
      <div>
        <h2>Печатные формы</h2>
        <p>Макет хранится в ПМ. В текст подставляются поля лицевого счёта. Уже собранный документ остаётся на своей версии шаблона.</p>
      </div>
      <button mat-stroked-button type="button" (click)="create()">+ Шаблон</button>
    </header>
    <div class="layout">
      <section class="list">
        @for (form of forms(); track form.id) {
          <button type="button" [class.on]="current()?.id === form.id" (click)="select(form)">
            {{ form.name }}
            <small>{{ kindLabel(form.doc_kind) }} · v{{ form.version }}</small>
          </button>
        }
        @if (!forms().length) { <p class="muted">Шаблонов пока нет.</p> }
      </section>
      <section class="editor">
        <div class="line">
          <mat-form-field><mat-label>Код</mat-label><input matInput [(ngModel)]="code" /></mat-form-field>
          <mat-form-field class="grow"><mat-label>Название</mat-label><input matInput [(ngModel)]="name" /></mat-form-field>
        </div>
        <div class="line">
          <mat-form-field><mat-label>Вид документа</mat-label>
            <mat-select [(ngModel)]="kind">
              @for (item of kinds; track item.id) { <mat-option [value]="item.id">{{ item.label }}</mat-option> }
            </mat-select>
          </mat-form-field>
          <mat-form-field><mat-label>Адресат</mat-label>
            <mat-select [(ngModel)]="addressee">
              <mat-option value="debtor">Должник</mat-option>
              <mat-option value="notary">Нотариус</mat-option>
              <mat-option value="supplier">Поставщик услуги</mat-option>
              <mat-option value="district">Администрация района</mat-option>
            </mat-select>
          </mat-form-field>
        </div>
        <p class="muted">Поля, которые система уже подставляет. Щелчок дописывает метку в текст.</p>
        <div class="tokens">
          @for (token of tokens; track token) {
            <button type="button" (click)="insert(token)">{{ '{' + token + '}' }}</button>
          }
        </div>
        <mat-form-field class="wide"><mat-label>Текст</mat-label>
          <textarea matInput rows="12" [(ngModel)]="body"></textarea>
        </mat-form-field>
        <div class="actions">
          <button mat-flat-button color="primary" type="button" (click)="save()">Сохранить</button>
          <button mat-stroked-button type="button" (click)="previewSample()">Предпросмотр</button>
          @if (current()?.revisions?.length) {
            @for (rev of current()?.revisions; track rev.version) {
              <button mat-stroked-button type="button" (click)="restore(rev.version)" [disabled]="rev.version === current()?.version">
                Вернуть v{{ rev.version }}
              </button>
            }
          }
        </div>
        <h3>Предпросмотр</h3>
        <pre>{{ preview() || 'Нажмите «Предпросмотр», чтобы подставить пример значений.' }}</pre>
        <div class="line">
          <mat-form-field><mat-label>ID лицевого счёта</mat-label><input matInput type="number" [(ngModel)]="accountId" /></mat-form-field>
          <button mat-stroked-button type="button" [disabled]="!current() || !accountId" (click)="previewAccount()">Собрать по счёту</button>
        </div>
        <p class="muted">Сборка PDF по счёту сохраняет документ этой версии шаблона. В кабинет БНП файл не уходит.</p>
      </section>
    </div>
  `,
  styles: `
    .head, .line, .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .head { justify-content: space-between; margin-bottom: 12px; }
    h2, h3 { margin: 0; color: var(--erip-primary-dark); }
    h3 { margin-top: 12px; font-size: 15px; }
    .muted, .head p { color: var(--erip-muted); margin: 4px 0 0; font-size: 13px; }
    .layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 16px; }
    .list, .editor { background: #fff; border: 1px solid var(--erip-border); border-radius: 12px; padding: 12px; }
    .list { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
    .list button {
      text-align: left; border: 1px solid var(--erip-border); background: #fff; border-radius: 8px;
      padding: 8px 10px; cursor: pointer; font: inherit;
    }
    .list button.on { border-color: var(--erip-primary); background: var(--erip-primary-soft); }
    .list small { display: block; color: var(--erip-muted); }
    .grow, .wide { flex: 1; width: 100%; }
    .tokens { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
    .tokens button {
      border: 1px solid var(--erip-border); background: #fff; border-radius: 999px; padding: 2px 8px;
      cursor: pointer; font: inherit; font-size: 12px;
    }
    pre { white-space: pre-wrap; background: var(--erip-bg); padding: 12px; border-radius: 8px; min-height: 80px; }
    @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
  `,
})
export class PrintFormsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly snack = inject(MatSnackBar);

  protected readonly forms = signal<PrintFormRow[]>([]);
  protected readonly current = signal<PrintFormRow | null>(null);
  protected readonly preview = signal('');
  protected readonly tokens = TOKENS;
  protected readonly kinds = [
    { id: 'warning', label: 'Предупреждение' },
    { id: 'writ', label: 'Заявление на исполнительную надпись' },
    { id: 'calculation', label: 'Расчёт задолженности' },
    { id: 'proxy', label: 'Доверенность' },
    { id: 'act', label: 'Акт' },
    { id: 'claim', label: 'Иск' },
    { id: 'writeoff', label: 'Акт списания' },
    { id: 'disconnect', label: 'Заказ-наряд на отключение' },
  ];

  protected code = '';
  protected name = '';
  protected kind = 'writ';
  protected addressee = 'notary';
  protected body = '';
  protected accountId: number | null = null;

  ngOnInit(): void {
    this.reload();
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
    this.body = form.body;
    this.preview.set('');
  }

  protected create(): void {
    this.current.set(null);
    this.code = '';
    this.name = '';
    this.kind = 'writ';
    this.addressee = 'notary';
    this.body = '';
    this.preview.set('');
  }

  protected insert(token: string): void {
    this.body = `${this.body}{${token}}`;
  }

  protected previewSample(): void {
    let text = this.body;
    for (const token of TOKENS) text = text.replaceAll(`{${token}}`, SAMPLE[token] || '');
    this.preview.set(text || 'Текст пустой.');
  }

  protected save(): void {
    if (!this.code.trim() || !this.name.trim()) {
      this.snack.open('Укажите код и название', 'OK');
      return;
    }
    const current = this.current();
    this.api.savePrintForm({
      id: current?.id, code: this.code.trim(), name: this.name.trim(), doc_kind: this.kind,
      addressee: this.addressee, body: this.body, font_size: 12, indent_mm: 0, outdent_mm: 0,
      block_order: ['body', 'signatory'],
    }).subscribe({
      next: (saved) => {
        this.snack.open('Шаблон сохранён', 'OK', { duration: 2000 });
        this.reload(saved.id);
      },
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

  protected previewAccount(): void {
    const form = this.current();
    if (!form || !this.accountId) return;
    this.api.renderPrintForm(form.id, [this.accountId]).subscribe({
      next: (result) => this.preview.set(result.text),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private reload(selectId?: number): void {
    this.api.printForms().subscribe({
      next: (page) => {
        this.forms.set(page.results);
        const picked = page.results.find((item) => item.id === (selectId || this.current()?.id));
        if (picked) this.select(picked);
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }
}
