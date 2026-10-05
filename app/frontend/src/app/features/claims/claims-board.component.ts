import { Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { debounceTime, distinctUntilChanged, filter } from 'rxjs';

import { ApiService, AssignedAccount, ClaimCase, Named, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { AccountRow, CalendarEvent } from '../../core/models';
import { AnalyticsComponent } from '../analytics/analytics.component';
import { CalendarBoardComponent } from '../calendar/calendar-board.component';
import { RegistryViewsComponent } from '../registry-views.component';

@Component({
  selector: 'app-claims-board',
  standalone: true,
  imports: [
    FormsModule, ReactiveFormsModule, RouterLink, RouterLinkActive, RouterOutlet, MatButtonModule, MatSnackBarModule,
    RegistryViewsComponent, AnalyticsComponent, CalendarBoardComponent,
  ],
  template: `
    <div class="page" [class.dim]="dialog()">
      <div class="toolbar">
        <h2>Претензионно-исковая работа</h2>
        @if (canAdd()) {
          <button type="button" class="add" (click)="openCreate()">+ Добавить исполнительную надпись</button>
        }
        <app-registry-views [mode]="mode()" (modeChange)="showView($event)" />
      </div>
      @if (mode() === 'list') {
      <div class="layout">
        <aside>
          <div class="chips">
            <button type="button" [class.on]="lane() === 'all'" (click)="lane.set('all')">Все дела</button>
            <button type="button" [class.on]="lane() === 'g3'" (click)="lane.set('g3')">Группа 3</button>
            <button type="button" [class.on]="lane() === 'late'" (click)="lane.set('late')">Группы 4–6</button>
          </div>
          <p class="hint">
            Группа 2 остаётся в мероприятиях: предупреждение и приостановление услуг.
            С группы 3 — надпись, иск и ОПИ. С группы 4 — ещё выселение и отчуждение.
          </p>
          @if (error()) { <p class="error">{{ error() }}</p> }
          <div class="list-pane">
          <h3 class="queue-title">Назначено, дело не открыто</h3>
          @if (!assignedVisible().length) {
            <p class="hint">Счетов без открытого дела нет.</p>
          } @else {
            @for (row of assignedVisible(); track row.account) {
              <button type="button" class="debtor queue" (click)="openAssigned(row)">
                <span>
                  <b>{{ row.short_fio || 'Без ФИО' }}</b>
                  <small>ЛС {{ row.client_account }} · группа {{ row.debt_group || '—' }}</small>
                </span>
                <em>назначено</em>
              </button>
            }
          }
          @if (!visible().length && !assignedVisible().length && !error()) {
            <p class="hint">Дел пока нет. Добавьте надпись по лицевому счёту группы 3 или старше.</p>
          }
          @for (card of visible(); track card.id) {
            <a class="debtor" [routerLink]="['/claims', card.id]" routerLinkActive="on">
              <span>
                <b>{{ card.short_fio || 'Без ФИО' }}</b>
                <small>ЛС {{ card.client_account }} · группа {{ card.debt_group || '—' }}</small>
              </span>
              <em [attr.data-stage]="card.stage">{{ card.stage_label }}</em>
            </a>
          }
          </div>
        </aside>

        <section class="main">
          <router-outlet />
          @if (!caseOpen()) {
            <div class="empty">
              <h2>Претензионно-исковая работа</h2>
              <p>Группа 3: пакет документов нотариусу или в суд, учёт решения, обмен с ОПИ, нотариальный тариф и госпошлина.</p>
              <p>Группы 4–6: дополнительно выселение из государственного фонда (ст. 80), арендного жилья (ст. 86), общежития (ст. 87) или отчуждение (ст. 137).</p>
              <p class="hint">Выберите должника слева или добавьте исполнительную надпись. Суммы долга и пени приходят из АИС и здесь не правятся.</p>
            </div>
          }
        </section>
      </div>
      }

      @if (mode() === 'kanban') {
        <div class="board">
          @for (lane of lanes; track lane.id) {
            <section class="column" [attr.data-lane]="lane.id">
              <h3><span>{{ lane.label }}</span><b>{{ laneCards(lane.id).length }}</b></h3>
              <div class="list-pane cards">
              @for (card of laneCards(lane.id); track card.id) {
                <button type="button" class="card" (click)="openLaneCard(card)">
                  <strong>{{ card.short_fio || 'Без ФИО' }}</strong>
                  <span class="ls">ЛС {{ card.client_account }}</span>
                  <span class="addr">{{ card.account_address || 'Адрес не указан' }}</span>
                  <span class="meta"><em [attr.data-stage]="card.stage">{{ card.stage_label }}</em> · Гр. {{ card.debt_group || '—' }}</span>
                  <span class="money">{{ money(card.balance_out) }} <small>+ пеня {{ money(card.penalty) }}</small></span>
                </button>
              }
              </div>
            </section>
          }
        </div>
      }

      @if (mode() === 'calendar') {
        <app-calendar-board
          [events]="claimEvents()" [from]="spanFrom" [to]="spanTo" [canCreate]="false"
          (spanChange)="setSpan($event)" (openEvent)="openClaimEvent($event)" />
      }

      @if (mode() === 'charts') {
        <app-analytics scope="claims" scopeLabel="Лицевые счета претензионно-исковой работы" />
      }

      @if (dialog()) {
        <div class="backdrop" (click)="closeDialog()">
          <form class="modal" (click)="pickerOpen.set(false); $event.stopPropagation()" (ngSubmit)="save(false)">
            <h2>Добавление исполнительной надписи</h2>
            <p class="hint">
              Пакет собирается из шаблона и вложений. Переход «Направлено нотариусу» возможен только с датой вручения предупреждения и нотариальным тарифом.
              В личный кабинет БНП на этом этапе пакет не уходит: канал — заглушка, файлы .pdf.sgn / .pdf.p7s до 15 МБ проверяет шлюз.
            </p>

            <h3>Дело</h3>
            <div class="picker" (click)="$event.stopPropagation()">
              <label>ЛС / должник
                <input [formControl]="query" placeholder="Номер ЛС или ФИО" (click)="openPicker()" />
              </label>
              @if (pickerOpen()) {
                <div class="picks">
                  @if (query.value.trim().length < 2) {
                    <p>Введите не меньше 2 символов — в списке не больше 12 счетов.</p>
                  } @else if (!found().length) {
                    <p>Ничего не найдено.</p>
                  } @else {
                    @for (row of found(); track row.id) {
                      <button type="button" [class.on]="picked()?.id === row.id" (click)="choose(row)">
                        {{ row.client_account }} — {{ row.short_fio || 'без ФИО' }} (Группа {{ groupOf(row) || '—' }})
                      </button>
                    }
                  }
                </div>
              }
            </div>
            @if (picked(); as row) {
              <p class="chosen">{{ row.client_account }} — {{ row.short_fio || 'без ФИО' }} (Группа {{ groupOf(row) || '—' }})</p>
              @if (early(row)) {
                <p class="warn">
                  Группа {{ groupOf(row) }}: исполнительная надпись не открывается.
                  Для группы 2 — предупреждение и приостановление услуг в реестре мероприятий.
                  Модуль включается с группы 3.
                </p>
              }
              @if ((groupOf(row) || 0) >= 4) {
                <p class="hint">Группа {{ groupOf(row) }}: после надписи доступны иск о выселении и отчуждении жилья.</p>
              }
              @if (already(); as open) {
                <p class="hint">Дело уже есть: {{ open.stage_label }}. <a [routerLink]="['/claims', open.id]" (click)="closeDialog()">Открыть</a></p>
              }
            }
            <label>Период задолженности
              <input [value]="periodText()" readonly />
            </label>
            <label [class.miss]="sendTried() && !warningDate">Дата вручения предупреждения
              <input type="date" [(ngModel)]="warningDate" name="warning" />
            </label>
            <p class="check" [class.ok]="!!warningDate">
              {{ warningDate ? 'Вручено — условие чек-листа выполнено' : 'Нет даты вручения предупреждения' }}
            </p>

            <h3>Суммы</h3>
            <label>Основной долг <input [value]="money(picked()?.balance_out ?? editing()?.balance_out ?? null)" readonly /></label>
            <label>Пеня <input [value]="money(picked()?.mulct_total ?? editing()?.penalty ?? null)" readonly /></label>
            <label [class.miss]="sendTried() && !(Number(tariff) > 0)">Нотариальный тариф
              <input [(ngModel)]="tariff" name="tariff" placeholder="считает АИС, пока можно внести" />
            </label>
            <p class="aside-note">Рассчитывается в АИС и относится на должника. ПМ сумму начисления не меняет.</p>
            <label class="total">Итого к взысканию <input [value]="grand()" readonly /></label>

            <h3>Нотариус</h3>
            <label>Нотариальная контора
              <input value="Справочник контор ещё не подключён" disabled />
            </label>

            <h3>Пакет документов</h3>
            <ul class="pack">
              <li><span>Заявление о совершении исполнительной надписи</span><em class="wait">из шаблона при направлении</em></li>
              <li>
                <span>Расчёт задолженности по ЛС {{ picked()?.client_account || editing()?.client_account || '' }}</span>
                <em class="ok">из АИС</em>
              </li>
              <li>
                <span>Копия предупреждения с отметкой о вручении</span>
                <em [class.ok]="!!warningDate" [class.wait]="!warningDate">{{ warningDate ? 'дата есть' : 'нет даты' }}</em>
              </li>
              <li><span>Выписка о зарегистрированных лицах</span><em class="wait">ожидает загрузки на карточку</em></li>
            </ul>

            <div class="actions">
              <button type="button" class="primary" [disabled]="busy() || !canSend()" (click)="save(true)">Сформировать пакет и направить</button>
              <button type="submit" class="ghost" [disabled]="busy() || !canDraft()">Сохранить черновик</button>
              <button type="button" class="ghost" (click)="closeDialog()">Отмена</button>
            </div>
          </form>
        </div>
      }
    </div>
  `,
  styles: `
    .toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .toolbar h2 { margin: 0; color: var(--erip-primary-dark); font-size: 20px; }
    .layout { display: grid; grid-template-columns: 280px 1fr; gap: 16px; align-items: start; }
    aside { background: #fff; border: 1px solid var(--erip-border); border-radius: 10px; padding: 12px; }
    .add {
      border: 0; background: var(--erip-primary); color: #fff; border-radius: 8px; padding: 8px 12px;
      font: inherit; font-weight: 600; cursor: pointer;
    }
    .queue-title { margin: 8px 0 4px; font-size: 12px; letter-spacing: .03em; color: var(--erip-muted); font-weight: 700; }
    .debtor.queue { width: 100%; border: 0; background: transparent; font: inherit; cursor: pointer; text-align: left; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
    .chips button { border: 1px solid var(--erip-border); background: #fff; border-radius: 999px; padding: 3px 10px; cursor: pointer; font: inherit; font-size: 12px; }
    .chips button.on { background: var(--erip-primary); color: #fff; border-color: var(--erip-primary); }
    .hint, .empty p { color: var(--erip-muted); font-size: 13px; }
    .error, .warn { color: var(--erip-danger); font-size: 13px; }
    .debtor {
      display: flex; justify-content: space-between; gap: 8px; align-items: center; text-decoration: none; color: inherit;
      padding: 8px 4px; border-top: 1px solid var(--erip-border);
    }
    .debtor.on { background: var(--erip-primary-soft); border-radius: 8px; }
    .debtor b { display: block; font-size: 14px; }
    .debtor small { color: var(--erip-muted); }
    .debtor em {
      font-style: normal; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 8px; white-space: nowrap;
      background: #e8eef8; color: #2458a6;
    }
    .debtor em[data-stage="writ_done"], .debtor em[data-stage="recovered"] { background: #e5f6ea; color: #1b7a32; }
    .debtor em[data-stage="refused"], .debtor em[data-stage="impossible"] { background: #fdecec; color: #b42318; }
    .debtor em[data-stage="prep"] { background: #f3f4f6; color: #4b5563; }
    .main { min-width: 0; }
    .empty { background: #fff; border: 1px solid var(--erip-border); border-radius: 10px; padding: 16px 18px; }
    .empty h2 { margin: 0 0 8px; color: var(--erip-primary-dark); font-size: 18px; }
    .board { display: flex; gap: 10px; overflow-x: auto; align-items: flex-start; }
    .column { width: 220px; flex: 0 0 220px; background: #f7f8fa; border-radius: 10px; padding: 0 8px 8px; }
    .column h3 { margin: 0 -8px 8px; padding: 8px 10px; border-radius: 10px 10px 0 0; color: #fff; font-size: 13px; display: flex; justify-content: space-between; background: var(--erip-claim); }
    .column[data-lane="pack"] h3 { background: #2e7d32; }
    .column[data-lane="notary"] h3 { background: var(--erip-claim); }
    .column[data-lane="court"] h3 { background: var(--erip-notice); }
    .column[data-lane="opi"] h3 { background: var(--erip-cut); }
    .column[data-lane="finish"] h3 { background: #6b7280; }
    .card {
      display: flex; flex-direction: column; gap: 3px; width: 100%; text-align: left; font: inherit; cursor: pointer;
      background: #fff; border: 0; border-radius: 8px; padding: 10px; margin-bottom: 8px; color: inherit;
    }
    .card em {
      font-style: normal; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 8px;
      background: #e8eef8; color: #2458a6;
    }
    .card em[data-stage="writ_done"], .card em[data-stage="recovered"] { background: #e5f6ea; color: #1b7a32; }
    .card em[data-stage="refused"], .card em[data-stage="impossible"] { background: #fdecec; color: #b42318; }
    .card em[data-stage="prep"] { background: #f3f4f6; color: #4b5563; }
    .ls, .addr, .money small { color: var(--erip-muted); font-size: 12px; }
    .backdrop { position: fixed; inset: 0; z-index: 30; background: rgba(20, 40, 55, .45); display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
    .modal {
      box-sizing: border-box; width: 720px; max-width: calc(100vw - 32px);
      height: min(640px, calc(100vh - 48px)); overflow: auto;
      background: #fff; border-radius: 12px; padding: 20px 22px 16px; box-shadow: 0 16px 40px rgba(16, 42, 67, .25);
    }
    .modal h2 { margin: 0 0 6px; font-size: 20px; color: #1f2933; }
    .modal h3 { margin: 14px 0 8px; font-size: 12px; letter-spacing: .04em; color: var(--erip-muted); }
    .modal label { display: grid; grid-template-columns: 220px 1fr; gap: 8px; align-items: center; margin: 6px 0; font-size: 14px; }
    .modal input { border: 1px solid var(--erip-border); border-radius: 6px; padding: 8px 10px; font: inherit; background: #fff; }
    .modal input[readonly], .modal input:disabled { background: #f7f8fa; color: #374151; }
    .modal label.miss input { border-color: var(--erip-danger); background: #fff6f6; }
    .modal label.total input { font-weight: 700; }
    .picker { position: relative; }
    .picks {
      position: absolute; z-index: 2; left: 220px; right: 0; top: 100%; max-height: 240px; overflow: auto;
      display: flex; flex-direction: column; gap: 4px; margin: 4px 0 0; padding: 6px;
      background: #fff; border: 1px solid var(--erip-border); border-radius: 8px; box-shadow: 0 8px 20px rgba(16, 42, 67, .15);
    }
    .picks p { margin: 4px; color: var(--erip-muted); font-size: 13px; }
    .picks button, .chosen { font-size: 13px; }
    .picks button { text-align: left; border: 1px solid var(--erip-border); background: #fff; border-radius: 6px; padding: 6px 8px; cursor: pointer; }
    .picks button.on { border-color: var(--erip-primary); background: var(--erip-primary-soft); }
    .check { margin: 0 0 0 220px; font-size: 13px; color: var(--erip-danger); }
    .check.ok { color: var(--erip-success); }
    .aside-note { margin: 0 0 0 220px; color: var(--erip-muted); font-size: 12px; }
    .pack { list-style: none; padding: 0; margin: 0; }
    .pack li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--erip-border); font-size: 14px; }
    .pack em { font-style: normal; font-size: 12px; font-weight: 700; }
    .pack em.ok { color: var(--erip-success); }
    .pack em.wait { color: #b45309; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
    .actions button { border-radius: 8px; padding: 8px 14px; font: inherit; cursor: pointer; }
    .actions button:disabled { opacity: .55; cursor: default; }
    .primary { border: 0; background: var(--erip-primary); color: #fff; font-weight: 600; }
    .ghost { border: 1px solid var(--erip-border); background: #fff; }
    @media (max-width: 900px) {
      .layout, .modal label { grid-template-columns: 1fr; }
      .picks { left: 0; }
      .check, .aside-note { margin-left: 0; }
      .toolbar { flex-wrap: wrap; }
    }
  `,
})
export class ClaimsBoardComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  protected readonly stages = signal<Named[]>([]);
  protected readonly cards = signal<ClaimCase[]>([]);
  protected readonly error = signal('');
  protected readonly mode = signal<'list' | 'kanban' | 'calendar' | 'charts'>('list');
  protected readonly lane = signal<'all' | 'g3' | 'late'>('all');
  protected readonly assigned = signal<AssignedAccount[]>([]);
  protected readonly pickerOpen = signal(false);
  protected spanFrom = monthStart();
  protected spanTo = monthEnd();
  protected readonly caseOpen = signal(false);
  protected readonly dialog = signal(false);
  protected readonly found = signal<AccountRow[]>([]);
  protected readonly picked = signal<AccountRow | null>(null);
  protected readonly editing = signal<ClaimCase | null>(null);
  protected readonly busy = signal(false);
  protected readonly sendTried = signal(false);
  protected readonly query = new FormControl('', { nonNullable: true });
  protected readonly Number = Number;
  protected warningDate = '';
  protected tariff = '';

  ngOnInit(): void {
    this.trackCase();
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => this.trackCase());
    this.route.queryParamMap.subscribe((params) => {
      if (params.get('writ') === '1') this.openFromRoute();
    });
    this.query.valueChanges.pipe(debounceTime(300), distinctUntilChanged()).subscribe((value) => this.lookup(value));
    const account = this.route.snapshot.queryParamMap.get('account');
    if (account) {
      this.api.openClaim(Number(account)).subscribe({
        next: (row) => this.router.navigate(['/claims', row.id]),
        error: (err) => this.snack.open(errorMessage(err), 'OK'),
      });
    }
    this.reload();
  }

  protected canAdd(): boolean {
    return this.auth.canWrite() && this.auth.me()?.contour !== 'supplier';
  }

  protected visible(): ClaimCase[] {
    return this.cards().filter((card) => this.inLane(card.debt_group));
  }

  protected assignedVisible(): AssignedAccount[] {
    return this.assigned().filter((row) => this.inLane(row.debt_group));
  }

  protected claimEvents(): CalendarEvent[] {
    const events: CalendarEvent[] = [];
    for (const card of this.visible()) {
      this.pushEvent(events, card, card.warning_delivered_on, 'Предупреждение');
      this.pushEvent(events, card, card.lawsuit_filed_on, 'Иск');
      this.pushEvent(events, card, card.package_filed_on, 'Пакет');
    }
    return events;
  }

  protected showView(mode: string): void {
    if (mode === 'list' || mode === 'kanban' || mode === 'calendar' || mode === 'charts') this.mode.set(mode);
  }

  protected setSpan(span: { from: string; to: string }): void {
    this.spanFrom = span.from;
    this.spanTo = span.to;
  }

  protected openClaimEvent(event: CalendarEvent): void {
    const card = this.cards().find((row) => row.account === event.account_id);
    if (!card) return;
    this.mode.set('list');
    this.router.navigate(['/claims', card.id]);
  }

  protected openAssigned(row: AssignedAccount): void {
    if (!this.canAdd()) {
      this.router.navigate(['/accounts', row.account]);
      return;
    }
    this.api.openClaim(row.account).subscribe({
      next: (claim) => {
        this.reload();
        this.router.navigate(['/claims', claim.id]);
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected readonly lanes = [
    { id: 'pack', label: 'Пакет', stages: ['prep', 'notary'] },
    { id: 'notary', label: 'Ответ нотариуса', stages: ['writ_done', 'refused'] },
    { id: 'court', label: 'Суд', stages: ['lawsuit', 'court'] },
    { id: 'opi', label: 'ОПИ', stages: ['opi', 'opi_measures'] },
    { id: 'finish', label: 'Итог', stages: ['recovered', 'impossible', 'writeoff'] },
  ];

  protected openLaneCard(card: ClaimCase): void {
    this.mode.set('list');
    setTimeout(() => this.router.navigate(['/claims', card.id]));
  }

  protected laneCards(laneId: string): ClaimCase[] {
    const known = new Set(this.lanes.flatMap((lane) => lane.stages));
    return this.visible().filter((card) => {
      const lane = this.lanes.find((item) => item.stages.includes(card.stage));
      return lane ? lane.id === laneId : laneId === 'pack' && !known.has(card.stage);
    });
  }

  protected early(row: AccountRow): boolean {
    const group = this.groupOf(row);
    return group != null && group < 3;
  }

  protected groupOf(row: AccountRow | null): number | null {
    if (!row) return null;
    return row.effective_group ?? row.debt_group;
  }

  protected already(): ClaimCase | undefined {
    const id = this.picked()?.id;
    if (!id || this.editing()) return undefined;
    return this.cards().find((card) => card.account === id);
  }

  protected periodText(): string {
    const row = this.picked();
    if (!row?.debt_started_on) return 'Дата возникновения в выгрузке не указана';
    const started = this.dotDate(row.debt_started_on);
    const months = row.months_debt ? `, ${row.months_debt} мес.` : '';
    return `с ${started}${months}`;
  }

  protected money(value: string | null): string {
    if (!value) return '—';
    const number = Number(value);
    if (Number.isNaN(number)) return value;
    return `${number.toLocaleString('ru-BY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} р.`;
  }

  protected grand(): string {
    const debt = Number(this.picked()?.balance_out || this.editing()?.balance_out || 0);
    const penalty = Number(this.picked()?.mulct_total || this.editing()?.penalty || 0);
    const tariff = Number(this.tariff || 0);
    return this.money(String(debt + penalty + tariff));
  }

  protected canDraft(): boolean {
    return !!this.picked() && !this.tooEarly();
  }

  protected canSend(): boolean {
    return this.canDraft() && !!this.warningDate && Number(this.tariff) > 0;
  }

  protected openCreate(): void {
    this.editing.set(null);
    this.picked.set(null);
    this.warningDate = '';
    this.tariff = '';
    this.sendTried.set(false);
    this.query.setValue('');
    this.found.set([]);
    this.pickerOpen.set(false);
    this.dialog.set(true);
  }

  protected openPicker(): void {
    this.pickerOpen.set(true);
    this.lookup(this.query.value);
  }

  protected choose(row: AccountRow): void {
    this.picked.set(row);
    this.pickerOpen.set(false);
    if (!this.warningDate && row.warning_handed_on) this.warningDate = row.warning_handed_on;
  }

  protected closeDialog(): void {
    this.dialog.set(false);
    this.router.navigate([], { queryParams: { writ: null }, queryParamsHandling: 'merge' });
  }

  protected save(send: boolean): void {
    const row = this.picked();
    if (!row || this.tooEarly()) return;
    if (send) this.sendTried.set(true);
    if (send && !this.canSend()) return;
    const existing = this.already();
    this.busy.set(true);
    const opened = existing
      ? this.api.claim(existing.id)
      : this.editing()
        ? this.api.claim(this.editing()!.id)
        : this.api.openClaim(row.id);
    opened.subscribe({
      next: (claim) => this.patchAndMaybeSend(claim, send),
      error: (err) => this.fail(err),
    });
  }

  private tooEarly(): boolean {
    const group = this.groupOf(this.picked());
    return group != null && group < 3;
  }

  private patchAndMaybeSend(claim: ClaimCase, send: boolean): void {
    this.api.patchClaim(claim.id, {
      warning_delivered_on: this.warningDate || null,
      notary_tariff: this.tariff || null,
    }).subscribe({
      next: (saved) => {
        if (!send) {
          this.busy.set(false);
          this.finish(saved, 'Черновик сохранён');
          return;
        }
        this.api.claimAction(saved.id, 'send-notary').subscribe({
          next: (sent) => {
            this.busy.set(false);
            this.finish(sent, 'Пакет отмечен заглушкой БНП');
          },
          error: (err) => this.fail(err),
        });
      },
      error: (err) => this.fail(err),
    });
  }

  private finish(row: ClaimCase, text: string): void {
    this.dialog.set(false);
    this.snack.open(text, 'OK', { duration: 2500 });
    this.reload();
    this.router.navigate(['/claims', row.id], { queryParams: { writ: null }, queryParamsHandling: 'merge' });
  }

  private fail(err: unknown): void {
    this.busy.set(false);
    this.snack.open(errorMessage(err), 'OK');
  }

  private openFromRoute(): void {
    const id = Number(this.route.firstChild?.snapshot.paramMap.get('id') || this.router.url.match(/\/claims\/(\d+)/)?.[1]);
    if (!id) return;
    this.api.claim(id).subscribe({
      next: (row) => {
        this.editing.set(row);
        this.warningDate = row.warning_delivered_on || '';
        this.tariff = row.notary_tariff || '';
        this.dialog.set(true);
        this.api.account(row.account).subscribe({
          next: (account) => this.picked.set(account),
          error: (err) => this.snack.open(errorMessage(err), 'OK'),
        });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private lookup(value: string): void {
    const text = value.trim();
    if (!this.pickerOpen() || text.length < 2) {
      this.found.set([]);
      return;
    }
    this.api.accounts({ q: text, page_size: 12 }).subscribe({
      next: (page) => this.found.set(page.results.slice(0, 12)),
      error: () => this.found.set([]),
    });
  }

  private inLane(group: number | null): boolean {
    const lane = this.lane();
    const value = group || 0;
    if (lane === 'g3') return value === 3;
    if (lane === 'late') return value >= 4;
    return true;
  }

  private pushEvent(events: CalendarEvent[], card: ClaimCase, date: string | null, kind: string): void {
    if (!date) return;
    events.push({
      date: date.slice(0, 10),
      kind,
      title: `${card.short_fio || 'Без ФИО'} · ЛС ${card.client_account}`,
      account_id: card.account,
    });
  }

  private trackCase(): void {
    this.caseOpen.set(/\/claims\/\d+/.test(this.router.url));
  }

  private dotDate(value: string): string {
    const [year, month, day] = value.slice(0, 10).split('-');
    return day && month && year ? `${day}.${month}.${year}` : value;
  }

  private reload(): void {
    this.api.claims().subscribe({
      next: (page) => {
        this.stages.set(page.stages);
        this.cards.set(page.results);
        this.assigned.set(page.assigned || []);
      },
      error: (err) => this.error.set(errorMessage(err)),
    });
  }
}

function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function monthEnd(): string {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}
