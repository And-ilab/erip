import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CalendarEvent, DisconnectCandidate, MeasureGroup, MeasureMatrix, MeasureRow } from '../../core/models';
import { AnalyticsComponent } from '../analytics/analytics.component';
import { CalendarBoardComponent } from '../calendar/calendar-board.component';
import { RegistryFilterComponent, RegistryFilterQuery } from '../registry-filter.component';
import { RegistryViewsComponent } from '../registry-views.component';

@Component({
  selector: 'app-measures-list',
  standalone: true,
  imports: [
    DatePipe, FormsModule, RouterLink, MatFormFieldModule, MatInputModule, MatButtonModule,
    MatIconModule, MatTooltipModule, MatCheckboxModule, MatSnackBarModule,
    RegistryViewsComponent, AnalyticsComponent, CalendarBoardComponent, RegistryFilterComponent,
  ],
  template: `
    <div class="page">
      <div class="toolbar">
        <h2>Реестр мероприятий</h2>
        @if (view() !== 'ready') {
          <app-registry-filter
            target="measures"
            placeholder="Поиск по ЛС, должнику, типу мероприятия..."
            [showMonth]="true"
            (queryChange)="onFilter($event)" />
        } @else if (view() === 'ready') {
          <p class="ready-title">Срок предупреждения истёк — можно приостанавливать услуги</p>
        }
        <button type="button" class="icon" matTooltip="Скачать видимый список" (click)="download()">
          <mat-icon>download</mat-icon>
        </button>
        @if (canOrderDisconnect()) {
          <button type="button" class="icon" [class.on]="view() === 'ready'" matTooltip="Готовы к отключению" (click)="show('ready')">
            <mat-icon>power_off</mat-icon>
          </button>
        }
        <app-registry-views [mode]="view() === 'ready' ? 'list' : view()" (modeChange)="showRegistry($event)" />
      </div>

      @if (view() === 'list') {
        <p class="guide">
          Группа 2: предупреждение, затем {{ waitDays() }} календарных дней на оплату (постановление № 465).
          Если долг остался — приостановление выбранных услуг.
          @if (canOrderDisconnect()) {
            <button type="button" (click)="show('ready')">К отключению</button>
          }
          Группы 3–6 в этом реестре — то же мероприятие, что сценарий на карточке лицевого счёта.
          Дело ведётся во вкладке
          <a routerLink="/claims">претензионно-исковая работа</a>.
        </p>
      }

      @if (error()) { <p class="status-failed">{{ error() }}</p> }

      @if (view() === 'list') {
        @if (loaded() && !groups().length && !error()) {
          <p class="muted">За выбранные условия мероприятий нет.</p>
        }
        @if (groups().length) {
          <section class="surface registry main">
            <div class="list-pane">
            <table class="wide">
              <thead>
                <tr>
                  <th>Мероприятие</th>
                  <th>Должник</th>
                  <th>Исполнитель</th>
                  <th>Следующее действие</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                @for (group of groups(); track group.status) {
                  <tr class="band">
                    <td colspan="5">
                      <button type="button" (click)="toggle(group.status)">
                        <mat-icon>{{ collapsed().has(group.status) ? 'chevron_right' : 'expand_more' }}</mat-icon>
                        {{ group.label }} ({{ group.total }})
                      </button>
                    </td>
                  </tr>
                  @if (!collapsed().has(group.status)) {
                    @for (row of group.results; track row.id) {
                      <tr>
                        <td>
                          <a class="title" [routerLink]="['/measures', row.id]">{{ row.title }}</a>
                          @if (row.progress && row.progress.total > 1) {
                            <div class="mini">
                              <span class="track"><span [style.width.%]="share(row)"></span></span>
                              <span class="muted">{{ row.progress.done }} / {{ row.progress.total }} ЛС</span>
                            </div>
                          }
                          @if (row.artifact) { <a [href]="row.artifact">Файл</a> }
                        </td>
                        <td>
                          @if (row.debtor_id) {
                            <a [routerLink]="['/accounts', row.debtor_id]">{{ row.debtor_name || 'ЛС' }}</a>
                          } @else {
                            <span>{{ row.debtor_name || '—' }}</span>
                          }
                          @if (row.debtor_account) { <div class="muted">ЛС {{ row.debtor_account }}</div> }
                          @if (row.accounts_count > 1) {
                            <div class="muted">ещё {{ row.accounts_count - 1 }} ЛС</div>
                          }
                        </td>
                        <td>
                          @if (row.assignee_name) {
                            <span class="person" [matTooltip]="row.assignee_name">
                              <span class="face t{{ tone(row.assignee_name) }}">{{ initials(row.assignee_name) }}</span>
                            </span>
                          } @else {
                            <span class="dash">—</span>
                          }
                        </td>
                        <td><span class="action-dot {{ row.status }}"></span>{{ row.next_action }}</td>
                        <td><span class="status-pill {{ row.status }}">{{ row.status_display }}</span></td>
                      </tr>
                    }
                    @if (group.results.length < group.total) {
                      <tr class="more-row">
                        <td colspan="5">
                          <span class="muted">Показаны {{ group.results.length }} из {{ group.total }}</span>
                          <button mat-stroked-button type="button" (click)="more(group)">Показать ещё</button>
                        </td>
                      </tr>
                    }
                  }
                }
              </tbody>
            </table>
            </div>
          </section>
        }
      }

      @if (view() === 'list') {
        @if (matrix(); as grid) {
          <section class="surface registry matrix-card" id="measure-matrix" [class.fill]="!groups().length">
            <h3><mat-icon>grid_on</mat-icon> Мероприятия по типам (представление «Матрица»)</h3>
            @if (grid.results.length < grid.total) {
              <div class="more">
                <span class="muted">Показаны {{ grid.results.length }} из {{ grid.total }}</span>
                <button mat-stroked-button type="button" (click)="moreMatrix()">Показать ещё</button>
              </div>
            }
            @if (!grid.results.length && !error()) {
              <p class="muted">За выбранные условия мероприятий нет.</p>
            }
            @if (grid.results.length) {
              <div class="matrix-wrap list-pane">
                <table class="matrix">
                  <thead>
                    <tr>
                      <th>ФИО должника</th>
                      <th>ЛС</th>
                      @for (kind of grid.kinds; track kind.code) { <th>{{ kind.label }}</th> }
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of grid.results; track row.account_id) {
                      <tr>
                        <td><a [routerLink]="['/accounts', row.account_id]">{{ row.debtor_name || 'ЛС' }}</a></td>
                        <td class="muted">{{ row.client_account }}</td>
                        @for (kind of grid.kinds; track kind.code) {
                          <td>
                            @if (row.cells[kind.code]; as cell) {
                              <a class="cell {{ cell.tone }}" [routerLink]="['/measures', cell.measure_id]">
                                <span class="action-dot {{ cell.status }}"></span>{{ cell.label }}
                              </a>
                            } @else {
                              <span class="muted">—</span>
                            }
                          </td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>
        }
      }

      @if (view() === 'kanban') {
        <div class="k-board">
          @for (lane of lanes; track lane.status) {
            <section class="k-col" [class.drop]="dropStatus() === lane.status" [attr.data-status]="lane.status"
                     (dragover)="allowDrop($event, lane.status)" (dragleave)="clearDrop(lane.status)" (drop)="dropOnStatus($event, lane.status)">
              <h3><span>{{ lane.label }}</span><b>{{ laneTotal(lane.status) }}</b></h3>
              <div class="list-pane cards">
                @for (row of laneRows(lane.status); track row.id) {
                  <article class="k-card {{ row.kind }}" [draggable]="canMove()"
                           (dragstart)="startCard($event, row)" (click)="openCard($event, row)">
                    <div class="name">{{ row.title }}</div>
                    <div class="line">{{ row.debtor_name || 'ЛС' }} · ЛС {{ row.debtor_account }}</div>
                    <div class="foot"><span class="when">{{ row.next_action }}</span></div>
                  </article>
                }
                @if (laneGroup(lane.status); as group) {
                  @if (group.results.length < group.total) {
                    <button type="button" class="more-lane" (click)="more(group)">Показать ещё</button>
                  }
                }
              </div>
            </section>
          }
        </div>
      }

      @if (view() === 'calendar') {
        <app-calendar-board
          [events]="events()" [from]="spanFrom" [to]="spanTo" [canCreate]="false"
          (spanChange)="setSpan($event)" (openEvent)="openCalendar($event)" />
      }

      @if (view() === 'charts') {
        <app-analytics scope="measures" scopeLabel="Лицевые счета с мероприятиями" />
      }

      @if (view() === 'ready') {
        <section class="surface group st-failed">
          <div class="group-head">
            <span>Срок предупреждения истёк</span>
            <span class="count">{{ candidates().length }}</span>
          </div>
          <p class="muted pad">
            Лицевые счета, где предупреждение вручено, срок оплаты прошёл, долг не погашен и услугу можно
            отключать за неоплату. Отметьте услуги и сформируйте задание поставщику.
          </p>
          @if (!candidates().length) {
            <p class="muted pad">Счетов, готовых к отключению, сейчас нет.</p>
          } @else {
            <div class="list-pane">
            <table>
              <thead>
                <tr>
                  <th class="tick"></th>
                  <th>Должник</th>
                  <th>Предупреждение вручено</th>
                  <th>Срок оплаты истёк</th>
                  <th>Услуги</th>
                </tr>
              </thead>
              <tbody>
                @for (row of candidates(); track row.account_id) {
                  <tr>
                    <td class="tick">
                      <mat-checkbox [checked]="picked().has(row.account_id)" (change)="pickAccount(row)" />
                    </td>
                    <td>
                      <a [routerLink]="['/accounts', row.account_id]">{{ row.debtor_name || 'ЛС' }}</a>
                      <div class="muted">ЛС {{ row.client_account }}</div>
                      @if (row.refused) { <div class="kind-chip disconnect">акт об отказе</div> }
                    </td>
                    <td>{{ row.delivered_on | date: 'dd.MM.yyyy' }}</td>
                    <td>
                      {{ row.warning_due | date: 'dd.MM.yyyy' }}
                      @if (row.requires_approval) { <div class="kind-chip warning">нужно согласование</div> }
                    </td>
                    <td>
                      @for (service of row.services; track service.id) {
                        <div>
                          <mat-checkbox
                            [checked]="services().has(service.id)"
                            (change)="pickService(row, service.id)">
                            {{ service.name }}
                          </mat-checkbox>
                        </div>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
            </div>
            <div class="more">
              <span class="muted">Отмечено счетов: {{ picked().size }}</span>
              <button mat-flat-button color="primary" [disabled]="busy() || !picked().size" (click)="launch()">
                Сформировать задание на отключение
              </button>
            </div>
          }
        </section>
      }
    </div>
  `,
  styles: `
    :host { display: flex; flex: 1; flex-direction: column; min-height: 0; }
    .page { flex: 1; min-height: 0; display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden; }
    .toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; flex: 0 0 auto; }
    h2 { margin: 0; font-size: 18px; color: var(--erip-primary-dark); white-space: nowrap; flex: 0 0 auto; }
    .icon {
      width: 36px; height: 36px; border: 1px solid var(--erip-border); background: #fff; border-radius: 8px;
      color: var(--erip-muted); cursor: pointer; display: grid; place-items: center;
    }
    .icon.on { color: var(--erip-primary); border-color: var(--erip-primary); background: var(--erip-primary-soft); }
    .icon mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .k-board { display: flex; gap: 14px; overflow: auto; align-items: stretch; flex: 1; min-height: 0; padding-bottom: 12px; }
    .k-col { width: 268px; flex: 0 0 268px; display: flex; flex-direction: column; min-height: 0; }
    .k-col h3 {
      display: flex; justify-content: space-between; align-items: baseline; gap: 8px;
      margin: 0 0 8px; padding: 0 2px 6px; border-bottom: 3px solid #cbd5e1;
      font-size: 13px; font-weight: 600; color: #243140;
    }
    .k-col h3 b { font-weight: 600; color: #8b95a1; }
    .k-col[data-status="assigned"] h3 { border-bottom-color: #2563eb; }
    .k-col[data-status="running"] h3 { border-bottom-color: #e0a106; }
    .k-col[data-status="done"] h3 { border-bottom-color: #1f9d55; }
    .k-col[data-status="failed"] h3 { border-bottom-color: #e53935; }
    .k-col[data-status="paused"] h3 { border-bottom-color: #c8962e; }
    .k-col[data-status="cancelled"] h3 { border-bottom-color: #9ca3af; }
    .k-col .list-pane { flex: 1; min-height: 0; }
    .k-col .list-pane.cards { --list-row: 96px; }
    .k-card {
      display: flex; flex-direction: column; gap: 4px; background: #fff; border: 1px solid #e6ebf0;
      border-left: 3px solid #cbd5e1; border-radius: 8px; padding: 10px 12px 8px; margin-bottom: 8px;
      text-decoration: none; color: inherit; box-shadow: 0 1px 2px rgba(16, 42, 67, .06);
    }
    .k-card:hover { box-shadow: 0 2px 8px rgba(16, 42, 67, .12); }
    .k-card[draggable="true"] { cursor: grab; }
    .k-col.drop { outline: 2px dashed var(--erip-primary); outline-offset: 2px; border-radius: 8px; }
    .k-card.call { border-left-color: #2563eb; }
    .k-card.notice { border-left-color: #0f766e; }
    .k-card.warning { border-left-color: #e0a106; }
    .k-card.disconnect { border-left-color: #f08c2e; }
    .k-card.collection { border-left-color: #e53935; }
    .k-card .name { font-weight: 700; font-size: 14px; line-height: 1.25; color: #1f2933; }
    .k-card .line, .k-card .when { font-size: 12px; line-height: 1.35; color: #6b7280; }
    .more-lane {
      border: 0; background: transparent; color: var(--erip-link); font: inherit; font-weight: 600;
      cursor: pointer; padding: 4px 2px 8px;
    }
    app-calendar-board, app-analytics { display: block; flex: 1; min-height: 0; overflow: auto; }
    .ready-title { margin: 0; color: var(--erip-muted); }
    .guide { margin: 0 0 8px; color: var(--erip-muted); font-size: 13px; flex: 0 0 auto; }
    .guide button, .guide a { margin: 0 4px; }
    .guide button {
      border: 0; background: transparent; color: var(--erip-link); font: inherit; font-weight: 600; cursor: pointer; padding: 0;
    }
    .registry { margin-top: 0; overflow: hidden; }
    .registry.main { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .registry.main .list-pane { flex: 1; max-height: none; min-height: 0; }
    .matrix-card { flex: 0 1 auto; max-height: 34%; min-height: 0; display: flex; flex-direction: column; margin-top: 8px; }
    .matrix-card.fill { flex: 1; max-height: none; }
    .matrix-card .list-pane { flex: 1; max-height: none; min-height: 0; }
    table.wide td, table.wide th { overflow-wrap: break-word; }
    .band td { background: #f7f9fb; padding: 0; }
    .band button {
      display: flex; align-items: center; gap: 4px; width: 100%; border: 0; background: transparent;
      padding: 8px 8px; font: inherit; font-weight: 700; color: #1f2933; cursor: pointer; text-align: left;
    }
    table { border: 0; border-radius: 0; }
    table.wide { width: 100%; table-layout: fixed; }
    table.wide th:nth-child(1), table.wide td:nth-child(1) { width: 34%; }
    table.wide th:nth-child(2), table.wide td:nth-child(2) { width: 28%; }
    table.wide th:nth-child(3), table.wide td:nth-child(3) { width: 12%; }
    table.wide th:nth-child(4), table.wide td:nth-child(4) { width: 14%; }
    table.wide th:nth-child(5), table.wide td:nth-child(5) { width: 12%; }
    th { text-align: left; font-size: 12px; font-weight: 600; color: var(--erip-muted); padding: 8px 12px; background: #fff; }
    td { padding: 10px 12px; border-top: 1px solid var(--erip-border); vertical-align: middle; }
    .title { font-weight: 600; color: inherit; }
    .mini { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
    .track { display: block; width: 72px; height: 6px; border-radius: 3px; background: #e5e7eb; overflow: hidden; }
    .track span { display: block; height: 100%; background: #16a34a; }
    .person { display: inline-flex; }
    .dash { color: var(--erip-muted); }
    .more-row td { display: flex; align-items: center; gap: 12px; }
    .more { display: flex; align-items: center; gap: 12px; margin: 0; padding: 8px 12px 12px; }
    .tick { width: 40px; }
    .pad { padding: 0 12px 8px; }
    a.cell { text-decoration: none; }
    h3 {
      margin: 0; padding: 12px 12px 0; font-size: 15px; color: var(--erip-primary-dark);
      display: flex; align-items: center; gap: 6px;
    }
    h3 mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--erip-muted); }
    .group { margin-top: 12px; overflow: auto; border-left: 4px solid #dc2626; flex: 1; min-height: 0; }
    .group-head {
      display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 12px; border: 0;
      background: #fef2f2; font: inherit; font-weight: 700; color: #b91c1c;
    }
    .count { min-width: 22px; padding: 1px 8px; border-radius: 10px; background: #fff; font-size: 12px; font-weight: 700; }
    .matrix-wrap { overflow: auto; }
    .matrix { width: 100%; min-width: 720px; }
    .cell {
      display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 10px; font-size: 12px; font-weight: 700;
      background: #f3f4f6; color: var(--erip-muted);
    }
    .cell.pending { background: #dbeafe; color: #1d4ed8; }
    .cell.run { background: #fef3c7; color: #b45309; }
    .cell.done { background: #dcfce7; color: #15803d; }
    .cell.error { background: #fee2e2; color: #b91c1c; }
    .cell.wait { background: #fde68a; color: #92400e; }
    .cell.muted { background: #f3f4f6; color: #6b7280; }
  `,
})
export class MeasuresListComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  protected readonly view = signal<'list' | 'kanban' | 'calendar' | 'charts' | 'ready'>('list');
  protected readonly lanes = [
    { status: 'assigned', label: 'Назначено' },
    { status: 'running', label: 'Выполняется' },
    { status: 'done', label: 'Завершено' },
    { status: 'failed', label: 'Завершено с ошибкой' },
    { status: 'paused', label: 'Приостановлено' },
    { status: 'cancelled', label: 'Прервано' },
  ];
  private filter: RegistryFilterQuery = { q: '', groups: [], ratings: [], stage: '', period: '' };
  protected readonly events = signal<CalendarEvent[]>([]);
  protected spanFrom = '';
  protected spanTo = '';
  protected readonly waitDays = signal(5);
  protected readonly groups = signal<MeasureGroup[]>([]);
  protected readonly matrix = signal<MeasureMatrix | null>(null);
  protected readonly candidates = signal<DisconnectCandidate[]>([]);
  protected readonly picked = signal<Set<number>>(new Set());
  protected readonly services = signal<Set<number>>(new Set());
  protected readonly collapsed = signal<Set<string>>(new Set());
  protected readonly error = signal('');
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly dropStatus = signal<string | null>(null);
  private request = 0;
  private cardDragged = false;

  protected canMove(): boolean {
    const me = this.auth.me();
    return !!me && me.role !== 'observer' && me.contour !== 'supplier';
  }

  protected canOrderDisconnect(): boolean {
    return this.auth.canWrite() && this.auth.me()?.contour !== 'supplier';
  }

  ngOnInit(): void {
    this.api.dialSettings().subscribe({
      next: (settings) => this.waitDays.set(settings.warning_wait_days || 5),
    });
    this.load();
  }

  protected show(mode: 'list' | 'ready'): void {
    this.view.set(mode);
    this.load();
  }

  protected showRegistry(mode: string): void {
    if (mode !== 'list' && mode !== 'kanban' && mode !== 'calendar' && mode !== 'charts') return;
    this.view.set(mode);
    if (mode === 'calendar') this.loadCalendar();
    else if (mode !== 'charts') this.load();
  }

  protected setSpan(span: { from: string; to: string }): void {
    this.spanFrom = span.from;
    this.spanTo = span.to;
    this.loadCalendar();
  }

  protected openCalendar(event: CalendarEvent): void {
    if (event.measure_id) this.router.navigate(['/measures', event.measure_id]);
    else if (event.account_id) this.router.navigate(['/accounts', event.account_id]);
  }

  protected download(): void {
    const lines = ['Мероприятие;Должник;Лицевой счёт (Номер ЛС);Исполнитель;Следующее действие;Статус'];
    for (const group of this.groups()) {
      for (const row of group.results) {
        lines.push([row.title, row.debtor_name, row.debtor_account, row.assignee_name, row.next_action, row.status_display]
          .map((value) => `"${String(value || '').replaceAll('"', '""')}"`)
          .join(';'));
      }
    }
    const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'meropriyatiya.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /** Отметка счёта тянет за собой его услуги: отключать нечего, если ни одна не выбрана. */
  protected pickAccount(row: DisconnectCandidate): void {
    const accounts = new Set(this.picked());
    const services = new Set(this.services());
    if (accounts.has(row.account_id)) {
      accounts.delete(row.account_id);
      for (const service of row.services) services.delete(service.id);
    } else {
      accounts.add(row.account_id);
      for (const service of row.services) services.add(service.id);
    }
    this.picked.set(accounts);
    this.services.set(services);
  }

  protected pickService(row: DisconnectCandidate, id: number): void {
    const services = new Set(this.services());
    if (services.has(id)) services.delete(id);
    else services.add(id);
    this.services.set(services);
    const accounts = new Set(this.picked());
    if (row.services.some((service) => services.has(service.id))) accounts.add(row.account_id);
    else accounts.delete(row.account_id);
    this.picked.set(accounts);
  }

  protected launch(): void {
    const accounts = [...this.picked()];
    const services = this.candidates()
      .filter((row) => this.picked().has(row.account_id))
      .flatMap((row) => row.services.map((service) => service.id))
      .filter((id) => this.services().has(id));
    if (!services.length) {
      this.snack.open('Отметьте хотя бы одну услугу', 'OK');
      return;
    }
    this.busy.set(true);
    this.api.createMeasure({ kind: 'disconnect', account_ids: accounts, service_ids: services }).subscribe({
      next: (measure) => {
        this.busy.set(false);
        this.snack.open('Задание на отключение создано', 'OK', { duration: 3000 });
        this.router.navigate(['/measures', measure.id]);
      },
      error: (err) => {
        this.busy.set(false);
        this.snack.open(errorMessage(err), 'OK');
      },
    });
  }

  protected toggle(status: string): void {
    const next = new Set(this.collapsed());
    if (next.has(status)) next.delete(status);
    else next.add(status);
    this.collapsed.set(next);
  }

  protected onFilter(query: RegistryFilterQuery): void {
    this.filter = query;
    this.load();
  }

  protected initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
  }

  protected tone(name: string): number {
    let sum = 0;
    for (const ch of name) sum += ch.charCodeAt(0);
    return sum % 5;
  }

  protected share(row: { progress?: { total: number; done: number } }): number {
    const total = row.progress?.total ?? 0;
    return total ? Math.round(((row.progress?.done ?? 0) / total) * 100) : 0;
  }

  protected startCard(event: DragEvent, row: MeasureRow): void {
    if (!this.canMove()) {
      event.preventDefault();
      return;
    }
    this.cardDragged = true;
    event.dataTransfer?.setData('text/plain', String(row.id));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    event.stopPropagation();
  }

  protected allowDrop(event: DragEvent, status: string): void {
    if (!this.canMove()) return;
    event.preventDefault();
    this.dropStatus.set(status);
  }

  protected clearDrop(status: string): void {
    if (this.dropStatus() === status) this.dropStatus.set(null);
  }

  protected dropOnStatus(event: DragEvent, status: string): void {
    event.preventDefault();
    this.dropStatus.set(null);
    if (!this.canMove()) return;
    const id = Number(event.dataTransfer?.getData('text/plain') || '');
    if (!id) return;
    const current = this.groups().flatMap((group) => group.results).find((row) => row.id === id);
    if (!current || current.status === status) return;
    this.api.measureStatus(id, status).subscribe({
      next: () => this.load(),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected openCard(event: MouseEvent, row: MeasureRow): void {
    if (this.cardDragged) {
      this.cardDragged = false;
      event.preventDefault();
      return;
    }
    this.router.navigate(['/measures', row.id]);
  }

  protected laneGroup(status: string): MeasureGroup | undefined {
    return this.groups().find((group) => group.status === status);
  }

  protected laneRows(status: string) {
    return this.laneGroup(status)?.results ?? [];
  }

  protected laneTotal(status: string): number {
    return this.laneGroup(status)?.total ?? 0;
  }

  protected more(group: MeasureGroup): void {
    const current = this.request;
    const offset = group.results.length;
    this.api.measureRegistry(this.params({ status: group.status, offset })).subscribe({
      next: (payload) => {
        if (current !== this.request) return;
        const extra = payload.groups.find((item) => item.status === group.status);
        if (!extra) return;
        this.groups.update((groups) => groups.map((item) => item.status === group.status
          ? { ...item, total: extra.total, results: [...item.results, ...extra.results], shown: item.results.length + extra.results.length }
          : item));
      },
      error: (err) => {
        if (current === this.request) this.error.set(errorMessage(err));
      },
    });
  }

  protected moreMatrix(): void {
    const current = this.request;
    const grid = this.matrix();
    if (!grid) return;
    this.api.measureMatrix(this.params({ offset: grid.results.length })).subscribe({
      next: (payload) => {
        if (current !== this.request) return;
        const results = [...grid.results, ...payload.results];
        this.matrix.set({ ...payload, results, truncated: results.length < payload.total });
      },
      error: (err) => {
        if (current === this.request) this.error.set(errorMessage(err));
      },
    });
  }

  private params(extra: Record<string, string | number> = {}): Record<string, string | number> {
    const query: Record<string, string | number> = {
      search: this.filter.q,
      period: this.filter.period,
      ...extra,
    };
    if (this.filter.groups.length) query['debt_group__in'] = this.filter.groups.join(',');
    if (this.filter.ratings.length) query['rating__in'] = this.filter.ratings.join(',');
    if (this.filter.stage) query['funnel_stage'] = this.filter.stage;
    return query;
  }

  private loadCalendar(): void {
    if (!this.spanFrom) {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      this.spanFrom = `${now.getFullYear()}-${month}-01`;
      this.spanTo = `${now.getFullYear()}-${month}-${String(last).padStart(2, '0')}`;
    }
    this.api.calendar({ date_from: this.spanFrom, date_to: this.spanTo }, {}).subscribe({
      next: (events) => this.events.set(events.filter((event) => event.measure_id)),
      error: (err) => this.error.set(errorMessage(err)),
    });
  }

  private load(): void {
    const current = ++this.request;
    const params = this.params();
    this.error.set('');
    if (this.view() === 'ready') {
      this.api.readyToDisconnect().subscribe({
        next: (payload) => {
          if (current !== this.request) return;
          this.candidates.set(payload.results);
          this.picked.set(new Set());
          this.services.set(new Set());
        },
        error: (err) => {
          if (current === this.request) this.error.set(errorMessage(err));
        },
      });
      return;
    }
    this.loaded.set(false);
    this.api.measureRegistry(params).subscribe({
      next: (payload) => {
        if (current !== this.request) return;
        this.groups.set(payload.groups);
        this.loaded.set(true);
      },
      error: (err) => {
        if (current !== this.request) return;
        this.loaded.set(true);
        this.error.set(errorMessage(err));
      },
    });
    this.api.measureMatrix(params).subscribe({
      next: (payload) => {
        if (current === this.request) this.matrix.set(payload);
      },
      error: (err) => {
        if (current === this.request) this.error.set(errorMessage(err));
      },
    });
  }
}
