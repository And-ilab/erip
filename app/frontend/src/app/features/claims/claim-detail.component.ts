import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { DateFieldComponent, HoldDraftDirective } from '../../core/date-field.component';
import { ApiService, ClaimCase, PrisDictRow, PrisExchangeRow, errorMessage } from '../../core/api.service';
import { AvcmxService, EdsCertificate } from '../../core/avcmx.service';
import { WritRecord } from '../../core/models';
import { ClaimChecklistComponent } from './claim-checklist.component';
import { AuthService } from '../../core/auth.service';
import { BynSignComponent, MoneyComponent } from '../../core/money.component';

@Component({
  selector: 'app-claim-detail',
  standalone: true,
  imports: [
    FormsModule, RouterLink, DatePipe, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatAutocompleteModule,
    MatCheckboxModule, MatSnackBarModule, MoneyComponent, BynSignComponent, ClaimChecklistComponent,
    DateFieldComponent, HoldDraftDirective,
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
            @if (periodLine(row)) { <p class="muted">{{ periodLine(row) }}</p> }
          </div>
          <span class="stage">{{ row.stage_label }}</span>
        </header>
        @if (packages().length > 1) {
          <nav class="packages" aria-label="Пакеты по периодам">
            @for (item of packages(); track item.id) {
              <a [routerLink]="['/claims', item.id]" [queryParams]="{ tab: tab() }" [class.on]="item.id === row.id">
                <b>Пакет {{ periodOf(item) }}</b>
                <small>{{ item.stage_label }}</small>
              </a>
            }
          </nav>
        }
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
                  (warningDateChange)="setWarningDate($event)"
                  (tariffChange)="setTariff($event)"
                  (withdrawnChange)="setWithdrawn($event)"
                  (changed)="replace($event)" />
                <mat-form-field class="wide">
                  <mat-label>E-mail для уведомлений нотариуса</mat-label>
                  <input matInput [ngModel]="notificationEmail" (ngModelChange)="setNotificationEmail($event)" placeholder="notary@example.by, copy@example.by" />
                </mat-form-field>
                <p class="muted">Адрес, на который нотариус пришлёт уведомление. Несколько адресов — через запятую. Контакт должника сюда не подставляется.</p>
                <div class="bar">
                  <button mat-stroked-button type="button" (click)="signDocuments('applicant')" [disabled]="signing">Подписать документы заявителя</button>
                  <button mat-stroked-button type="button" (click)="signDocuments('head')" [disabled]="signing">Подписать доверенность</button>
                  <button mat-flat-button color="primary" type="button" (click)="formPackage()">Собрать архив</button>
                  <button mat-stroked-button type="button" (click)="downloadArchive()">Скачать архив</button>
                  <button mat-stroked-button type="button" (click)="downloadManifest()">Скачать json</button>
                  <button mat-flat-button type="button" disabled title="Обмен с БНП система-система не подключён">Отправить</button>
                </div>
                @if (edsCerts.length) {
                  <mat-form-field class="wide">
                    <mat-label>Сертификат ГосСУОК на AvPass</mat-label>
                    <mat-select [(ngModel)]="edsCert">
                      @for (cert of edsCerts; track cert.pubKeyId) {
                        <mat-option [value]="$index">{{ cert.subject }}{{ cert.hasUnp ? '' : ' · УНП из атрибутного сертификата' }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                }
                <p class="muted">Подпись ставит плагин AvCMXWebP на этом компьютере: «Комплект абонента АВЕСТ», ключ AvPass, сертификат РУЦ ГосСУОК. Заявление и расчёт подписывает представитель, доверенность — руководитель. Если в личном сертификате нет УНП, плагин добавляет атрибутный сертификат. Статус ключа проверяется по списку отозванных сертификатов. Дистрибутив — <a href="https://nces.by/pki/info/software" target="_blank" rel="noopener">НЦЭУ</a>. В кабинет БНП вызов не уходит. «Отправить» неактивна: канал БНП система-система не подключён.</p>
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
                  <app-date-field label="Дата вручения предупреждения" [required]="true" [value]="warningDate" (valueChange)="setWarningDate($event)" />
                  <mat-form-field [class.need]="!(Number(tariff) > 0)"><mat-label>Нотариальный тариф *</mat-label>
                    <input matInput holdDraft [ngModel]="tariff" (ngModelChange)="setTariff($event)" />
                    <span matTextSuffix><app-byn-sign /></span>
                  </mat-form-field>
                  <mat-checkbox holdDraft [ngModel]="withdrawn" (ngModelChange)="setWithdrawn($event)">Заявление отозвано</mat-checkbox>
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
                  <button mat-flat-button type="button" disabled title="Обмен с БНП система-система не подключён">Отправить</button>
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
                    <app-date-field label="Дата вручения предупреждения" [value]="warningDate" (valueChange)="setWarningDate($event)" />
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
                @if (row.opi_mode === 'channel') {
                  <p class="banner">Пакет принят тестовым каналом шлюза. {{ row.pris_process_message }} {{ row.pris_response_id }}</p>
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
                @if (row.pris?.inquiry?.applied) {
                  <div class="inquiry">
                    <p class="hint">Ход из АИС ПРИС. Идентификатор задолженности {{ row.pris?.cl_num }}.</p>
                    @for (sum of row.pris?.inquiry?.p_ost || []; track $index) {
                      <p>Остаток {{ sum.ost_sum }} {{ sum.curr_code }}, требование {{ sum.req_sum }}</p>
                    }
                    @for (status of row.pris?.inquiry?.p_status || []; track $index) {
                      <p>Статус {{ status.status }} от {{ status.date_status }}@if (status.actual === '1') {, актуальный }</p>
                    }
                    @for (action of row.pris?.inquiry?.p_action || []; track $index) {
                      <p>Мера: {{ actionLine(action) }}</p>
                    }
                    @for (pay of row.pris?.inquiry?.p_repay || []; track $index) {
                      <p>Погашение {{ pay['p_pay_sum'] || pay['pay_sum'] || actionLine(pay) }}</p>
                    }
                    @for (charge of row.pris?.inquiry?.p_nachisl || []; track $index) {
                      <p>Начисление: {{ actionLine(charge) }}</p>
                    }
                  </div>
                }
                <details>
                  <summary>Передача в ПРИС</summary>
                  <p class="hint">Код выбирается из GetNSIData или вписывается. В режимах stub и channel справочник 120 содержит только пример регламента. Полный набор Минюста приходит при GW_PRIS_MODE=http. Подпись — отсоединённый PKCS#7, файл .p7s или .sgn. Её ставит тот же ключ AvPass. Если PDF выбран «из пакета», в ПРИС уходит подпись с вкладки «Комплект».</p>
                  @if (row.pris?.problems?.length) {
                    <p class="need">{{ row.pris?.problems?.join('; ') }}</p>
                  }
                  <p class="hint">Идентификатор задолженности: {{ row.pris?.cl_num || 'появится при передаче' }}</p>
                  <div class="fields">
                    <mat-form-field><mat-label>ОПИ, справочник 120</mat-label>
                      <input matInput [(ngModel)]="prisOpi" [matAutocomplete]="autoOpi" />
                      <mat-autocomplete #autoOpi="matAutocomplete">
                        @for (item of dict('120'); track item.code) { <mat-option [value]="item.code">{{ item.code }} — {{ item.name }}</mat-option> }
                      </mat-autocomplete>
                    </mat-form-field>
                    <mat-form-field><mat-label>Требование, справочник 214</mat-label>
                      <input matInput [(ngModel)]="prisReq" [matAutocomplete]="autoReq" />
                      <mat-autocomplete #autoReq="matAutocomplete">
                        @for (item of dict('214'); track item.code) { <mat-option [value]="item.code">{{ item.code }} — {{ item.name }}</mat-option> }
                      </mat-autocomplete>
                    </mat-form-field>
                    <mat-form-field><mat-label>Вид документа, справочник 201</mat-label>
                      <input matInput [(ngModel)]="prisDocCode" [matAutocomplete]="autoDoc" />
                      <mat-autocomplete #autoDoc="matAutocomplete">
                        @for (item of dict('201'); track item.code) { <mat-option [value]="item.code">{{ item.code }} — {{ item.name }}</mat-option> }
                      </mat-autocomplete>
                    </mat-form-field>
                    <mat-form-field><mat-label>Номер документа</mat-label><input matInput [(ngModel)]="prisDocNum" /></mat-form-field>
                    <mat-form-field><mat-label>Дата документа</mat-label><input matInput [(ngModel)]="prisDocDate" placeholder="ДД.ММ.ГГГГ" /></mat-form-field>
                    <mat-form-field><mat-label>Орган, справочник 217</mat-label>
                      <input matInput [(ngModel)]="prisOrgCode" [matAutocomplete]="autoOrg" />
                      <mat-autocomplete #autoOrg="matAutocomplete">
                        @for (item of organDict(); track item.code) { <mat-option [value]="item.code">{{ item.code }} — {{ item.name }}</mat-option> }
                      </mat-autocomplete>
                    </mat-form-field>
                    <mat-form-field class="wide"><mat-label>Наименование органа</mat-label><input matInput [(ngModel)]="prisOrg" /></mat-form-field>
                    <mat-form-field><mat-label>Дата вступления в силу</mat-label><input matInput [(ngModel)]="prisDocDateIn" placeholder="ДД.ММ.ГГГГ" /></mat-form-field>
                    <mat-form-field><mat-label>ОПФ должника-юрлица</mat-label><input matInput [(ngModel)]="prisDebtorOpf" /></mat-form-field>
                    <mat-form-field><mat-label>Страна должника, 306</mat-label>
                      <input matInput [(ngModel)]="prisDebtorCountry" [matAutocomplete]="autoDebtorCountry" />
                      <mat-autocomplete #autoDebtorCountry="matAutocomplete">
                        @for (item of dict('306'); track item.code) { <mat-option [value]="item.code">{{ item.code }} — {{ item.name }}</mat-option> }
                      </mat-autocomplete>
                    </mat-form-field>
                    <mat-form-field><mat-label>Тип населённого пункта должника, 309</mat-label>
                      <input matInput [(ngModel)]="prisNpType" [matAutocomplete]="autoNp" />
                      <mat-autocomplete #autoNp="matAutocomplete">
                        @for (item of dict('309'); track item.code) { <mat-option [value]="item.code">{{ item.code }} — {{ item.name }}</mat-option> }
                      </mat-autocomplete>
                    </mat-form-field>
                    <mat-form-field><mat-label>Населённый пункт должника</mat-label><input matInput [(ngModel)]="prisDebtorNp" /></mat-form-field>
                    <mat-form-field><mat-label>Область должника</mat-label><input matInput [(ngModel)]="prisDebtorRegion" /></mat-form-field>
                    <mat-form-field><mat-label>Район должника</mat-label><input matInput [(ngModel)]="prisDebtorArea" /></mat-form-field>
                    <mat-form-field><mat-label>Тип улицы должника, 308</mat-label>
                      <input matInput [(ngModel)]="prisDebtorStreetType" [matAutocomplete]="autoDebtorStreet" />
                      <mat-autocomplete #autoDebtorStreet="matAutocomplete">
                        @for (item of dict('308'); track item.code) { <mat-option [value]="item.code">{{ item.code }} — {{ item.name }}</mat-option> }
                      </mat-autocomplete>
                    </mat-form-field>
                    <mat-form-field><mat-label>Улица должника</mat-label><input matInput [(ngModel)]="prisDebtorStreet" /></mat-form-field>
                    <mat-form-field><mat-label>Дом должника</mat-label><input matInput [(ngModel)]="prisDebtorHouse" /></mat-form-field>
                    <mat-form-field><mat-label>Квартира должника</mat-label><input matInput [(ngModel)]="prisDebtorFlat" /></mat-form-field>
                    <mat-form-field><mat-label>Индекс должника</mat-label><input matInput [(ngModel)]="prisDebtorIndex" /></mat-form-field>
                    <mat-form-field class="wide"><mat-label>Полный адрес должника</mat-label><input matInput [(ngModel)]="prisDebtorAddress" /></mat-form-field>
                    <mat-form-field><mat-label>PDF исполнительного документа</mat-label>
                      <mat-select [(ngModel)]="prisPdf">
                        <mat-option [value]="0">Из пакета, если подпись уже приложена</mat-option>
                        @for (file of row.files; track file.id) {
                          <mat-option [value]="file.id">{{ file.name }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                    <mat-form-field><mat-label>Файл подписи .p7s или .sgn</mat-label>
                      <mat-select [(ngModel)]="prisSign">
                        <mat-option [value]="0">Из пакета, если подпись уже приложена</mat-option>
                        @for (file of row.files; track file.id) {
                          <mat-option [value]="file.id">{{ file.name }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                    <button mat-stroked-button type="button" (click)="signPrisPdf()" [disabled]="signing">Подписать PDF ключом AvPass</button>
                    <mat-form-field><mat-label>ОПФ взыскателя</mat-label><input matInput [(ngModel)]="prisOpf" /></mat-form-field>
                    <mat-form-field><mat-label>Страна адреса, справочник 306</mat-label>
                      <input matInput [(ngModel)]="prisCountry" [matAutocomplete]="autoCountry" />
                      <mat-autocomplete #autoCountry="matAutocomplete">
                        @for (item of dict('306'); track item.code) { <mat-option [value]="item.code">{{ item.code }} — {{ item.name }}</mat-option> }
                      </mat-autocomplete>
                    </mat-form-field>
                    <mat-form-field class="wide"><mat-label>Полный адрес взыскателя</mat-label><input matInput [(ngModel)]="prisAddress" /></mat-form-field>
                    <mat-form-field><mat-label>Область взыскателя</mat-label><input matInput [(ngModel)]="prisClaimRegion" /></mat-form-field>
                    <mat-form-field><mat-label>Район взыскателя</mat-label><input matInput [(ngModel)]="prisClaimArea" /></mat-form-field>
                    <mat-form-field><mat-label>Тип населённого пункта, 309</mat-label>
                      <input matInput [(ngModel)]="prisClaimNpType" [matAutocomplete]="autoClaimNp" />
                      <mat-autocomplete #autoClaimNp="matAutocomplete">
                        @for (item of dict('309'); track item.code) { <mat-option [value]="item.code">{{ item.code }} — {{ item.name }}</mat-option> }
                      </mat-autocomplete>
                    </mat-form-field>
                    <mat-form-field><mat-label>Населённый пункт</mat-label><input matInput [(ngModel)]="prisNp" /></mat-form-field>
                    <mat-form-field><mat-label>Тип улицы, 308</mat-label>
                      <input matInput [(ngModel)]="prisClaimStreetType" [matAutocomplete]="autoClaimStreet" />
                      <mat-autocomplete #autoClaimStreet="matAutocomplete">
                        @for (item of dict('308'); track item.code) { <mat-option [value]="item.code">{{ item.code }} — {{ item.name }}</mat-option> }
                      </mat-autocomplete>
                    </mat-form-field>
                    <mat-form-field><mat-label>Улица взыскателя</mat-label><input matInput [(ngModel)]="prisClaimStreet" /></mat-form-field>
                    <mat-form-field><mat-label>Дом</mat-label><input matInput [(ngModel)]="prisHouse" /></mat-form-field>
                    <mat-form-field><mat-label>Корпус</mat-label><input matInput [(ngModel)]="prisClaimCorp" /></mat-form-field>
                    <mat-form-field><mat-label>Квартира</mat-label><input matInput [(ngModel)]="prisClaimFlat" /></mat-form-field>
                    <mat-form-field><mat-label>Индекс</mat-label><input matInput [(ngModel)]="prisClaimIndex" /></mat-form-field>
                    <mat-form-field><mat-label>УНП получателя</mat-label><input matInput [(ngModel)]="prisBankUnp" /></mat-form-field>
                    <mat-form-field><mat-label>SWIFT</mat-label><input matInput [(ngModel)]="prisBank" /></mat-form-field>
                    <mat-form-field><mat-label>Счёт</mat-label><input matInput [(ngModel)]="prisAccount" /></mat-form-field>
                    <mat-form-field><mat-label>Тип счёта</mat-label><input matInput [(ngModel)]="prisAccType" /></mat-form-field>
                    <mat-form-field><mat-label>Валюта, ОКРБ</mat-label><input matInput [(ngModel)]="prisCurr" /></mat-form-field>
                    <mat-form-field><mat-label>Код платежа в бюджет</mat-label><input matInput [(ngModel)]="prisBudget" /></mat-form-field>
                  </div>
                  <div class="actions">
                    <button mat-stroked-button type="button" (click)="savePrisDraft()">Сохранить черновик</button>
                    <button mat-flat-button color="primary" type="button" (click)="sendPris()">Передать в ПРИС</button>
                    <button mat-stroked-button type="button" (click)="act('pris/refresh')">Обновить ход</button>
                    <button mat-stroked-button type="button" (click)="act('pris/repay')">Передать погашения</button>
                    <button mat-stroked-button type="button" (click)="act('ais-receipt')">Имитация выгрузки АИС</button>
                  </div>
                  @if (row.pris?.exchanges?.length) {
                    <details>
                      <summary>Журнал обмена ПРИС</summary>
                      @for (item of row.pris?.exchanges || []; track item.id) {
                        <p class="hint">{{ item.created_at }} · {{ item.operation }} · {{ item.mode || 'без канала' }} · {{ item.process_status }} · {{ item.note }}</p>
                        <pre>{{ exchangeText(item) }}</pre>
                      }
                    </details>
                  }
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
              @for (event of journal(row); track $index) {
                <li>
                  <time>{{ event.at | date: 'dd.MM.yyyy HH:mm' }}</time>
                  <span><b>{{ event.actor }}</b> {{ event.reason || event.new_stage }}</span>
                </li>
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
    .packages { display: flex; flex-wrap: wrap; gap: 8px; }
    .packages a {
      display: flex; flex-direction: column; gap: 2px; text-decoration: none; color: inherit;
      border: 1px solid var(--erip-border); border-radius: 8px; background: #fff; padding: 8px 10px;
    }
    .packages a.on { border-color: var(--erip-primary); background: var(--erip-primary-soft); }
    .packages small { color: var(--erip-muted); }
    .work { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 12px; }
    .pane { min-width: 0; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 8px; background: #fff; border: 1px solid var(--erip-border); border-radius: 12px; padding: 12px; }
    .sums { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .sums div { background: var(--erip-bg); border-radius: 8px; padding: 8px 10px; }
    .sums span { display: block; color: var(--erip-muted); font-size: 12px; }
    .sums .total { background: var(--erip-primary-soft); }
    .line, .actions, .bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .fields { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
    .inquiry { margin: 8px 0; }
    pre { white-space: pre-wrap; font-size: 12px; background: #f6f8fa; padding: 8px; border-radius: 8px; max-height: 240px; overflow: auto; }
    .wide { width: 100%; }
    .need { color: var(--erip-danger); }
    aside { background: #f7f8fa; border-radius: 10px; padding: 12px; min-height: 0; overflow: auto; }
    aside ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    aside li { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
    aside time { color: var(--erip-muted); font-size: 12px; }
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
export class ClaimDetailComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly eds = inject(AvcmxService);
  protected readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private alive = true;
  private viewedId = 0;
  private notaryEpoch = 0;
  private notaryTimer: ReturnType<typeof setTimeout> | null = null;
  private warningDirty = false;
  private tariffDirty = false;
  private withdrawnDirty = false;
  private emailDirty = false;

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
  protected readonly packages = signal<WritRecord[]>([]);
  protected warningDate = '';
  protected tariff = '';
  protected checklistSkip = '';
  protected notificationEmail = '';
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
  protected prisDebtorOpf = '';
  protected prisDebtorCountry = '';
  protected prisDebtorNp = '';
  protected prisDebtorRegion = '';
  protected prisDebtorArea = '';
  protected prisDebtorStreetType = '';
  protected prisDebtorStreet = '';
  protected prisDebtorHouse = '';
  protected prisDebtorFlat = '';
  protected prisDebtorIndex = '';
  protected prisDebtorAddress = '';
  protected prisPdf = 0;
  protected prisSign = 0;
  protected signing = false;
  protected edsCerts: EdsCertificate[] = [];
  protected edsCert = 0;
  private edsListed = false;
  protected prisOpf = '';
  protected prisCountry = '';
  protected prisAddress = '';
  protected prisClaimNpType = '';
  protected prisNp = '';
  protected prisHouse = '';
  protected prisBank = '';
  protected prisAccount = '';
  protected prisAccType = '';
  protected prisClaimRegion = '';
  protected prisClaimArea = '';
  protected prisClaimStreetType = '';
  protected prisClaimStreet = '';
  protected prisClaimCorp = '';
  protected prisClaimFlat = '';
  protected prisClaimIndex = '';
  protected prisBankUnp = '';
  protected prisCurr = '933';
  protected prisBudget = '';
  protected prisDicts: Record<string, PrisDictRow[]> = {};
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
    this.api.prisDictionaries().subscribe({
      next: (page) => {
        const books: Record<string, PrisDictRow[]> = {};
        for (const [code, book] of Object.entries(page.dictionaries || {})) books[code] = book.rows || [];
        this.prisDicts = books;
      },
      error: () => { this.prisDicts = {}; },
    });
  }

  ngOnDestroy(): void {
    this.alive = false;
    this.flushNotarySave();
  }

  protected setNotificationEmail(value: string): void {
    this.notificationEmail = value;
    this.emailDirty = true;
  }

  protected setWarningDate(value: string | null): void {
    const next = value || '';
    if (next === this.warningDate) return;
    this.warningDate = next;
    this.warningDirty = true;
    this.notaryEpoch += 1;
    this.queueNotarySave();
  }

  protected setTariff(value: string | null): void {
    const next = value == null ? '' : String(value);
    if (next === this.tariff) return;
    this.tariff = next;
    this.tariffDirty = true;
    this.notaryEpoch += 1;
    this.queueNotarySave();
  }

  protected setWithdrawn(value: boolean): void {
    const next = !!value;
    if (next === this.withdrawn) return;
    this.withdrawn = next;
    this.withdrawnDirty = true;
    this.notaryEpoch += 1;
    this.queueNotarySave();
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

  protected periodLine(row: ClaimCase): string {
    if (!row.debt_from || !row.debt_to) return 'Пакет без периода';
    return `Пакет за период ${this.dotDate(row.debt_from)}–${this.dotDate(row.debt_to)}`;
  }

  protected periodOf(item: WritRecord): string {
    if (!item.debt_from || !item.debt_to) return 'без периода';
    return `${this.dotDate(item.debt_from)}–${this.dotDate(item.debt_to)}`;
  }

  protected journal(row: ClaimCase): ClaimCase['events'] {
    return row.events || [];
  }

  private dotDate(iso: string): string {
    const [year, month, day] = iso.slice(0, 10).split('-');
    return day && month && year ? `${day}.${month}.${year}` : iso;
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
    this.cancelNotaryTimer();
    this.notaryEpoch += 1;
    const epoch = this.notaryEpoch;
    this.api.patchClaim(row.id, this.draft()).subscribe({
      next: (next) => {
        if (!this.alive || epoch !== this.notaryEpoch) return;
        this.warningDirty = false;
        this.tariffDirty = false;
        this.withdrawnDirty = false;
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
    this.flushNotarySave(() => this.submitPackage());
  }

  private submitPackage(): void {
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
      notification_email: this.notificationEmail.trim(),
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
            this.emailDirty = false;
            this.apply(next);
            this.downloadArchive();
            this.router.navigate(['/accounts', row.account], { queryParams: { tab: 'writ' } });
          },
          error: (err) => this.snack.open(errorMessage(err), 'OK'),
        });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected signDocuments(role: 'applicant' | 'head'): void {
    const row = this.claim();
    if (!row || this.signing) return;
    void this.signPackage(row, role);
  }

  protected signPrisPdf(): void {
    const row = this.claim();
    if (!row || this.signing) return;
    if (!this.prisPdf) {
      this.snack.open('PDF не выбран. Подпись комплекта ставится на вкладке «Комплект», и тогда ПРИС берёт её из пакета.', 'OK');
      return;
    }
    void this.signAttachment(row, this.prisPdf);
  }

  private async signPackage(row: ClaimCase, role: 'applicant' | 'head'): Promise<void> {
    this.signing = true;
    try {
      const cert = await this.pickCertificate();
      if (!cert) return;
      const docs = (row.package?.documents || []).filter((doc) => {
        if (!doc.has_pdf || doc.has_signature) return false;
        return role === 'head' ? doc.signer === 'head' : doc.signer !== 'head';
      });
      if (!docs.length) {
        this.snack.open(
          role === 'head' ? 'Нет неподписанной доверенности' : 'Нет неподписанных документов заявителя',
          'OK',
        );
        return;
      }
      const signatures: { doc_id: number; pkcs7: string }[] = [];
      let attribute = false;
      let subject = cert.subject;
      for (const doc of docs) {
        const blob = await firstValueFrom(this.api.downloadClaimFile(row.id, doc.id));
        const signed = await this.eds.signDetached(new Uint8Array(await blob.arrayBuffer()), cert);
        signatures.push({ doc_id: doc.id, pkcs7: signed.pkcs7 });
        attribute = attribute || signed.attributeCertificate;
        subject = signed.subject;
      }
      const next = await firstValueFrom(this.api.claimAction(row.id, 'sign-documents', { signatures }));
      this.apply(next);
      const extra = attribute ? ' В подпись включён атрибутный сертификат с УНП.' : '';
      this.snack.open(
        `Подписано: ${subject}. Статус ключа проверил плагин по СОС. В кабинет БНП вызов не уходит.${extra}`,
        'OK',
        { duration: 5000 },
      );
    } catch (err) {
      this.snack.open(this.failText(err), 'OK');
    } finally {
      this.signing = false;
    }
  }

  private async signAttachment(row: ClaimCase, fileId: number): Promise<void> {
    const file = row.files.find((item) => item.id === fileId);
    if (!file) {
      this.snack.open('Файл PDF не найден среди вложений', 'OK');
      return;
    }
    this.signing = true;
    try {
      const cert = await this.pickCertificate();
      if (!cert) return;
      const blob = await firstValueFrom(this.api.downloadAttachment(file.id));
      const signed = await this.eds.signDetached(new Uint8Array(await blob.arrayBuffer()), cert);
      const name = file.name.toLowerCase().endsWith('.pdf') ? `${file.name}.p7s` : `${file.name}.pdf.p7s`;
      const upload = new File([bytesFromBase64(signed.pkcs7)], name, { type: 'application/pkcs7-signature' });
      const saved = await firstValueFrom(this.api.uploadFile(row.account, 'подпись', upload));
      const next = await firstValueFrom(this.api.claim(row.id));
      this.apply(next);
      this.prisSign = Number(saved.id);
      const extra = signed.attributeCertificate ? ' В подпись включён атрибутный сертификат с УНП.' : '';
      this.snack.open(`Подпись ${name} сохранена. Статус ключа проверил плагин по СОС.${extra}`, 'OK', { duration: 5000 });
    } catch (err) {
      this.snack.open(this.failText(err), 'OK');
    } finally {
      this.signing = false;
    }
  }

  private async pickCertificate(): Promise<EdsCertificate | null> {
    if (!this.eds.installed()) {
      this.snack.open(this.eds.missingText(), 'OK', { duration: 8000 });
      return null;
    }
    if (!this.edsCerts.length) this.edsCerts = await this.eds.certificates();
    if (!this.edsCerts.length) {
      this.snack.open('В личном справочнике нет сертификата. Вставьте AvPass и откройте персональный менеджер сертификатов АВЕСТ.', 'OK');
      return null;
    }
    if (this.edsCerts.length > 1 && !this.edsListed) {
      this.edsListed = true;
      this.snack.open('Выберите сертификат ГосСУОК на AvPass и нажмите подпись ещё раз', 'OK');
      return null;
    }
    return this.edsCerts[this.edsCert] || this.edsCerts[0];
  }

  private failText(error: unknown): string {
    if (error instanceof HttpErrorResponse) return errorMessage(error);
    if (error instanceof Error && error.message) return error.message;
    return errorMessage(error);
  }

  protected downloadManifest(): void {
    const row = this.claim();
    if (!row) return;
    this.api.claimManifest(row.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `bnp-claim-${row.id}.json`;
        link.click();
        URL.revokeObjectURL(url);
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
    this.cancelNotaryTimer();
    this.notaryEpoch += 1;
    const epoch = this.notaryEpoch;
    this.api.patchClaim(row.id, this.draft()).subscribe({
      next: (next) => {
        if (!this.alive || epoch !== this.notaryEpoch) return;
        this.warningDirty = false;
        this.tariffDirty = false;
        this.withdrawnDirty = false;
        this.apply(next);
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected needsSkip(row: ClaimCase): boolean {
    return (row.writ_checklist || []).some((item) => !item.met && !item.mandatory);
  }

  protected dict(type: string): PrisDictRow[] {
    return this.prisDicts[type] || [];
  }

  protected organDict(): PrisDictRow[] {
    return [...this.dict('217'), ...this.dict('2107')];
  }

  protected actionLine(row: Record<string, string>): string {
    return Object.entries(row).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join(', ');
  }

  protected exchangeText(item: PrisExchangeRow): string {
    return JSON.stringify({ request: item.request, response: item.response }, null, 2);
  }

  protected savePrisDraft(): void {
    this.act('pris/draft', this.prisPayload());
  }

  protected sendPris(): void {
    this.act('pris/submit', this.prisPayload());
  }

  private prisPayload(): object {
    return {
      opi: this.prisOpi,
      req_init: this.prisReq,
      doc_code: this.prisDocCode,
      doc_num: this.prisDocNum,
      doc_date: this.prisDocDate,
      doc_org_code: this.prisOrgCode,
      doc_org: this.prisOrg,
      doc_date_in: this.prisDocDateIn,
      debtor_np_type: this.prisNpType,
      debtor_opf: this.prisDebtorOpf,
      debtor_country: this.prisDebtorCountry,
      debtor_np: this.prisDebtorNp,
      debtor_region: this.prisDebtorRegion,
      debtor_area: this.prisDebtorArea,
      debtor_street_type: this.prisDebtorStreetType,
      debtor_street: this.prisDebtorStreet,
      debtor_house: this.prisDebtorHouse,
      debtor_flat: this.prisDebtorFlat,
      debtor_post_index: this.prisDebtorIndex,
      debtor_full_adr: this.prisDebtorAddress,
      pdf_id: this.prisPdf || '',
      signature_id: this.prisSign || '',
      claimant: {
        opf: this.prisOpf,
        country: this.prisCountry,
        full_adr: this.prisAddress,
        region: this.prisClaimRegion,
        area: this.prisClaimArea,
        np_type: this.prisClaimNpType,
        np: this.prisNp,
        street_type: this.prisClaimStreetType,
        street: this.prisClaimStreet,
        house: this.prisHouse,
        corp: this.prisClaimCorp,
        flat: this.prisClaimFlat,
        post_index: this.prisClaimIndex,
        bank_unp: this.prisBankUnp,
        bank_code: this.prisBank,
        acc_num: this.prisAccount,
        acc_type: this.prisAccType,
        curr_code: this.prisCurr || '933',
        budget_code: this.prisBudget,
      },
    };
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

  private loadPackages(accountId: number): void {
    this.api.writDraft(accountId).subscribe({
      next: (draft) => this.packages.set(draft.records || []),
      error: () => this.packages.set([]),
    });
  }

  private load(id: number): void {
    if (id === this.viewedId) return;
    this.flushNotarySave();
    this.viewedId = id;
    this.warningDirty = false;
    this.tariffDirty = false;
    this.withdrawnDirty = false;
    this.emailDirty = false;
    this.notaryEpoch += 1;
    this.api.claim(id).subscribe({
      next: (row) => {
        if (!this.alive || this.viewedId !== id) return;
        this.apply(row);
        this.loadPackages(row.account);
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private queueNotarySave(): void {
    if (this.notaryTimer) clearTimeout(this.notaryTimer);
    this.notaryTimer = setTimeout(() => this.flushNotarySave(), 300);
  }

  private cancelNotaryTimer(): void {
    if (!this.notaryTimer) return;
    clearTimeout(this.notaryTimer);
    this.notaryTimer = null;
  }

  private flushNotarySave(done?: () => void): void {
    this.cancelNotaryTimer();
    const row = this.claim();
    if (!row || (!this.warningDirty && !this.tariffDirty && !this.withdrawnDirty)) {
      done?.();
      return;
    }
    const id = row.id;
    const epoch = this.notaryEpoch;
    const warning = this.warningDate;
    const tariff = this.tariff;
    const withdrawn = this.withdrawn;
    this.api.patchClaim(id, {
      warning_delivered_on: warning || null,
      notary_tariff: tariff || null,
      application_withdrawn: withdrawn,
    }).subscribe({
      next: (next) => {
        if (!this.alive || this.viewedId !== id || epoch !== this.notaryEpoch) {
          if (this.alive && this.viewedId === id && (this.warningDirty || this.tariffDirty || this.withdrawnDirty)) {
            this.queueNotarySave();
          }
          return;
        }
        this.warningDirty = false;
        this.tariffDirty = false;
        this.withdrawnDirty = false;
        this.claim.set(next);
        this.warningDate = next.warning_delivered_on || '';
        this.tariff = next.notary_tariff || '';
        this.withdrawn = !!next.application_withdrawn;
        done?.();
      },
      error: (err) => {
        if (this.alive) this.snack.open(errorMessage(err), 'OK');
      },
    });
  }

  private apply(row: ClaimCase): void {
    this.claim.set(row);
    if (!this.warningDirty) {
      const incoming = row.warning_delivered_on || '';
      if (incoming || !this.warningDate) this.warningDate = incoming;
    }
    if (!this.tariffDirty) {
      const incoming = row.notary_tariff || '';
      if (incoming || !this.tariff) this.tariff = incoming;
    }
    if (!this.withdrawnDirty) this.withdrawn = row.application_withdrawn;
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
    this.prisDebtorOpf = String(request['debtor_opf'] || '');
    this.prisDebtorCountry = String(request['debtor_country'] || '');
    this.prisDebtorNp = String(request['debtor_np'] || '');
    this.prisDebtorRegion = String(request['debtor_region'] || '');
    this.prisDebtorArea = String(request['debtor_area'] || '');
    this.prisDebtorStreetType = String(request['debtor_street_type'] || '');
    this.prisDebtorStreet = String(request['debtor_street'] || '');
    this.prisDebtorHouse = String(request['debtor_house'] || '');
    this.prisDebtorFlat = String(request['debtor_flat'] || '');
    this.prisDebtorIndex = String(request['debtor_post_index'] || '');
    this.prisDebtorAddress = String(request['debtor_full_adr'] || '');
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
    this.prisClaimRegion = String(claimant['region'] || '');
    this.prisClaimArea = String(claimant['area'] || '');
    this.prisClaimStreetType = String(claimant['street_type'] || '');
    this.prisClaimStreet = String(claimant['street'] || '');
    this.prisClaimCorp = String(claimant['corp'] || '');
    this.prisClaimFlat = String(claimant['flat'] || '');
    this.prisClaimIndex = String(claimant['post_index'] || '');
    this.prisBankUnp = String(claimant['bank_unp'] || '');
    this.prisCurr = String(claimant['curr_code'] || '933');
    this.prisBudget = String(claimant['budget_code'] || '');
    this.eviction = row.eviction_stage;
    if (!this.emailDirty) this.notificationEmail = row.package?.notification_email || '';
    this.note = row.notary_note || '';
    this.lawsuitNote = row.lawsuit_note || '';
  }
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
