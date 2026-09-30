import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ApiService, PrintFormRow, ScenarioRow, ScenarioStep, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

const ACTIONS = [
  { id: 'call', label: 'Автообзвон' },
  { id: 'manual_call', label: 'Ручной звонок' },
  { id: 'sms', label: 'SMS' },
  { id: 'email', label: 'E-mail' },
  { id: 'messenger', label: 'Мессенджер (не отправляет)' },
  { id: 'warning', label: 'Предупреждение' },
  { id: 'disconnect', label: 'Отключение' },
  { id: 'writ', label: 'Исполнительная надпись' },
  { id: 'lawsuit', label: 'Иск' },
];

@Component({
  selector: 'app-scenarios',
  standalone: true,
  imports: [
    FormsModule, MatCardModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatCheckboxModule, MatSnackBarModule,
  ],
  template: `
    <div class="page layout">
      <mat-card>
        <mat-card-title>Сценарии</mat-card-title>
        <mat-card-content>
          <p class="muted">Центральный сценарий копируется в схему. Уже запущенные лицевые счета остаются на прежней версии.</p>
          @if (auth.me()?.role !== 'specialist' && auth.me()?.role !== 'observer') {
            <button mat-stroked-button (click)="create()">+ Черновик</button>
          }
          @for (row of scenarios(); track row.id) {
            <button type="button" class="item" [class.on]="current()?.id === row.id" (click)="select(row)">
              {{ row.name }}
              <small>{{ row.organization ? 'схема' : 'центр' }} · v{{ row.version }} · {{ row.status === 'active' ? 'активный' : 'черновик' }}</small>
            </button>
          }
        </mat-card-content>
      </mat-card>

      <div class="stack">
        @if (current(); as row) {
          <mat-card>
            <mat-card-content class="fields">
              <mat-form-field class="wide"><mat-label>Название</mat-label><input matInput [(ngModel)]="name" /></mat-form-field>
              @for (step of steps; track $index) {
                <div class="step">
                  <mat-form-field><mat-label>№</mat-label><input matInput type="number" [(ngModel)]="step.order" /></mat-form-field>
                  <mat-form-field><mat-label>Действие</mat-label>
                    <mat-select [(ngModel)]="step.action">
                      @for (action of actions; track action.id) { <mat-option [value]="action.id">{{ action.label }}</mat-option> }
                    </mat-select>
                  </mat-form-field>
                  <mat-form-field><mat-label>Ждать дней</mat-label><input matInput type="number" [(ngModel)]="step.wait_days" /></mat-form-field>
                  <mat-form-field><mat-label>Шаблон</mat-label><input matInput [(ngModel)]="step.template" /></mat-form-field>
                  <mat-form-field><mat-label>Группа от</mat-label><input matInput type="number" [(ngModel)]="step.branch_group" /></mat-form-field>
                  <mat-checkbox [(ngModel)]="step.terminal">Конец</mat-checkbox>
                  <mat-checkbox [(ngModel)]="step.approval">Согласование</mat-checkbox>
                  <button mat-button (click)="removeStep($index)">Убрать</button>
                </div>
              }
              <button mat-stroked-button (click)="addStep()">+ Шаг</button>
              <div class="actions">
                <button mat-flat-button color="primary" (click)="save()">Сохранить</button>
                <button mat-stroked-button (click)="publish()">Опубликовать</button>
                <button mat-stroked-button (click)="copy()">Копировать в схему</button>
              </div>
              @if (warnings().length) {
                @for (text of warnings(); track text) { <p class="banner">{{ text }}</p> }
              }
              <div class="step">
                <mat-form-field><mat-label>ID лицевого счёта</mat-label><input matInput type="number" [(ngModel)]="accountId" /></mat-form-field>
                <mat-form-field class="wide"><mat-label>Причина паузы</mat-label><input matInput [(ngModel)]="pauseReason" /></mat-form-field>
                <button mat-stroked-button (click)="assign(false)">Назначить текущую версию</button>
                <button mat-stroked-button (click)="assign(true)">Поставить на паузу</button>
              </div>
              @if (runNote()) { <p>{{ runNote() }}</p> }
            </mat-card-content>
          </mat-card>
        }

        <mat-card>
          <mat-card-title>Печатные формы</mat-card-title>
          <mat-card-content class="fields">
            <p class="muted">Переменные: {{ '{fio}' }}, {{ '{account}' }}, {{ '{amount}' }}, {{ '{address}' }}, {{ '{services}' }}, {{ '{last_payment}' }}, {{ '{organization}' }}, {{ '{due_days}' }}, {{ '{tariff}' }}. Документ запоминает версию шаблона.</p>
            @for (form of forms(); track form.id) {
              <button type="button" class="item" [class.on]="print()?.id === form.id" (click)="selectForm(form)">
                {{ form.name }} <small>v{{ form.version }}</small>
              </button>
            }
            <button mat-stroked-button (click)="newForm()">+ Макет</button>
            <mat-form-field><mat-label>Код</mat-label><input matInput [(ngModel)]="formCode" /></mat-form-field>
            <mat-form-field><mat-label>Название</mat-label><input matInput [(ngModel)]="formName" /></mat-form-field>
            <mat-form-field><mat-label>Вид</mat-label>
              <mat-select [(ngModel)]="formKind">
                <mat-option value="warning">Предупреждение</mat-option>
                <mat-option value="writ">Исполнительная надпись</mat-option>
                <mat-option value="claim">Иск</mat-option>
                <mat-option value="writeoff">Акт списания</mat-option>
                <mat-option value="disconnect">Заказ-наряд на отключение</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field class="wide"><mat-label>Текст</mat-label><textarea matInput rows="5" [(ngModel)]="formBody"></textarea></mat-form-field>
            <button mat-flat-button color="primary" (click)="saveForm()">Сохранить макет</button>
            <mat-form-field><mat-label>ID счёта для сборки</mat-label><input matInput type="number" [(ngModel)]="renderAccount" /></mat-form-field>
            <button mat-stroked-button (click)="render()">Собрать документ</button>
            @if (rendered()) { <pre>{{ rendered() }}</pre> }
          </mat-card-content>
        </mat-card>
      </div>
    </div>
  `,
  styles: `
    .layout { display: grid; grid-template-columns: 280px 1fr; gap: 16px; }
    .stack { display: flex; flex-direction: column; gap: 16px; }
    .item, .item small { display: block; width: 100%; text-align: left; }
    .item { border: 0; background: transparent; padding: 8px; border-radius: 8px; cursor: pointer; }
    .item.on { background: rgba(0, 90, 120, .08); }
    .fields { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; }
    .step { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .wide { width: 100%; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .banner { background: #fff8e1; border-radius: 8px; padding: 8px 12px; }
    mat-card-title { padding: 16px 16px 0; }
    pre { white-space: pre-wrap; background: #f4f7f8; padding: 12px; border-radius: 8px; }
  `,
})
export class ScenariosComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly snack = inject(MatSnackBar);
  protected readonly auth = inject(AuthService);

  protected readonly actions = ACTIONS;
  protected readonly scenarios = signal<ScenarioRow[]>([]);
  protected readonly forms = signal<PrintFormRow[]>([]);
  protected readonly current = signal<ScenarioRow | null>(null);
  protected readonly print = signal<PrintFormRow | null>(null);
  protected readonly warnings = signal<string[]>([]);
  protected readonly runNote = signal('');
  protected readonly rendered = signal('');

  protected name = '';
  protected steps: ScenarioStep[] = [];
  protected accountId: number | null = null;
  protected pauseReason = '';
  protected formCode = '';
  protected formName = '';
  protected formKind = 'warning';
  protected formBody = 'Уважаемый {fio}, по счёту {account} долг {amount}. Услуги: {services}. Оплатите за {due_days} дн. {organization}.';
  protected renderAccount: number | null = null;

  ngOnInit(): void {
    this.reload();
    this.api.printForms().subscribe({
      next: (page) => this.forms.set(page.results),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected select(row: ScenarioRow): void {
    this.current.set(row);
    this.name = row.name;
    this.steps = row.steps.map((step) => ({ ...step }));
    this.warnings.set([]);
    this.runNote.set('');
  }

  protected create(): void {
    this.api.saveScenario({
      name: 'Новый сценарий',
      steps: [{ order: 1, action: 'warning', wait_days: 5, template: 'Предупреждение', terminal: true }],
    }).subscribe({
      next: (row) => {
        this.reload(row.id);
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected addStep(): void {
    const order = this.steps.reduce((max, step) => Math.max(max, step.order), 0) + 1;
    this.steps = [...this.steps.map((step) => ({ ...step, terminal: false })), { order, action: 'writ', wait_days: 0, terminal: true }];
  }

  protected removeStep(index: number): void {
    this.steps = this.steps.filter((_, item) => item !== index);
  }

  protected save(): void {
    const row = this.current();
    if (!row) return;
    this.api.saveScenario({ id: row.id, name: this.name, steps: this.clean() }).subscribe({
      next: (saved) => {
        this.select(saved);
        this.reload(saved.id);
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected publish(): void {
    const row = this.current();
    if (!row) return;
    this.api.saveScenario({ id: row.id, name: this.name, steps: this.clean() }).subscribe({
      next: (saved) => this.api.publishScenario(saved.id).subscribe({
        next: (result) => {
          this.warnings.set(result.warnings);
          this.snack.open(`Опубликована версия ${result.version}`, 'OK', { duration: 2000 });
          this.reload(saved.id);
        },
        error: (err) => this.snack.open(errorMessage(err), 'OK'),
      }),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected copy(): void {
    const row = this.current();
    if (!row) return;
    this.api.copyScenario(row.id).subscribe({
      next: (copy) => this.reload(copy.id),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected assign(paused: boolean): void {
    const row = this.current();
    if (!row || !this.accountId) return;
    this.api.assignScenario(row.id, {
      account: this.accountId, paused, pause_reason: this.pauseReason,
    }).subscribe({
      next: (run) => this.runNote.set(
        paused
          ? 'Сценарий на паузе.'
          : `На счёте версия ${run.version}. Текущая опубликованная — ${run.current_version}.`,
      ),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected selectForm(form: PrintFormRow): void {
    this.print.set(form);
    this.formCode = form.code;
    this.formName = form.name;
    this.formKind = form.doc_kind;
    this.formBody = form.body;
  }

  protected newForm(): void {
    this.print.set(null);
    this.formCode = 'warning-local';
    this.formName = 'Предупреждение схемы';
    this.formKind = 'warning';
  }

  protected saveForm(): void {
    const current = this.print();
    const body = {
      id: current?.id, code: this.formCode, name: this.formName, doc_kind: this.formKind, body: this.formBody,
    };
    this.api.savePrintForm(body).subscribe({
      next: (saved) => {
        this.selectForm(saved);
        this.api.printForms().subscribe((page) => this.forms.set(page.results));
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected render(): void {
    const form = this.print();
    if (!form || !this.renderAccount) return;
    this.api.renderPrintForm(form.id, this.renderAccount).subscribe({
      next: (result) => this.rendered.set(`Версия шаблона ${result.version}\n\n${result.text}`),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private clean(): ScenarioStep[] {
    return this.steps.map((step) => ({
      order: Number(step.order),
      action: step.action,
      wait_days: Number(step.wait_days || 0),
      template: step.template || '',
      approval: Boolean(step.approval),
      branch_group: step.branch_group ? Number(step.branch_group) : null,
      terminal: Boolean(step.terminal),
    }));
  }

  private reload(selectId?: number): void {
    this.api.scenarios().subscribe({
      next: (page) => {
        this.scenarios.set(page.results);
        const picked = page.results.find((row) => row.id === (selectId ?? this.current()?.id));
        if (picked) this.select(picked);
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }
}
