import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';

import { ApiService, BlankData, ClaimCase, PrintFormRow, errorMessage } from '../../core/api.service';
import {
  FIELD_LABELS, FONT_FAMILIES, FONT_SIZES, KNOWN_TOKENS, SheetBlock, SheetEditor,
  blankToBlocks, normalizeBlock, slugifyCode,
} from './document-flow';
import { ActiveInsertionTarget, PrintSheetComponent } from './print-sheet.component';

const SYSTEM_CODES = new Set([
  'notary-warning', 'notary-calculation', 'notary-application', 'notary-proxy',
  'reminder', 'notice-137', 'notice-80', 'notice-86', 'notice-tko',
  'claim-debt', 'claim-eviction', 'claim-alienation', 'warning-demo',
]);

@Component({
  selector: 'app-print-forms',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, MatButtonModule, MatSnackBarModule, PrintSheetComponent],
  template: `
    <header class="head">
      <div>
        <h2>Конструктор печатных форм</h2>
        <p>Редактирование блоков, шрифтов, таблиц и переменных на листе A4. Любой системный шаблон можно изменить или сохранить как собственный.</p>
      </div>
      <div class="head-actions">
        <button mat-stroked-button type="button" (click)="duplicateAsOwn()">Копировать в мои</button>
        <button mat-flat-button color="primary" type="button" (click)="create()">+ Новый шаблон</button>
      </div>
    </header>
    @if (note()) { <p class="note">{{ note() }}</p> }
    <div class="layout">
      <section class="list">
        <div class="list-head">
          <h3>Мои шаблоны</h3>
          <button type="button" class="add-own-btn" (click)="create()">+ Добавить</button>
        </div>
        @for (form of ownForms(); track form.id) {
          <div class="tpl-row" [class.on]="current()?.id === form.id">
            <button type="button" class="tpl-pick" (click)="select(form)">
              {{ form.name }}
              <small>{{ kindLabel(form.doc_kind) }} · v{{ form.version }}</small>
            </button>
            <button type="button" class="tpl-del" title="Удалить шаблон" (click)="removeForm(form, $event)">×</button>
          </div>
        }
        @if (!ownForms().length) {
          <p class="muted">Своих шаблонов пока нет. Нажмите «+ Добавить» или «Сохранить как свой шаблон».</p>
        }

        <h3>Системные шаблоны</h3>
        @for (form of systemForms(); track form.id) {
          <button type="button" class="tpl-system" [class.on]="current()?.id === form.id" (click)="select(form)">
            {{ form.name }}
            <small>{{ kindLabel(form.doc_kind) }} · v{{ form.version }}</small>
          </button>
        }
      </section>

      <section class="editor">
        <div class="panes">
          <button type="button" [class.on]="pane() === 'layout'" (click)="pane.set('layout')">Макет A4</button>
          <button type="button" [class.on]="pane() === 'pdf'" (click)="showPdf()">Предпросмотр PDF</button>
          <button type="button" (click)="stepForm(-1)">← Назад</button>
          <button type="button" (click)="stepForm(1)">Вперёд →</button>
          @if (pane() === 'pdf' && pdfReady()) {
            <button type="button" (click)="downloadPdf()">Скачать PDF</button>
          }
        </div>

        @if (pane() === 'layout') {
          <div class="line meta-line">
            <label class="grow" [class.need]="!name.trim()">Название шаблона
              <input [(ngModel)]="name" (ngModelChange)="onNameInput($event)" placeholder="Например: Уведомление собственнику" />
            </label>
            <label>Код шаблона
              <input [(ngModel)]="code" [disabled]="!!claimId" placeholder="Автоматически" />
            </label>
            <label>Вид документа
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
            <label class="scan">Загрузить скан/PDF
              <input type="file" accept="application/pdf,.pdf,image/*" (change)="onScan($event)" />
            </label>
          </div>

          @if (chosen(); as block) {
            <div class="word-ribbon" role="toolbar" aria-label="Панель форматирования">
              <div class="ribbon-group">
                <span class="group-caption">Шрифт</span>
                <div class="ribbon-controls">
                  <select class="font-select" [(ngModel)]="block.font_family" aria-label="Шрифт">
                    @for (f of fonts; track f.id) {
                      <option [value]="f.id">{{ f.label }}</option>
                    }
                  </select>
                  <select class="size-select" [(ngModel)]="block.font_size" aria-label="Размер шрифта">
                    @for (s of fontSizes; track s) {
                      <option [ngValue]="s">{{ s }} пт</option>
                    }
                  </select>
                  <button type="button" class="tb-btn" title="Уменьшить шрифт" (click)="stepFontSize(block, -1)">A−</button>
                  <button type="button" class="tb-btn" title="Увеличить шрифт" (click)="stepFontSize(block, 1)">A+</button>
                  <button
                    type="button"
                    class="tb-btn fmt-bold"
                    [class.on]="block.bold"
                    title="Жирный (Ж)"
                    (click)="block.bold = !block.bold">Ж</button>
                  <button
                    type="button"
                    class="tb-btn fmt-italic"
                    [class.on]="block.italic"
                    title="Курсив (К)"
                    (click)="block.italic = !block.italic">К</button>
                  <button type="button" class="tb-btn" title="Применить шрифт и размер ко всем блокам" (click)="applyFontToAll(block)">Ко всем</button>
                </div>
              </div>

              <div class="ribbon-group">
                <span class="group-caption">Абзац и блок</span>
                <div class="ribbon-controls">
                  <button type="button" class="tb-btn" [class.on]="block.align === 'left'" title="По левому краю" (click)="block.align = 'left'">Слева</button>
                  <button type="button" class="tb-btn" [class.on]="block.align === 'center'" title="По центру" (click)="block.align = 'center'">Центр</button>
                  <button type="button" class="tb-btn" [class.on]="block.align === 'right'" title="По правому краю" (click)="block.align = 'right'">Справа</button>
                  <button type="button" class="tb-btn" [class.on]="block.align === 'justify'" title="По ширине" (click)="block.align = 'justify'">По ширине</button>
                  <label class="inline-num" title="Ширина блока в процентах листа">
                    Шир.
                    <input type="number" min="20" max="100" [(ngModel)]="block.w" />%
                  </label>
                </div>
              </div>

              <div class="ribbon-group">
                <span class="group-caption">Блоки</span>
                <div class="ribbon-controls">
                  <button type="button" class="tb-btn" (click)="addTextBlock()">+ Текст</button>
                  <button type="button" class="tb-btn" (click)="addTableBlock()">+ Таблица</button>
                  <button type="button" class="tb-btn" (click)="addSignBlock()">+ Подпись</button>
                  <button type="button" class="tb-btn" (click)="duplicateBlock(block)">Дублировать</button>
                  @if (blocks.length > 1) {
                    <button type="button" class="tb-btn danger" (click)="removeBlock(block)">Удалить блок</button>
                  }
                </div>
              </div>

              <div class="ribbon-group">
                <span class="group-caption">Таблица в блоке «{{ block.title }}»</span>
                <div class="ribbon-controls">
                  @if (!block.columns.length) {
                    <button type="button" class="tb-btn" (click)="addColumn(block)">+ Создать таблицу</button>
                    <button type="button" class="tb-btn" (click)="addServiceTable(block)">+ Таблица услуг</button>
                  } @else {
                    <button type="button" class="tb-btn" (click)="addColumn(block)">+ Столбец</button>
                    <button type="button" class="tb-btn" (click)="removeColumn(block)">− Столбец</button>
                    <button type="button" class="tb-btn" (click)="addRow(block)">+ Строка</button>
                    @if (block.rows.length > 1) {
                      <button type="button" class="tb-btn" (click)="removeRow(block)">− Строка</button>
                    }
                    <button type="button" class="tb-btn danger" (click)="clearTable(block)">Убрать таблицу</button>
                  }
                </div>
              </div>
            </div>
          }

          <div class="tokens-bar">
            <span class="tokens-title">Вставить поле ЛС:</span>
            @for (token of tokens; track token) {
              <button type="button" class="token-chip" (click)="insert(token)" [title]="'Вставить {' + token + '}'">
                {{ labelOf(token) }}
              </button>
            }
          </div>

          <div class="work">
            <aside class="parts">
              <div class="parts-head">
                <h3>Блоки ({{ blocks.length }})</h3>
                <div class="parts-add">
                  <button type="button" (click)="addTextBlock()" title="Добавить текстовый блок">+ Блок</button>
                  <button type="button" (click)="addTableBlock()" title="Добавить блок с таблицей">+ Табл.</button>
                </div>
              </div>
              <p class="parts-hint">Перетаскивайте блоки мышью для смены порядка. Галочка включает блок на листе.</p>
              @for (block of orderedBlocks(); track block.key) {
                <div
                  class="part-item"
                  [class.on]="block.enabled"
                  [class.active]="selectedKey === block.key"
                  [class.drop-target]="dragOverSidebarKey() === block.key"
                  draggable="true"
                  (click)="focusBlock(block.key)"
                  (dragstart)="onSidebarDragStart($event, block)"
                  (dragover)="onSidebarDragOver($event, block)"
                  (dragleave)="onSidebarDragLeave(block)"
                  (drop)="onSidebarDrop($event, block)"
                  (dragend)="onSidebarDragEnd()">
                  <span class="drag-grip" title="Перетащите для изменения порядка">⋮⋮</span>
                  <button
                    type="button"
                    class="mark"
                    [class.checked]="block.enabled"
                    title="Включить / выключить блок"
                    (click)="block.enabled = !block.enabled; $event.stopPropagation()">
                    {{ block.enabled ? '✓' : '' }}
                  </button>
                  <input
                    class="part-title-input"
                    [(ngModel)]="block.title"
                    (focus)="focusBlock(block.key)"
                    (click)="$event.stopPropagation()"
                    [attr.aria-label]="'Название блока'" />
                  <div class="part-moves" (click)="$event.stopPropagation()">
                    <button type="button" title="Выше" (click)="moveBlock(block, -1)">↑</button>
                    <button type="button" title="Ниже" (click)="moveBlock(block, 1)">↓</button>
                    @if (blocks.length > 1) {
                      <button type="button" class="del" title="Удалить блок" (click)="removeBlock(block)">×</button>
                    }
                  </div>
                </div>
              }
            </aside>

            <div class="sheet-wrap">
              <app-print-sheet
                [blocks]="blocks"
                [flows]="editor.flows"
                [form]="editor.form"
                [selectedKey]="selectedKey"
                (pick)="focusBlock($event)"
                (targetChange)="onTargetChange($event)" />
            </div>
          </div>

          <div class="actions">
            @if (claimId && docId) {
              <button mat-flat-button color="primary" type="button" (click)="saveCase()">Сохранить в деле</button>
            } @else {
              <button mat-flat-button color="primary" type="button" (click)="save()">Сохранить шаблон</button>
              <button mat-stroked-button type="button" (click)="saveAsOwn()">Сохранить как свой шаблон</button>
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
    .head, .head-actions, .line, .actions, .panes { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .head { justify-content: space-between; margin-bottom: 12px; }
    h2, h3 { margin: 0; color: var(--erip-primary-dark); }
    h3 { margin: 10px 0 6px; font-size: 13px; }
    .muted, .head p, .note { color: var(--erip-muted); margin: 4px 0 0; font-size: 13px; }
    .note { background: #fff8e8; border: 1px solid #e0a106; border-radius: 8px; padding: 8px 10px; }
    .layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 16px; }
    .list, .editor { background: #fff; border: 1px solid var(--erip-border); border-radius: 12px; padding: 12px; min-width: 0; }
    .list { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
    .list-head { display: flex; justify-content: space-between; align-items: center; margin-top: 2px; }
    .list-head h3 { margin: 0; }
    .add-own-btn {
      border: 1px solid var(--erip-primary); background: var(--erip-primary-soft); color: var(--erip-primary-dark);
      border-radius: 6px; padding: 3px 8px; font-size: 12px; font-weight: 600; cursor: pointer;
    }
    .tpl-row {
      display: flex; align-items: stretch; border: 1px solid var(--erip-border); border-radius: 8px; background: #fff; overflow: hidden;
    }
    .tpl-row.on { border-color: var(--erip-primary); background: var(--erip-primary-soft); }
    .tpl-pick {
      flex: 1; text-align: left; border: 0; background: transparent; padding: 8px 10px; cursor: pointer; font: inherit; min-width: 0;
    }
    .tpl-del {
      border: 0; border-left: 1px solid var(--erip-border); background: transparent; color: #8c9ba5;
      padding: 0 8px; cursor: pointer; font-size: 15px;
    }
    .tpl-del:hover { color: #c62828; background: #fdecec; }
    .tpl-system, .panes button {
      text-align: left; border: 1px solid var(--erip-border); background: #fff; border-radius: 8px;
      padding: 8px 10px; cursor: pointer; font: inherit;
    }
    .tpl-system.on, .panes button.on { border-color: var(--erip-primary); background: var(--erip-primary-soft); }
    .list small { display: block; color: var(--erip-muted); font-size: 11px; margin-top: 2px; }
    .grow { flex: 1; min-width: 180px; }
    .meta-line { margin-top: 8px; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--erip-muted); }
    input, select { font: inherit; color: #1f2933; border: 1px solid var(--erip-border); border-radius: 6px; padding: 5px 8px; }
    .scan input { font-size: 12px; padding: 3px 6px; }
    .need { color: #c62828; }

    .word-ribbon {
      display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; padding: 8px 10px;
      background: #f6f9fb; border: 1px solid #d5e1e6; border-radius: 10px; align-items: flex-end;
    }
    .ribbon-group {
      display: flex; flex-direction: column; gap: 4px; padding-right: 10px; border-right: 1px solid #dce6eb;
    }
    .ribbon-group:last-child { border-right: 0; padding-right: 0; }
    .group-caption { font-size: 11px; font-weight: 600; color: #546a76; text-transform: uppercase; letter-spacing: 0.02em; }
    .ribbon-controls { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    .font-select { min-width: 148px; padding: 4px 6px; font-size: 13px; background: #fff; }
    .size-select { width: 72px; padding: 4px 6px; font-size: 13px; background: #fff; }
    .tb-btn {
      border: 1px solid #c5d4dc; background: #fff; color: #1f2933; border-radius: 6px;
      padding: 4px 8px; font: inherit; font-size: 12px; cursor: pointer; line-height: 1.2;
    }
    .tb-btn:hover { background: #e8f1f5; border-color: #1d4f63; }
    .tb-btn.on { background: #1d4f63; border-color: #1d4f63; color: #fff; }
    .tb-btn.fmt-bold { font-weight: 700; min-width: 28px; text-align: center; }
    .tb-btn.fmt-italic { font-style: italic; font-family: Georgia, serif; min-width: 28px; text-align: center; }
    .tb-btn.danger { color: #b71c1c; border-color: #e4b4b4; }
    .tb-btn.danger:hover { background: #fdecec; border-color: #c62828; }
    .inline-num {
      flex-direction: row; align-items: center; gap: 4px; font-size: 12px; color: #334e5c; margin-left: 2px;
    }
    .inline-num input { width: 52px; padding: 3px 5px; font-size: 12px; }

    .tokens-bar {
      display: flex; flex-wrap: wrap; gap: 5px; align-items: center; margin: 8px 0 4px;
      padding: 6px 8px; background: #fbfcfd; border: 1px solid var(--erip-border); border-radius: 8px;
    }
    .tokens-title { font-size: 12px; font-weight: 600; color: var(--erip-muted); margin-right: 4px; }
    .token-chip {
      border: 1px solid #cad6de; background: #fff; color: #1d4f63; border-radius: 999px;
      padding: 2px 9px; cursor: pointer; font: inherit; font-size: 12px;
    }
    .token-chip:hover { background: var(--erip-primary-soft); border-color: var(--erip-primary); }

    .work { display: grid; grid-template-columns: 270px minmax(0, 1fr); gap: 12px; margin-top: 8px; align-items: start; }
    .parts {
      border: 1px solid var(--erip-border); border-radius: 12px; padding: 10px; background: #fff;
      display: flex; flex-direction: column; gap: 6px;
    }
    .parts-head { display: flex; justify-content: space-between; align-items: center; }
    .parts-head h3 { margin: 0; }
    .parts-add { display: flex; gap: 4px; }
    .parts-add button {
      border: 1px solid var(--erip-border); background: #f6f9fb; color: var(--erip-primary-dark);
      border-radius: 6px; padding: 2px 6px; font-size: 11px; font-weight: 600; cursor: pointer;
    }
    .parts-hint { margin: 0; font-size: 11px; color: var(--erip-muted); line-height: 1.3; }
    .part-item {
      display: flex; gap: 6px; align-items: center; width: 100%; box-sizing: border-box;
      border: 1px solid var(--erip-border); background: #fff; border-radius: 8px;
      padding: 5px 6px; cursor: pointer;
    }
    .part-item.active { border-color: var(--erip-primary); background: var(--erip-primary-soft); }
    .part-item.drop-target { border-top: 2px solid #1d4f63; }
    .drag-grip { cursor: grab; color: #7b8d98; font-weight: 700; letter-spacing: -1px; user-select: none; }
    .mark {
      width: 18px; height: 18px; flex: 0 0 18px; border: 1px solid #c5ced6; border-radius: 4px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 12px; line-height: 1; color: transparent; background: #fff; cursor: pointer; padding: 0;
    }
    .mark.checked { background: #2e9b57; border-color: #2e9b57; color: #fff; }
    .part-title-input {
      flex: 1; min-width: 0; border: 1px solid transparent; background: transparent;
      padding: 2px 4px; font-size: 12px; color: #1f2933; border-radius: 4px;
    }
    .part-title-input:focus { border-color: #b7cbd4; background: #fff; outline: none; }
    .part-moves { display: flex; gap: 2px; }
    .part-moves button {
      border: 1px solid #d5e0e6; background: #fff; border-radius: 4px; padding: 1px 4px;
      font-size: 11px; cursor: pointer; color: #334e5c;
    }
    .part-moves button.del:hover { color: #c62828; border-color: #c62828; }

    .sheet-wrap { min-width: 0; }
    .actions { margin-top: 12px; }
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
  protected readonly fonts = FONT_FAMILIES;
  protected readonly fontSizes = FONT_SIZES;
  protected readonly kinds = [
    { id: 'warning', label: 'Предупреждение' },
    { id: 'reminder', label: 'Напоминание' },
    { id: 'notice', label: 'Уведомление' },
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
  protected readonly blank = signal('');
  private accountId: number | null = null;
  protected selectedKey = 'body';
  protected claimId: number | null = null;
  protected docId: number | null = null;
  private requestedForm: number | null = null;
  private rawUrl = '';
  private activeTarget: ActiveInsertionTarget | null = null;
  private autoCode = false;

  protected readonly dragSidebarKey = signal('');
  protected readonly dragOverSidebarKey = signal('');

  protected systemForms(): PrintFormRow[] {
    return this.forms().filter((form) => form.organization == null && SYSTEM_CODES.has(form.code));
  }

  protected ownForms(): PrintFormRow[] {
    return this.forms().filter((form) => form.organization != null || !SYSTEM_CODES.has(form.code));
  }

  protected isSystemForm(form: PrintFormRow | null): boolean {
    return !!form && form.organization == null && SYSTEM_CODES.has(form.code);
  }

  protected orderedBlocks(): SheetBlock[] {
    return [...this.blocks].sort((a, b) => a.y - b.y || a.x - b.x);
  }

  protected labelOf(token: string): string {
    return FIELD_LABELS[token] || token;
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

  protected onNameInput(value: string): void {
    if (!this.current() || this.autoCode || !this.code.trim()) {
      this.autoCode = true;
      this.code = slugifyCode('', value);
    }
  }

  protected select(form: PrintFormRow): void {
    this.current.set(form);
    this.autoCode = false;
    this.code = form.code;
    this.name = form.name;
    this.kind = form.doc_kind;
    this.addressee = form.addressee || 'debtor';
    this.blocks = this.copyBlocks(form);
    this.selectedKey = this.blocks[0]?.key || 'body';
    this.activeTarget = null;
    this.pdfUrl.set(null);
    this.pdfReady.set(false);
    this.blank.set(form.blank || '');
    if (this.claimId) {
      this.fillClaim();
    } else {
      this.accountId = null;
      this.openSheet();
      if (!form.blocks?.length && form.blank) {
        this.loadBlank(form);
      }
    }
  }

  protected create(): void {
    this.current.set(null);
    this.autoCode = true;
    this.name = 'Новый шаблон';
    this.code = slugifyCode('', this.name);
    this.kind = 'warning';
    this.addressee = 'debtor';
    this.blocks = [
      normalizeBlock({
        key: 'logo', title: 'Шапка организации', enabled: true, align: 'center', bold: true,
        font_size: 12, font_family: 'Times New Roman', y: 12,
        text: 'Республика Беларусь\n{organization}',
      }, 0),
      normalizeBlock({
        key: 'requisites', title: 'Адресат и реквизиты', enabled: true, align: 'right',
        font_size: 12, font_family: 'Times New Roman', y: 80,
        text: 'Должник: {fio}\nЛицевой счёт: {account}\nАдрес: {address}',
      }, 1),
      normalizeBlock({
        key: 'body', title: 'Основной текст', enabled: true, align: 'left',
        font_size: 12, font_family: 'Times New Roman', y: 160,
        text: 'УВЕДОМЛЕНИЕ\n\nУважаемый(ая) {fio}!\nПо лицевому счёту № {account} по адресу {address} числится задолженность в размере {amount} руб., в том числе пеня {penalty} руб.\nПросим погасить задолженность в течение {due_days} дней.',
      }, 2),
      normalizeBlock({
        key: 'table', title: 'Таблица задолженности', enabled: true, align: 'left',
        font_size: 11, font_family: 'Times New Roman', y: 260, text: '',
        columns: [
          { title: 'Услуга', width: 45 },
          { title: 'Сумма долга', width: 30 },
          { title: 'Пеня', width: 25 },
        ],
        rows: [['{services}', '{amount}', '{penalty}']],
      }, 3),
      normalizeBlock({
        key: 'signatory', title: 'Подпись', enabled: true, align: 'left',
        font_size: 12, font_family: 'Times New Roman', y: 360,
        text: 'Руководитель _______________________ {organization}',
      }, 4),
    ];
    this.blank.set('');
    this.selectedKey = 'body';
    this.activeTarget = null;
    this.claimId = null;
    this.docId = null;
    this.pane.set('layout');
    this.pdfUrl.set(null);
    this.pdfReady.set(false);
    this.openSheet();
  }

  protected duplicateAsOwn(): void {
    const baseName = (this.name || this.current()?.name || 'Шаблон').trim();
    this.current.set(null);
    this.autoCode = true;
    this.name = baseName.endsWith('(свой)') ? baseName : `${baseName} (свой)`;
    this.code = slugifyCode('', this.name);
    this.blank.set('');
    this.snack.open('Создана копия. Отредактируйте и нажмите «Сохранить шаблон».', 'OK', { duration: 2500 });
  }

  protected removeForm(form: PrintFormRow, event: Event): void {
    event.stopPropagation();
    this.api.deletePrintForm(form.id).subscribe({
      next: () => {
        this.snack.open('Шаблон удалён', 'OK', { duration: 2000 });
        if (this.current()?.id === form.id) {
          this.current.set(null);
        }
        this.reload();
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected onTargetChange(target: ActiveInsertionTarget): void {
    this.activeTarget = target;
    if (target.blockKey) {
      this.selectedKey = target.blockKey;
    }
  }

  protected insert(token: string): void {
    const placeholder = `{${token}}`;
    const block = this.chosen() || this.blocks[0];
    if (!block) return;

    if (this.activeTarget && this.activeTarget.blockKey === block.key && this.activeTarget.kind === 'cell') {
      const r = this.activeTarget.row ?? 0;
      const c = this.activeTarget.col ?? 0;
      if (block.rows[r] && c < block.rows[r].length) {
        const currentCell = block.rows[r][c] || '';
        const start = this.activeTarget.selectionStart ?? currentCell.length;
        const end = this.activeTarget.selectionEnd ?? currentCell.length;
        block.rows[r][c] = currentCell.slice(0, start) + placeholder + currentCell.slice(end);
        return;
      }
    }

    const text = block.text || '';
    if (this.activeTarget && this.activeTarget.blockKey === block.key && this.activeTarget.kind === 'text') {
      const start = this.activeTarget.selectionStart ?? text.length;
      const end = this.activeTarget.selectionEnd ?? text.length;
      block.text = text.slice(0, start) + placeholder + text.slice(end);
      const nextPos = start + placeholder.length;
      this.activeTarget = { ...this.activeTarget, selectionStart: nextPos, selectionEnd: nextPos };
      return;
    }

    const glue = text && !text.endsWith('\n') && !text.endsWith(' ') ? ' ' : '';
    block.text = `${text}${glue}${placeholder}`;
  }

  protected chosen(): SheetBlock | undefined {
    return this.blocks.find((block) => block.key === this.selectedKey) || this.blocks.find((block) => block.enabled) || this.blocks[0];
  }

  protected focusBlock(key: string): void {
    this.selectedKey = key;
  }

  protected stepFontSize(block: SheetBlock, delta: number): void {
    block.font_size = Math.min(36, Math.max(8, (Number(block.font_size) || 12) + delta));
  }

  protected applyFontToAll(source: SheetBlock): void {
    for (const block of this.blocks) {
      block.font_family = source.font_family;
      block.font_size = source.font_size;
    }
    this.snack.open(`Шрифт ${source.font_family} (${source.font_size} пт) применён ко всем блокам`, 'OK', { duration: 2000 });
  }

  protected addTextBlock(): void {
    const nextNum = this.blocks.length + 1;
    const maxY = this.blocks.reduce((max, b) => Math.max(max, b.y), 0);
    const created = normalizeBlock({
      key: `block-${Date.now().toString().slice(-5)}-${nextNum}`,
      title: `Текстовый блок ${nextNum}`,
      enabled: true,
      align: 'left',
      font_size: 12,
      font_family: this.chosen()?.font_family || 'Times New Roman',
      text: 'Новый абзац текста...',
      y: maxY + 80,
    }, this.blocks.length);
    this.blocks = [...this.blocks, created];
    this.selectedKey = created.key;
  }

  protected addTableBlock(): void {
    const nextNum = this.blocks.length + 1;
    const maxY = this.blocks.reduce((max, b) => Math.max(max, b.y), 0);
    const created = normalizeBlock({
      key: `block-tbl-${Date.now().toString().slice(-5)}-${nextNum}`,
      title: `Таблица ${nextNum}`,
      enabled: true,
      align: 'left',
      font_size: 11,
      font_family: this.chosen()?.font_family || 'Times New Roman',
      text: '',
      columns: [
        { title: 'Наименование услуги', width: 40 },
        { title: 'Сумма долга', width: 30 },
        { title: 'Пеня', width: 30 },
      ],
      rows: [['{services}', '{amount}', '{penalty}']],
      y: maxY + 80,
    }, this.blocks.length);
    this.blocks = [...this.blocks, created];
    this.selectedKey = created.key;
  }

  protected addSignBlock(): void {
    const maxY = this.blocks.reduce((max, b) => Math.max(max, b.y), 0);
    const key = this.blocks.some((b) => b.key === 'signatory')
      ? `block-sign-${Date.now().toString().slice(-4)}`
      : 'signatory';
    const created = normalizeBlock({
      key,
      title: 'Подпись',
      enabled: true,
      align: 'left',
      font_size: 12,
      font_family: this.chosen()?.font_family || 'Times New Roman',
      text: 'Подпись уполномоченного лица _______________________',
      y: maxY + 80,
    }, this.blocks.length);
    this.blocks = [...this.blocks, created];
    this.selectedKey = created.key;
  }

  protected duplicateBlock(block: SheetBlock): void {
    const copy = normalizeBlock({
      ...block,
      key: `block-copy-${Date.now().toString().slice(-5)}`,
      title: `${block.title} (копия)`,
      columns: block.columns.map((c) => ({ ...c })),
      rows: block.rows.map((r) => [...r]),
      y: block.y + 40,
    }, this.blocks.length);
    this.blocks = [...this.blocks, copy];
    this.selectedKey = copy.key;
  }

  protected removeBlock(block: SheetBlock): void {
    if (this.blocks.length <= 1) return;
    const idx = this.blocks.findIndex((b) => b.key === block.key);
    this.blocks = this.blocks.filter((b) => b.key !== block.key);
    const next = this.blocks[Math.max(0, idx - 1)] || this.blocks[0];
    if (next) this.selectedKey = next.key;
  }

  protected moveBlock(block: SheetBlock, delta: number): void {
    const ordered = this.orderedBlocks();
    const index = ordered.findIndex((item) => item.key === block.key);
    const other = ordered[index + delta];
    if (!other) return;
    const y = block.y;
    block.y = other.y;
    other.y = y === other.y ? y + delta * 40 : y;
  }

  // Перетаскивание блоков в левой панели
  protected onSidebarDragStart(event: DragEvent, block: SheetBlock): void {
    this.dragSidebarKey.set(block.key);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', block.key);
    }
  }

  protected onSidebarDragOver(event: DragEvent, target: SheetBlock): void {
    const src = this.dragSidebarKey();
    if (!src || src === target.key) return;
    event.preventDefault();
    this.dragOverSidebarKey.set(target.key);
  }

  protected onSidebarDragLeave(target: SheetBlock): void {
    if (this.dragOverSidebarKey() === target.key) {
      this.dragOverSidebarKey.set('');
    }
  }

  protected onSidebarDrop(event: DragEvent, target: SheetBlock): void {
    const srcKey = this.dragSidebarKey();
    this.dragSidebarKey.set('');
    this.dragOverSidebarKey.set('');
    if (!srcKey || srcKey === target.key) return;
    event.preventDefault();
    const ordered = this.orderedBlocks();
    const fromIdx = ordered.findIndex((b) => b.key === srcKey);
    const toIdx = ordered.findIndex((b) => b.key === target.key);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);
    ordered.forEach((b, i) => {
      b.y = 12 + i * 80;
    });
  }

  protected onSidebarDragEnd(): void {
    this.dragSidebarKey.set('');
    this.dragOverSidebarKey.set('');
  }

  protected addColumn(block: SheetBlock): void {
    block.columns = [...block.columns, { title: `Колонка ${block.columns.length + 1}`, width: 25 }];
    block.rows = block.rows.length
      ? block.rows.map((row) => [...row, ''])
      : [block.columns.map(() => '')];
  }

  protected removeColumn(block: SheetBlock): void {
    if (!block.columns.length) return;
    const colIdx = block.columns.length - 1;
    block.columns = block.columns.slice(0, colIdx);
    block.rows = block.columns.length
      ? block.rows.map((row) => row.slice(0, colIdx))
      : [];
  }

  protected addRow(block: SheetBlock): void {
    if (!block.columns.length) {
      this.addServiceTable(block);
      return;
    }
    block.rows = [...block.rows, block.columns.map(() => '')];
  }

  protected removeRow(block: SheetBlock): void {
    if (block.rows.length <= 1) return;
    block.rows = block.rows.slice(0, -1);
  }

  protected clearTable(block: SheetBlock): void {
    block.columns = [];
    block.rows = [];
  }

  protected addServiceTable(block: SheetBlock): void {
    block.columns = [
      { title: 'Услуга', width: 40 },
      { title: 'Задолженность', width: 30 },
      { title: 'Пеня', width: 30 },
    ];
    block.rows = [['{services}', '{amount}', '{penalty}']];
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
    this.persistForm(false);
  }

  protected saveAsOwn(): void {
    this.persistForm(true);
  }

  private persistForm(forceNewOwn: boolean): void {
    if (!this.name.trim()) {
      this.snack.open('Укажите название шаблона', 'OK');
      return;
    }
    this.editor.commit(this.blocks, 'template');
    const body = this.blocks.find((block) => block.key === 'body')?.text
      || this.blocks.filter((b) => b.enabled && b.text).map((b) => b.text).join('\n\n');
    const current = this.current();
    const isNew = forceNewOwn || !current?.id;
    let code = slugifyCode(this.code, this.name);
    if (forceNewOwn && SYSTEM_CODES.has(code)) {
      code = `${code}-custom-${Date.now().toString().slice(-4)}`;
    }
    const name = forceNewOwn && current && this.name.trim() === current.name
      ? `${this.name.trim()} (свой)`
      : this.name.trim();

    const payload: Partial<PrintFormRow> = {
      id: isNew ? undefined : current?.id,
      code,
      name,
      doc_kind: this.kind,
      addressee: this.addressee,
      blank: '',
      body,
      blocks: this.blocks,
      font_size: this.chosen()?.font_size || 12,
      indent_mm: 0,
      outdent_mm: 0,
      block_order: this.blocks.filter((block) => block.enabled).map((block) => block.key),
    };

    this.api.savePrintForm(payload).subscribe({
      next: (saved) => {
        this.snack.open(isNew ? 'Собственный шаблон сохранён' : 'Шаблон сохранён', 'OK', { duration: 2000 });
        this.reload(saved.id);
      },
      error: (err) => {
        if (!isNew && err?.status === 403) {
          this.persistForm(true);
          return;
        }
        this.snack.open(errorMessage(err), 'OK');
      },
    });
  }

  protected saveCase(): void {
    if (!this.claimId || !this.docId) return;
    const blocks = this.previewBlocks();
    const body = blocks.find((block) => block.key === 'body')?.text
      || blocks.filter((b) => b.enabled && b.text).map((b) => b.text).join('\n\n');
    this.api.claimAction(this.claimId, `package/documents/${this.docId}/layout`, { body, blocks, blank: '' }).subscribe({
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
    const rows = [...this.ownForms(), ...this.systemForms()];
    const index = rows.findIndex((form) => form.id === this.current()?.id);
    const next = rows[index + delta];
    if (next) this.select(next);
  }

  protected showPdf(): void {
    this.pane.set('pdf');
    this.pdfReady.set(false);
    const blocks = this.previewBlocks();
    const body = blocks.find((block) => block.key === 'body')?.text
      || blocks.filter((b) => b.enabled && b.text).map((b) => b.text).join('\n\n');
    this.api.previewPrintForm({ blocks, body, account: this.accountId }).subscribe({
      next: (blob) => this.showBlob(blob),
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

  private showBlob(blob: Blob): void {
    blob.slice(0, 5).arrayBuffer().then((head) => {
      const magic = String.fromCharCode(...new Uint8Array(head));
      const file = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
      this.revoke();
      this.rawUrl = URL.createObjectURL(file);
      this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.rawUrl));
      this.pdfReady.set(magic.startsWith('%PDF'));
    });
  }

  private loadBlank(form: PrintFormRow, account?: number, claim?: ClaimCase): void {
    if (!form.blank) return;
    this.api.blankData(form.blank, account).subscribe({
      next: (data) => this.applyBlank(data, claim, !form.blocks?.length),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private applyBlank(data: BlankData, claim?: ClaimCase, replaceBlocks = false): void {
    if (replaceBlocks && data.blocks?.length) {
      this.blocks = data.blocks.map((b, i) => normalizeBlock(b, i));
      this.selectedKey = this.blocks[0]?.key || 'body';
    }
    const vals: Record<string, string> = { ...(data.values || {}) };
    if (claim?.warning_delivered_on) {
      const [year, month, day] = claim.warning_delivered_on.slice(0, 10).split('-');
      if (day && month && year) vals['warning_date'] = `${day}.${month}.${year}`;
    }
    this.editor.load(this.blocks);
    if (this.accountId || claim) {
      this.editor.fillEmpty(vals);
    }
  }

  private reload(selectId?: number): void {
    this.api.printForms().subscribe({
      next: (page) => {
        this.forms.set(page.results);
        const wanted = selectId || this.requestedForm || this.current()?.id || page.results[0]?.id;
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
        this.accountId = claim.account;
        const form = this.current();
        if (form && form.blank && !saved?.length) {
          this.loadBlank(form, claim.account, claim);
        }
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
    if (form.blank) {
      const fromBlank = blankToBlocks(form.blank);
      if (fromBlank.length) return fromBlank;
    }
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
