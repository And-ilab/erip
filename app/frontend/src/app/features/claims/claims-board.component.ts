import { Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { debounceTime, distinctUntilChanged, filter } from 'rxjs';

import { ApiService, ClaimCase, Named, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { AccountRow } from '../../core/models';

@Component({
  selector: 'app-claims-board',
  standalone: true,
  imports: [
    FormsModule, ReactiveFormsModule, RouterLink, RouterLinkActive, RouterOutlet, MatButtonModule, MatSnackBarModule,
  ],
  template: `
    <div class="page" [class.dim]="dialog()">
      <div class="layout">
        <aside>
          @if (canAdd()) {
            <button type="button" class="add" (click)="openCreate()">+ Добавить исполнительную надпись</button>
          }
          <div class="chips">
            <button type="button" [class.on]="lane() === 'all'" (click)="lane.set('all')">Все дела</button>
            <button type="button" [class.on]="lane() === 'g3'" (click)="lane.set('g3')">Группа 3</button>
            <button type="button" [class.on]="lane() === 'late'" (click)="lane.set('late')">Группы 4–6</button>
            <button type="button" [class.on]="mode() === 'kanban'" (click)="mode.set(mode() === 'kanban' ? 'list' : 'kanban')">
              {{ mode() === 'kanban' ? 'Список' : 'Воронка' }}
            </button>
          </div>
          <p class="hint">
            Группа 2 остаётся в мероприятиях: предупреждение и приостановление услуг.
            С группы 3 — надпись, иск и ОПИ. С группы 4 — ещё выселение и отчуждение.
          </p>
          @if (error()) { <p class="error">{{ error() }}</p> }
          @if (!visible().length && !error()) {
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
        </aside>

        <section class="main">
          <div [hidden]="mode() === 'kanban'">
            <router-outlet />
            @if (!caseOpen()) {
              <div class="empty">
                <h2>Претензионно-исковая работа</h2>
                <p>Группа 3: пакет документов нотариусу или в суд, учёт решения, обмен с ОПИ, нотариальный тариф и госпошлина.</p>
                <p>Группы 4–6: дополнительно выселение из государственного фонда (ст. 80), арендного жилья (ст. 86), общежития (ст. 87) или отчуждение (ст. 137).</p>
                <p class="hint">Выберите должника слева или добавьте исполнительную надпись. Суммы долга и пени приходят из АИС и здесь не правятся.</p>
              </div>
            }
          </div>
          @if (mode() === 'kanban') {
            <div class="board">
              @for (stage of stages(); track stage.id) {
                <section class="column" [attr.data-stage]="stage.id">
                  <h3><span>{{ stage.label }}</span><b>{{ column(stage.id).length }}</b></h3>
                  @for (card of column(stage.id); track card.id) {
                    <a class="card" [routerLink]="['/claims', card.id]">
                      <strong>{{ card.short_fio || 'Без ФИО' }}</strong>
                      <span class="ls">ЛС {{ card.client_account }}</span>
                      <span class="addr">{{ card.account_address || 'Адрес не указан' }}</span>
                      <span class="meta"><em>Гр. {{ card.debt_group || '—' }}</em></span>
                      <span class="money">{{ money(card.balance_out) }} <small>+ пеня {{ money(card.penalty) }}</small></span>
                    </a>
                  }
                </section>
              }
            </div>
          }
        </section>
      </div>

      @if (dialog()) {
        <div class="backdrop" (click)="closeDialog()">
          <form class="modal" (click)="$event.stopPropagation()" (ngSubmit)="save(false)">
            <h2>Добавление исполнительной надписи</h2>
            <p class="hint">
              Пакет собирается из шаблона и вложений. Переход «Направлено нотариусу» возможен только с датой вручения предупреждения и нотариальным тарифом.
              В личный кабинет БНП на этом этапе пакет не уходит: канал — заглушка, файлы .pdf.sgn / .pdf.p7s до 15 МБ проверяет шлюз.
            </p>

            <h3>Дело</h3>
            <label>ЛС / должник
              <input [formControl]="query" placeholder="Номер ЛС или ФИО" />
            </label>
            @if (found().length) {
              <div class="picks">
                @for (row of found(); track row.id) {
                  <button type="button" [class.on]="picked()?.id === row.id" (click)="choose(row)">
                    {{ row.client_account }} — {{ row.short_fio || 'без ФИО' }} (Группа {{ groupOf(row) || '—' }})
                  </button>
                }
              </div>
            }
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
    .layout { display: grid; grid-template-columns: 280px 1fr; gap: 16px; align-items: start; }
    aside { background: #fff; border: 1px solid var(--erip-border); border-radius: 10px; padding: 12px; }
    .add {
      width: 100%; border: 0; background: var(--erip-primary); color: #fff; border-radius: 8px; padding: 10px 12px;
      font: inherit; font-weight: 600; cursor: pointer; text-align: left;
    }
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
    .column[data-stage="prep"] h3 { background: #2e7d32; }
    .column[data-stage="refused"] h3 { background: var(--erip-danger); }
    .column[data-stage="lawsuit"] h3, .column[data-stage="court"] h3 { background: var(--erip-notice); }
    .column[data-stage="opi"] h3, .column[data-stage="opi_measures"] h3 { background: var(--erip-cut); }
    .column[data-stage="recovered"] h3 { background: var(--erip-success); }
    .column[data-stage="impossible"] h3, .column[data-stage="writeoff"] h3 { background: #6b7280; }
    .card { display: flex; flex-direction: column; gap: 3px; background: #fff; border-radius: 8px; padding: 10px; margin-bottom: 8px; text-decoration: none; color: inherit; }
    .ls, .addr, .money small { color: var(--erip-muted); font-size: 12px; }
    .backdrop { position: fixed; inset: 0; z-index: 30; background: rgba(20, 40, 55, .45); display: flex; align-items: flex-start; justify-content: center; overflow: auto; padding: 32px 16px; }
    .modal { width: min(720px, 100%); background: #fff; border-radius: 12px; padding: 20px 22px 16px; box-shadow: 0 16px 40px rgba(16, 42, 67, .25); }
    .modal h2 { margin: 0 0 6px; font-size: 20px; color: #1f2933; }
    .modal h3 { margin: 14px 0 8px; font-size: 12px; letter-spacing: .04em; color: var(--erip-muted); }
    .modal label { display: grid; grid-template-columns: 220px 1fr; gap: 8px; align-items: center; margin: 6px 0; font-size: 14px; }
    .modal input { border: 1px solid var(--erip-border); border-radius: 6px; padding: 8px 10px; font: inherit; background: #fff; }
    .modal input[readonly], .modal input:disabled { background: #f7f8fa; color: #374151; }
    .modal label.miss input { border-color: var(--erip-danger); background: #fff6f6; }
    .modal label.total input { font-weight: 700; }
    .picks { display: flex; flex-direction: column; gap: 4px; margin: 4px 0 8px 220px; }
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
      .layout, .modal label, .picks { grid-template-columns: 1fr; margin-left: 0; }
      .picks, .check, .aside-note { margin-left: 0; }
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
  protected readonly mode = signal<'list' | 'kanban'>('list');
  protected readonly lane = signal<'all' | 'g3' | 'late'>('all');
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
    const lane = this.lane();
    return this.cards().filter((card) => {
      const group = card.debt_group || 0;
      if (lane === 'g3') return group === 3;
      if (lane === 'late') return group >= 4;
      return true;
    });
  }

  protected column(stage: string): ClaimCase[] {
    return this.visible().filter((card) => card.stage === stage);
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
    this.dialog.set(true);
    this.lookup('');
  }

  protected choose(row: AccountRow): void {
    this.picked.set(row);
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
    this.api.accounts({ q: value.trim(), page_size: 20 }).subscribe({
      next: (page) => this.found.set(page.results),
      error: () => this.found.set([]),
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
      },
      error: (err) => this.error.set(errorMessage(err)),
    });
  }
}
