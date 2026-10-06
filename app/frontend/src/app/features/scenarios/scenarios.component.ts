import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ApiService, DebtGroupBand, PrintFormRow, ScenarioRow, ScenarioStep, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DialSettings, MessageTemplate } from '../../core/models';
import { TemplatesComponent } from '../templates/templates.component';

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
    FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatCheckboxModule, MatSnackBarModule, TemplatesComponent,
  ],
  template: `
    <div class="page">
      <p class="back"><a routerLink="/measures">Мероприятия</a></p>
      <header class="head">
        <div>
          <h2>Настройка</h2>
          <p>Сценарий, тексты сообщений, печатные формы и методология. Уже запущенный счёт остаётся на своей версии сценария.</p>
          <p class="jumps">
            <a href="#scenario">Сценарий</a>
            <a href="#messages">Шаблоны сообщений</a>
            <a href="#forms">Печатные формы</a>
            @if (auth.isSuperadmin()) { <a href="#methodology">Методология</a> }
          </p>
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
      <div class="picker list-pane" id="scenario">
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
                <mat-form-field><mat-label>Предшествующее мероприятие</mat-label>
                  <mat-select [(ngModel)]="step.previous_action">
                    <mat-option value="">Любое</mat-option>
                    @for (action of actions; track action.id) { <mat-option [value]="action.id">{{ action.label }}</mat-option> }
                  </mat-select>
                </mat-form-field>
                <mat-form-field><mat-label>Через сколько дней</mat-label><input matInput type="number" [(ngModel)]="step.wait_days" /></mat-form-field>
              </div>
              <div class="line">
                <mat-form-field><mat-label>Применимо к группам</mat-label>
                  <mat-select [(ngModel)]="step.groups" multiple>
                    @for (group of groups; track group) { <mat-option [value]="group">Группа {{ group }}</mat-option> }
                  </mat-select>
                </mat-form-field>
                <mat-form-field><mat-label>Группа от</mat-label><input matInput type="number" [(ngModel)]="step.branch_group" /></mat-form-field>
              </div>
              <div class="line">
                <mat-form-field><mat-label>Категория должника</mat-label>
                  <mat-select [(ngModel)]="step.debtor_category">
                    <mat-option [value]="null">Любая</mat-option>
                    @for (category of categories(); track category.id) { <mat-option [value]="category.id">{{ category.name }}</mat-option> }
                  </mat-select>
                </mat-form-field>
                <mat-form-field><mat-label>Тип организации</mat-label>
                  <mat-select [(ngModel)]="step.org_kind">
                    <mat-option value="any">Любая</mat-option>
                    <mat-option value="billing">Начисляющая</mat-option>
                    <mat-option value="supplier">Поставщик</mat-option>
                  </mat-select>
                </mat-form-field>
              </div>
              <div class="line">
                <mat-form-field><mat-label>Лицо</mat-label>
                  <mat-select [(ngModel)]="step.party">
                    <mat-option value="any">Любое</mat-option>
                    <mat-option value="person">Физическое</mat-option>
                    <mat-option value="legal">Юридическое</mat-option>
                  </mat-select>
                </mat-form-field>
                <mat-form-field><mat-label>Статус предыдущего</mat-label>
                  <mat-select [(ngModel)]="step.require_status">
                    <mat-option value="">Не важен</mat-option>
                    <mat-option value="done">Завершено</mat-option>
                  </mat-select>
                </mat-form-field>
              </div>
              <mat-checkbox [(ngModel)]="step.require_phone">Есть телефон +375</mat-checkbox>
              <mat-checkbox [(ngModel)]="step.exclude_if_paid">Исключить, если оплата поступила</mat-checkbox>
              <h4>Действие</h4>
              <div class="line">
                <mat-form-field><mat-label>Мера</mat-label>
                  <mat-select [(ngModel)]="step.action">
                    @for (action of actions; track action.id) { <mat-option [value]="action.id">{{ action.label }}</mat-option> }
                  </mat-select>
                </mat-form-field>
                <mat-form-field><mat-label>Шаблон сообщения</mat-label>
                  <mat-select [ngModel]="templateValue(step)" (ngModelChange)="setTemplate(step, $event)">
                    <mat-option value="">Не выбран</mat-option>
                    @for (item of messageTemplates(); track item.id) {
                      <mat-option [value]="'' + item.id">{{ item.name }} · {{ item.channel_display }}</mat-option>
                    }
                    @if (orphanTemplate(step); as name) {
                      <mat-option [value]="'name:' + name">{{ name }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              </div>
              <mat-checkbox [(ngModel)]="step.approval">Нужно согласование</mat-checkbox>
              <mat-checkbox [(ngModel)]="step.auto_complete">Считать выполненным при успешной отправке</mat-checkbox>
              @if (step.action === 'messenger') {
                <p class="banner">Мессенджер в сценарии есть, сообщение не отправляется.</p>
              }
              <h4>Переход</h4>
              <mat-checkbox [(ngModel)]="step.blocks_next">Обязателен для перехода</mat-checkbox>
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
        @if (pauses().length) {
          <section class="history">
            <h3>Паузы по счёту</h3>
            @for (item of pauses(); track item.at) {
              <div class="rev"><span>{{ item.paused ? 'Пауза' : 'В работе' }} · {{ item.actor }} · {{ item.reason }}</span></div>
            }
          </section>
        }
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

      <app-templates (changed)="loadMessageTemplates()" />

      <section class="forms" id="forms">
        <h3>Печатные формы</h3>
        <p class="muted">Макет — страница из блоков. Порядок, шрифт, отступ и выступ видны сразу. Документ запоминает версию шаблона.</p>
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
              <mat-option value="act">Акт</mat-option>
              <mat-option value="writ">Исполнительная надпись</mat-option>
              <mat-option value="claim">Иск</mat-option>
              <mat-option value="writeoff">Акт списания</mat-option>
              <mat-option value="disconnect">Заказ-наряд на отключение</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field><mat-label>Адресат</mat-label>
            <mat-select [(ngModel)]="formAddressee">
              <mat-option value="debtor">Должник</mat-option>
              <mat-option value="supplier">Поставщик услуги</mat-option>
              <mat-option value="district">Администрация района, ст. 137</mat-option>
            </mat-select>
          </mat-form-field>
        </div>
        <div class="line">
          <mat-form-field><mat-label>Шрифт, пт</mat-label><input matInput type="number" [(ngModel)]="formFont" /></mat-form-field>
          <mat-form-field><mat-label>Отступ, мм</mat-label><input matInput type="number" [(ngModel)]="formIndent" /></mat-form-field>
          <mat-form-field><mat-label>Выступ, мм</mat-label><input matInput type="number" [(ngModel)]="formOutdent" /></mat-form-field>
        </div>
        <div class="tokens">
          @for (token of printTokens; track token) {
            <button type="button" (click)="insertToken(token)">{{ '{' + token + '}' }}</button>
          }
        </div>
        <div class="sheet" [style.font-size.pt]="formFont || 12" [style.padding-left.mm]="formIndent || 0">
          @for (block of formBlocks; track block; let i = $index) {
            <article class="block">
              <header>
                <span>{{ blockTitle(block) }}</span>
                <button type="button" (click)="moveBlock(i, -1)" [disabled]="i === 0">Выше</button>
                <button type="button" (click)="moveBlock(i, 1)" [disabled]="i === formBlocks.length - 1">Ниже</button>
              </header>
              @switch (block) {
                @case ('logo') { <input [(ngModel)]="formLogo" placeholder="Логотип" /> }
                @case ('requisites') { <textarea rows="2" [(ngModel)]="formRequisites" placeholder="Реквизиты"></textarea> }
                @case ('signatory') { <input [(ngModel)]="formSignatory" placeholder="Подпись уполномоченного" /> }
                @case ('body') {
                  <textarea rows="5" [(ngModel)]="formBody" [style.text-indent.mm]="-(formOutdent || 0)" placeholder="Текст с переменными"></textarea>
                }
              }
            </article>
          }
        </div>
        <div class="actions">
          <button mat-flat-button color="primary" (click)="saveForm()">Сохранить макет</button>
          <mat-form-field class="grow"><mat-label>ID счетов через запятую</mat-label><input matInput [(ngModel)]="renderAccounts" /></mat-form-field>
          <button mat-stroked-button (click)="render()">Собрать PDF</button>
        </div>
        @if (rendered()) { <pre>{{ rendered() }}</pre> }
        @if (printDocs().length) {
          <div class="rev">
            @for (doc of printDocs(); track doc.id) {
              <button mat-stroked-button (click)="downloadDoc(doc.id)">PDF ЛС {{ doc.account }} · v{{ doc.version }}</button>
            }
            @if (printBatch()) { <button mat-stroked-button (click)="downloadPackage()">Пакет PDF</button> }
          </div>
        }
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

      <section class="forms">
        <h3>Обзвон</h3>
        @if (canEdit()) {
          <mat-checkbox [(ngModel)]="orgCallLegal">Звонить юридическим лицам в этой схеме</mat-checkbox>
          <button mat-stroked-button (click)="saveCalling()">Сохранить признак схемы</button>
        }
        @if (current()) {
          <div class="line">
            <mat-form-field><mat-label>ЮЛ в этом сценарии</mat-label>
              <mat-select [(ngModel)]="scenarioCall">
                <mat-option value="inherit">Как в схеме</mat-option>
                <mat-option value="yes">Звонить</mat-option>
                <mat-option value="no">Не звонить</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field><mat-label>Мобильный с числа</mat-label><input matInput type="number" [(ngModel)]="scenarioDialDay" /></mat-form-field>
          </div>
          <p class="muted">Пустое число и пустые дни берут общее правило. Дни сценария: отметьте, в какие дни недели брать только мобильный.</p>
          <div class="line">
            @for (day of weekDays; track day.id) {
              <mat-checkbox [checked]="scenarioWeekdays.includes(day.id)" (change)="toggleScenarioDay(day.id, $event.checked)">{{ day.label }}</mat-checkbox>
            }
          </div>
        }
      </section>

      @if (auth.isSuperadmin()) {
        <section class="forms" id="methodology">
          <h3>Настройка методологии</h3>
          <p class="muted">Шкалу и рейтинг меняет суперадминистратор. Сохранение не переписывает уже записанную историю. Текущие буквы обновляются при следующем пересчёте, а с галкой — сразу.</p>
          <div class="list-pane">
            <table>
              <thead><tr><th>Группа</th><th>Название</th><th>Месяцев от</th><th>Месяцев до</th></tr></thead>
              <tbody>
                @for (band of bands(); track band.group) {
                  <tr>
                    <td>{{ band.group }}</td>
                    <td><input [(ngModel)]="band.name" /></td>
                    <td><input type="number" [(ngModel)]="band.months_from" /></td>
                    <td><input type="number" [(ngModel)]="band.months_to" /></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="line">
            <mat-form-field><mat-label>B с группы</mat-label><input matInput type="number" [(ngModel)]="ratingB" /></mat-form-field>
            <mat-form-field><mat-label>C с группы</mat-label><input matInput type="number" [(ngModel)]="ratingCFrom" /></mat-form-field>
            <mat-form-field><mat-label>C по группу</mat-label><input matInput type="number" [(ngModel)]="ratingCTo" /></mat-form-field>
            <mat-form-field><mat-label>E с группы</mat-label><input matInput type="number" [(ngModel)]="ratingE" /></mat-form-field>
            <mat-form-field><mat-label>Мобильный с числа</mat-label><input matInput type="number" [(ngModel)]="dialDay" /></mat-form-field>
          </div>
          <div class="line">
            @for (day of weekDays; track day.id) {
              <mat-checkbox [checked]="dialWeekdays.includes(day.id)" (change)="toggleDialDay(day.id, $event.checked)">{{ day.label }}</mat-checkbox>
            }
          </div>
          <mat-checkbox [(ngModel)]="applyRecorded">Применить к уже рассчитанным текущим значениям</mat-checkbox>
          <div class="actions">
            <button mat-flat-button color="primary" (click)="saveMethodology()">Сохранить методологию</button>
          </div>
        </section>
      }
    </div>
  `,
  styles: `
    .back a, .jumps a { color: var(--erip-link); }
    .jumps { display: flex; gap: 12px; flex-wrap: wrap; margin: 8px 0 0; }
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
    .tokens { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
    .tokens button { border: 1px solid var(--erip-border); background: #fff; border-radius: 999px; padding: 2px 8px; cursor: pointer; font: inherit; font-size: 12px; }
    .sheet { max-width: 520px; background: #fff; border: 1px solid var(--erip-border); padding: 16px; }
    .block { border: 1px dashed var(--erip-border); padding: 8px; margin-bottom: 8px; }
    .block header { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; font-size: 12px; color: var(--erip-muted); }
    .block header button { border: 0; background: transparent; color: var(--erip-link); cursor: pointer; font: inherit; }
    .block input, .block textarea { width: 100%; box-sizing: border-box; border: 0; font: inherit; background: transparent; }
    @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
  `,
})
export class ScenariosComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly snack = inject(MatSnackBar);
  protected readonly auth = inject(AuthService);

  protected readonly actions = ACTIONS;
  protected readonly groups = [1, 2, 3, 4, 5, 6];
  protected readonly weekDays = [
    { id: 0, label: 'Пн' }, { id: 1, label: 'Вт' }, { id: 2, label: 'Ср' },
    { id: 3, label: 'Чт' }, { id: 4, label: 'Пт' }, { id: 5, label: 'Сб' }, { id: 6, label: 'Вс' },
  ];
  protected readonly scenarios = signal<ScenarioRow[]>([]);
  protected readonly forms = signal<PrintFormRow[]>([]);
  protected readonly current = signal<ScenarioRow | null>(null);
  protected readonly picked = signal(0);
  protected readonly print = signal<PrintFormRow | null>(null);
  protected readonly warnings = signal<string[]>([]);
  protected readonly runNote = signal('');
  protected readonly rendered = signal('');
  protected readonly pauses = signal<{ paused: boolean; reason: string; at: string; actor: string }[]>([]);
  protected readonly categories = signal<{ id: number; name: string }[]>([]);
  protected readonly bands = signal<DebtGroupBand[]>([]);
  protected readonly printDocs = signal<{ id: number; account: number; version: number }[]>([]);
  protected readonly printBatch = signal('');
  protected readonly messageTemplates = signal<MessageTemplate[]>([]);

  protected name = '';
  protected steps: ScenarioStep[] = [];
  protected accountId: number | null = null;
  protected pauseReason = '';
  protected formCode = '';
  protected formName = '';
  protected formKind = 'warning';
  protected formAddressee = 'debtor';
  protected formFont = 12;
  protected formIndent = 0;
  protected formOutdent = 0;
  protected formBlocks = ['logo', 'requisites', 'body', 'signatory'];
  protected readonly printTokens = ['fio', 'account', 'amount', 'address', 'services', 'last_payment', 'organization', 'due_days', 'tariff'];
  protected formLogo = '';
  protected formRequisites = '';
  protected formSignatory = '';
  protected formBody = 'Уважаемый {fio}, по счёту {account} долг {amount}. Услуги: {services}. Оплатите за {due_days} дн. {organization}.';
  protected renderAccounts = '';
  protected applyRunning = false;
  protected orgCallLegal = false;
  protected scenarioCall = 'inherit';
  protected scenarioDialDay: number | null = null;
  protected scenarioWeekdays: number[] = [];
  protected ratingB = 3;
  protected ratingCFrom = 4;
  protected ratingCTo = 5;
  protected ratingE = 6;
  protected dialDay = 25;
  protected dialWeekdays: number[] = [5, 6];
  protected applyRecorded = false;

  ngOnInit(): void {
    this.reload();
    this.loadMessageTemplates();
    this.api.printForms().subscribe({
      next: (page) => this.forms.set(page.results),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
    this.api.debtorCategories().subscribe({
      next: (page) => this.categories.set(page.results),
      error: () => this.categories.set([]),
    });
    if (this.canEdit()) {
      this.api.scenarioCalling().subscribe({
        next: (row) => this.orgCallLegal = row.call_legal,
        error: () => undefined,
      });
    }
    if (this.auth.isSuperadmin()) {
      this.api.debtGroups().subscribe({
        next: (page) => this.bands.set(page.results.map((band) => ({ ...band }))),
        error: (err) => this.snack.open(errorMessage(err), 'OK'),
      });
      this.api.dialSettings().subscribe({
        next: (row) => this.readDial(row),
        error: () => undefined,
      });
    }
  }

  protected loadMessageTemplates(): void {
    this.api.templates({ page_size: 200, is_active: true }).subscribe({
      next: (page) => {
        this.messageTemplates.set(page.results);
        this.bindTemplateIds();
      },
      error: () => this.messageTemplates.set([]),
    });
  }

  protected templateValue(step: ScenarioStep): string {
    if (step.template_id) return String(step.template_id);
    const found = this.messageTemplates().find((item) => item.name === step.template);
    if (found) return String(found.id);
    return step.template ? `name:${step.template}` : '';
  }

  protected orphanTemplate(step: ScenarioStep): string {
    const value = this.templateValue(step);
    return value.startsWith('name:') ? value.slice(5) : '';
  }

  protected setTemplate(step: ScenarioStep, value: string): void {
    if (!value) {
      step.template_id = null;
      step.template = '';
      return;
    }
    if (value.startsWith('name:')) {
      step.template_id = null;
      step.template = value.slice(5);
      return;
    }
    const found = this.messageTemplates().find((item) => String(item.id) === value);
    step.template_id = found ? found.id : Number(value);
    step.template = found?.name || step.template || '';
  }

  protected blockTitle(kind: string): string {
    return { logo: 'Логотип', requisites: 'Реквизиты', body: 'Текст', signatory: 'Подпись' }[kind] || kind;
  }

  protected moveBlock(index: number, delta: number): void {
    const next = index + delta;
    if (next < 0 || next >= this.formBlocks.length) return;
    const order = [...this.formBlocks];
    const [item] = order.splice(index, 1);
    order.splice(next, 0, item);
    this.formBlocks = order;
  }

  protected insertToken(token: string): void {
    this.formBody = `${this.formBody}{${token}}`;
  }

  private bindTemplateIds(): void {
    for (const step of this.steps) {
      if (step.template_id) continue;
      const found = this.messageTemplates().find((item) => item.name === step.template);
      if (found) step.template_id = found.id;
    }
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
    this.steps = row.steps.map((step) => ({
      ...step,
      groups: step.groups || [],
      party: step.party || 'any',
      org_kind: step.org_kind || 'any',
      previous_action: step.previous_action || '',
      require_status: step.require_status || '',
      blocks_next: step.blocks_next !== false,
    }));
    this.bindTemplateIds();
    this.scenarioCall = row.call_legal == null ? 'inherit' : row.call_legal ? 'yes' : 'no';
    this.scenarioDialDay = row.dial_mobile_from_day ?? null;
    this.scenarioWeekdays = [...(row.dial_mobile_weekdays || [])];
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
    this.api.saveScenario({ id: row.id, name: this.name, steps: this.clean(), ...this.callFields() }).subscribe({
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
    this.api.saveScenario({ id: row.id, name: this.name, steps: this.clean(), ...this.callFields() }).subscribe({
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
      next: (run) => {
        this.pauses.set(run.pauses || []);
        const skip = run.last_skip ? ` ${run.last_skip}` : '';
        this.runNote.set(
          paused
            ? 'Сценарий на паузе.'
            : `На счёте версия ${run.version}. Текущая опубликованная — ${run.current_version}.${skip}`,
        );
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected selectForm(form: PrintFormRow): void {
    this.print.set(form);
    this.formCode = form.code;
    this.formName = form.name;
    this.formKind = form.doc_kind;
    this.formAddressee = form.addressee || 'debtor';
    this.formFont = form.font_size || 12;
    this.formIndent = form.indent_mm || 0;
    this.formOutdent = form.outdent_mm || 0;
    this.formBlocks = form.block_order?.length ? [...form.block_order] : ['logo', 'requisites', 'body', 'signatory'];
    this.formLogo = form.logo_text || '';
    this.formRequisites = form.requisites || '';
    this.formSignatory = form.signatory || '';
    this.formBody = form.body;
    this.printDocs.set([]);
    this.printBatch.set('');
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
      id: current?.id, code: this.formCode, name: this.formName, doc_kind: this.formKind,
      addressee: this.formAddressee, font_size: Number(this.formFont) || 12,
      indent_mm: Number(this.formIndent) || 0, outdent_mm: Number(this.formOutdent) || 0,
      block_order: this.formBlocks,
      logo_text: this.formLogo, requisites: this.formRequisites, signatory: this.formSignatory, body: this.formBody,
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
    const accounts = this.renderAccounts.split(/[,\s]+/).map((item) => Number(item)).filter((item) => item > 0);
    if (!form || !accounts.length) return;
    this.api.renderPrintForm(form.id, accounts).subscribe({
      next: (result) => {
        this.printDocs.set(result.documents || []);
        this.printBatch.set(result.batch || '');
        this.rendered.set(`Версия шаблона ${result.version}\n\n${result.text}`);
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected downloadDoc(id: number): void {
    const form = this.print();
    if (!form) return;
    this.saveBlob(this.api.printFile(form.id, `documents/${id}`), `document-${id}.pdf`);
  }

  protected downloadPackage(): void {
    const form = this.print();
    if (!form || !this.printBatch()) return;
    this.saveBlob(this.api.printFile(form.id, `package/${this.printBatch()}`), `package-${this.printBatch().slice(0, 8)}.pdf`);
  }

  private clean(): ScenarioStep[] {
    return this.steps.map((step) => ({
      order: Number(step.order),
      action: step.action,
      wait_days: Number(step.wait_days || 0),
      template: step.template || '',
      template_id: step.template_id || null,
      approval: Boolean(step.approval),
      branch_group: step.branch_group ? Number(step.branch_group) : null,
      groups: (step.groups || []).map((group) => Number(group)),
      party: step.party || 'any',
      org_kind: step.org_kind || 'any',
      require_phone: Boolean(step.require_phone),
      debtor_category: step.debtor_category ? Number(step.debtor_category) : null,
      previous_action: step.previous_action || '',
      require_status: step.require_status || '',
      exclude_if_paid: Boolean(step.exclude_if_paid),
      auto_complete: Boolean(step.auto_complete),
      blocks_next: step.blocks_next !== false,
      terminal: Boolean(step.terminal),
    }));
  }

  private callFields(): Partial<ScenarioRow> {
    return {
      call_legal: this.scenarioCall === 'inherit' ? null : this.scenarioCall === 'yes',
      dial_mobile_from_day: this.scenarioDialDay ? Number(this.scenarioDialDay) : null,
      dial_mobile_weekdays: this.scenarioWeekdays.length ? [...this.scenarioWeekdays] : null,
    };
  }

  protected saveCalling(): void {
    this.api.saveScenarioCalling(this.orgCallLegal).subscribe({
      next: () => this.snack.open('Признак схемы сохранён', 'OK', { duration: 2000 }),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected toggleScenarioDay(day: number, checked: boolean): void {
    this.scenarioWeekdays = checked
      ? [...this.scenarioWeekdays, day].sort()
      : this.scenarioWeekdays.filter((item) => item !== day);
  }

  protected toggleDialDay(day: number, checked: boolean): void {
    this.dialWeekdays = checked
      ? [...this.dialWeekdays, day].sort()
      : this.dialWeekdays.filter((item) => item !== day);
  }

  protected saveMethodology(): void {
    const bands = this.bands().map((band) => ({
      ...band,
      months_from: Number(band.months_from),
      months_to: band.months_to === null || band.months_to === undefined || String(band.months_to) === ''
        ? null
        : Number(band.months_to),
    }));
    this.api.saveDebtGroups(bands).subscribe({
      next: (saved) => {
        this.bands.set(saved.map((band) => ({ ...band })));
        this.api.saveDialSettings({
          dial_mobile_from_day: Number(this.dialDay),
          dial_mobile_weekdays: [...this.dialWeekdays],
          rating_b_group: Number(this.ratingB),
          rating_c_from: Number(this.ratingCFrom),
          rating_c_to: Number(this.ratingCTo),
          rating_e_from: Number(this.ratingE),
          apply_recorded: this.applyRecorded,
        } as Partial<DialSettings>).subscribe({
          next: () => this.snack.open('Методология сохранена', 'OK', { duration: 2500 }),
          error: (err) => this.snack.open(errorMessage(err), 'OK'),
        });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private readDial(row: DialSettings): void {
    this.dialDay = row.dial_mobile_from_day;
    this.dialWeekdays = [...(row.dial_mobile_weekdays || [5, 6])];
    this.ratingB = row.rating_b_group ?? 3;
    this.ratingCFrom = row.rating_c_from ?? 4;
    this.ratingCTo = row.rating_c_to ?? 5;
    this.ratingE = row.rating_e_from ?? 6;
  }

  private saveBlob(source: { subscribe: Function }, filename: string): void {
    source.subscribe({
      next: (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (err: unknown) => this.snack.open(errorMessage(err), 'OK'),
    });
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
