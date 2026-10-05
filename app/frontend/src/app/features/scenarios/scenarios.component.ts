import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
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
    FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatCheckboxModule, MatSnackBarModule,
  ],
  template: `
    <div class="page">
      <p class="back"><a routerLink="/measures">Мероприятия</a></p>
      <header class="head">
        <div>
          <h2>Конструктор сценариев</h2>
          <p>Слева меры и срок, справа условия, действие и переход. Уже запущенный счёт остаётся на своей версии.</p>
          @if (current()) {
            <mat-form-field class="name"><mat-label>Название сценария</mat-label><input matInput [(ngModel)]="name" /></mat-form-field>
          }
        </div>
        <div class="actions">
          @if (canEdit()) {
            <button mat-stroked-button (click)="create()">+ Черновик</button>
          }
          <button mat-flat-button color="primary" (click)="save()">Сохранить</button>
          <mat-checkbox [(ngModel)]="applyRunning">Перевести уже запущенные счета</mat-checkbox>
          <button mat-stroked-button (click)="publish()">Опубликовать</button>
          <button mat-stroked-button (click)="copy()">Копировать в схему</button>
        </div>
      </header>
      <div class="picker list-pane">
        @for (row of scenarios(); track row.id) {
          <button type="button" [class.on]="current()?.id === row.id" (click)="select(row)">
            {{ row.name }}
            <small>{{ row.organization ? 'схема' : 'центр' }} · v{{ row.version }} · {{ row.status === 'active' ? 'активный' : 'черновик' }}</small>
          </button>
        }
      </div>
      @if (current(); as row) {
        <div class="layout">
          <section class="table-wrap">
            <div class="list-pane">
            <table>
              <thead><tr><th>№</th><th>Мера</th><th>Дней</th><th>Режим</th></tr></thead>
              <tbody>
                @for (step of steps; track $index) {
                  <tr [class.on]="picked() === $index" (click)="picked.set($index)">
                    <td>{{ step.order }}</td>
                    <td>{{ actionLabel(step.action) }}</td>
                    <td>{{ step.wait_days || 0 }}</td>
                    <td><span class="mode" [class.hand]="!isAuto(step.action)">{{ isAuto(step.action) ? 'Авто' : 'Вручную' }}</span></td>
                  </tr>
                }
              </tbody>
            </table>
            </div>
            <button mat-stroked-button (click)="addStep()">+ Шаг</button>
          </section>
          @if (steps[picked()]; as step) {
            <section class="pane">
              <h3>Шаг {{ step.order }}. {{ actionLabel(step.action) }}</h3>
              <h4>Условия запуска</h4>
              <div class="line">
                <mat-form-field><mat-label>Ждать дней</mat-label><input matInput type="number" [(ngModel)]="step.wait_days" /></mat-form-field>
                <mat-form-field><mat-label>Группа от</mat-label><input matInput type="number" [(ngModel)]="step.branch_group" /></mat-form-field>
              </div>
              <h4>Действие</h4>
              <div class="line">
                <mat-form-field><mat-label>Мера</mat-label>
                  <mat-select [(ngModel)]="step.action">
                    @for (action of actions; track action.id) { <mat-option [value]="action.id">{{ action.label }}</mat-option> }
                  </mat-select>
                </mat-form-field>
                <mat-form-field><mat-label>Шаблон</mat-label><input matInput [(ngModel)]="step.template" /></mat-form-field>
              </div>
              <mat-checkbox [(ngModel)]="step.approval">Нужно согласование</mat-checkbox>
              @if (step.action === 'messenger') {
                <p class="banner">Мессенджер в сценарии есть, сообщение не отправляется.</p>
              }
              <h4>Переход</h4>
              <mat-checkbox [(ngModel)]="step.terminal">Конечный шаг</mat-checkbox>
              <p class="muted">Следующий шаг — строка ниже в таблице. Два шага с одним номером и тупик без конца сценарий не сохранит.</p>
              <button mat-button (click)="removeStep(picked())">Убрать шаг</button>
            </section>
          }
        </div>
        @if (warnings().length) {
          @for (text of warnings(); track text) { <p class="banner">{{ text }}</p> }
        }
        <div class="assign">
          <mat-form-field><mat-label>ID лицевого счёта</mat-label><input matInput type="number" [(ngModel)]="accountId" /></mat-form-field>
          <mat-form-field class="grow"><mat-label>Причина паузы</mat-label><input matInput [(ngModel)]="pauseReason" /></mat-form-field>
          <button mat-stroked-button (click)="assign(false)">Назначить текущую версию</button>
          <button mat-stroked-button (click)="assign(true)">Поставить на паузу</button>
        </div>
        @if (runNote()) { <p>{{ runNote() }}</p> }
        @if (current()?.revisions?.length) {
          <section class="history">
            <h3>Версии сценария</h3>
            <p class="muted">Откат публикует выбранные шаги новым номером. Запущенные счета остаются на своей версии, пока не отмечен перевод.</p>
            @for (rev of current()?.revisions; track rev.version) {
              <div class="rev">
                <span>v{{ rev.version }} {{ rev.author }}</span>
                <button mat-stroked-button (click)="restore(rev.version)" [disabled]="rev.version === current()?.version">Откатить как новую версию</button>
              </div>
            }
          </section>
        }
      }

      <section class="forms">
        <h3>Печатные формы</h3>
        <p class="muted">Переменные: {{ '{fio}' }}, {{ '{account}' }}, {{ '{amount}' }}, {{ '{address}' }}, {{ '{services}' }}, {{ '{last_payment}' }}, {{ '{organization}' }}, {{ '{due_days}' }}, {{ '{tariff}' }}. Документ запоминает версию шаблона.</p>
        <div class="picker list-pane">
          @for (form of forms(); track form.id) {
            <button type="button" [class.on]="print()?.id === form.id" (click)="selectForm(form)">{{ form.name }} <small>v{{ form.version }}</small></button>
          }
          <button mat-stroked-button (click)="newForm()">+ Макет</button>
        </div>
        <div class="line">
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
        </div>
        <mat-form-field class="wide"><mat-label>Текст</mat-label><textarea matInput rows="4" [(ngModel)]="formBody"></textarea></mat-form-field>
        <div class="actions">
          <button mat-flat-button color="primary" (click)="saveForm()">Сохранить макет</button>
          <mat-form-field><mat-label>ID счёта для сборки</mat-label><input matInput type="number" [(ngModel)]="renderAccount" /></mat-form-field>
          <button mat-stroked-button (click)="render()">Собрать документ</button>
        </div>
        @if (rendered()) { <pre>{{ rendered() }}</pre> }
        @if (print()?.revisions?.length) {
          <h4>Версии макета</h4>
          <p class="muted">Уже собранный документ остаётся на версии, которой его печатали.</p>
          @for (rev of print()?.revisions; track rev.version) {
            <div class="rev">
              <span>v{{ rev.version }}</span>
              <button mat-stroked-button (click)="restoreForm(rev.version)" [disabled]="rev.version === print()?.version">Вернуть текст новой версией</button>
            </div>
          }
        }
      </section>
    </div>
  `,
  styles: `
    .back a { color: var(--erip-link); }
    .head, .actions, .line, .assign { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .head { justify-content: space-between; }
    h2, h3, h4 { margin: 0; color: var(--erip-primary-dark); }
    h4 { margin-top: 8px; font-size: 13px; color: var(--erip-muted); text-transform: uppercase; letter-spacing: .04em; }
    .head p, .muted { color: var(--erip-muted); margin: 4px 0 0; }
    .picker { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
    .picker button { border: 1px solid var(--erip-border); background: #fff; border-radius: 8px; padding: 6px 10px; cursor: pointer; text-align: left; }
    .picker button.on { border-color: var(--erip-primary); background: var(--erip-primary-soft); }
    .picker small { display: block; color: var(--erip-muted); }
    .layout { display: grid; grid-template-columns: 1.1fr .9fr; gap: 16px; }
    .table-wrap, .pane, .forms { background: #fff; border: 1px solid var(--erip-border); border-radius: 12px; padding: 12px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--erip-border); font-size: 13px; }
    th { color: var(--erip-muted); }
    tr { cursor: pointer; }
    tr.on { background: var(--erip-primary-soft); }
    .mode { background: var(--erip-success-soft); color: var(--erip-success); border-radius: 999px; padding: 2px 8px; }
    .mode.hand { background: var(--erip-warn-kind-soft); color: var(--erip-warn-kind); }
    .pane { display: flex; flex-direction: column; gap: 8px; }
    .banner { background: var(--erip-warning-soft); border-radius: 8px; padding: 8px 12px; }
    .assign, .forms, .history { margin-top: 16px; }
    .history, .rev { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .history { flex-direction: column; align-items: stretch; }
    .forms { display: flex; flex-direction: column; gap: 8px; }
    .wide, .grow { width: 100%; flex: 1; }
    pre { white-space: pre-wrap; background: var(--erip-bg); padding: 12px; border-radius: 8px; }
    @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
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
  protected readonly picked = signal(0);
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
  protected applyRunning = false;

  ngOnInit(): void {
    this.reload();
    this.api.printForms().subscribe({
      next: (page) => this.forms.set(page.results),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected canEdit(): boolean {
    const role = this.auth.me()?.role;
    return role !== 'specialist' && role !== 'observer';
  }

  protected actionLabel(id: string): string {
    return this.actions.find((action) => action.id === id)?.label || id;
  }

  protected isAuto(id: string): boolean {
    return id === 'call' || id === 'sms' || id === 'email' || id === 'messenger';
  }

  protected select(row: ScenarioRow): void {
    this.current.set(row);
    this.name = row.name;
    this.steps = row.steps.map((step) => ({ ...step }));
    this.picked.set(0);
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
    this.picked.set(this.steps.length - 1);
  }

  protected removeStep(index: number): void {
    this.steps = this.steps.filter((_, item) => item !== index);
    this.picked.set(Math.max(0, Math.min(index, this.steps.length - 1)));
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
      next: (saved) => this.api.publishScenario(saved.id, this.applyRunning).subscribe({
        next: (result) => {
          this.warnings.set(result.warnings);
          const moved = this.applyRunning ? ` Переведено счетов: ${result.moved}.` : ' Запущенные счета оставлены на своей версии.';
          this.snack.open(`Опубликована версия ${result.version}.${moved}`, 'OK', { duration: 3000 });
          this.reload(saved.id);
        },
        error: (err) => this.snack.open(errorMessage(err), 'OK'),
      }),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected restore(version: number): void {
    const row = this.current();
    if (!row) return;
    this.api.restoreScenario(row.id, version, this.applyRunning).subscribe({
      next: (saved) => {
        this.warnings.set(saved.warnings || []);
        this.reload(saved.id);
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected restoreForm(version: number): void {
    const form = this.print();
    if (!form) return;
    this.api.restorePrintForm(form.id, version).subscribe({
      next: (saved) => {
        this.selectForm(saved);
        this.api.printForms().subscribe((page) => this.forms.set(page.results));
      },
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
        const wanted = selectId ?? this.current()?.id ?? page.results[0]?.id;
        const picked = page.results.find((row) => row.id === wanted);
        if (picked) this.select(picked);
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }
}
