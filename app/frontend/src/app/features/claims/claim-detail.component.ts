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
import { AuthService } from '../../core/auth.service';
import { BynSignComponent, MoneyComponent } from '../../core/money.component';

@Component({
  selector: 'app-claim-detail',
  standalone: true,
  imports: [
    FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatCheckboxModule, MatSnackBarModule, MoneyComponent, BynSignComponent, ClaimChecklistComponent,
    DateFieldComponent,
  ],
  template: `
    <div class="case">
      @if (claim(); as row) {
        <header>
          <div>
            <a class="back" routerLink="/claims">К списку</a>
            <h2>{{ row.short_fio || 'Должник не указан' }}</h2>
            <p>ЛС {{ row.client_account }} · {{ row.account_address || 'Адрес не указан' }}</p>
            <p class="muted">Группа {{ row.debt_group || '—' }} · рейтинг {{ row.rating || '—' }}</p>
          </div>
          <span class="stage">{{ row.stage_label }}</span>
        </header>
        @if (row.debt_group != null && row.debt_group < 3) {
          <p class="banner">Группа {{ row.debt_group }} ведётся в мероприятиях. Исполнительная надпись — с группы 3. <a routerLink="/measures">Реестр мероприятий</a></p>
        }
        <nav class="tabs">
          @for (item of tabs; track item.id) {
            <button type="button" [class.on]="tab() === item.id" (click)="setTab(item.id)">{{ item.label }}</button>
          }
        </nav>
        <div class="work">
          <div class="pane">
            @switch (tab()) {
              @case ('pack') {
                <app-claim-checklist
                  [claimId]="row.id"
                  [pack]="row.package || null"
                  [warningDate]="warningDate"
                  [tariff]="tariff"
                  [withdrawn]="withdrawn"
                  scope="notary"
                  [focus]="focusSlot()"
                  (warningDateChange)="warningDate = $event"
                  (tariffChange)="tariff = $event"
                  (withdrawnChange)="withdrawn = $event"
                  (changed)="replace($event)" />
                <div class="bar">
                  <button mat-flat-button color="primary" type="button" (click)="formPackage()">Собрать архив</button>
                  <button mat-flat-button type="button" (click)="saveThenSend()">Подписать и направить</button>
                  @if (row.package?.has_archive) {
                    <button mat-stroked-button type="button" (click)="downloadArchive()">Скачать архив</button>
                  }
                </div>
                @if (sendGaps(row).length) {
                  <ul class="blockers">
                    @for (item of sendGaps(row); track $index) { <li>{{ item }}</li> }
                  </ul>
                }
                @if (needsSkip(row)) {
                  <mat-form-field class="wide"><mat-label>Причина пропуска этапа</mat-label><input matInput [(ngModel)]="checklistSkip" /></mat-form-field>
                }
              }
              @case ('notary') {
                <div class="sums">
                  <div><span>Исходящее сальдо с пенями <app-byn-sign /></span><b><app-money [value]="row.balance_out" /></b></div>
                  <div><span>Исходящее сальдо пени <app-byn-sign /></span><b><app-money [value]="row.penalty" /></b></div>
                  <div><span>Нотариальный тариф <app-byn-sign /></span><b><app-money [value]="tariff || null" /></b></div>
                  <div class="total"><span>Итого</span><b><app-money [value]="grand(row)" [blank]="false" /></b></div>
                </div>
                <p class="hint">Долг и пеня из АИС. «Взыскано» — после погашения долга, пени и тарифа.</p>
                <div class="line">
                  <app-date-field label="Дата вручения предупреждения" [required]="true" [value]="warningDate" (valueChange)="warningDate = $event" />
                  <mat-form-field [class.need]="!(Number(tariff) > 0)"><mat-label>Нотариальный тариф *</mat-label>
                    <input matInput [(ngModel)]="tariff" />
                    <span matTextSuffix><app-byn-sign /></span>
                  </mat-form-field>
                  <mat-checkbox [(ngModel)]="withdrawn">Заявление отозвано</mat-checkbox>
                </div>
                @if (row.submission_mode === 'stub') {
                  <p class="banner">В кабинет БНП пакет не уходил. Номер заглушки: {{ row.submission_id }}.</p>
                }
                @if (sendGaps(row).length) {
                  <ul class="blockers">
                    @for (item of sendGaps(row); track $index) { <li>{{ item }}</li> }
                  </ul>
                }
                @if (needsSkip(row)) {
                  <mat-form-field class="wide"><mat-label>Причина пропуска этапа</mat-label><input matInput [(ngModel)]="checklistSkip" /></mat-form-field>
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
                  <button mat-stroked-button type="button" (click)="save()">Сохранить</button>
                  <button mat-flat-button color="primary" type="button" (click)="saveThenSend()">Подписать и направить</button>
                  <button mat-stroked-button type="button" (click)="act('notary-result', { result: 'done', note: note })">Надпись совершена</button>
                  <button mat-stroked-button type="button" (click)="refuse()">Отказ нотариуса</button>
                  @if (row.stage === 'notary' || row.stage === 'writ_done' || row.stage === 'refused') {
                    <button mat-stroked-button type="button" (click)="rework()">На доработку пакета</button>
                  }
                  @if (row.stage === 'writ_done') {
                    <button mat-stroked-button type="button" (click)="setTab('opi')">Исполнительный документ в ОПИ</button>
                  }
                  @if (row.stage === 'refused') {
                    <button mat-stroked-button type="button" (click)="setTab('court')">К иску</button>
                  }
                </div>
              }
              @case ('court') {
                @if ((row.debt_group || 0) >= 4) {
                  <p class="hint">Группа {{ row.debt_group }}: в виде иска доступны выселение и отчуждение.</p>
                }
                <app-claim-checklist
                  [claimId]="row.id"
                  [pack]="row.package || null"
                  scope="court"
                  [lawsuitKind]="lawsuitKind"
                  (changed)="replace($event)">
                  <div class="fields">
                    <mat-form-field><mat-label>Номер иска</mat-label><input matInput [(ngModel)]="lawsuitNumber" /></mat-form-field>
                    <mat-form-field><mat-label>Вид</mat-label>
                      <mat-select [(ngModel)]="lawsuitKind">
                        @for (kind of row.lawsuit_kinds || []; track kind.id) {
                          <mat-option [value]="kind.id">{{ kind.label }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                    <mat-form-field><mat-label>Ответчик</mat-label><input matInput [(ngModel)]="defendant" /></mat-form-field>
                    <app-date-field label="Дата подачи" [value]="lawsuitDate" (valueChange)="lawsuitDate = $event" />
                    <mat-form-field><mat-label>Госпошлина</mat-label><input matInput [(ngModel)]="duty" /><span matTextSuffix><app-byn-sign /></span></mat-form-field>
                    <app-date-field label="Дата вручения предупреждения" [value]="warningDate" (valueChange)="warningDate = $event" />
                    <mat-form-field class="wide"><mat-label>Примечание</mat-label><input matInput [(ngModel)]="lawsuitNote" /></mat-form-field>
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
                      <button mat-stroked-button type="button" (click)="save()">Сохранить иск</button>
                      @if (auth.canSkip()) {
                        <button mat-stroked-button type="button" (click)="act('move', { stage: 'lawsuit', reason: skipReason })">К иску</button>
                        <button mat-stroked-button type="button" (click)="act('move', { stage: 'court', reason: skipReason })">Решение суда</button>
                      }
                    </div>
                  </div>
                </app-claim-checklist>
              }
              @case ('opi') {
                @if (row.opi_mode === 'manual') {
                  <p class="banner">Статус ОПИ внесён вручную. Сервисы 3.11.01–3.11.05 не вызывались.</p>
                }
                @if (row.opi_mode === 'stub') {
                  <p class="banner">Пакет проверен по регламенту ПРИС. В АИС ПРИС он не отправлялся.</p>
                }
                @if (row.opi_mode === 'pris') {
                  <p class="banner">Пакет передан в АИС ПРИС. {{ row.pris_process_message }} {{ row.pris_response_id }}</p>
                }
                <div class="line">
                  <mat-form-field><mat-label>Номер производства</mat-label><input matInput [(ngModel)]="opiNumber" /></mat-form-field>
                  <mat-form-field><mat-label>Статус вручную</mat-label><input matInput [(ngModel)]="opiStatus" /></mat-form-field>
                </div>
                <div class="actions">
                  <button mat-stroked-button type="button" (click)="act('opi', { number: opiNumber, status: opiStatus })">Записать статус</button>
                  @if (auth.canSkip()) {
                    <button mat-stroked-button type="button" (click)="act('move', { stage: 'opi', reason: skipReason })">Направлено в ОПИ</button>
                    <button mat-stroked-button type="button" (click)="act('move', { stage: 'opi_measures', reason: skipReason })">Меры приняты</button>
                  }
                  <button mat-stroked-button type="button" (click)="act('move', { stage: 'recovered' })">Взыскано</button>
                </div>
                <div class="line">
                  <mat-form-field class="wide"><mat-label>Акт о невозможности взыскания</mat-label><input matInput [(ngModel)]="actTitle" /></mat-form-field>
                  <button mat-stroked-button type="button" (click)="act('acts', { title: actTitle })">Приложить акт</button>
                </div>
                <p class="hint">Актов: {{ row.acts_count }}. @for (item of row.acts; track item.id) { {{ item.title }}. }</p>
                <div class="actions">
                  <button mat-stroked-button type="button" (click)="act('move', { stage: 'impossible' })">Невозможность взыскания</button>
                </div>
                <details>
                  <summary>Передача в ПРИС</summary>
                  <p class="hint">Коды справочников 120, 201, 214, 217, 306, 309. Пустое поле в запрос не подставляется.</p>
                  @if (row.pris?.problems?.length) {
                    <p class="need">{{ row.pris?.problems?.join('; ') }}</p>
                  }
                  <div class="fields">
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
                  </div>
                  <div class="actions">
                    <button mat-flat-button color="primary" type="button" (click)="sendPris()">Передать в ПРИС</button>
                    <button mat-stroked-button type="button" (click)="act('pris/refresh')">Обновить ход</button>
                    <button mat-stroked-button type="button" (click)="act('pris/repay')">Передать погашения</button>
                    <button mat-stroked-button type="button" (click)="act('ais-receipt')">Имитация выгрузки АИС</button>
                  </div>
                </details>
              }
              @case ('writeoff') {
                <p class="hint">Актов о невозможности: {{ row.acts_count }} из 3. Списание в АИС делает учётная система. Здесь согласуется комплект.</p>
                @if (row.acts.length) {
                  <ul class="acts">
                    @for (item of row.acts; track item.id) { <li>{{ item.title }}</li> }
                  </ul>
                }
                <mat-form-field class="wide"><mat-label>Согласующие</mat-label>
                  <mat-select [(ngModel)]="approvers" multiple>
                    @for (person of row.approver_choices || []; track person.id) {
                      <mat-option [value]="person.id">{{ person.name }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <button mat-flat-button color="primary" type="button" (click)="act('writeoff', { approver_ids: approvers })">На согласование</button>
                <p class="hint">Маршрут: {{ row.writeoff_status || 'не запущен' }}. {{ row.writeoff_note }}</p>
                @for (vote of row.approvals; track vote.id) {
                  <p>{{ vote.approver_name }}: {{ vote.decision }} {{ vote.reason }}</p>
                }
                <mat-form-field class="wide"><mat-label>Ваше решение</mat-label><input matInput [(ngModel)]="decisionReason" /></mat-form-field>
                <div class="actions">
                  <button mat-stroked-button type="button" (click)="act('decide', { decision: 'yes', reason: decisionReason })">Согласовать</button>
                  <button mat-stroked-button type="button" (click)="act('decide', { decision: 'no', reason: decisionReason })">Отказать</button>
                </div>
              }
            }
          </div>
          <aside>
            <h3>История</h3>
            <ul>
              @for (event of recent(row); track $index) {
                <li><b>{{ event.actor }}</b> {{ event.reason || event.new_stage }}</li>
              } @empty {
                <li class="muted">Записей пока нет</li>
              }
            </ul>
          </aside>
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
    .case { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
    :host:has(app-claim-checklist.file-open),
    .case:has(app-claim-checklist.file-open),
    .work:has(app-claim-checklist.file-open) { flex: none; height: auto; min-height: auto; }
    .work:has(app-claim-checklist.file-open) { align-items: start; }
    .pane:has(app-claim-checklist.file-open) { overflow: visible; height: auto; min-height: auto; }
    header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    h2, h3 { margin: 0; color: var(--erip-primary-dark); }
    h2 { font-size: 20px; }
    .back { color: var(--erip-link); font-size: 13px; text-decoration: none; }
    .muted, .hint { color: var(--erip-muted); font-size: 13px; margin: 0; }
    .stage { background: var(--erip-claim-soft); color: var(--erip-claim); border-radius: 999px; padding: 4px 10px; font-size: 13px; white-space: nowrap; }
    .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--erip-border); }
    .tabs button {
      border: 0; border-bottom: 2px solid transparent; background: transparent; font: inherit; font-weight: 600;
      color: var(--erip-muted); padding: 8px 12px; cursor: pointer;
    }
    .tabs button.on { color: var(--erip-primary-dark); border-bottom-color: var(--erip-primary); }
    .work { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 12px; }
    .pane { min-width: 0; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 8px; background: #fff; border: 1px solid var(--erip-border); border-radius: 12px; padding: 12px; }
    .sums { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .sums div { background: var(--erip-bg); border-radius: 8px; padding: 8px 10px; }
    .sums span { display: block; color: var(--erip-muted); font-size: 12px; }
    .sums .total { background: var(--erip-primary-soft); }
    .line, .actions, .bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .fields { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
    .wide { width: 100%; }
    .need { color: var(--erip-danger); }
    aside { background: #f7f8fa; border-radius: 10px; padding: 12px; min-height: 0; overflow: auto; }
    aside ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    aside li { font-size: 13px; }
    .banner { background: var(--erip-warning-soft); border-radius: 8px; padding: 8px 12px; margin: 0; }
    .blockers { color: var(--erip-warning); margin: 0; padding-left: 18px; }
    .acts { margin: 0; padding-left: 18px; }
    details { border: 1px solid var(--erip-border); border-radius: 8px; padding: 8px 12px; }
    summary { cursor: pointer; font-weight: 600; color: var(--erip-primary-dark); }
    @media (max-width: 900px) {
      .work, .sums { grid-template-columns: 1fr; }
      .case { overflow: auto; }
    }
  `,
})
export class ClaimDetailComponent implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  protected readonly Number = Number;
  protected readonly tabs = [
    { id: 'pack' as const, label: 'Комплект' },
    { id: 'notary' as const, label: 'Нотариат' },
    { id: 'court' as const, label: 'Суд' },
    { id: 'opi' as const, label: 'ОПИ' },
    { id: 'writeoff' as const, label: 'Списание' },
  ];
  protected readonly tab = signal<(typeof this.tabs)[number]['id']>('pack');
  protected readonly focusSlot = signal('');
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
    this.route.queryParamMap.subscribe((params) => {
      const tab = params.get('tab');
      if (tab === 'pack' || tab === 'notary' || tab === 'court' || tab === 'opi' || tab === 'writeoff') {
        this.tab.set(tab);
      }
    });
    this.route.paramMap.subscribe((params) => this.load(Number(params.get('id'))));
  }

  protected setTab(tab: (typeof this.tabs)[number]['id']): void {
    this.tab.set(tab);
    this.router.navigate([], { relativeTo: this.route, queryParams: { tab }, queryParamsHandling: 'merge' });
  }

  protected sendGaps(row: ClaimCase): string[] {
    const fromList = (row.writ_checklist || [])
      .filter((item) => item.mandatory && !item.met)
      .map((item) => item.gap || item.name);
    if (fromList.length) return fromList;
    return (row.blockers || []).filter((item) => item.includes('вручения') || item.includes('тариф'));
  }

  protected recent(row: ClaimCase): ClaimCase['events'] {
    return (row.events || []).slice(-8).reverse();
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

  protected refuse(): void {
    if (!this.note.trim() && !this.refusalFile) {
      this.snack.open('Нужен комментарий или файл с карточки счёта', 'OK');
      return;
    }
    const row = this.claim();
    if (!row) return;
    this.api.claimAction(row.id, 'notary-result', {
      result: 'refused', note: this.note, attachment_id: this.refusalFile || null,
    }).subscribe({
      next: (next) => {
        this.apply(next);
        this.setTab('court');
        this.snack.open(next.stage_label, 'OK', { duration: 2000 });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected rework(): void {
    this.act('move', { stage: 'prep', reason: this.note.trim() || 'Возврат на доработку пакета' });
    this.setTab('pack');
  }

  protected replace(row: ClaimCase): void {
    this.apply(row);
  }

  protected saveThenSend(): void {
    const row = this.claim();
    if (!row) return;
    if (!this.warningDate) {
      this.focusSlot.set('warning');
      this.setTab('pack');
      this.snack.open('Нужна дата вручения предупреждения', 'OK');
      return;
    }
    if (!(Number(this.tariff) > 0)) {
      this.focusSlot.set('tariff');
      this.setTab('pack');
      this.snack.open('Нужен нотариальный тариф', 'OK');
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

  protected formPackage(): void {
    const row = this.claim();
    const pack = row?.package;
    if (!row || !pack) {
      this.snack.open('Сначала приложите документы комплекта', 'OK');
      return;
    }
    const housing = (pack.services || []).find((service) => service.housing);
    const serviceId = pack.service_id || housing?.id || null;
    const service = (pack.services || []).find((item) => item.id === serviceId);
    const typeId = service?.debt_type_ids?.[0] || '';
    this.api.claimAction(row.id, 'package', {
      service_id: serviceId,
      contact_data: pack.contact_data,
      notification_email: pack.notification_email,
      user_message: pack.user_message,
      debtors: pack.debtors,
      debts: (pack.debts || []).map((debt) => ({
        source: debt.source,
        typeId: debt.typeId || typeId,
        startDate: debt.startDate || '',
        endDate: debt.endDate || '',
        dateAt: debt.startDate && debt.endDate ? '' : (debt.dateAt || ''),
      })),
    }).subscribe({
      next: () => {
        this.api.claimAction(row.id, 'package/form', {}).subscribe({
          next: (next) => {
            this.apply(next);
            this.snack.open('Архив собран. В кабинет БНП вызов не уходит.', 'OK', { duration: 3000 });
          },
          error: (err) => this.snack.open(errorMessage(err), 'OK'),
        });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected downloadArchive(): void {
    const row = this.claim();
    if (!row) return;
    this.api.claimArchive(row.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `bnp-claim-${row.id}.zip`;
        link.click();
        URL.revokeObjectURL(url);
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
