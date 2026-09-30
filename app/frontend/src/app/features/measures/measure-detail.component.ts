import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable } from 'rxjs';
import { RouterLink } from '@angular/router';

import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MeasureDetail, MeasureItemRow } from '../../core/models';

const CALL_RESULTS = [
  { value: 'answered', label: 'Дозвон' },
  { value: 'no_answer', label: 'Недозвон' },
  { value: 'busy', label: 'Занято' },
  { value: 'bad_number', label: 'Неверный номер' },
];

const DELIVERY_METHODS = [
  { value: 'personal', label: 'Лично под роспись' },
  { value: 'registered', label: 'Заказное письмо' },
  { value: 'administration', label: 'Через администрацию учреждения' },
];

@Component({
  selector: 'app-measure-detail',
  standalone: true,
  imports: [
    DatePipe, FormsModule, RouterLink, MatCardModule, MatButtonModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatCheckboxModule, MatSnackBarModule, MatIconModule, MatTooltipModule,
  ],
  template: `
    <div class="page" [class]="'page kind-' + (measure()?.kind || '')">
      <div class="page-header">
        <a mat-button routerLink="/measures">← Реестр мероприятий</a>
        @if (measure(); as m) {
          <span class="kind-chip {{ m.kind }}">{{ m.kind_display }}</span>
          <h2>{{ m.title }}</h2>
          <span class="status-pill {{ m.status }}">{{ m.status_display }}</span>
        }
      </div>

      @if (error()) { <p class="status-failed">{{ error() }}</p> }

      @if (measure(); as m) {
        <div class="grid">
          <mat-card class="fact"><mat-card-content>
            <dl>
              <dt>Вид</dt><dd><span class="kind-chip {{ m.kind }}">{{ m.kind_display }}</span></dd>
              @if (m.template_name) { <dt>Шаблон</dt><dd>{{ m.template_name }}</dd> }
              @if (m.channel) { <dt>Канал</dt><dd>{{ channelLabel(m.channel) }}</dd> }
              @if (m.scenario_name) { <dt>Сценарий</dt><dd>{{ m.scenario_name }}</dd> }
              <dt>Начато</dt><dd>{{ m.started_on | date: 'dd.MM.yyyy' }}</dd>
              <dt>Срок</dt><dd>{{ (m.due_on | date: 'dd.MM.yyyy') || '—' }}</dd>
              @if (m.time_from) { <dt>Окно обзвона</dt><dd>{{ hhmm(m.time_from) }} – {{ hhmm(m.time_to) }}</dd> }
              <dt>Исполнитель</dt><dd>{{ m.assignee_name || '—' }}</dd>
              <dt>Следующее действие</dt><dd><span class="action-dot {{ m.status }}"></span>{{ m.next_action }}</dd>
              @if (m.artifact) { <dt>Файл</dt><dd><a [href]="m.artifact">Скачать</a></dd> }
            </dl>
          </mat-card-content></mat-card>

          <mat-card class="fact progress-card"><mat-card-content>
            <dl>
              <dt>Лицевых счетов</dt><dd>{{ m.items.length }}</dd>
              <dt>Завершено</dt><dd>{{ done() }} из {{ m.items.length }}</dd>
              @if (m.needs_approval) {
                <dt>Согласование</dt>
                <dd>
                  <span class="status-pill" [class.running]="m.approval === 'pending'" [class.done]="m.approval === 'approved'" [class.failed]="m.approval === 'rejected'">
                    {{ approvalLabel(m.approval) }}
                  </span>
                </dd>
                @if (m.approval_note) { <dt>Решение</dt><dd>{{ m.approval_note }}</dd> }
              }
              @if (m.suspension_confirmed_on) {
                <dt>Приостановлено</dt>
                <dd>{{ m.suspension_confirmed_on | date: 'dd.MM.yyyy' }} ({{ sourceLabel(m.suspension_source) }})</dd>
              }
              @if (m.resumed_on) {
                <dt>Возобновлено</dt>
                <dd>{{ m.resumed_on | date: 'dd.MM.yyyy' }} ({{ sourceLabel(m.resume_source) }})</dd>
              }
              @if (m.note) { <dt>Примечание</dt><dd>{{ m.note }}</dd> }
            </dl>
            @if (m.items.length) {
              <div class="bar"><span [style.width.%]="percent()"></span></div>
            }
          </mat-card-content></mat-card>
        </div>

        @if (canApprove()) {
          <mat-card class="action tone-run"><mat-card-content>
            <h3>Согласование отключения</h3>
            <p class="muted">Без согласования задание не уйдёт поставщику.</p>
            <div class="filters">
              <mat-form-field class="wide">
                <mat-label>Решение или причина отказа</mat-label>
                <input matInput [(ngModel)]="approvalNote" />
              </mat-form-field>
              <button mat-flat-button color="primary" [disabled]="busy()" (click)="approve()">Согласовать</button>
              <button mat-stroked-button [disabled]="busy()" (click)="reject()">Отказать</button>
            </div>
          </mat-card-content></mat-card>
        }

        @if (canAccept()) {
          <mat-card class="action tone-cut"><mat-card-content>
            <h3>Задание поставщику</h3>
            <p class="muted">Принятие переводит лицевые счета на этап «Отключение услуги».</p>
            <button mat-flat-button color="primary" [disabled]="busy()" (click)="accept()">Принять задание</button>
          </mat-card-content></mat-card>
        }

        @if (canConfirm()) {
          <mat-card class="action tone-done"><mat-card-content>
            <h3>Факт приостановления</h3>
            <p class="muted">
              В выгрузке АИС признака отключения пока нет, поэтому источник отметки фиксируется явно.
            </p>
            <div class="filters">
              <mat-form-field>
                <mat-label>Источник</mat-label>
                <mat-select [(ngModel)]="confirmSource">
                  <mat-option value="pm">Отметка в ПМ</mat-option>
                  <mat-option value="ais">Из АИС «Расчет-ЖКУ»</mat-option>
                </mat-select>
              </mat-form-field>
              @if (!m.suspension_confirmed_on) {
                <button mat-flat-button color="primary" [disabled]="busy()" (click)="confirm('suspend')">
                  Услуга приостановлена
                </button>
              } @else if (!m.resumed_on) {
                <button mat-flat-button color="primary" [disabled]="busy()" (click)="confirm('resume')">
                  Услуга возобновлена
                </button>
              }
            </div>
          </mat-card-content></mat-card>
        }

        @if (canCancel()) {
          <mat-card class="action tone-fail"><mat-card-content>
            <h3>Отмена задания</h3>
            <p class="muted">Пока поставщик не приостановил услугу, задание можно отозвать с указанием причины.</p>
            <div class="filters">
              <mat-form-field class="wide">
                <mat-label>Причина отмены</mat-label>
                <input matInput [(ngModel)]="cancelReason" />
              </mat-form-field>
              <button mat-stroked-button [disabled]="busy()" (click)="cancel()">Отменить задание</button>
            </div>
          </mat-card-content></mat-card>
        }

        @if (m.kind === 'notice' && openItems().length) {
          <mat-card class="action tone-notice"><mat-card-content>
            <h3>Отправка уведомлений</h3>
            <p class="muted">
              Каналы на заглушках: ошибка доставки вернётся в строку лицевого счёта, прочтение не подтверждается.
            </p>
            <button mat-flat-button color="primary" [disabled]="busy() || !selected().size" (click)="send()">
              Отправить отмеченным ({{ selected().size }})
            </button>
          </mat-card-content></mat-card>
        }

        @if (m.kind === 'warning' && openItems().length) {
          <mat-card class="action tone-warn"><mat-card-content>
            <h3>Вручение предупреждения</h3>
            <p class="muted">Дата вручения запускает срок оплаты, после которого можно отключать услугу.</p>
            <div class="filters">
              <mat-form-field>
                <mat-label>Способ</mat-label>
                <mat-select [(ngModel)]="deliveryMethod">
                  @for (method of methods; track method.value) {
                    <mat-option [value]="method.value">{{ method.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field>
                <mat-label>Дата вручения или акта</mat-label>
                <input matInput type="date" [(ngModel)]="deliveredOn" />
              </mat-form-field>
              <mat-form-field>
                <mat-label>ФИО получившего</mat-label>
                <input matInput [(ngModel)]="recipientName" [disabled]="refused" />
              </mat-form-field>
              <mat-form-field>
                <mat-label>Почтовый идентификатор</mat-label>
                <input matInput [(ngModel)]="postalId" />
              </mat-form-field>
              <mat-checkbox [(ngModel)]="refused">Отказ или невручение</mat-checkbox>
              <mat-form-field class="wide">
                <mat-label>{{ refused ? 'Текст акта об отказе' : 'Примечание' }}</mat-label>
                <input matInput [(ngModel)]="deliveryReason" />
              </mat-form-field>
              <button mat-flat-button color="primary" [disabled]="busy() || !selected().size" (click)="deliver()">
                Отметить вручение ({{ selected().size }})
              </button>
            </div>
          </mat-card-content></mat-card>
        }

        <section class="surface group items">
          <div class="group-head">
            <span>Лицевые счета партии</span>
            <span class="muted">({{ m.items.length }})</span>
          </div>
          @if (!m.items.length) {
            <p class="muted pad">В этой партии нет лицевых счетов вашего контура.</p>
          } @else {
            <table>
              <thead>
                <tr>
                  @if (selectable()) {
                    <th class="tick">
                      <mat-checkbox [checked]="allPicked()" [indeterminate]="somePicked()" (change)="toggleAll()" />
                    </th>
                  }
                  <th>Должник</th>
                  <th>Статус</th>
                  @switch (m.kind) {
                    @case ('call') { <th>Телефон</th><th>Результат</th> }
                    @case ('notice') { <th>Адресат</th><th>Доставка</th> }
                    @case ('warning') { <th>Вручение</th><th>Отправление</th> }
                    @case ('disconnect') { <th>Приостановлено</th><th>Возобновлено</th> }
                    @default { <th>Отметка</th><th>Примечание</th> }
                  }
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (item of m.items; track item.id) {
                  <tr>
                    @if (selectable()) {
                      <td class="tick">
                        <mat-checkbox
                          [checked]="selected().has(item.id)"
                          [disabled]="!isOpen(item)"
                          (change)="pick(item)" />
                      </td>
                    }
                    <td>
                      <a [routerLink]="['/accounts', item.account]">{{ item.debtor_name || 'ЛС' }}</a>
                      <div class="muted">ЛС {{ item.client_account }}</div>
                    </td>
                    <td>
                      <span class="status-pill {{ item.status }}">{{ item.status_display }}</span>
                      @if (item.delivery_error) { <div class="status-failed">{{ item.delivery_error }}</div> }
                    </td>
                    @switch (m.kind) {
                      @case ('call') {
                        <td>{{ item.phone || '—' }}</td>
                        <td>
                          {{ item.call_result_display || '—' }}
                          @if (item.duration_sec !== null) {
                            <div class="muted">{{ item.duration_sec }} с, прослушано {{ item.listen_percent ?? 0 }}%</div>
                          }
                        </td>
                      }
                      @case ('notice') {
                        <td>{{ item.recipient || '—' }}</td>
                        <td>{{ item.acted_at ? (item.acted_at | date: 'dd.MM.yyyy HH:mm') : '—' }}</td>
                      }
                      @case ('warning') {
                        <td>
                          {{ item.delivery_method_display || '—' }}
                          @if (item.delivered_on) {
                            <div class="muted">{{ item.delivered_on | date: 'dd.MM.yyyy' }}</div>
                          }
                          @if (item.recipient_name) { <div class="muted">{{ item.recipient_name }}</div> }
                          @if (item.refused) { <div class="muted">отказ или невручение</div> }
                        </td>
                        <td>
                          {{ item.postal_status || '—' }}
                          @if (item.postal_id) { <div class="muted">{{ item.postal_id }}</div> }
                        </td>
                      }
                      @case ('disconnect') {
                        <td>{{ (item.suspended_on | date: 'dd.MM.yyyy') || '—' }}</td>
                        <td>{{ (item.resumed_on | date: 'dd.MM.yyyy') || '—' }}</td>
                      }
                      @default {
                        <td>{{ item.acted_at ? (item.acted_at | date: 'dd.MM.yyyy HH:mm') : '—' }}</td>
                        <td>{{ item.note || '—' }}</td>
                      }
                    }
                    <td class="row-actions">
                      @if (isOpen(item)) {
                        <button mat-icon-button matTooltip="Отметить результат" (click)="openRow(item)">
                          <mat-icon>edit_note</mat-icon>
                        </button>
                      } @else if (item.note) {
                        <span class="muted" [matTooltip]="item.note">
                          <mat-icon inline>sticky_note_2</mat-icon>
                        </span>
                      }
                    </td>
                  </tr>
                  @if (rowId() === item.id) {
                    <tr class="row-form">
                      <td [attr.colspan]="selectable() ? 6 : 5">
                        <div class="filters">
                          @if (m.kind === 'call') {
                            <mat-form-field>
                              <mat-label>Результат звонка</mat-label>
                              <mat-select [(ngModel)]="rowResult">
                                @for (result of callResults; track result.value) {
                                  <mat-option [value]="result.value">{{ result.label }}</mat-option>
                                }
                              </mat-select>
                            </mat-form-field>
                            <mat-form-field class="narrow">
                              <mat-label>Длительность, с</mat-label>
                              <input matInput type="number" min="0" [(ngModel)]="rowDuration" />
                            </mat-form-field>
                            <mat-form-field class="narrow">
                              <mat-label>Прослушано, %</mat-label>
                              <input matInput type="number" min="0" max="100" [(ngModel)]="rowListen" />
                            </mat-form-field>
                          } @else {
                            <mat-form-field>
                              <mat-label>Итог</mat-label>
                              <mat-select [(ngModel)]="rowStatus">
                                <mat-option value="done">Завершено</mat-option>
                                <mat-option value="failed">Завершено с ошибкой</mat-option>
                                <mat-option value="cancelled">Прервать</mat-option>
                              </mat-select>
                            </mat-form-field>
                          }
                          <mat-form-field class="wide">
                            <mat-label>{{ reasonLabel() }}</mat-label>
                            <input matInput [(ngModel)]="rowReason" />
                          </mat-form-field>
                          <button mat-flat-button color="primary" [disabled]="busy()" (click)="saveRow(item)">
                            Сохранить
                          </button>
                          <button mat-button type="button" (click)="rowId.set(null)">Отмена</button>
                        </div>
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          }
        </section>

        @if (m.events.length) {
          <section class="surface group">
            <div class="group-head"><span>Журнал переходов</span></div>
            <table>
              <thead>
                <tr><th>Когда</th><th>Кто</th><th>Переход</th><th>Основание</th></tr>
              </thead>
              <tbody>
                @for (event of m.events; track event.id) {
                  <tr>
                    <td>{{ event.created_at | date: 'dd.MM.yyyy HH:mm' }}</td>
                    <td>{{ event.actor || 'Система' }}</td>
                    <td>{{ statusLabel(event.old_status) }} → {{ statusLabel(event.new_status) }}</td>
                    <td>{{ event.reason || '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </section>
        }
      }
    </div>
  `,
  styles: `
    .kind-call .page-header { border-bottom: 3px solid var(--erip-call); }
    .kind-notice .page-header { border-bottom: 3px solid var(--erip-notice); }
    .kind-warning .page-header { border-bottom: 3px solid var(--erip-warn-kind); }
    .kind-disconnect .page-header { border-bottom: 3px solid var(--erip-cut); }
    .kind-collection .page-header { border-bottom: 3px solid var(--erip-claim); }
    .fact { border-top: 3px solid var(--erip-primary); }
    .kind-call .fact { border-top-color: var(--erip-call); }
    .kind-notice .fact { border-top-color: var(--erip-notice); }
    .kind-warning .fact { border-top-color: var(--erip-warn-kind); }
    .kind-disconnect .fact { border-top-color: var(--erip-cut); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; }
    dt { color: var(--erip-muted); font-size: 13px; }
    dd { margin: 0; }
    .action { margin-top: 12px; border-left: 4px solid #cbd5e1; }
    .action.tone-run { border-left-color: #d97706; }
    .action.tone-cut { border-left-color: var(--erip-cut); }
    .action.tone-done { border-left-color: #16a34a; }
    .action.tone-fail { border-left-color: #dc2626; }
    .action.tone-notice { border-left-color: var(--erip-notice); }
    .action.tone-warn { border-left-color: var(--erip-warn-kind); }
    .action h3 { margin: 0 0 4px; font-size: 15px; color: var(--erip-primary-dark); }
    .action p { margin: 0 0 8px; }
    .bar { margin-top: 12px; height: 8px; border-radius: 4px; background: #eef1f4; overflow: hidden; }
    .bar span { display: block; height: 100%; background: #16a34a; }
    .wide { min-width: 320px; }
    .narrow { max-width: 150px; }
    .group { margin-top: 12px; overflow: hidden; }
    .items { border-left: 4px solid var(--erip-primary); }
    .kind-call .items { border-left-color: var(--erip-call); }
    .kind-notice .items { border-left-color: var(--erip-notice); }
    .kind-warning .items { border-left-color: var(--erip-warn-kind); }
    .kind-disconnect .items { border-left-color: var(--erip-cut); }
    .group-head {
      display: flex; align-items: center; gap: 4px; padding: 10px 12px;
      background: #f7f9fb; font-weight: 700; color: var(--erip-primary-dark);
    }
    .group-head .muted { font-weight: 500; }
    .pad { padding: 12px; }
    table { border: 0; border-radius: 0; }
    th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .02em; color: var(--erip-muted); padding: 8px 12px; }
    td { padding: 10px 12px; border-top: 1px solid var(--erip-border); vertical-align: top; }
    .tick { width: 40px; }
    .row-actions { width: 56px; text-align: right; }
    .row-form td { background: #f7f9fb; }
  `,
})
export class MeasureDetailComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly snack = inject(MatSnackBar);

  readonly id = input.required<string>();

  protected readonly callResults = CALL_RESULTS;
  protected readonly methods = DELIVERY_METHODS;
  protected readonly measure = signal<MeasureDetail | null>(null);
  protected readonly selected = signal<Set<number>>(new Set());
  protected readonly rowId = signal<number | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);

  protected approvalNote = '';
  protected cancelReason = '';
  protected confirmSource: 'pm' | 'ais' = 'pm';
  protected deliveryMethod = 'personal';
  protected deliveredOn = '';
  protected recipientName = '';
  protected postalId = '';
  protected refused = false;
  protected deliveryReason = '';
  protected rowResult = 'answered';
  protected rowStatus = 'done';
  protected rowDuration: number | null = null;
  protected rowListen: number | null = null;
  protected rowReason = '';

  protected readonly openItems = computed(() => (this.measure()?.items ?? []).filter((item) => this.isOpen(item)));
  protected readonly done = computed(
    () => (this.measure()?.items ?? []).filter((item) => item.status === 'done').length,
  );
  protected readonly percent = computed(() => {
    const total = this.measure()?.items.length ?? 0;
    return total ? Math.round((this.done() / total) * 100) : 0;
  });
  protected readonly selectable = computed(
    () => ['notice', 'warning'].includes(this.measure()?.kind ?? '') && this.openItems().length > 0,
  );
  protected readonly allPicked = computed(() => {
    const open = this.openItems();
    return open.length > 0 && open.every((item) => this.selected().has(item.id));
  });
  protected readonly somePicked = computed(() => this.selected().size > 0 && !this.allPicked());

  protected readonly canApprove = computed(() => {
    const m = this.measure();
    return !!m && m.needs_approval === true && m.approval === 'pending'
      && ['superadmin', 'local_admin'].includes(this.auth.me()?.role ?? '');
  });

  protected readonly canAccept = computed(() => {
    const m = this.measure();
    return !!m && m.kind === 'disconnect' && m.status === 'assigned' && !m.suspension_confirmed_on
      && this.auth.me()?.contour === 'supplier' && this.approved(m);
  });

  protected readonly canConfirm = computed(() => {
    const m = this.measure();
    return !!m && m.kind === 'disconnect' && m.status !== 'cancelled' && !m.resumed_on && this.approved(m);
  });

  protected readonly canCancel = computed(() => {
    const m = this.measure();
    return !!m && m.kind === 'disconnect' && m.status !== 'cancelled' && !m.suspension_confirmed_on
      && !m.items.some((item) => item.suspended_on);
  });

  constructor() {
    // Переход между карточками не пересоздаёт компонент, поэтому партия перечитывается по смене id.
    effect(() => {
      const id = Number(this.id());
      this.measure.set(null);
      this.rowId.set(null);
      this.load(id);
    }, { allowSignalWrites: true });
  }

  protected isOpen(item: MeasureItemRow): boolean {
    return item.status === 'assigned' || item.status === 'running';
  }

  protected hhmm(value: string | null | undefined): string {
    return (value ?? '').slice(0, 5);
  }

  protected channelLabel(channel: string): string {
    return channel === 'email' ? 'E-mail' : channel === 'sms' ? 'SMS' : channel;
  }

  protected sourceLabel(source: string | undefined): string {
    return source === 'ais' ? 'из АИС' : 'отметка в ПМ';
  }

  protected approvalLabel(approval: string | undefined): string {
    const labels: Record<string, string> = {
      pending: 'Ожидает решения', approved: 'Согласовано', rejected: 'Отказано',
    };
    return labels[approval ?? ''] || 'Не требуется';
  }

  protected statusLabel(status: string): string {
    const labels: Record<string, string> = {
      assigned: 'назначено', running: 'выполняется', done: 'завершено',
      failed: 'ошибка', cancelled: 'прервано', paused: 'приостановлено',
    };
    return labels[status] || status || '—';
  }

  protected reasonLabel(): string {
    return this.measure()?.kind === 'call' ? 'Комментарий к звонку' : 'Основание';
  }

  protected toggleAll(): void {
    const open = this.openItems();
    this.selected.set(this.allPicked() ? new Set() : new Set(open.map((item) => item.id)));
  }

  protected pick(item: MeasureItemRow): void {
    const next = new Set(this.selected());
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    this.selected.set(next);
  }

  protected openRow(item: MeasureItemRow): void {
    this.rowId.set(item.id);
    this.rowResult = item.call_result || 'answered';
    this.rowStatus = 'done';
    this.rowDuration = item.duration_sec;
    this.rowListen = item.listen_percent;
    this.rowReason = item.note || '';
  }

  protected saveRow(item: MeasureItemRow): void {
    const body: Record<string, unknown> = { item_id: item.id, reason: this.rowReason.trim() };
    if (this.measure()?.kind === 'call') {
      body['call_result'] = this.rowResult;
      body['duration_sec'] = this.rowDuration ?? '';
      body['listen_percent'] = this.rowListen ?? '';
    } else {
      body['status'] = this.rowStatus;
    }
    this.run(this.api.recordMeasureItem(this.measureId(), body), 'Результат сохранён', () => this.rowId.set(null));
  }

  protected send(): void {
    this.run(this.api.sendNotices(this.measureId(), [...this.selected()]), 'Уведомления поставлены в отправку');
  }

  protected deliver(): void {
    if (!this.deliveredOn) {
      this.snack.open('Укажите дату вручения или акта', 'OK');
      return;
    }
    this.run(this.api.deliverWarning(this.measureId(), {
      item_ids: [...this.selected()],
      delivery_method: this.deliveryMethod,
      delivered_on: this.deliveredOn,
      recipient_name: this.refused ? '' : this.recipientName.trim(),
      refused: this.refused,
      postal_id: this.postalId.trim(),
      reason: this.deliveryReason.trim(),
    }), 'Вручение отмечено');
  }

  protected approve(): void {
    this.run(this.api.approveMeasure(this.measureId(), this.approvalNote.trim()), 'Отключение согласовано');
  }

  protected reject(): void {
    this.run(this.api.rejectMeasure(this.measureId(), this.approvalNote.trim()), 'Отключение отклонено');
  }

  protected accept(): void {
    this.run(this.api.acceptMeasure(this.measureId()), 'Задание принято');
  }

  protected confirm(action: 'suspend' | 'resume'): void {
    this.run(
      this.api.confirmMeasure(this.measureId(), action, this.confirmSource),
      action === 'suspend' ? 'Приостановление зафиксировано' : 'Возобновление зафиксировано',
    );
  }

  protected cancel(): void {
    this.run(this.api.cancelMeasure(this.measureId(), this.cancelReason.trim()), 'Задание отменено');
  }

  private approved(measure: MeasureDetail): boolean {
    return !measure.needs_approval || measure.approval === 'approved';
  }

  private measureId(): number {
    return Number(this.id());
  }

  /** Любое действие возвращает партию целиком, поэтому список и журнал перечитываются с ответа. */
  private run(request: Observable<unknown>, message: string, after?: () => void): void {
    this.busy.set(true);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.snack.open(message, 'OK', { duration: 3000 });
        after?.();
        this.load(this.measureId());
      },
      error: (err) => {
        this.busy.set(false);
        this.snack.open(errorMessage(err), 'OK');
      },
    });
  }

  private load(id: number): void {
    this.api.measure(id).subscribe({
      next: (measure) => {
        this.measure.set(measure);
        this.selected.set(new Set());
        this.error.set('');
      },
      error: (err) => this.error.set(errorMessage(err)),
    });
  }
}
