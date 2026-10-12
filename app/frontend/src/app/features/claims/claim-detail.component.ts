import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { DateFieldComponent } from '../../core/date-field.component';
import { ApiService, ClaimCase, errorMessage } from '../../core/api.service';
import { ClaimChecklistComponent } from './claim-checklist.component';
import { ClaimPackageComponent } from './claim-package.component';
import { AuthService } from '../../core/auth.service';
import { BynSignComponent, MoneyComponent } from '../../core/money.component';

@Component({
  selector: 'app-claim-detail',
  standalone: true,
  imports: [
    FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatCheckboxModule, MatSnackBarModule, MoneyComponent, BynSignComponent, ClaimChecklistComponent, ClaimPackageComponent,
    DateFieldComponent,
  ],
  template: `
    <div class="case">
      @if (claim(); as row) {
        <section class="sheet">
          <header>
            <div>
              <h2>{{ row.short_fio || 'Должник не указан' }}</h2>
              <p>ЛС {{ row.client_account }} · {{ row.account_address || 'Адрес не указан' }}</p>
              <p class="muted">Группа {{ row.debt_group || '—' }} · рейтинг {{ row.rating || '—' }}</p>
            </div>
            <span class="stage">{{ row.stage_label }}</span>
          </header>
          @if (row.debt_group != null && row.debt_group < 3) {
            <p class="banner">Группа {{ row.debt_group }} ведётся предупреждением и приостановлением услуг. Исполнительная надпись включается с группы 3. <a routerLink="/measures">Реестр мероприятий</a></p>
          }
          @if (row.debt_group === 3) {
            <p class="hint">Группа 3: пакет нотариусу или в суд, учёт решения, ОПИ, нотариальный тариф и госпошлина. Долг и пеня из АИС здесь не правятся.</p>
          }
          @if ((row.debt_group || 0) >= 4) {
            <p class="banner">Группа {{ row.debt_group }}: помимо взыскания доступны выселение (ст. 80, 86, 87 ЖК) и отчуждение (ст. 137 ЖК). Шаги идут последовательно, где этого требует закон.</p>
          }
          <p class="actions">
            <button mat-stroked-button type="button" (click)="openWrit()">Форма исполнительной надписи</button>
            <a mat-button routerLink="/claims">К списку</a>
          </p>
          <div class="split">
            <div class="form">
              @if ((row.blockers || []).length) {
                <ul class="blockers">
                  @for (item of row.blockers; track $index) { <li>{{ item }}</li> }
                </ul>
              }
              @if (row.writ_checklist?.length) {
                <h3>Чек-лист надписи</h3>
                <p class="hint">Порядок и обязательность заданы в конструкторе сценариев. Обязательный пункт без выполнения блокирует направление нотариусу.</p>
                <ol class="writ-list">
                  @for (item of row.writ_checklist; track item.code) {
                    <li [class.met]="item.met" [class.need]="!item.met && item.mandatory" [class.skip]="!item.met && !item.mandatory">
                      <strong>{{ item.order }}. {{ item.name }}</strong>
                      <span>{{ item.met ? 'выполнено' : (item.mandatory ? 'обязательно' : 'можно пропустить') }}</span>
                      <p>{{ item.criteria }}</p>
                      @if (!item.met && item.gap) { <p class="gap">{{ item.gap }}</p> }
                    </li>
                  }
                </ol>
                @if (needsSkip(row)) {
                  <mat-form-field class="wide"><mat-label>Причина пропуска этапа</mat-label><input matInput [(ngModel)]="checklistSkip" /></mat-form-field>
                }
              }
              <div class="sums">
                <div><span>Исходящее сальдо с пенями <app-byn-sign /></span><b><app-money [value]="row.balance_out" /></b></div>
                <div><span>Исходящее сальдо пени <app-byn-sign /></span><b><app-money [value]="row.penalty" /></b></div>
                <div><span>Нотариальный тариф <app-byn-sign /></span><b><app-money [value]="tariff || null" /></b></div>
                <div class="total"><span>Итого</span><b><app-money [value]="grand(row)" [blank]="false" /></b></div>
              </div>
              <p class="hint">Долг и пеня приходят из АИС и в этой форме не меняются. Тариф вносит специалист, пока его не считает АИС.</p>
              <div class="line">
                <app-date-field label="Дата вручения предупреждения" [required]="true" [value]="warningDate" (valueChange)="warningDate = $event" />
                <span class="ok" [class.miss]="!warningDate">{{ warningDate ? 'вручено' : 'обязательно' }}</span>
              </div>
              <div class="line">
                <mat-form-field [class.need]="!(Number(tariff) > 0)"><mat-label>Нотариальный тариф *</mat-label>
                  <input matInput [(ngModel)]="tariff" />
                  <span matTextSuffix><app-byn-sign /></span>
                </mat-form-field>
                <mat-checkbox [(ngModel)]="withdrawn">Заявление отозвано</mat-checkbox>
              </div>
              <mat-form-field class="wide"><mat-label>Нотариальная контора</mat-label>
                <input matInput value="Справочник контор ещё не подключён" disabled />
              </mat-form-field>
              <app-claim-checklist
                [claimId]="row.id"
                [pack]="row.package || null"
                [warningDate]="warningDate"
                [tariff]="tariff"
                [stage]="row.stage"
                (changed)="replace($event)" />
              <h3>Пакет для личного кабинета БНП</h3>
              @if (row.package) {
                <app-claim-package [claimId]="row.id" [pack]="row.package" (changed)="replace($event)" />
              }
              @if ((row.files || []).length) {
                <ul class="files">
                  @for (file of row.files; track file.id) {
                    <li><b>{{ fileRole(file.role) }}</b> {{ file.name }} <span>{{ file.doc_type }}</span></li>
                  }
                </ul>
              } @else {
                <p class="hint">Файлов на карточке счёта нет. Расчёт, доверенность и скан загружаются во вкладке «Вложения».</p>
              }
              <mat-form-field class="wide"><mat-label>Комментарий к ответу нотариуса</mat-label><input matInput [(ngModel)]="note" /></mat-form-field>
              @if ((row.files || []).length) {
                <mat-form-field class="wide"><mat-label>Файл карточки для отказа</mat-label>
                  <mat-select [(ngModel)]="refusalFile">
                    <mat-option [value]="0">Не выбран</mat-option>
                    @for (file of row.files; track file.id) {
                      <mat-option [value]="file.id">{{ file.name }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              }
              <div class="actions">
                <button mat-flat-button color="primary" (click)="saveThenSend()">Подписать и направить</button>
                <button mat-stroked-button (click)="save()">Сохранить черновик</button>
                <a mat-button routerLink="/claims">Отмена</a>
              </div>
              <div class="actions">
                <button mat-stroked-button (click)="act('notary-result', { result: 'done', note: note })">Надпись совершена</button>
                <button mat-stroked-button (click)="refuse()">Отказ нотариуса</button>
              </div>
            </div>
            <aside>
              @if (row.submission_mode === 'stub') {
                <p class="banner">Пакет в личный кабинет БНП не уходил. Номер заглушки: {{ row.submission_id }}.</p>
              }
              @if (row.opi_mode === 'manual') {
                <p class="banner">Статус ОПИ внесён вручную. Сервисы 3.11.01–3.11.05 не вызывались.</p>
              }
              @if (row.opi_mode === 'stub') {
                <p class="banner">Пакет проверен по регламенту ПРИС. В АИС ПРИС он не отправлялся: канал-заглушка.</p>
              }
              @if (row.opi_mode === 'pris') {
                <p class="banner">Пакет передан в АИС ПРИС. {{ row.pris_process_message }} {{ row.pris_response_id }}</p>
              }
              <h3>Статус дела</h3>
              <ol>
                @for (item of row.stages || []; track item.id) {
                  <li [class.now]="item.id === row.stage">{{ item.label }}</li>
                }
              </ol>
            </aside>
          </div>
        </section>

        <section class="more">
          <h3>Иск, суд, ОПИ и списание</h3>
          <div class="grid">
            <div class="fields">
              <mat-form-field><mat-label>Номер иска</mat-label><input matInput [(ngModel)]="lawsuitNumber" /></mat-form-field>
              @if ((claim()?.debt_group || 0) >= 4) {
                <p class="hint">Для групп 4–6 в виде иска выберите выселение или отчуждение, если есть основания.</p>
              }
              <mat-form-field><mat-label>Вид</mat-label>
                <mat-select [(ngModel)]="lawsuitKind">
                  @for (kind of row.lawsuit_kinds || []; track kind.id) {
                    <mat-option [value]="kind.id">{{ kind.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field><mat-label>Ответчик</mat-label><input matInput [(ngModel)]="defendant" /></mat-form-field>
              <mat-form-field class="wide"><mat-label>Примечание к иску</mat-label><input matInput [(ngModel)]="lawsuitNote" /></mat-form-field>
              <app-date-field label="Дата подачи" [value]="lawsuitDate" (valueChange)="lawsuitDate = $event" />
              <mat-form-field><mat-label>Госпошлина</mat-label><input matInput [(ngModel)]="duty" /><span matTextSuffix><app-byn-sign /></span></mat-form-field>
              @if (housingKind()) {
                <app-date-field label="Дата пакета на выселение" [value]="packageDate" (valueChange)="packageDate = $event" />
                <mat-form-field><mat-label>Ветвь выселения</mat-label>
                  <mat-select [(ngModel)]="eviction">
                    <mat-option value="">Нет</mat-option>
                    <mat-option value="notice">Уведомление</mat-option>
                    <mat-option value="lawsuit">Иск</mat-option>
                    <mat-option value="court">Решение</mat-option>
                    <mat-option value="enforced">Выселение / продажа</mat-option>
                  </mat-select>
                </mat-form-field>
              }
              <mat-form-field><mat-label>Статус суда</mat-label>
                <mat-select [(ngModel)]="court">
                  <mat-option value="">Не подано</mat-option>
                  <mat-option value="pending">На рассмотрении</mat-option>
                  <mat-option value="granted">Удовлетворено</mat-option>
                  <mat-option value="denied">Отказано в иске</mat-option>
                </mat-select>
              </mat-form-field>
              @if (auth.canSkip()) {
                <mat-form-field class="wide"><mat-label>Причина пропуска этапа</mat-label><input matInput [(ngModel)]="skipReason" /></mat-form-field>
              }
              <div class="actions">
                <button mat-stroked-button (click)="save()">Сохранить иск</button>
                @if (auth.canSkip()) {
                  <button mat-stroked-button (click)="act('move', { stage: 'lawsuit', reason: skipReason })">К иску</button>
                  <button mat-stroked-button (click)="act('move', { stage: 'court', reason: skipReason })">Решение суда</button>
                }
              </div>
            </div>
            <div class="fields">
              <mat-form-field><mat-label>Номер производства</mat-label><input matInput [(ngModel)]="opiNumber" /></mat-form-field>
              <mat-form-field><mat-label>Статус вручную</mat-label><input matInput [(ngModel)]="opiStatus" /></mat-form-field>
              <div class="actions">
                <button mat-stroked-button (click)="act('opi', { number: opiNumber, status: opiStatus })">Записать статус ОПИ</button>
                @if (auth.canSkip()) {
                  <button mat-stroked-button (click)="act('move', { stage: 'opi', reason: skipReason })">Направлено в ОПИ</button>
                  <button mat-stroked-button (click)="act('move', { stage: 'opi_measures', reason: skipReason })">Меры приняты</button>
                }
              </div>
              <p class="hint">Коды справочников ПРИС (120, 201, 214, 217, 306, 309) вводятся вручную. Пустое поле в запрос не подставляется.</p>
              @if (row.pris?.problems?.length) {
                <p class="need">{{ row.pris?.problems?.join('; ') }}</p>
              }
              <mat-form-field><mat-label>ОПИ, справочник 120</mat-label><input matInput [(ngModel)]="prisOpi" /></mat-form-field>
              <mat-form-field><mat-label>Требование, справочник 214</mat-label><input matInput [(ngModel)]="prisReq" /></mat-form-field>
              <mat-form-field><mat-label>Вид документа, справочник 201</mat-label><input matInput [(ngModel)]="prisDocCode" /></mat-form-field>
              <mat-form-field><mat-label>Номер документа</mat-label><input matInput [(ngModel)]="prisDocNum" /></mat-form-field>
              <mat-form-field><mat-label>Дата документа</mat-label><input matInput [(ngModel)]="prisDocDate" placeholder="ДД.ММ.ГГГГ" /></mat-form-field>
              <mat-form-field><mat-label>Орган, справочник 217</mat-label><input matInput [(ngModel)]="prisOrgCode" /></mat-form-field>
              <mat-form-field class="wide"><mat-label>Наименование органа</mat-label><input matInput [(ngModel)]="prisOrg" /></mat-form-field>
              <mat-form-field><mat-label>Дата вступления в силу</mat-label><input matInput [(ngModel)]="prisDocDateIn" placeholder="ДД.ММ.ГГГГ" /></mat-form-field>
              <mat-form-field><mat-label>Тип населённого пункта должника, 309</mat-label><input matInput [(ngModel)]="prisNpType" /></mat-form-field>
              <mat-form-field><mat-label>PDF исполнительного документа</mat-label>
                <mat-select [(ngModel)]="prisPdf">
                  <mat-option [value]="0">Из пакета, если подпись уже приложена</mat-option>
                  @for (file of row.files; track file.id) {
                    <mat-option [value]="file.id">{{ file.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field><mat-label>Файл подписи</mat-label>
                <mat-select [(ngModel)]="prisSign">
                  <mat-option [value]="0">Из пакета, если подпись уже приложена</mat-option>
                  @for (file of row.files; track file.id) {
                    <mat-option [value]="file.id">{{ file.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field><mat-label>ОПФ взыскателя</mat-label><input matInput [(ngModel)]="prisOpf" /></mat-form-field>
              <mat-form-field><mat-label>Страна адреса, справочник 306</mat-label><input matInput [(ngModel)]="prisCountry" /></mat-form-field>
              <mat-form-field class="wide"><mat-label>Полный адрес взыскателя</mat-label><input matInput [(ngModel)]="prisAddress" /></mat-form-field>
              <mat-form-field><mat-label>Тип населённого пункта, 309</mat-label><input matInput [(ngModel)]="prisClaimNpType" /></mat-form-field>
              <mat-form-field><mat-label>Населённый пункт</mat-label><input matInput [(ngModel)]="prisNp" /></mat-form-field>
              <mat-form-field><mat-label>Дом</mat-label><input matInput [(ngModel)]="prisHouse" /></mat-form-field>
              <mat-form-field><mat-label>SWIFT</mat-label><input matInput [(ngModel)]="prisBank" /></mat-form-field>
              <mat-form-field><mat-label>Счёт</mat-label><input matInput [(ngModel)]="prisAccount" /></mat-form-field>
              <mat-form-field><mat-label>Тип счёта</mat-label><input matInput [(ngModel)]="prisAccType" /></mat-form-field>
              <div class="actions">
                <button mat-flat-button color="primary" (click)="sendPris()">Передать в ПРИС</button>
                <button mat-stroked-button (click)="act('pris/refresh')">Обновить ход производства</button>
                <button mat-stroked-button (click)="act('pris/repay')">Передать погашения</button>
              </div>
              <mat-form-field class="wide"><mat-label>Новый акт ОПИ</mat-label><input matInput [(ngModel)]="actTitle" /></mat-form-field>
              <button mat-stroked-button (click)="act('acts', { title: actTitle })">Приложить акт</button>
              <p>Актов: {{ row.acts_count }}. @for (item of row.acts; track item.id) { {{ item.title }}; }</p>
              <div class="actions">
                <button mat-stroked-button (click)="act('move', { stage: 'impossible' })">Невозможность взыскания</button>
                <button mat-stroked-button (click)="act('ais-receipt')">Имитация выгрузки АИС</button>
                <button mat-stroked-button (click)="act('move', { stage: 'recovered' })">Взыскано</button>
              </div>
              <mat-form-field class="wide"><mat-label>Согласующие</mat-label>
                <mat-select [(ngModel)]="approvers" multiple>
                  @for (person of row.approver_choices || []; track person.id) {
                    <mat-option [value]="person.id">{{ person.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <button mat-flat-button color="primary" (click)="act('writeoff', { approver_ids: approvers })">На согласование списания</button>
              <p>Маршрут: {{ row.writeoff_status || 'не запущен' }}. {{ row.writeoff_note }}</p>
              @for (vote of row.approvals; track vote.id) {
                <p>{{ vote.approver_name }}: {{ vote.decision }} {{ vote.reason }}</p>
              }
              <mat-form-field class="wide"><mat-label>Ваше решение, если вы согласующий</mat-label><input matInput [(ngModel)]="decisionReason" /></mat-form-field>
              <div class="actions">
                <button mat-stroked-button (click)="act('decide', { decision: 'yes', reason: decisionReason })">Согласовать</button>
                <button mat-stroked-button (click)="act('decide', { decision: 'no', reason: decisionReason })">Отказать</button>
              </div>
            </div>
          </div>
        </section>

        <h3>История</h3>
        <ul>
          @for (event of row.events || []; track $index) {
            <li>{{ event.actor }}: {{ event.old_stage }} → {{ event.new_stage }}. {{ event.reason }}</li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .case { min-width: 0; }
    .sheet, .more { background: #fff; border: 1px solid var(--erip-border); border-radius: 12px; padding: 16px 18px; margin-bottom: 16px; }
    header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    h2, h3 { margin: 0 0 4px; color: var(--erip-primary-dark); }
    .muted, .hint { color: var(--erip-muted); }
    .stage { background: var(--erip-claim-soft); color: var(--erip-claim); border-radius: 999px; padding: 4px 10px; font-size: 13px; }
    .split { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 20px; margin-top: 12px; min-width: 0; }
    .form, .fields { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .sums { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .sums div { background: var(--erip-bg); border-radius: 8px; padding: 8px 10px; }
    .sums span { display: block; color: var(--erip-muted); font-size: 12px; }
    .sums .total { background: var(--erip-primary-soft); }
    .line, .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .ok { color: var(--erip-success); font-size: 13px; }
    .ok.miss, .need { color: var(--erip-danger); }
    .pack { list-style: none; padding: 0; margin: 0; }
    .pack li { padding: 6px 0 6px 22px; position: relative; color: var(--erip-muted); }
    .pack li.ready { color: inherit; }
    .pack li.ready::before { content: '●'; position: absolute; left: 0; color: var(--erip-success); }
    .pack li:not(.ready)::before { content: '○'; position: absolute; left: 0; }
    .files { list-style: none; padding: 0; margin: 0; }
    .files li { padding: 4px 0; font-size: 13px; }
    .files span { color: var(--erip-muted); margin-left: 6px; }
    aside { background: #f7f8fa; border-radius: 10px; padding: 12px; }
    aside ol { margin: 8px 0 0; padding-left: 18px; }
    aside li.now { font-weight: 700; color: var(--erip-primary); }
    .banner { background: var(--erip-warning-soft); border-radius: 8px; padding: 8px 12px; }
    .blockers { color: var(--erip-warning); margin: 0; }
    .writ-list { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .writ-list li { border: 1px solid var(--erip-border); border-radius: 8px; padding: 8px 10px; background: #fff; }
    .writ-list li.met { border-color: var(--erip-success); }
    .writ-list li.need { border-color: var(--erip-danger); }
    .writ-list li.skip { border-color: var(--erip-warning); }
    .writ-list strong { display: block; }
    .writ-list span, .writ-list p { color: var(--erip-muted); font-size: 13px; margin: 2px 0 0; }
    .writ-list .gap { color: var(--erip-danger); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .wide { width: 100%; }
    @media (max-width: 900px) { .split, .grid, .sums { grid-template-columns: 1fr; } }
  `,
})
export class ClaimDetailComponent implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  protected readonly Number = Number;
  protected readonly claim = signal<ClaimCase | null>(null);
  protected warningDate = '';
  protected tariff = '';
  protected checklistSkip = '';
  protected withdrawn = false;
  protected note = '';
  protected lawsuitNote = '';
  protected lawsuitNumber = '';
  protected lawsuitKind = '';
  protected defendant = '';
  protected lawsuitDate = '';
  protected duty = '';
  protected packageDate = '';
  protected court = '';
  protected skipReason = '';
  protected opiNumber = '';
  protected opiStatus = '';
  protected prisOpi = '';
  protected prisReq = '';
  protected prisDocCode = '';
  protected prisDocNum = '';
  protected prisDocDate = '';
  protected prisOrgCode = '';
  protected prisOrg = '';
  protected prisDocDateIn = '';
  protected prisNpType = '';
  protected prisPdf = 0;
  protected prisSign = 0;
  protected prisOpf = '';
  protected prisCountry = '';
  protected prisAddress = '';
  protected prisClaimNpType = '';
  protected prisNp = '';
  protected prisHouse = '';
  protected prisBank = '';
  protected prisAccount = '';
  protected prisAccType = '';
  protected actTitle = 'Акт о невозможности взыскания';
  protected approvers: number[] = [];
  protected decisionReason = '';
  protected eviction = '';
  protected refusalFile = 0;

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => this.load(Number(params.get('id'))));
  }

  protected openWrit(): void {
    this.router.navigate([], { queryParams: { writ: 1 }, queryParamsHandling: 'merge' });
  }

  protected grand(row: ClaimCase): number {
    const debt = Number(row.balance_out || 0);
    const penalty = Number(row.penalty || 0);
    const tariff = Number(this.tariff || 0);
    return debt + penalty + tariff;
  }

  protected housingKind(): boolean {
    return ['eviction_80', 'eviction_86', 'eviction_87', 'alienation_137'].includes(this.lawsuitKind);
  }

  protected hasFile(row: ClaimCase, role: string): boolean {
    return (row.files || []).some((file) => file.role === role);
  }

  protected fileRole(role: string): string {
    if (role === 'calculation') return 'Расчёт';
    if (role === 'warrant') return 'Доверенность';
    if (role === 'scan') return 'Скан';
    return 'Файл';
  }

  protected refuse(): void {
    if (!this.note.trim() && !this.refusalFile) {
      this.snack.open('Нужен комментарий или файл с карточки счёта', 'OK');
      return;
    }
    this.act('notary-result', {
      result: 'refused', note: this.note, attachment_id: this.refusalFile || null,
    });
  }

  protected replace(row: ClaimCase): void {
    this.apply(row);
  }

  protected saveThenSend(): void {
    const row = this.claim();
    if (!row) return;
    if (!this.warningDate || !(Number(this.tariff) > 0)) {
      this.snack.open('Заполните обязательные поля: дата вручения и нотариальный тариф', 'OK');
      return;
    }
    this.api.patchClaim(row.id, this.draft()).subscribe({
      next: (next) => {
        this.apply(next);
        if (this.needsSkip(next) && !this.checklistSkip.trim()) {
          this.snack.open('Пропуск этапа записывается с причиной', 'OK');
          return;
        }
        this.act('sign-and-send', { skip_reason: this.checklistSkip.trim() });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected save(): void {
    const row = this.claim();
    if (!row) return;
    this.api.patchClaim(row.id, this.draft()).subscribe({
      next: (next) => this.apply(next),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected needsSkip(row: ClaimCase): boolean {
    return (row.writ_checklist || []).some((item) => !item.met && !item.mandatory);
  }

  protected sendPris(): void {
    this.act('pris/submit', {
      opi: this.prisOpi,
      req_init: this.prisReq,
      doc_code: this.prisDocCode,
      doc_num: this.prisDocNum,
      doc_date: this.prisDocDate,
      doc_org_code: this.prisOrgCode,
      doc_org: this.prisOrg,
      doc_date_in: this.prisDocDateIn,
      debtor_np_type: this.prisNpType,
      pdf_id: this.prisPdf || '',
      signature_id: this.prisSign || '',
      claimant: {
        opf: this.prisOpf,
        country: this.prisCountry,
        full_adr: this.prisAddress,
        np_type: this.prisClaimNpType,
        np: this.prisNp,
        house: this.prisHouse,
        bank_code: this.prisBank,
        acc_num: this.prisAccount,
        acc_type: this.prisAccType,
        curr_code: '933',
      },
    });
  }

  protected act(action: string, body: object = {}): void {
    const row = this.claim();
    if (!row) return;
    this.api.claimAction(row.id, action, body).subscribe({
      next: (next) => {
        this.apply(next);
        this.snack.open(next.stage_label, 'OK', { duration: 2000 });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private draft(): object {
    return {
      warning_delivered_on: this.warningDate || null,
      notary_tariff: this.tariff || null,
      application_withdrawn: this.withdrawn,
      notary_note: this.note,
      lawsuit_number: this.lawsuitNumber,
      lawsuit_kind: this.lawsuitKind,
      defendant_name: this.defendant,
      lawsuit_filed_on: this.lawsuitDate || null,
      state_duty: this.duty || null,
      package_filed_on: this.packageDate || null,
      court_status: this.court,
      skip_reason: this.skipReason,
      eviction_stage: this.eviction,
      lawsuit_note: this.lawsuitNote,
    };
  }

  private load(id: number): void {
    this.api.claim(id).subscribe({
      next: (row) => this.apply(row),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private apply(row: ClaimCase): void {
    this.claim.set(row);
    this.warningDate = row.warning_delivered_on || '';
    this.tariff = row.notary_tariff || '';
    this.withdrawn = row.application_withdrawn;
    this.lawsuitNumber = row.lawsuit_number;
    this.lawsuitKind = row.lawsuit_kind;
    this.defendant = row.defendant_name;
    this.lawsuitDate = row.lawsuit_filed_on || '';
    this.duty = row.state_duty || '';
    this.packageDate = row.package_filed_on || '';
    this.court = row.court_status;
    this.skipReason = row.skip_reason;
    this.opiNumber = row.opi_number;
    this.opiStatus = row.opi_status;
    const request = row.pris?.request || {};
    const claimant = row.pris?.claimant || {};
    this.prisOpi = String(request['opi'] || '');
    this.prisReq = String(request['req_init'] || '');
    this.prisDocCode = String(request['doc_code'] || '');
    this.prisDocNum = String(request['doc_num'] || '');
    this.prisDocDate = String(request['doc_date'] || '');
    this.prisOrgCode = String(request['doc_org_code'] || '');
    this.prisOrg = String(request['doc_org'] || '');
    this.prisDocDateIn = String(request['doc_date_in'] || '');
    this.prisNpType = String(request['debtor_np_type'] || '');
    this.prisPdf = Number(request['pdf_id'] || 0);
    this.prisSign = Number(request['signature_id'] || 0);
    this.prisOpf = String(claimant['opf'] || '');
    this.prisCountry = String(claimant['country'] || '');
    this.prisAddress = String(claimant['full_adr'] || '');
    this.prisClaimNpType = String(claimant['np_type'] || '');
    this.prisNp = String(claimant['np'] || '');
    this.prisHouse = String(claimant['house'] || '');
    this.prisBank = String(claimant['bank_code'] || '');
    this.prisAccount = String(claimant['acc_num'] || '');
    this.prisAccType = String(claimant['acc_type'] || '');
    this.eviction = row.eviction_stage;
    this.note = row.notary_note || '';
    this.lawsuitNote = row.lawsuit_note || '';
  }
}
