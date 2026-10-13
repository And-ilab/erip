import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ApiService, PrintFormRow, ScenarioRow, ScenarioStep, WritChecklistItem, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DialSettings, MessageTemplate } from '../../core/models';
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

const LOCKED_WRIT = ['warning', 'voluntary', 'package', 'tariff'];

function defaultWritChecklist(): WritChecklistItem[] {
  return [
    { code: 'warning', order: 1, name: 'Предупреждение вручено', criteria: 'Есть дата вручения предупреждения или уведомления', mandatory: true, locked: true },
    { code: 'voluntary', order: 2, name: 'Срок добровольной оплаты истёк', criteria: 'С даты вручения прошло не меньше срока, заданного для схемы', mandatory: true, locked: true },
    { code: 'package', order: 3, name: 'Пакет документов', criteria: 'Сформирован пакет на исполнительную надпись', mandatory: true, locked: true },
    { code: 'tariff', order: 4, name: 'Нотариальный тариф', criteria: 'Тариф из АИС больше нуля, заявление не отозвано', mandatory: true, locked: true },
  ];
}

@Component({
  selector: 'app-scenarios',
  standalone: true,
  imports: [
    FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatCheckboxModule, MatSnackBarModule,
  ],
  template: `
    <div>
      @if (current()) {
        <nav class="subtabs" aria-label="Части сценария">
          <button type="button" [class.on]="sheet() === 'scenario'" (click)="openScenario()">Сценарий</button>
          @for (step of steps; track $index) {
            <button type="button" [class.on]="sheet() === $index" (click)="openStep($index)">{{ stepTabLabel($index) }}</button>
          }
          @if (callStepIndex() < 0) {
            <button type="button" [class.on]="sheet() === 'dial'" (click)="sheet.set('dial')">Автообзвон</button>
          }
        </nav>
      }

      @if (sheet() === 'scenario' || !current()) {
        <p class="lead">Список сценариев и порядок шагов. Условия меры — на её подвкладке. Уже запущенный счёт остаётся на своей версии.</p>
        <div class="picker" id="scenario">
          @for (row of scenarios(); track row.id) {
            <button type="button" [class.on]="current()?.id === row.id" (click)="select(row)">
              {{ row.name }}
              <small>{{ row.organization ? 'схема' : 'центр' }} · v{{ row.version }} · {{ row.status === 'active' ? 'активный' : 'черновик' }}</small>
            </button>
          }
        </div>
        @if (!scenarios().length) {
          <p class="muted">Сценариев нет.</p>
        }

        @if (current(); as row) {
          <section class="card">
            <mat-form-field class="name"><mat-label>Название сценария</mat-label><input matInput [(ngModel)]="name" /></mat-form-field>
            <div class="toolbar">
              @if (canEdit()) {
                <button mat-stroked-button type="button" (click)="create()">+ Черновик</button>
              }
              <button mat-flat-button color="primary" type="button" (click)="save()">Сохранить</button>
              <button mat-stroked-button type="button" (click)="publish()">Опубликовать</button>
              <button mat-stroked-button type="button" (click)="copy()">Копировать в схему</button>
              <mat-checkbox [(ngModel)]="applyRunning">Перевести уже запущенные счета</mat-checkbox>
            </div>
            <p class="meta">{{ row.organization ? 'Схема' : 'Центр' }} · версия {{ row.version }} · {{ row.status === 'active' ? 'активный' : 'черновик' }}</p>
          </section>

          <section class="card">
            <div class="card-head">
              <h3>Шаги</h3>
              <button mat-stroked-button type="button" (click)="addStep()">+ Шаг</button>
            </div>
            @if (steps.length) {
              <div class="list-pane">
                <table>
                  <thead><tr><th>№</th><th>Мера</th><th>Дней</th><th>Режим</th><th></th></tr></thead>
                  <tbody>
                    @for (step of steps; track $index) {
                      <tr (click)="openStep($index)">
                        <td>{{ step.order }}</td>
                        <td>{{ actionLabel(step.action) }}</td>
                        <td>{{ step.wait_days || 0 }}</td>
                        <td><span class="mode" [class.hand]="!isAuto(step.action)">{{ isAuto(step.action) ? 'Авто' : 'Вручную' }}</span></td>
                        <td class="go">Настроить</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="muted">Шагов пока нет.</p>
            }
            <p class="hint">Строка открывает подвкладку шага.</p>
          </section>

          @if (warnings().length) {
            @for (text of warnings(); track text) { <p class="banner">{{ text }}</p> }
          }

          <section class="card">
            <h3>Счёт</h3>
            <div class="toolbar">
              <mat-form-field><mat-label>ID лицевого счёта</mat-label><input matInput type="number" [(ngModel)]="accountId" /></mat-form-field>
              <mat-form-field class="grow"><mat-label>Причина паузы</mat-label><input matInput [(ngModel)]="pauseReason" /></mat-form-field>
              <button mat-stroked-button type="button" (click)="assign(false)">Назначить текущую версию</button>
              <button mat-stroked-button type="button" (click)="assign(true)">Поставить на паузу</button>
            </div>
            @if (runNote()) { <p class="meta">{{ runNote() }}</p> }
            @if (pauses().length) {
              <h4>Паузы по счёту</h4>
              @for (item of pauses(); track item.at) {
                <p class="rev">{{ item.paused ? 'Пауза' : 'В работе' }} · {{ item.actor }} · {{ item.reason }}</p>
              }
            }
          </section>

          @if (row.revisions?.length) {
            <section class="card">
              <h3>Версии</h3>
              <p class="muted">Откат публикует выбранные шаги новым номером. Запущенные счета остаются на своей версии, пока не отмечен перевод.</p>
              @for (rev of row.revisions; track rev.version) {
                <div class="rev">
                  <span>v{{ rev.version }} {{ rev.author }}</span>
                  <button mat-stroked-button type="button" (click)="restore(rev.version)" [disabled]="rev.version === row.version">Откатить как новую версию</button>
                </div>
              }
            </section>
          }

          @if (canEdit()) {
            <section class="card">
              <h3>Сроки схемы</h3>
              <p class="muted">Пустое число дней после предупреждения берёт общее значение ({{ centralWarning }}). Ожидание шага перекрывает срок, записанный в сценарии. У каждой схемы свои числа.</p>
              <div class="grid">
                <mat-form-field><mat-label>Дней после предупреждения</mat-label><input matInput type="number" [(ngModel)]="warningWait" /></mat-form-field>
                @for (item of waitActions; track item.id) {
                  <mat-form-field><mat-label>{{ item.label }}</mat-label><input matInput type="number" [(ngModel)]="stepWaits[item.id]" /></mat-form-field>
                }
              </div>
              <button mat-stroked-button type="button" (click)="saveTimeline()">Сохранить сроки схемы</button>
            </section>
          }
        } @else if (canEdit()) {
          <button mat-stroked-button type="button" (click)="create()">+ Черновик</button>
        }
      }

      @if (activeStep(); as step) {
        <section class="card">
          <div class="card-head">
            <div>
              <h3>Шаг {{ step.order }}. {{ actionLabel(step.action) }}</h3>
              <p class="hint">Условия этой меры. Порядок шагов меняется на подвкладке «Сценарий».</p>
            </div>
            <button mat-stroked-button type="button" (click)="openScenario()">К сценарию</button>
          </div>

          <h4>Условия запуска</h4>
          <div class="grid">
            <mat-form-field><mat-label>Предшествующее мероприятие</mat-label>
              <mat-select [(ngModel)]="step.previous_action">
                <mat-option value="">Любое</mat-option>
                @for (action of actions; track action.id) { <mat-option [value]="action.id">{{ action.label }}</mat-option> }
              </mat-select>
            </mat-form-field>
            <mat-form-field><mat-label>Через сколько дней</mat-label><input matInput type="number" [(ngModel)]="step.wait_days" /></mat-form-field>
            <mat-form-field><mat-label>Применимо к группам</mat-label>
              <mat-select [(ngModel)]="step.groups" multiple>
                @for (group of groups; track group) { <mat-option [value]="group">Группа {{ group }}</mat-option> }
              </mat-select>
            </mat-form-field>
            <mat-form-field><mat-label>Группа от</mat-label><input matInput type="number" [(ngModel)]="step.branch_group" /></mat-form-field>
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
          <div class="checks">
            <mat-checkbox [(ngModel)]="step.require_phone">Есть телефон +375</mat-checkbox>
            <mat-checkbox [(ngModel)]="step.exclude_if_paid">Исключить, если оплата поступила</mat-checkbox>
          </div>

          <h4>Действие</h4>
          <div class="grid">
            <mat-form-field><mat-label>Мера</mat-label>
              <mat-select [ngModel]="step.action" (ngModelChange)="onAction(step, $event)">
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
          @if (step.action === 'call') {
            <h4>Частота по группам</h4>
            <p class="muted">Группы 1–2: один успешный дозвон в день. Группы 4 и старше — один раз. Группа 3 звонит реже: число дней берётся из этого шага.</p>
            <mat-form-field class="name"><mat-label>Группа 3, раз в дней</mat-label>
              <input matInput type="number" min="1" [ngModel]="group3Days(step)" (ngModelChange)="setGroup3Days(step, $event)" />
            </mat-form-field>
          }
          <div class="checks">
            <mat-checkbox [(ngModel)]="step.approval">Нужно согласование</mat-checkbox>
            <mat-checkbox [(ngModel)]="step.auto_complete">Считать выполненным при успешной отправке</mat-checkbox>
          </div>
          @if (step.action === 'messenger') {
            <p class="banner">Мессенджер в сценарии есть, сообщение не отправляется.</p>
          }
          @if (step.action === 'writ') {
            <h4>Чек-лист исполнительной надписи</h4>
            <p class="muted">Название, порядок и критерий приёмки. Обязательный этап блокирует направление нотариусу. Пропуск — только с записанной причиной. Дату вручения, срок оплаты, пакет и тариф убрать нельзя.</p>
            @for (item of step.checklist || []; track item.code; let index = $index) {
              <div class="check">
                <div class="line">
                  <span class="ord">{{ item.order }}</span>
                  <mat-form-field class="grow"><mat-label>Название</mat-label><input matInput [(ngModel)]="item.name" /></mat-form-field>
                  <button mat-button type="button" (click)="moveCheck(step, index, -1)" [disabled]="index === 0">Выше</button>
                  <button mat-button type="button" (click)="moveCheck(step, index, 1)" [disabled]="index === (step.checklist || []).length - 1">Ниже</button>
                  @if (!item.locked) {
                    <button mat-button type="button" (click)="removeCheck(step, index)">Убрать</button>
                  }
                </div>
                <mat-form-field class="wide"><mat-label>Критерий приёмки</mat-label><textarea matInput rows="2" [(ngModel)]="item.criteria"></textarea></mat-form-field>
                <mat-checkbox [(ngModel)]="item.mandatory" [disabled]="!!item.locked">Обязательный этап</mat-checkbox>
                @if (!item.mandatory) {
                  <p class="muted">Этот этап можно перескочить. При направлении нотариусу специалист записывает причину.</p>
                }
              </div>
            }
            @if (!hasDisconnect(step)) {
              <button mat-stroked-button type="button" (click)="addDisconnect(step)">+ Этап «Отключение услуг»</button>
            }
          }

          <h4>Переход</h4>
          <div class="checks">
            <mat-checkbox [(ngModel)]="step.blocks_next">Обязателен для перехода</mat-checkbox>
            <mat-checkbox [(ngModel)]="step.terminal">Конечный шаг</mat-checkbox>
          </div>
          <p class="muted">Следующий шаг — следующая строка таблицы на подвкладке «Сценарий». Два шага с одним номером и тупик без конца сценарий не сохранит.</p>
          <div class="toolbar foot">
            <button mat-flat-button color="primary" type="button" (click)="save()">Сохранить</button>
            <button mat-button type="button" (click)="removeStep(activeIndex())">Убрать шаг</button>
          </div>
        </section>
      }

      @if (sheet() !== 'scenario' && warnings().length) {
        @for (text of warnings(); track text) { <p class="banner">{{ text }}</p> }
      }

      @if (showDial()) {
        @if (sheet() === 'dial') {
          <p class="lead">В этом сценарии нет шага «Автообзвон». Номера схемы и окно задаются здесь.</p>
        }
        @if (canEdit()) {
          <section class="card">
            <h3>Номера схемы</h3>
            <div class="checks">
              <mat-checkbox [(ngModel)]="orgCallLegal">Звонить юридическим лицам в этой схеме</mat-checkbox>
            </div>
            <mat-form-field class="wide"><mat-label>Исходящие номера, по одному в строке</mat-label>
              <textarea matInput rows="3" [(ngModel)]="outgoingNumbers"></textarea>
            </mat-form-field>
            <p class="muted">Ротация уходит в адаптер. Пока адаптер — заглушка, номер пишется в журнал партии, набор не выполняется.</p>
            <div class="checks">
              <mat-checkbox [checked]="false" disabled>Запись разговора</mat-checkbox>
              <mat-checkbox [checked]="false" disabled>Перевод на оператора</mat-checkbox>
            </div>
            <p class="muted">Запись и перевод выключены, пока Asterisk их не отдаёт.</p>
            <button mat-stroked-button type="button" (click)="saveCalling()">Сохранить обзвон схемы</button>
          </section>
        }
        @if (auth.isSuperadmin()) {
          <section class="card">
            <h3>Общее правило номера</h3>
            <div class="grid">
              <mat-form-field><mat-label>Мобильный с числа</mat-label><input matInput type="number" [(ngModel)]="dialDay" /></mat-form-field>
            </div>
            <div class="days">
              @for (day of weekDays; track day.id) {
                <mat-checkbox [checked]="dialWeekdays.includes(day.id)" (change)="toggleDialDay(day.id, $event.checked)">{{ day.label }}</mat-checkbox>
              }
            </div>
            <button mat-stroked-button type="button" (click)="saveGlobalDial()">Сохранить общее правило</button>
          </section>
        }
        @if (current()) {
          <section class="card">
            <h3>Окно обзвона</h3>
            <p class="muted">Будни — вечер, выходные — своё окно. Старт не раньше 27-го числа. Пустое число мобильного и пустые дни берут общее правило номера. Окно записывается вместе со сценарием.</p>
            <div class="grid">
              <mat-form-field><mat-label>ЮЛ в этом сценарии</mat-label>
                <mat-select [(ngModel)]="scenarioCall">
                  <mat-option value="inherit">Как в схеме</mat-option>
                  <mat-option value="yes">Звонить</mat-option>
                  <mat-option value="no">Не звонить</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field><mat-label>Мобильный с числа</mat-label><input matInput type="number" [(ngModel)]="scenarioDialDay" /></mat-form-field>
              <mat-form-field><mat-label>Старт с числа</mat-label><input matInput type="number" min="27" max="31" [(ngModel)]="callFromDay" /></mat-form-field>
              <mat-form-field><mat-label>Будни с</mat-label><input matInput type="time" [(ngModel)]="weekdayFrom" /></mat-form-field>
              <mat-form-field><mat-label>Будни по</mat-label><input matInput type="time" [(ngModel)]="weekdayTo" /></mat-form-field>
              <mat-form-field><mat-label>Выходные с</mat-label><input matInput type="time" [(ngModel)]="weekendFrom" /></mat-form-field>
              <mat-form-field><mat-label>Выходные по</mat-label><input matInput type="time" [(ngModel)]="weekendTo" /></mat-form-field>
            </div>
            <p class="hint">Дни сценария: в какие дни недели брать только мобильный.</p>
            <div class="days">
              @for (day of weekDays; track day.id) {
                <mat-checkbox [checked]="scenarioWeekdays.includes(day.id)" (change)="toggleScenarioDay(day.id, $event.checked)">{{ day.label }}</mat-checkbox>
              }
            </div>
            <button mat-flat-button color="primary" type="button" (click)="save()">Сохранить</button>
          </section>
        }
      }
    </div>
  `,
  styles: `
    .lead { margin: 0 0 12px; max-width: 72ch; color: var(--erip-muted); }
    .subtabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 16px; }
    .subtabs button {
      border: 1px solid var(--erip-border); background: #fff; color: var(--erip-muted);
      border-radius: 999px; padding: 6px 12px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
    }
    .subtabs button.on { background: var(--erip-primary); border-color: var(--erip-primary); color: #fff; }
    .card {
      background: #fff; border: 1px solid var(--erip-border); border-radius: 12px; padding: 16px; margin: 0 0 12px;
    }
    .card-head, .toolbar, .line, .rev { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .card-head { justify-content: space-between; margin-bottom: 8px; }
    .toolbar.foot { margin-top: 8px; }
    h3, h4 { margin: 0; color: var(--erip-primary-dark); }
    h4 { margin: 16px 0 8px; font-size: 12px; color: var(--erip-muted); text-transform: uppercase; letter-spacing: .04em; }
    .card-head + h4 { margin-top: 4px; }
    .hint, .muted, .meta { color: var(--erip-muted); margin: 4px 0 0; }
    .hint { font-size: 13px; }
    .picker { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 12px; }
    .picker button { border: 1px solid var(--erip-border); background: #fff; border-radius: 8px; padding: 6px 10px; cursor: pointer; text-align: left; font: inherit; }
    .picker button.on { border-color: var(--erip-primary); background: var(--erip-primary-soft); }
    .picker small { display: block; color: var(--erip-muted); }
    .name { width: min(420px, 100%); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px; }
    .grid mat-form-field, .wide, .grow { width: 100%; }
    .grow { flex: 1 1 180px; }
    .checks, .days { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 4px 0 8px; }
    .checks { flex-direction: column; align-items: flex-start; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--erip-border); font-size: 13px; }
    th { color: var(--erip-muted); font-weight: 600; }
    tbody tr { cursor: pointer; }
    tbody tr:hover { background: #f4f7f8; }
    .go { text-align: right; color: var(--erip-link); font-weight: 600; white-space: nowrap; }
    .mode { background: var(--erip-success-soft); color: var(--erip-success); border-radius: 999px; padding: 2px 8px; }
    .mode.hand { background: var(--erip-warn-kind-soft); color: var(--erip-warn-kind); }
    .check { border: 1px solid var(--erip-border); border-radius: 8px; padding: 8px; margin: 0 0 8px; }
    .ord { font-weight: 700; color: var(--erip-primary-dark); min-width: 1.5rem; }
    .banner { background: var(--erip-warning-soft); border-radius: 8px; padding: 8px 12px; margin: 0 0 12px; }
    @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
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
  protected readonly sheet = signal<'scenario' | 'dial' | number>('scenario');
  protected readonly print = signal<PrintFormRow | null>(null);
  protected readonly warnings = signal<string[]>([]);
  protected readonly runNote = signal('');
  protected readonly rendered = signal('');
  protected readonly pauses = signal<{ paused: boolean; reason: string; at: string; actor: string }[]>([]);
  protected readonly categories = signal<{ id: number; name: string }[]>([]);
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
  protected outgoingNumbers = '';
  protected callFromDay = 27;
  protected weekdayFrom = '18:00';
  protected weekdayTo = '21:00';
  protected weekendFrom = '10:00';
  protected weekendTo = '22:00';
  protected scenarioCall = 'inherit';
  protected scenarioDialDay: number | null = null;
  protected scenarioWeekdays: number[] = [];
  protected dialDay = 25;
  protected dialWeekdays: number[] = [5, 6];
  protected readonly waitActions = [
    { id: 'call', label: 'До автообзвона, дней' },
    { id: 'email', label: 'До уведомления, дней' },
    { id: 'warning', label: 'До предупреждения, дней' },
    { id: 'writ', label: 'До надписи, дней' },
    { id: 'lawsuit', label: 'До иска, дней' },
  ];
  protected warningWait: number | null = null;
  protected centralWarning = 5;
  protected stepWaits: Record<string, number | null> = {
    call: null, email: null, warning: null, writ: null, lawsuit: null,
  };

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
        next: (row) => {
          this.orgCallLegal = row.call_legal;
          this.outgoingNumbers = (row.outgoing_numbers || []).join('\n');
        },
        error: () => undefined,
      });
      this.api.scenarioTimeline().subscribe({
        next: (row) => {
          this.warningWait = row.warning_wait_custom;
          this.centralWarning = row.central_warning_wait_days;
          for (const item of this.waitActions) this.stepWaits[item.id] = row.step_waits?.[item.id] ?? null;
        },
        error: () => undefined,
      });
    }
    if (this.auth.isSuperadmin()) {
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

  protected onAction(step: ScenarioStep, action: string): void {
    step.action = action;
    if (action === 'writ') step.checklist = this.checksOf(step);
    if (action === 'call' && !step.repeat) step.repeat = this.callRepeat(3);
  }

  protected group3Days(step: ScenarioStep): number {
    const days = step.repeat?.['3']?.every_days;
    return days && days > 0 ? days : 3;
  }

  protected setGroup3Days(step: ScenarioStep, value: number | string): void {
    const days = Math.max(1, Number(value) || 3);
    step.repeat = this.callRepeat(days);
  }

  private callRepeat(group3: number): ScenarioStep['repeat'] {
    return {
      '1': { every_days: 1 },
      '2': { every_days: 1 },
      '3': { every_days: group3 },
      '4': { once: true },
      '5': { once: true },
      '6': { once: true },
    };
  }

  protected moveCheck(step: ScenarioStep, index: number, delta: number): void {
    const list = [...(step.checklist || [])];
    const next = index + delta;
    if (next < 0 || next >= list.length) return;
    const [item] = list.splice(index, 1);
    list.splice(next, 0, item);
    list.forEach((row, place) => { row.order = place + 1; });
    step.checklist = list;
  }

  protected removeCheck(step: ScenarioStep, index: number): void {
    const item = step.checklist?.[index];
    if (!item || item.locked) return;
    step.checklist = (step.checklist || []).filter((_, place) => place !== index)
      .map((row, place) => ({ ...row, order: place + 1 }));
  }

  protected addDisconnect(step: ScenarioStep): void {
    if (this.hasDisconnect(step)) return;
    const list = [...(step.checklist || [])];
    list.push({
      code: 'disconnect',
      order: list.length + 1,
      name: 'Отключение услуг',
      criteria: 'Услуги отключены. Неприменимый этап пропускается с записанной причиной',
      mandatory: false,
      locked: false,
    });
    step.checklist = list;
  }

  protected hasDisconnect(step: ScenarioStep): boolean {
    return (step.checklist || []).some((item) => item.code === 'disconnect');
  }

  private checksOf(step: ScenarioStep): WritChecklistItem[] {
    const raw = step.checklist?.length ? step.checklist : defaultWritChecklist();
    return raw.map((item, index) => ({
      ...item,
      order: item.order || index + 1,
      locked: LOCKED_WRIT.includes(item.code),
      mandatory: LOCKED_WRIT.includes(item.code) ? true : item.mandatory !== false,
    }));
  }

  protected isAuto(id: string): boolean {
    return id === 'call' || id === 'sms' || id === 'email' || id === 'messenger';
  }

  protected openScenario(): void {
    this.sheet.set('scenario');
  }

  protected openStep(index: number): void {
    this.picked.set(index);
    this.sheet.set(index);
  }

  protected activeIndex(): number {
    const sheet = this.sheet();
    return typeof sheet === 'number' ? sheet : -1;
  }

  protected activeStep(): ScenarioStep | null {
    const index = this.activeIndex();
    return index >= 0 ? this.steps[index] ?? null : null;
  }

  protected callStepIndex(): number {
    return this.steps.findIndex((step) => step.action === 'call');
  }

  protected stepTabLabel(index: number): string {
    const step = this.steps[index];
    if (!step) return '';
    const short = this.actionLabel(step.action).replace(/ \(.*\)$/, '');
    const count = this.steps.filter((item) => item.action === step.action).length;
    return count > 1 ? `${step.order}. ${short}` : short;
  }

  protected showDial(): boolean {
    const sheet = this.sheet();
    if (sheet === 'dial') return true;
    const call = this.callStepIndex();
    return call >= 0 && sheet === call;
  }

  private sameScenario = false;
  private pendingSheet: 'scenario' | 'dial' | number = 'scenario';

  private keepSheet(): void {
    const sheet = this.pendingSheet;
    if (this.sameScenario && typeof sheet === 'number' && sheet < this.steps.length) {
      this.picked.set(sheet);
      return;
    }
    if (this.sameScenario && sheet === 'dial') {
      const call = this.callStepIndex();
      if (call < 0) {
        this.picked.set(0);
        return;
      }
      this.sheet.set(call);
      this.picked.set(call);
      return;
    }
    if (this.sameScenario && sheet === 'scenario') {
      this.picked.set(0);
      return;
    }
    this.sheet.set('scenario');
    this.picked.set(0);
  }


  protected select(row: ScenarioRow): void {
    this.sameScenario = this.current()?.id === row.id;
    this.pendingSheet = this.sheet();
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
      checklist: step.action === 'writ' ? this.checksOf(step) : undefined,
    }));
    this.bindTemplateIds();
    this.scenarioCall = row.call_legal == null ? 'inherit' : row.call_legal ? 'yes' : 'no';
    this.scenarioDialDay = row.dial_mobile_from_day ?? null;
    this.scenarioWeekdays = [...(row.dial_mobile_weekdays || [])];
    this.callFromDay = row.call_from_day ?? 27;
    this.weekdayFrom = this.hhmm(row.weekday_from, '18:00');
    this.weekdayTo = this.hhmm(row.weekday_to, '21:00');
    this.weekendFrom = this.hhmm(row.weekend_from, '10:00');
    this.weekendTo = this.hhmm(row.weekend_to, '22:00');
    this.keepSheet();
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
    this.steps = [...this.steps.map((step) => ({ ...step, terminal: false })), {
      order, action: 'writ', wait_days: 0, terminal: true, checklist: defaultWritChecklist(),
    }];
    this.openStep(this.steps.length - 1);
  }

  protected removeStep(index: number): void {
    this.steps = this.steps.filter((_, item) => item !== index);
    this.picked.set(0);
    this.sheet.set('scenario');
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
      ...(step.action === 'writ' ? { checklist: this.cleanChecks(step) } : {}),
      ...(step.action === 'call' ? { repeat: step.repeat || this.callRepeat(this.group3Days(step)) } : {}),
    }));
  }

  private cleanChecks(step: ScenarioStep): WritChecklistItem[] {
    return this.checksOf(step).map((item, index) => ({
      code: item.code,
      name: (item.name || '').trim(),
      order: index + 1,
      criteria: (item.criteria || '').trim(),
      mandatory: LOCKED_WRIT.includes(item.code) ? true : Boolean(item.mandatory),
    }));
  }

  private callFields(): Partial<ScenarioRow> {
    return {
      call_legal: this.scenarioCall === 'inherit' ? null : this.scenarioCall === 'yes',
      dial_mobile_from_day: this.scenarioDialDay ? Number(this.scenarioDialDay) : null,
      dial_mobile_weekdays: this.scenarioWeekdays.length ? [...this.scenarioWeekdays] : null,
      call_from_day: Number(this.callFromDay) || 27,
      weekday_from: this.weekdayFrom || '18:00',
      weekday_to: this.weekdayTo || '21:00',
      weekend_from: this.weekendFrom || '10:00',
      weekend_to: this.weekendTo || '22:00',
    };
  }

  protected saveCalling(): void {
    const numbers = this.outgoingNumbers.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    this.api.saveScenarioCalling({ call_legal: this.orgCallLegal, outgoing_numbers: numbers }).subscribe({
      next: (row) => {
        this.outgoingNumbers = (row.outgoing_numbers || numbers).join('\n');
        this.snack.open('Обзвон схемы сохранён', 'OK', { duration: 2000 });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private hhmm(value: string | null | undefined, fallback: string): string {
    if (!value) return fallback;
    return value.slice(0, 5);
  }

  protected saveTimeline(): void {
    const waits: Record<string, number> = {};
    for (const item of this.waitActions) {
      const value = this.stepWaits[item.id];
      if (value !== null && value !== undefined && String(value) !== '') waits[item.id] = Number(value);
    }
    const warning = this.warningWait === null || String(this.warningWait) === '' ? null : Number(this.warningWait);
    this.api.saveScenarioTimeline({ warning_wait_days: warning, step_waits: waits }).subscribe({
      next: (row) => {
        this.warningWait = row.warning_wait_custom;
        this.snack.open('Сроки схемы сохранены', 'OK', { duration: 2000 });
      },
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

  protected saveGlobalDial(): void {
    this.api.saveDialSettings({
      dial_mobile_from_day: Number(this.dialDay),
      dial_mobile_weekdays: [...this.dialWeekdays],
    }).subscribe({
      next: (row) => {
        this.readDial(row);
        this.snack.open('Общее правило обзвона сохранено', 'OK', { duration: 2000 });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private readDial(row: DialSettings): void {
    this.dialDay = row.dial_mobile_from_day;
    this.dialWeekdays = [...(row.dial_mobile_weekdays || [5, 6])];
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
