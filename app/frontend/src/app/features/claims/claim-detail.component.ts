import { DatePipe } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
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
import {
  ApiService,
  ClaimActRow,
  ClaimCase,
  ClaimPackage,
  OpiMeasureTaken,
  OpiOffice,
  PrisChannelStatus,
  PrisDictRow,
  FunnelGateInfo,
  PrisExchangeRow,
  errorMessage,
  funnelGate,
  gateTarget,
} from '../../core/api.service';
import { WritRecord } from '../../core/models';
import { FunnelGateDialogComponent } from '../funnel-gate-dialog.component';
import { ClaimChecklistComponent } from './claim-checklist.component';
import { AuthService } from '../../core/auth.service';
import { BynSignComponent, MoneyComponent } from '../../core/money.component';

@Component({
  selector: 'app-claim-detail',
  standalone: true,
  imports: [
    FormsModule, RouterLink, DatePipe, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatAutocompleteModule,
    MatCheckboxModule, MatSnackBarModule, MoneyComponent, BynSignComponent, ClaimChecklistComponent,
    DateFieldComponent, HoldDraftDirective, FunnelGateDialogComponent,
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
            <span class="tab" [attr.data-tip]="tabTitle(item.id, row) || null">
              <button type="button" [class.on]="tab() === item.id" [disabled]="!tabOpen(item.id, row)" (click)="setTab(item.id)">{{ item.label }}</button>
            </span>
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
                  <span class="tip" [attr.data-tip]="signing || !kitReady(row) ? signTitle(row) : null">
                    <button mat-flat-button color="primary" type="button" (click)="signAndAssemble()" [disabled]="signing || !kitReady(row)">Подписать и собрать архив</button>
                  </span>
                  <span class="tip" [attr.data-tip]="archiveReady(row) ? null : 'Сначала подпишите комплект и соберите архив'">
                    <button mat-stroked-button type="button" (click)="downloadArchive()" [disabled]="!archiveReady(row)">Скачать архив</button>
                  </span>
                  <span class="tip" [attr.data-tip]="archiveReady(row) ? null : 'Сначала подпишите комплект и соберите архив'">
                    <button mat-flat-button type="button" (click)="sendArchive()" [disabled]="!archiveReady(row)">Отправить</button>
                  </span>
                </div>
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
                  <mat-form-field class="tariff" subscriptSizing="dynamic" [class.need]="!(Number(tariff) > 0)"><mat-label>Нотариальный тариф *</mat-label>
                    <input matInput holdDraft [ngModel]="tariff" (ngModelChange)="setTariff($event)" />
                  </mat-form-field>
                  <mat-checkbox holdDraft [ngModel]="withdrawn" (ngModelChange)="setWithdrawn($event)">Заявление отозвано</mat-checkbox>
                </div>
                @if (row.submission_mode === 'stub' && row.stage === 'notary') {
                  <p class="banner">В кабинет БНП пакет не уходил. Номер направления: {{ directionNo(row.submission_id) }}. Ответ кабинета тоже заглушка: это не документ нотариуса.</p>
                }
                @if (stubAnswer(row)) {
                  <p class="banner">Ответ БНП — заглушка. Кабинет не вызывался. Файл на счёте не является исполнительной надписью нотариуса.</p>
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
                  <span class="tip" [attr.data-tip]="notarySendTitle(row)">
                    <button mat-flat-button type="button" disabled>Отправить</button>
                  </span>
                  @if (row.stage === 'notary' && row.submission_mode === 'stub') {
                    <button mat-flat-button color="primary" type="button" (click)="act('bnp-result')">Ответ БНП (заглушка)</button>
                  }
                  @if (row.stage === 'notary' && !writFileReady(row)) {
                    <label class="file-pick">PDF надписи
                      <input type="file" accept="application/pdf,.pdf" (change)="uploadWrit($event)" />
                    </label>
                  }
                  <span class="tip" [attr.data-tip]="notaryDoneOpen(row) ? null : notaryAnswerTitle(row)">
                    <button mat-stroked-button type="button" [disabled]="!notaryDoneOpen(row)" (click)="act('notary-result', { result: 'done', note: note })">Надпись совершена</button>
                  </span>
                  <span class="tip" [attr.data-tip]="refusalOpen(row) ? null : refusalTitle(row)">
                    <button mat-stroked-button type="button" [disabled]="!refusalOpen(row)" (click)="refuse()">Отказ нотариуса</button>
                  </span>
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
                    <div class="actions">
                      <button mat-stroked-button type="button" (click)="save()">Сохранить иск</button>
                      @if (canAdvance()) {
                        <span [title]="lawsuitMoveTitle(row)">
                          <button mat-stroked-button type="button" [disabled]="row.stage !== 'refused'" (click)="act('move', { stage: 'lawsuit', reason: 'Отказ нотариуса' })">К иску</button>
                        </span>
                        @if (row.stage === 'lawsuit' && !decisionReady(row)) {
                          <label class="file-pick">PDF решения
                            <input type="file" accept="application/pdf,.pdf" (change)="uploadDecision($event)" />
                          </label>
                        }
                        <span [title]="decisionMoveTitle(row)">
                          <button mat-stroked-button type="button" [disabled]="row.stage !== 'lawsuit' || !decisionReady(row)" (click)="act('move', { stage: 'court' })">Решение суда</button>
                        </span>
                        <span [title]="courtSignTitle(row)">
                          <button mat-stroked-button type="button" [disabled]="signing || !courtSignOpen(row)" (click)="signCourtPackage()">Подписать ЭЦП</button>
                        </span>
                      }
                      @if (row.stage === 'refused' || row.stage === 'lawsuit' || row.stage === 'court') {
                        <p class="hint">Отказ нотариуса ведёт в суд. В ОПИ дело переходит только после совершённой надписи.</p>
                      }
                    </div>
                  </div>
                </app-claim-checklist>
              }
              @case ('opi') {
                @if (courtBranch(row)) {
                  <p class="banner">После отказа нотариуса дело ведётся в суде. В ОПИ оно переходит только после совершённой исполнительной надписи.</p>
                }
                @if (prisStatus(); as st) {
                  <p class="banner" [class.ok-banner]="st.sends">{{ st.detail }}</p>
                }
                @if (row.opi_mode === 'manual') {
                  <p class="banner">Статус ОПИ внесён вручную. Сервисы 3.11.01–3.11.05 не вызывались.</p>
                }
                @if (row.opi_mode === 'stub') {
                  <p class="banner">Пакет проверен по регламенту ПРИС. В АИС ПРИС он не отправлялся.</p>
                }
                @if (row.opi_mode === 'pris') {
                  <p class="banner ok-banner">Пакет передан в АИС ПРИС. {{ row.pris_process_message }} {{ row.pris_response_id }}</p>
                }
                @if (row.opi_mode === 'channel') {
                  <p class="banner ok-banner">Пакет записан. В АИС ПРИС он не передавался. {{ row.pris_process_message }} {{ row.pris_response_id }}</p>
                }

                <div class="sums">
                  <div><span>Основной долг с пенями <app-byn-sign /></span><b><app-money [value]="row.balance_out" /></b></div>
                  <div><span>В т.ч. пеня <app-byn-sign /></span><b><app-money [value]="row.penalty" /></b></div>
                  <div><span>Расходы (тариф / пошлина) <app-byn-sign /></span><b><app-money [value]="opiExpenses(row)" /></b></div>
                  <div class="total"><span>Итого к взысканию <app-byn-sign /></span><b><app-money [value]="opiTotal(row)" [blank]="false" /></b></div>
                </div>

                <div class="split">
                  <ul class="checks">
                    @for (slot of opiSlots; track slot.id) {
                      <li [class.on]="opiSlot() === slot.id" [class.done]="opiDone(slot.id, row)" [class.need]="slot.required && !opiDone(slot.id, row)">
                        <button type="button" class="check-row" (click)="openOpiSlot(slot.id)">
                          <span class="box" [class.on]="opiDone(slot.id, row)"></span>
                          <span class="title">{{ slot.title }}</span>
                          <span class="state">{{ opiState(slot.id, row) }}</span>
                        </button>
                      </li>
                    }
                  </ul>
                  <div class="viewer">
                <div class="opi-card" [hidden]="opiSlot() !== 'register'">
                  <h4>Орган и дата направления (ТЗ 4.2.4.4, FR-CLM-07)</h4>
                  <p class="hint">Без органа, даты направления и исполнительного документа статус «Направлено в ОПИ» не ставится. Если номер производства уже пришёл из АИС ПРИС, переход проходит по нему.</p>
                  <div class="fields">
                    <mat-form-field class="wide" [class.need]="!opiDepartment.trim()"><mat-label>Орган ОПИ (справочник 120) *</mat-label>
                      <input matInput [ngModel]="opiDepartment" (ngModelChange)="onOpiDepartmentInput($event)" [matAutocomplete]="autoOpiDept" placeholder="Код или наименование подразделения ОПИ" />
                      <mat-autocomplete #autoOpiDept="matAutocomplete" (optionSelected)="onPickOpiOffice($event.option.value)">
                        @for (item of filteredOpiOffices(); track item.code + item.name) {
                          <mat-option [value]="item.code + ' — ' + item.name">{{ item.code }} — {{ item.name }}@if (item.region) { ({{ item.region }}) }</mat-option>
                        }
                      </mat-autocomplete>
                    </mat-form-field>
                    <app-date-field label="Дата направления в ОПИ" [required]="true" [value]="opiSentOn" (valueChange)="opiSentOn = $event" />
                  </div>
                </div>

                <div class="opi-card" [hidden]="opiSlot() !== 'proceeding'">
                  <h4>Номер и статус исполнительного производства</h4>
                  <div class="fields">
                    <mat-form-field [class.need]="!opiNumber.trim()"><mat-label>Номер производства *</mat-label><input matInput [(ngModel)]="opiNumber" placeholder="Напр. 70126000123" /></mat-form-field>
                    <mat-form-field [class.need]="!opiStatus.trim()"><mat-label>Статус производства *</mat-label>
                      <input matInput [(ngModel)]="opiStatus" [matAutocomplete]="autoOpiStatus" />
                      <mat-autocomplete #autoOpiStatus="matAutocomplete">
                        @for (st of row.opi_statuses || defaultOpiStatuses; track st.id) {
                          <mat-option [value]="st.label">{{ st.label }}</mat-option>
                        }
                      </mat-autocomplete>
                    </mat-form-field>
                    <app-date-field label="Дата возбуждения ИП" [value]="opiStartedOn" (valueChange)="opiStartedOn = $event" />
                    <app-date-field label="Дата окончания ИП" [value]="opiEndedOn" (valueChange)="opiEndedOn = $event" />
                    <mat-form-field><mat-label>Судебный исполнитель</mat-label><input matInput [(ngModel)]="opiBailiff" /></mat-form-field>
                    <mat-form-field class="wide"><mat-label>Примечание по ходу ИП</mat-label><input matInput [(ngModel)]="opiNote" /></mat-form-field>
                  </div>
                </div>

                <div class="opi-card" [hidden]="opiSlot() !== 'document'">
                  <h4>Исполнительный документ</h4>
                  <p class="hint">В ОПИ уходит исполнительный документ совершённой надписи. Пакет, уже принятый или проверенный ПРИС, этот пункт закрывает.</p>
                  @if (hasEnforcement(row) && (row.opi_mode === 'pris' || row.opi_mode === 'channel' || row.opi_mode === 'stub')) {
                    <p class="ready-line">Документ учтён в пакете ПРИС.</p>
                  }
                  @for (file of enforcementFiles(row); track file.id) {
                    <p>{{ file.name }}</p>
                  }
                  <label class="file-pick" [class.need]="!hasEnforcement(row)">
                    Исполнительный документ *
                    <input type="file" accept="application/pdf,.pdf" (change)="uploadEnforcement($event)" />
                  </label>
                </div>

                <div class="opi-card" [hidden]="opiSlot() !== 'measures'">
                  <h4>Принятые ОПИ меры принудительного исполнения</h4>
                  @if ((row.opi_measures_taken || []).length) {
                    <table class="opi-table">
                      <thead>
                        <tr>
                          <th>Дата</th>
                          <th>Мера ОПИ</th>
                          <th>Постановление №</th>
                          <th>Примечание / Документ</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (m of row.opi_measures_taken || []; track m.id) {
                          <tr>
                            <td>{{ dotDate(m.date) }}</td>
                            <td><b>{{ m.title }}</b></td>
                            <td>{{ m.doc_number || '—' }}</td>
                            <td>
                              {{ m.note || '' }}
                              @if (m.attachment_id) {
                                <button type="button" class="link-btn" (click)="downloadFileById(m.attachment_id, m.attachment_name || 'postanovlenie.pdf')">
                                  {{ m.attachment_name || 'Скачать постановление' }}
                                </button>
                              }
                            </td>
                            <td class="right">
                              <button type="button" class="link-btn danger" (click)="removeMeasure(m)">Удалить</button>
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  } @else {
                    <p class="hint">Принятые меры ОПИ пока не зафиксированы.</p>
                  }
                  <div class="kind-list">
                    @for (k of row.opi_measure_kinds || defaultMeasureKinds; track k.id) {
                      <mat-checkbox [checked]="kindTaken(k.id)" (change)="pickMeasureKind(k)">{{ k.label }}</mat-checkbox>
                    }
                  </div>
                  <div class="fields top-gap">
                    <mat-form-field [class.need]="!newMeasureTitle.trim()"><mat-label>Наименование меры *</mat-label><input matInput [(ngModel)]="newMeasureTitle" /></mat-form-field>
                    <app-date-field label="Дата постановления" [required]="true" [value]="newMeasureDate" (valueChange)="newMeasureDate = $event" />
                    <mat-form-field><mat-label>№ постановления</mat-label><input matInput [(ngModel)]="newMeasureDocNum" /></mat-form-field>
                    <mat-form-field class="wide"><mat-label>Примечание к мере</mat-label><input matInput [(ngModel)]="newMeasureNote" /></mat-form-field>
                    <label class="file-pick">
                      Постановление (PDF/скан):
                      <input type="file" (change)="onMeasureFile($event)" />
                    </label>
                  </div>
                  <div class="actions">
                    <span [title]="measureDraftTitle()">
                      <button mat-stroked-button type="button" [disabled]="!measureDraftReady()" (click)="submitOpiMeasure(false)">Добавить меру ОПИ</button>
                    </span>
                    <span [title]="measureMoveTitle(row)">
                      <button mat-stroked-button type="button" [disabled]="!measureMoveOpen(row)" (click)="submitOpiMeasure(true)">Добавить меру и перевести в «Меры ОПИ»</button>
                    </span>
                  </div>
                </div>

                <div class="opi-card" [hidden]="opiSlot() !== 'fullness'">
                  <h4>Полнота взыскания: долг, пеня и тариф</h4>
                  <p class="hint">ПМ показывает суммы АИС и не меняет их. Статус «Взыскано» — после погашения основного долга, пени и нотариального тарифа.</p>
                  <p [class.ready-line]="row.tariff_received && row.ais_debt_cleared" [class.need]="!(row.tariff_received && row.ais_debt_cleared)">
                    {{ row.tariff_received && row.ais_debt_cleared ? 'Погашение долга, пени и тарифа подтверждено выгрузкой АИС.' : 'Выгрузка АИС о погашении ещё не пришла.' }}
                  </p>
                  <div class="actions">
                    <button mat-stroked-button type="button" (click)="act('ais-receipt')">Подтвердить погашение (АИС)</button>
                  </div>
                </div>

                <div class="opi-card" [hidden]="opiSlot() !== 'acts' && opiSlot() !== 'acts3'">
                  <h4>Акт о невозможности взыскания</h4>
                  <p class="hint">Взыскание идёт по исполнительному документу. Акт прикладывают, только если взыскать не удалось. Для списания по этому документу нужны три таких акта. Сейчас приложено: <b>{{ row.acts_count }}</b>.</p>
                  @if (row.acts.length) {
                    <table class="opi-table">
                      <thead>
                        <tr>
                          <th>Наименование</th>
                          <th>№ акта</th>
                          <th>Дата</th>
                          <th>Основание / Файл</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (item of row.acts; track item.id) {
                          <tr>
                            <td><b>{{ item.title }}</b></td>
                            <td>{{ item.act_number || '—' }}</td>
                            <td>{{ item.act_date ? dotDate(item.act_date) : '—' }}</td>
                            <td>
                              {{ item.reason || '' }}
                              @if (item.attachment_id) {
                                <button type="button" class="link-btn" (click)="downloadFileById(item.attachment_id, item.file_name || 'act_opi.pdf')">
                                  {{ item.file_name || 'Скачать акт' }}
                                </button>
                              }
                            </td>
                            <td class="right">
                              <button type="button" class="link-btn danger" (click)="removeAct(item)">Удалить</button>
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  }
                  <div class="fields top-gap">
                    <mat-form-field><mat-label>Акт о невозможности взыскания</mat-label><input matInput [(ngModel)]="actTitle" /></mat-form-field>
                    <mat-form-field><mat-label>Номер акта</mat-label><input matInput [(ngModel)]="actNumber" /></mat-form-field>
                    <app-date-field label="Дата акта" [value]="actDate" (valueChange)="actDate = $event" />
                    <mat-form-field class="wide"><mat-label>Основание возврата (ст. 52 Закона об ИП)</mat-label>
                      <input matInput [(ngModel)]="actReason" [matAutocomplete]="autoActReason" />
                      <mat-autocomplete #autoActReason="matAutocomplete">
                        @for (r of dict('204'); track r.code) {
                          <mat-option [value]="r.name">{{ r.code }} — {{ r.name }}</mat-option>
                        }
                      </mat-autocomplete>
                    </mat-form-field>
                    <label class="file-pick">
                      Скан акта / постановления ОПИ
                      <input type="file" (change)="onActFile($event)" />
                    </label>
                  </div>
                  <div class="actions">
                    <span [title]="actDraftTitle()">
                      <button mat-stroked-button type="button" [disabled]="!actDraftReady()" (click)="submitAct()">Приложить акт</button>
                    </span>
                    @if (canAdvance()) {
                      <span [title]="impossibleTitle(row)">
                        <button mat-stroked-button type="button" [disabled]="!impossibleOpen(row)" (click)="act('move', { stage: 'impossible' })">Невозможность взыскания</button>
                      </span>
                    }
                    @if (row.acts_count >= 3) {
                      <button mat-stroked-button type="button" (click)="setTab('writeoff')">Перейти к согласованию списания</button>
                    }
                  </div>
                </div>

                <div class="opi-card" [hidden]="opiSlot() !== 'pris'">

                  @if (row.pris?.inquiry?.applied) {
                    <div class="inquiry opi-card">
                      <h4>Сведения о ходе исполнительного производства из АИС ПРИС (3.11.04 / 3.11.05)</h4>
                      <p class="hint">Идентификатор задолженности взыскателя: <b>{{ row.pris?.cl_num }}</b></p>
                      @for (doc of row.pris?.inquiry?.p_ispdoc || []; track $index) {
                        <p>Исполнительный производство № <b>{{ doc.proc_num }}</b> по документу № {{ doc.doc_num }}</p>
                      }
                      @for (sum of row.pris?.inquiry?.p_ost || []; track $index) {
                        <p>Остаток долга: <b>{{ sum.ost_sum }}</b> (код валюты {{ sum.curr_code }}), первоначальное требование: {{ sum.req_sum }}</p>
                      }
                      @for (status of row.pris?.inquiry?.p_status || []; track $index) {
                        <p>Статус ИП: <b>{{ status.status }}</b> от {{ status.date_status }}@if (status.actual === '1') { · актуальный }</p>
                      }
                      @for (action of row.pris?.inquiry?.p_action || []; track $index) {
                        <p>Принятая мера: {{ actionLine(action) }}</p>
                      }
                      @for (pay of row.pris?.inquiry?.p_repay || []; track $index) {
                        <p>Погашение: {{ pay['p_pay_sum'] || pay['pay_sum'] || actionLine(pay) }}</p>
                      }
                      @for (charge of row.pris?.inquiry?.p_nachisl || []; track $index) {
                        <p>Начисление: {{ actionLine(charge) }}</p>
                      }
                    </div>
                  }

                  @if (stubAnswer(row)) {
                    <p class="banner">PDF для передачи в ОПИ — заглушка ответа БНП, не исполнительная надпись нотариуса. В списке он уже выбран, если свой файл не указывали.</p>
                  }
                  @if (row.stage === 'prep' || row.stage === 'notary') {
                    <div class="banner">
                      Сначала отметьте «Надпись совершена». Нужны дата вручения, нотариальный тариф и PDF. В кабинет БНП этот шаг не отправляет. Файл подписи не нужен.
                    </div>
                    <div class="line">
                      <app-date-field label="Дата вручения предупреждения" [required]="true" [value]="warningDate" (valueChange)="setWarningDate($event)" />
                      <mat-form-field [class.need]="!(Number(tariff) > 0)"><mat-label>Нотариальный тариф *</mat-label>
                        <input matInput holdDraft [ngModel]="tariff" (ngModelChange)="setTariff($event)" />
                        <span matTextSuffix><app-byn-sign /></span>
                      </mat-form-field>
                      <span [title]="writMarkTitle(row)">
                        <button mat-flat-button color="primary" type="button" [disabled]="!writMarkOpen(row)" (click)="markWrit()">Надпись совершена</button>
                      </span>
                    </div>
                  }
                  <details open>
                    <summary>Направление в ОПИ через АИС ПРИС (ОАИС 3.11.01–3.11.05)</summary>
                    <p class="hint">Пустые реквизиты документа, адрес должника и код органа подставляются из карточки. Уже введённое не затирается. Реквизиты взыскателя берутся из карточки организации. Документ для передачи специалист подписывает тем же ключом, что комплект нотариусу. Без этой подписи пакет не собирается.</p>
                    @if (row.pris?.problems?.length) {
                      <p class="need">Не заполнено для передачи в ОПИ: {{ row.pris?.problems?.join('; ') }}</p>
                    } @else if (row.pris?.ready) {
                      <p class="ready-line">Пакет 3.11.02 полностью заполнен и готов к передаче в АИС ПРИС.</p>
                    }
                    <div class="actions">
                      <button mat-stroked-button type="button" (click)="autofillPrisForm()">Заполнить из карточки ЛС и дела</button>
                    </div>
                    <p class="hint">Идентификатор задолженности: {{ row.pris?.cl_num || 'появится при передаче' }}</p>
                    <div class="fields">
                    <mat-form-field [class.need]="!prisOpi.trim()"><mat-label>ОПИ, справочник 120 *</mat-label>
                      <input matInput [ngModel]="prisOpi" (ngModelChange)="onPrisOpiInput($event)" [matAutocomplete]="autoOpi" />
                      <mat-hint>Тот же орган, что в пункте «Орган и дата направления».</mat-hint>
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
                      <mat-form-field [class.need]="!prisDocCode.trim()"><mat-label>Вид документа, справочник 201 *</mat-label>
                        <input matInput [(ngModel)]="prisDocCode" [matAutocomplete]="autoDoc" />
                        <mat-autocomplete #autoDoc="matAutocomplete">
                          @for (item of dict('201'); track item.code) { <mat-option [value]="item.code">{{ item.code }} — {{ item.name }}</mat-option> }
                        </mat-autocomplete>
                      </mat-form-field>
                      <mat-form-field [class.need]="!prisDocNum.trim()"><mat-label>Номер документа *</mat-label><input matInput [(ngModel)]="prisDocNum" /></mat-form-field>
                      <mat-form-field [class.need]="!prisDocDate.trim()"><mat-label>Дата документа *</mat-label><input matInput [(ngModel)]="prisDocDate" placeholder="ДД.ММ.ГГГГ" /></mat-form-field>
                      <mat-form-field [class.need]="!prisOrgCode.trim()"><mat-label>Орган, справочник 217 *</mat-label>
                        <input matInput [(ngModel)]="prisOrgCode" [matAutocomplete]="autoOrg" />
                        <mat-autocomplete #autoOrg="matAutocomplete">
                          @for (item of organDict(); track item.code) { <mat-option [value]="item.code">{{ item.code }} — {{ item.name }}</mat-option> }
                        </mat-autocomplete>
                      </mat-form-field>
                      <mat-form-field class="wide" [class.need]="!prisOrg.trim()"><mat-label>Наименование органа *</mat-label><input matInput [(ngModel)]="prisOrg" /></mat-form-field>
                      <mat-form-field [class.need]="!prisDocDateIn.trim()"><mat-label>Дата вступления в силу *</mat-label><input matInput [(ngModel)]="prisDocDateIn" placeholder="ДД.ММ.ГГГГ" /></mat-form-field>
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
                          <mat-option [value]="0">Не выбран</mat-option>
                          @for (file of prisDocumentFiles(row); track file.id) {
                            <mat-option [value]="file.id">{{ file.name }}</mat-option>
                          }
                        </mat-select>
                      </mat-form-field>
                      <label class="file-pick">
                        Приложить PDF
                        <input type="file" accept="application/pdf,.pdf" (change)="uploadPrisPdf($event)" />
                      </label>
                      <mat-form-field><mat-label>Подпись специалиста</mat-label>
                        <mat-select [(ngModel)]="prisSign">
                          <mat-option [value]="0">Нет подписи</mat-option>
                          @for (file of prisSignatureFiles(row); track file.id) {
                            <mat-option [value]="file.id">{{ file.name }}</mat-option>
                          }
                        </mat-select>
                      </mat-form-field>
                      <span [title]="prisSignTitle()">
                        <button mat-stroked-button type="button" (click)="signPrisPdf()" [disabled]="signing || !prisPdf">Подписать ЭЦП</button>
                      </span>
                      <mat-form-field [class.need]="!prisOrgUnp.trim()"><mat-label>УНП взыскателя *</mat-label><input matInput [(ngModel)]="prisOrgUnp" maxlength="9" /></mat-form-field>
                      <mat-form-field [class.need]="!prisOpf.trim()"><mat-label>ОПФ взыскателя *</mat-label><input matInput [(ngModel)]="prisOpf" /></mat-form-field>
                      <mat-form-field [class.need]="!prisCountry.trim()"><mat-label>Страна адреса, справочник 306 *</mat-label>
                        <input matInput [(ngModel)]="prisCountry" [matAutocomplete]="autoCountry" />
                        <mat-autocomplete #autoCountry="matAutocomplete">
                          @for (item of dict('306'); track item.code) { <mat-option [value]="item.code">{{ item.code }} — {{ item.name }}</mat-option> }
                        </mat-autocomplete>
                      </mat-form-field>
                      <mat-form-field class="wide" [class.need]="!prisAddress.trim()"><mat-label>Полный адрес взыскателя *</mat-label><input matInput [(ngModel)]="prisAddress" /></mat-form-field>
                      <mat-form-field><mat-label>Область взыскателя</mat-label><input matInput [(ngModel)]="prisClaimRegion" /></mat-form-field>
                      <mat-form-field><mat-label>Район взыскателя</mat-label><input matInput [(ngModel)]="prisClaimArea" /></mat-form-field>
                      <mat-form-field [class.need]="!prisClaimNpType.trim()"><mat-label>Тип населённого пункта, 309 *</mat-label>
                        <input matInput [(ngModel)]="prisClaimNpType" [matAutocomplete]="autoClaimNp" />
                        <mat-autocomplete #autoClaimNp="matAutocomplete">
                          @for (item of dict('309'); track item.code) { <mat-option [value]="item.code">{{ item.code }} — {{ item.name }}</mat-option> }
                        </mat-autocomplete>
                      </mat-form-field>
                      <mat-form-field [class.need]="!prisNp.trim()"><mat-label>Населённый пункт *</mat-label><input matInput [(ngModel)]="prisNp" /></mat-form-field>
                      <mat-form-field><mat-label>Тип улицы, 308</mat-label>
                        <input matInput [(ngModel)]="prisClaimStreetType" [matAutocomplete]="autoClaimStreet" />
                        <mat-autocomplete #autoClaimStreet="matAutocomplete">
                          @for (item of dict('308'); track item.code) { <mat-option [value]="item.code">{{ item.code }} — {{ item.name }}</mat-option> }
                        </mat-autocomplete>
                      </mat-form-field>
                      <mat-form-field><mat-label>Улица взыскателя</mat-label><input matInput [(ngModel)]="prisClaimStreet" /></mat-form-field>
                      <mat-form-field [class.need]="!prisHouse.trim()"><mat-label>Дом *</mat-label><input matInput [(ngModel)]="prisHouse" /></mat-form-field>
                      <mat-form-field><mat-label>Корпус</mat-label><input matInput [(ngModel)]="prisClaimCorp" /></mat-form-field>
                      <mat-form-field><mat-label>Квартира</mat-label><input matInput [(ngModel)]="prisClaimFlat" /></mat-form-field>
                      <mat-form-field><mat-label>Индекс</mat-label><input matInput [(ngModel)]="prisClaimIndex" /></mat-form-field>
                      <mat-form-field><mat-label>УНП получателя</mat-label><input matInput [(ngModel)]="prisBankUnp" /></mat-form-field>
                      <mat-form-field [class.need]="!prisBank.trim()"><mat-label>SWIFT *</mat-label><input matInput [(ngModel)]="prisBank" /></mat-form-field>
                      <mat-form-field [class.need]="!prisAccount.trim()"><mat-label>Счёт *</mat-label><input matInput [(ngModel)]="prisAccount" /></mat-form-field>
                      <mat-form-field [class.need]="!prisAccType.trim()"><mat-label>Тип счёта *</mat-label><input matInput [(ngModel)]="prisAccType" /></mat-form-field>
                      <mat-form-field><mat-label>Валюта, ОКРБ</mat-label><input matInput [(ngModel)]="prisCurr" /></mat-form-field>
                      <mat-form-field><mat-label>Код платежа в бюджет</mat-label><input matInput [(ngModel)]="prisBudget" /></mat-form-field>
                    </div>
                    <p class="hint">В пакете уходит остаток АИС на момент передачи.</p>
                    <div class="actions">
                      <button mat-stroked-button type="button" (click)="savePrisDraft()">Сохранить черновик</button>
                      <span [title]="opiSendTitle(row)">
                        <button mat-flat-button color="primary" type="button" (click)="sendPris()" [disabled]="!opiSendOpen(row)">Передать в ОПИ</button>
                      </span>
                    </div>
                    @if (prisSent(row)) {
                      <p class="hint">Судебный исполнитель принимает задолженность вручную. Запрос хода и погашение по делу, переданному сегодня, уходят на следующий день. Новая оплата из АИС ждёт в очереди. «Передать погашения» повторяет только эту очередь.</p>
                      <div class="actions">
                        <button mat-stroked-button type="button" (click)="act('pris/refresh')">Обновить ход</button>
                        <button mat-stroked-button type="button" (click)="act('pris/repay')">Передать погашения</button>
                      </div>
                    }
                    @if (row.pris?.exchanges?.length) {
                      <details>
                        <summary>Журнал обмена с ОПИ</summary>
                        @for (item of row.pris?.exchanges || []; track item.id) {
                          <p class="hint">{{ item.created_at }} · {{ item.operation }} · {{ item.mode || 'без канала' }} · {{ item.process_status }} · {{ item.note }}</p>
                          <pre>{{ exchangeText(item) }}</pre>
                        }
                      </details>
                    }
                  </details>
                </div>
                <div class="actions">
                  <button mat-flat-button color="primary" type="button" (click)="saveOpiRecord()">Записать статус</button>
                  @if (canAdvance() && row.stage === 'writ_done') {
                    <span [title]="opiDirectionTitle(row)">
                      <button mat-stroked-button type="button" [disabled]="!opiDirectionReady(row)" (click)="moveToOpi()">Направлено в ОПИ</button>
                    </span>
                  }
                  @if (canAdvance() && row.stage === 'opi') {
                    <span [title]="measuresMoveTitle(row)">
                      <button mat-stroked-button type="button" [disabled]="!measuresKnown(row)" (click)="moveToMeasures()">Меры приняты</button>
                    </span>
                  }
                  @if (canAdvance()) {
                    <span [title]="recoveredTitle(row)">
                      <button mat-stroked-button type="button" [disabled]="!recoveredOpen(row)" (click)="act('move', { stage: 'recovered' })">Взыскано</button>
                    </span>
                  }
                </div>
                  </div>
                </div>
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
                <span [title]="writeoffTitle(row)">
                  <button mat-flat-button color="primary" type="button" [disabled]="!writeoffOpen(row)" (click)="act('writeoff', { approver_ids: approvers })">На согласование</button>
                </span>
                <p class="hint">Маршрут: {{ row.writeoff_status || 'не запущен' }}. {{ row.writeoff_note }}</p>
                @for (vote of row.approvals; track vote.id) {
                  <p>{{ vote.approver_name }}: {{ vote.decision }} {{ vote.reason }}</p>
                }
                <mat-form-field class="wide"><mat-label>Ваше решение</mat-label><input matInput [(ngModel)]="decisionReason" /></mat-form-field>
                <div class="actions">
                  <span [title]="decideTitle(row, 'yes')">
                    <button mat-stroked-button type="button" [disabled]="!myPending(row)" (click)="act('decide', { decision: 'yes', reason: decisionReason })">Согласовать</button>
                  </span>
                  <span [title]="decideTitle(row, 'no')">
                    <button mat-stroked-button type="button" [disabled]="!myPending(row) || !decisionReason.trim()" (click)="act('decide', { decision: 'no', reason: decisionReason })">Отказать</button>
                  </span>
                </div>
              }
            }
          </div>
          @if (journal(row).length) {
            <aside>
              <h3>История</h3>
              <ul>
                @for (event of journal(row); track $index) {
                  <li>
                    <time>{{ event.at | date: 'dd.MM.yyyy HH:mm' }}</time>
                    <span><b>{{ event.actor }}</b> {{ event.reason || event.new_stage }}</span>
                  </li>
                }
              </ul>
            </aside>
          }
        </div>
      }
      <app-funnel-gate-dialog [gate]="gate()" (go)="openGate()" (closed)="gate.set(null)" />
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
    .tabs .tab { position: relative; display: inline-flex; }
    .tabs button {
      border: 0; border-bottom: 2px solid transparent; background: transparent; font: inherit; font-weight: 600;
      color: var(--erip-muted); padding: 8px 12px; cursor: pointer;
    }
    .tabs button.on { color: var(--erip-primary-dark); border-bottom-color: var(--erip-primary); }
    .tabs button:disabled { opacity: 0.45; cursor: default; pointer-events: none; }
    .tabs .tab[data-tip]:hover::after, .tip[data-tip]:hover::after {
      content: attr(data-tip);
      position: absolute; left: 0; top: calc(100% + 6px); z-index: 8;
      width: max-content; max-width: 280px; padding: 6px 8px; border-radius: 6px;
      background: #243044; color: #fff; font-size: 12px; font-weight: 500; line-height: 1.35;
      white-space: normal; pointer-events: none;
    }
    .tip { position: relative; display: inline-flex; }
    .tip > button:disabled { pointer-events: none; }
    .bar .tip[data-tip]:hover::after, .actions .tip[data-tip]:hover::after { top: auto; bottom: calc(100% + 6px); }
    .packages { display: flex; flex-wrap: wrap; gap: 8px; }
    .packages a {
      display: flex; flex-direction: column; gap: 2px; text-decoration: none; color: inherit;
      border: 1px solid var(--erip-border); border-radius: 8px; background: #fff; padding: 8px 10px;
    }
    .packages a.on { border-color: var(--erip-primary); background: var(--erip-primary-soft); }
    .packages small { color: var(--erip-muted); }
    .work { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 12px; }
    .work:not(:has(aside)) { grid-template-columns: minmax(0, 1fr); }
    .pane { min-width: 0; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 8px; background: #fff; border: 1px solid var(--erip-border); border-radius: 12px; padding: 12px; }
    .sums { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .sums div { background: var(--erip-bg); border-radius: 8px; padding: 8px 10px; }
    .sums span { display: block; color: var(--erip-muted); font-size: 12px; }
    .sums .total { background: var(--erip-primary-soft); }
    .line, .actions, .bar { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-start; }
    .line > mat-form-field.tariff { flex: 0 0 260px; width: 260px; }
    .line mat-checkbox { align-self: center; margin-top: 8px; }
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
    .banner.ok-banner { background: #e8f6ee; color: #166534; }
    .ready-line { color: #166534; font-size: 13px; font-weight: 600; margin: 4px 0; }
    [hidden] { display: none !important; }
    .opi-card { border: 1px solid var(--erip-border); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px; background: #fbfcfd; }
    .opi-card h4 { margin: 0; font-size: 14px; color: var(--erip-primary-dark); }
    .opi-table { width: 100%; border-collapse: collapse; font-size: 13px; background: #fff; }
    .opi-table th, .opi-table td { border-bottom: 1px solid var(--erip-border); padding: 6px 8px; text-align: left; vertical-align: middle; }
    .opi-table th { font-size: 11px; text-transform: uppercase; color: var(--erip-muted); background: #f7f9fb; }
    .opi-table td.right { text-align: right; white-space: nowrap; }
    .link-btn { border: 0; background: transparent; color: var(--erip-link); cursor: pointer; font: inherit; font-size: 12px; padding: 0 4px; text-decoration: underline; }
    .link-btn.danger { color: var(--erip-danger); }
    .file-pick { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--erip-muted); }
    .file-pick.need { color: #c62828; font-weight: 650; }
    .split { display: grid; grid-template-columns: minmax(220px, 300px) minmax(0, 1fr); gap: 12px; align-items: start; }
    .checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .checks li { border: 1px solid var(--erip-border); border-radius: 8px; background: #fff; padding: 6px 8px; }
    .checks li.on { border-color: var(--erip-primary); background: var(--erip-primary-soft); }
    .checks li.need { border-color: #c62828; }
    .check-row {
      display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; align-items: center; column-gap: 8px;
      width: 100%; border: 0; background: transparent; text-align: left; font: inherit; cursor: pointer; padding: 2px 0;
    }
    .box { width: 16px; height: 16px; border: 1.5px solid #8aa0ad; border-radius: 3px; background: #fff; }
    .box.on { background: var(--erip-success); border-color: var(--erip-success); box-shadow: inset 0 0 0 2px #fff; }
    .check-row .title { min-width: 0; font-size: 14px; line-height: 1.3; }
    .check-row .state { font-size: 12px; color: var(--erip-muted); white-space: nowrap; }
    .viewer { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .kind-list { display: flex; flex-direction: column; gap: 4px; }
    .fields .need {
      --mdc-outlined-text-field-outline-color: #c62828;
      --mdc-outlined-text-field-hover-outline-color: #c62828;
      --mdc-outlined-text-field-focus-outline-color: #c62828;
      --mdc-outlined-text-field-label-text-color: #c62828;
    }
    @media (max-width: 900px) { .split { grid-template-columns: minmax(0, 1fr); } }
    .top-gap { margin-top: 6px; }
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
  protected readonly gate = signal<FunnelGateInfo | null>(null);
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
  protected opiDepartment = '';
  protected opiSentOn = '';
  protected opiStartedOn = '';
  protected opiEndedOn = '';
  protected opiBailiff = '';
  protected opiNote = '';
  protected readonly opiOffices = signal<OpiOffice[]>([]);
  protected readonly opiSlots = [
    { id: 'register', title: 'Орган и дата направления', required: true },
    { id: 'proceeding', title: 'Номер и статус производства', required: true },
    { id: 'document', title: 'Исполнительный документ', required: true },
    { id: 'measures', title: 'Меры принудительного исполнения', required: true },
    { id: 'fullness', title: 'Полнота: долг, пеня и тариф', required: false },
    { id: 'acts', title: 'Акт о невозможности взыскания', required: false },
    { id: 'acts3', title: 'Три акта для списания', required: false },
    { id: 'pris', title: 'Направление через АИС ПРИС', required: false },
  ];
  protected readonly opiSlot = signal('register');
  protected readonly prisStatus = signal<PrisChannelStatus | null>(null);
  protected newMeasureKind = 'asset_arrest';
  protected newMeasureTitle = 'Арест имущества';
  protected newMeasureDate = '';
  protected newMeasureDocNum = '';
  protected newMeasureNote = '';
  protected newMeasureFile: File | null = null;
  protected actNumber = '';
  protected actDate = '';
  protected actReason = '';
  protected actFile: File | null = null;
  protected readonly defaultOpiStatuses = [
    { id: 'Возбуждено', label: 'Возбуждено' },
    { id: 'На исполнении', label: 'На исполнении' },
    { id: 'Меры приняты', label: 'Меры приняты' },
    { id: 'Частично исполнено', label: 'Частично исполнено' },
    { id: 'Приостановлено', label: 'Приостановлено' },
    { id: 'Окончено (взыскано)', label: 'Окончено (взыскано)' },
    { id: 'Возвращено (акт о невозможности взыскания)', label: 'Возвращено (акт о невозможности взыскания)' },
    { id: 'Прекращено', label: 'Прекращено' },
  ];
  protected readonly defaultMeasureKinds = [
    { id: 'asset_arrest', label: 'Арест имущества' },
    { id: 'account_seizure', label: 'Арест и списание денежных средств со счетов (АИС ИДО)' },
    { id: 'wage_deduction', label: 'Обращение взыскания на заработную плату и приравненные доходы' },
    { id: 'travel_ban', label: 'Временное ограничение права должника на выезд из Республики Беларусь' },
    { id: 'drive_ban', label: 'Временное ограничение права должника на управление механическими ТС' },
    { id: 'reg_ban', label: 'Запрет на совершение регистрационных действий в отношении имущества' },
    { id: 'search', label: 'Розыск должника / имущества должника' },
    { id: 'inventory', label: 'Опись и изъятие имущества' },
  ];
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
  private archiveWatch: ReturnType<typeof setInterval> | null = null;
  private watchingPris = false;
  private signAttempt = 0;
  private readonly emailProblem = 'Нужен e-mail для уведомлений. Несколько адресов — через запятую';
  private readonly serviceProblem = 'Выберите услугу исполнительной надписи из справочника БНП';
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
  protected prisOrgUnp = '';
  protected prisBankUnp = '';
  protected prisCurr = '933';
  protected prisBudget = '';
  protected prisDicts: Record<string, PrisDictRow[]> = {};
  protected actTitle = 'Акт о невозможности взыскания';
  protected approvers: number[] = [];
  protected decisionReason = '';
  protected eviction = '';
  protected refusalFile = 0;
  private readySignPath = '';
  private readySignClaimId = 0;

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const tab = params.get('tab');
      if (tab === 'pris') {
        this.opiSlot.set('pris');
        const row = this.claim();
        if (row && !this.tabOpen('opi', row)) {
          this.settleTab(row);
          return;
        }
        this.tab.set('opi');
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { tab: 'opi', slot: 'pris' },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
        return;
      }
      if (tab === 'pack' || tab === 'notary' || tab === 'court' || tab === 'opi' || tab === 'writeoff') {
        const row = this.claim();
        if (row && !this.tabOpen(tab, row)) {
          this.settleTab(row);
          return;
        }
        this.tab.set(tab);
      }
      const slot = params.get('slot');
      if (slot === 'pris' || this.opiSlots.some((item) => item.id === slot)) {
        this.opiSlot.set(slot || 'register');
      } else if (slot) {
        this.applySlot(slot);
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
    this.api.opiOffices().subscribe({
      next: (page) => this.opiOffices.set(page.results || []),
      error: () => this.opiOffices.set([]),
    });
    this.api.prisStatus().subscribe({
      next: (st) => this.prisStatus.set(st),
      error: () => this.prisStatus.set(null),
    });
  }

  ngOnDestroy(): void {
    this.alive = false;
    this.stopArchiveWatch();
    this.flushNotarySave();
  }

  @HostListener('window:focus')
  protected refreshPackOnFocus(): void {
    if (!this.alive || !this.archiveWatch || this.tab() !== 'pack') return;
    this.refreshClaim();
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
    const row = this.claim();
    if (row && !this.tabOpen(tab, row)) return;
    this.tab.set(tab);
    this.router.navigate([], { relativeTo: this.route, queryParams: { tab }, queryParamsHandling: 'merge' });
  }

  protected notarySendTitle(row: ClaimCase): string {
    return [...this.sendGaps(row), 'Обмен с БНП система-система не подключён'].join('. ');
  }

  protected sendGaps(row: ClaimCase): string[] {
    const fromList = (row.writ_checklist || [])
      .filter((item) => item.mandatory && !item.met)
      .map((item) => item.gap || item.name);
    const items = fromList.length
      ? fromList
      : (row.blockers || []).filter((item) => item.includes('вручения') || item.includes('тариф'));
    return items.filter((item, index) => item && items.indexOf(item) === index);
  }

  protected kitReady(row: ClaimCase): boolean {
    return this.kitGaps(row).length === 0;
  }

  protected archiveReady(row: ClaimCase): boolean {
    const pack = row.package;
    return this.kitReady(row) && !!pack?.formed_at && !(pack.send_blockers || []).length;
  }

  protected signTitle(row: ClaimCase): string {
    if (this.signing) return 'Подпись уже запущена';
    if (!this.kitReady(row)) return this.kitGaps(row).join('. ') || 'Комплект неполный';
    return 'Подписать документы и собрать архив';
  }

  protected stubAnswer(row: ClaimCase): boolean {
    return row.submission_mode === 'stub' && (row.notary_note || '').includes('заглушка') && row.stage !== 'notary';
  }

  protected directionNo(value: string | null | undefined): string {
    const text = value || '';
    return text.startsWith('stub-') ? text.slice(5) : text;
  }

  private kitGaps(row: ClaimCase): string[] {
    const gaps: string[] = [];
    const pack = row.package;
    if (!pack?.persisted) {
      gaps.push('Сначала приложите заявление, расчёт и доверенность');
    } else {
      for (const problem of pack.problems || []) {
        if (problem === this.emailProblem && this.emailLooksValid()) continue;
        if (problem === this.serviceProblem && this.defaultServiceId(pack)) continue;
        gaps.push(problem);
      }
      if (!this.emailLooksValid() && !(pack.problems || []).includes(this.emailProblem)) {
        gaps.push(this.emailProblem);
      }
    }
    if (!this.warningDate) gaps.push('Нет даты вручения предупреждения');
    if (!(Number(this.tariff) > 0)) gaps.push('Нет нотариального тарифа');
    return gaps.filter((item, index) => gaps.indexOf(item) === index);
  }

  private emailLooksValid(): boolean {
    const parts = this.notificationEmail.split(',').map((item) => item.trim()).filter(Boolean);
    return parts.length > 0 && parts.every((item) => /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(item));
  }

  private defaultServiceId(pack: ClaimPackage | null | undefined): number | null {
    if (!pack) return null;
    if (pack.service_id) return pack.service_id;
    return (pack.services || []).find((service) => service.housing)?.id || null;
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

  protected dotDate(iso: string): string {
    const [year, month, day] = (iso || '').slice(0, 10).split('-');
    return day && month && year ? `${day}.${month}.${year}` : iso;
  }

  protected grand(row: ClaimCase): number {
    const debt = Number(row.balance_out || 0);
    const penalty = Number(row.penalty || 0);
    const tariff = Number(this.tariff || 0);
    return debt + penalty + tariff;
  }

  protected opiExpenses(row: ClaimCase): number | null {
    const tariff = Number(this.tariff || row.notary_tariff || 0);
    const duty = Number(this.duty || row.state_duty || 0);
    const total = tariff + duty;
    return total > 0 ? total : null;
  }

  protected opiTotal(row: ClaimCase): number {
    const debt = Number(row.balance_out || 0);
    const penalty = Number(row.penalty || 0);
    const exp = this.opiExpenses(row) || 0;
    return debt + penalty + exp;
  }

  protected filteredOpiOffices(): OpiOffice[] {
    const q = (this.opiDepartment || '').trim().toLowerCase();
    const list = this.opiOffices();
    if (!q) return list.slice(0, 40);
    return list.filter((item) => `${item.code} ${item.name} ${item.region} ${item.address}`.toLowerCase().includes(q)).slice(0, 40);
  }

  protected onPickOpiOffice(val: string): void {
    this.onOpiDepartmentInput(val);
  }

  protected onOpiDepartmentInput(value: string): void {
    this.opiDepartment = value;
    const match = (value || '').match(/^(\d{2,6})\b/);
    if (match && this.prisOpi !== match[1]) this.prisOpi = match[1];
  }

  protected onPrisOpiInput(value: string): void {
    const code = (value || '').trim();
    this.prisOpi = code;
    if (!/^\d{2,6}$/.test(code) || new RegExp(`^${code}\\b`).test(this.opiDepartment)) return;
    const office = this.opiOffices().find((item) => item.code === code);
    if (office) this.opiDepartment = `${office.code} — ${office.name}`;
  }

  protected saveOpiRecord(): void {
    this.act('opi', this.opiBody());
  }

  protected opiDone(id: string, row: ClaimCase): boolean {
    if (id === 'register') return !!this.opiDepartment.trim() && !!this.opiSentOn;
    if (id === 'proceeding') return !!this.opiNumber.trim() && !!this.opiStatus.trim();
    if (id === 'document') return this.hasEnforcement(row);
    if (id === 'measures') return this.measuresKnown(row);
    if (id === 'fullness') return !!(row.tariff_received && row.ais_debt_cleared);
    if (id === 'acts') return row.acts_count >= 1;
    if (id === 'acts3') return row.acts_count >= 3;
    if (id === 'pris') return row.opi_mode === 'pris' || row.opi_mode === 'channel';
    return false;
  }

  protected opiState(id: string, row: ClaimCase): string {
    if (id === 'acts') return row.acts_count ? String(row.acts_count) : 'нет';
    if (id === 'acts3') return `${row.acts_count} из 3`;
    return this.opiDone(id, row) ? 'есть' : 'нет';
  }

  protected hasEnforcement(row: ClaimCase): boolean {
    if (row.opi_mode === 'pris' || row.opi_mode === 'channel' || row.opi_mode === 'stub') return true;
    return this.enforcementFiles(row).length > 0;
  }

  protected prisDocumentFiles(row: ClaimCase): ClaimCase['files'] {
    return (row.files || []).filter((file) => !this.signFile(file.name));
  }

  protected prisSignatureFiles(row: ClaimCase): ClaimCase['files'] {
    return (row.files || []).filter((file) => this.signFile(file.name));
  }

  private signFile(name: string): boolean {
    const lower = (name || '').toLowerCase();
    return lower.endsWith('.p7s') || lower.endsWith('.sgn');
  }

  protected enforcementFiles(row: ClaimCase): ClaimCase['files'] {
    return (row.files || []).filter((file) => /исполнительн/i.test(`${file.doc_type} ${file.name}`));
  }

  protected measuresKnown(row: ClaimCase): boolean {
    if ((row.opi_measures_taken || []).length) return true;
    return (row.pris?.inquiry?.p_action || []).length > 0;
  }

  protected kindTaken(id: string): boolean {
    return (this.claim()?.opi_measures_taken || []).some((item) => item.kind === id);
  }

  protected pickMeasureKind(kind: { id: string; label: string }): void {
    this.newMeasureKind = kind.id;
    this.newMeasureTitle = kind.label;
  }

  protected courtBranch(row: ClaimCase): boolean {
    return row.stage === 'refused' || row.stage === 'lawsuit' || row.stage === 'court';
  }

  protected canAdvance(): boolean {
    const me = this.auth.me();
    return this.auth.canWrite() && !!me && me.contour !== 'supplier';
  }

  private opiTabOpen(row: ClaimCase): boolean {
    if (this.courtBranch(row)) return false;
    return row.stage === 'writ_done' || row.stage === 'opi' || row.stage === 'opi_measures'
      || row.stage === 'recovered' || row.stage === 'impossible' || row.stage === 'writeoff';
  }

  protected tabOpen(id: string, row: ClaimCase): boolean {
    if (id === 'pack' || id === 'notary') return true;
    if (id === 'court') return this.courtBranch(row);
    if (id === 'opi') return this.opiTabOpen(row);
    if (id === 'writeoff') return row.stage === 'impossible' || row.stage === 'writeoff' || row.acts_count >= 3;
    return false;
  }

  protected tabTitle(id: string, row: ClaimCase): string {
    if (this.tabOpen(id, row)) return '';
    if (id === 'court') return 'Не хватает отказа нотариуса';
    if (id === 'opi') {
      return this.courtBranch(row)
        ? 'После отказа дело идёт в суд. Для ОПИ не хватает совершённой надписи'
        : 'Не хватает совершённой исполнительной надписи';
    }
    if (id === 'writeoff') return 'Не хватает трёх актов о невозможности взыскания';
    return '';
  }

  protected writFileReady(row: ClaimCase): boolean {
    return (row.files || []).some((file) => /исполнительн/i.test(`${file.doc_type} ${file.name}`));
  }

  protected decisionReady(row: ClaimCase): boolean {
    return (row.files || []).some((file) => /судебное решение/i.test(`${file.doc_type} ${file.name}`));
  }

  protected notaryDoneOpen(row: ClaimCase): boolean {
    return row.stage === 'notary' && this.writFileReady(row);
  }

  protected notaryAnswerTitle(row: ClaimCase): string {
    if (row.stage === 'notary' && !this.writFileReady(row)) return 'Сначала приложите PDF исполнительной надписи';
    if (row.stage === 'notary') return 'Зафиксировать положительный ответ нотариуса';
    if (row.stage === 'writ_done' || row.stage === 'refused' || this.courtBranch(row)) return 'Ответ нотариуса уже зафиксирован';
    return 'Сначала направьте пакет нотариусу';
  }

  protected refusalOpen(row: ClaimCase): boolean {
    return row.stage === 'notary' && (!!this.note.trim() || !!this.refusalFile);
  }

  protected refusalTitle(row: ClaimCase): string {
    if (row.stage !== 'notary') return this.notaryAnswerTitle(row);
    if (!this.note.trim() && !this.refusalFile) return 'Нужен комментарий или файл постановления об отказе';
    return 'Зафиксировать отказ нотариуса';
  }

  protected lawsuitMoveTitle(row: ClaimCase): string {
    return row.stage === 'refused' ? 'Перейти к исковому заявлению' : 'К иску переходят после отказа нотариуса';
  }

  protected courtSignOpen(row: ClaimCase): boolean {
    return this.courtDocs(row).some((doc) => doc.has_pdf && !doc.has_signature);
  }

  protected courtSignTitle(row: ClaimCase): string {
    const docs = this.courtDocs(row).filter((doc) => doc.has_pdf);
    if (!docs.length) return 'Сначала создайте или загрузите исковое заявление';
    if (!docs.some((doc) => !doc.has_signature)) return 'Исковые документы уже подписаны';
    return 'Подписать исковые документы тем же ключом, что комплект нотариусу';
  }

  private courtDocs(row: ClaimCase): ClaimPackage['documents'] {
    const kinds = new Set(['lawsuit', 'eviction', 'alienation']);
    return (row.package?.documents || []).filter((doc) => kinds.has(doc.doc_type));
  }

  protected decisionMoveTitle(row: ClaimCase): string {
    if (row.stage !== 'lawsuit') return 'Решение суда фиксируют после искового заявления';
    if (!this.decisionReady(row)) return 'Сначала приложите PDF «Судебное решение»';
    return 'Зафиксировать решение суда';
  }

  protected writMarkOpen(row: ClaimCase): boolean {
    return (row.stage === 'prep' || row.stage === 'notary')
      && !!this.warningDate
      && Number(this.tariff) > 0
      && this.writFileReady(row);
  }

  protected writMarkTitle(row: ClaimCase): string {
    if (row.stage !== 'prep' && row.stage !== 'notary') return 'Надпись отмечается из подготовки пакета или статуса «Направлено нотариусу»';
    const gaps: string[] = [];
    if (!this.warningDate) gaps.push('дату вручения');
    if (!(Number(this.tariff) > 0)) gaps.push('нотариальный тариф');
    if (!this.writFileReady(row)) gaps.push('PDF надписи');
    return gaps.length ? `Сначала укажите: ${gaps.join(', ')}` : 'Отметить надпись совершённой';
  }

  protected opiDirectionReady(row: ClaimCase): boolean {
    const integrated = (row.opi_mode === 'pris' || row.opi_mode === 'channel') && !!(row.opi_number || this.opiNumber).trim();
    if (integrated) return true;
    return !!this.opiDepartment.trim() && !!this.opiSentOn && this.hasEnforcement(row);
  }

  protected opiDirectionTitle(row: ClaimCase): string {
    if (this.opiDirectionReady(row)) return 'Поставить статус «Направлено в ОПИ»';
    const gaps: string[] = [];
    if (!this.opiDepartment.trim()) gaps.push('орган ОПИ');
    if (!this.opiSentOn) gaps.push('дату направления');
    if (!this.hasEnforcement(row)) gaps.push('исполнительный документ');
    return `Сначала заполните: ${gaps.join(', ')}`;
  }

  protected measuresMoveTitle(row: ClaimCase): string {
    return this.measuresKnown(row) ? 'Поставить статус «Меры ОПИ приняты»' : 'Сначала добавьте принятую меру ОПИ';
  }

  protected recoveredOpen(row: ClaimCase): boolean {
    return row.stage === 'opi_measures' && !!row.tariff_received && !!row.ais_debt_cleared;
  }

  protected recoveredTitle(row: ClaimCase): string {
    if (row.stage !== 'opi_measures') return '«Взыскано» ставится после статуса «Меры ОПИ приняты»';
    if (!row.tariff_received || !row.ais_debt_cleared) return 'Ждёт выгрузку АИС: погашены долг, пеня и тариф';
    return 'Поставить статус «Взыскано»';
  }

  protected impossibleOpen(row: ClaimCase): boolean {
    return row.stage === 'opi_measures' && row.acts_count >= 1;
  }

  protected impossibleTitle(row: ClaimCase): string {
    if (row.stage !== 'opi_measures') return 'Статус ставится после «Меры ОПИ приняты»';
    if (row.acts_count < 1) return 'Сначала приложите акт о невозможности взыскания';
    return 'Поставить статус «Невозможность взыскания»';
  }

  protected measureDraftReady(): boolean {
    return !!this.newMeasureTitle.trim() && !!this.newMeasureDate;
  }

  protected measureDraftTitle(): string {
    return this.measureDraftReady() ? 'Записать меру ОПИ' : 'Нужны наименование и дата постановления';
  }

  protected measureMoveOpen(row: ClaimCase): boolean {
    if (!this.measureDraftReady() || this.courtBranch(row)) return false;
    if (row.stage === 'opi') return true;
    return row.stage === 'writ_done' && this.opiDirectionReady(row);
  }

  protected measureMoveTitle(row: ClaimCase): string {
    if (this.courtBranch(row)) return 'После отказа дело идёт в суд, не в меры ОПИ';
    if (!this.measureDraftReady()) return 'Нужны наименование и дата постановления';
    if (row.stage === 'writ_done' && !this.opiDirectionReady(row)) return this.opiDirectionTitle(row);
    if (row.stage !== 'writ_done' && row.stage !== 'opi') return 'Перевод в «Меры ОПИ» доступен после направления в ОПИ';
    return 'Добавить меру и перевести дело';
  }

  protected actDraftReady(): boolean {
    return !!this.actTitle.trim() && !!this.actNumber.trim() && !!this.actDate && !!this.actReason.trim() && !!this.actFile;
  }

  protected actDraftTitle(): string {
    return this.actDraftReady() ? 'Приложить акт' : 'Нужны наименование, номер, дата, основание и файл';
  }

  protected writeoffOpen(row: ClaimCase): boolean {
    return this.canAdvance() && row.stage === 'impossible' && row.acts_count >= 3 && this.approvers.length > 0;
  }

  protected myPending(row: ClaimCase): boolean {
    const me = this.auth.me();
    if (!me) return false;
    return row.approvals.some((vote) => vote.approver_id === me.id && vote.decision === 'pending');
  }

  protected decideTitle(row: ClaimCase, decision: 'yes' | 'no'): string {
    if (!this.myPending(row)) return 'Решение доступно согласующему, пока маршрут ждёт его ответ';
    if (decision === 'no' && !this.decisionReason.trim()) return 'Отказ записывается с причиной';
    return decision === 'yes' ? 'Согласовать списание' : 'Отказать в списании';
  }

  protected writeoffTitle(row: ClaimCase): string {
    if (!this.canAdvance()) return '';
    if (row.stage !== 'impossible') return 'Согласование запускается из статуса «Невозможность взыскания»';
    if (row.acts_count < 3) return 'Нужны три акта о невозможности взыскания';
    if (!this.approvers.length) return 'Выберите хотя бы одного согласующего';
    return 'Отправить на согласование';
  }

  protected opiSendOpen(row: ClaimCase): boolean {
    if (row.stage !== 'writ_done' && row.stage !== 'opi' && row.stage !== 'opi_measures') return false;
    return !(row.pris?.problems || []).length && !!row.pris?.ready;
  }

  protected opiSendTitle(row: ClaimCase): string {
    if (this.courtBranch(row)) return 'После отказа нотариуса дело идёт в суд, не в ОПИ';
    if (row.stage !== 'writ_done' && row.stage !== 'opi' && row.stage !== 'opi_measures') {
      return 'Передача в ОПИ включается после совершённой надписи';
    }
    const problems = row.pris?.problems || [];
    if (problems.length) return `Сначала заполните: ${problems.join('; ')}`;
    if (!row.pris?.ready) return 'Сначала заполните пакет для передачи в ОПИ';
    return 'Передать пакет в ОПИ';
  }

  protected moveToOpi(): void {
    const row = this.claim();
    if (!row) return;
    const integrated = (row.opi_mode === 'pris' || row.opi_mode === 'channel') && !!(row.opi_number || this.opiNumber).trim();
    if (!integrated) {
      const gaps: string[] = [];
      if (!this.opiDepartment.trim()) gaps.push('орган ОПИ');
      if (!this.opiSentOn) gaps.push('дату направления');
      if (!this.hasEnforcement(row)) gaps.push('исполнительный документ');
      if (gaps.length) {
        this.opiSlot.set(gaps.some((item) => item.includes('документ')) ? 'document' : 'register');
        this.snack.open(`Заполните: ${gaps.join(', ')}`, 'OK');
        return;
      }
    } else {
      this.act('move', { stage: 'opi', reason: this.skipReason || 'Направлено в ОПИ' });
      return;
    }
    this.api.claimAction(row.id, 'opi', this.opiBody()).subscribe({
      next: (saved) => {
        this.apply(saved);
        this.act('move', { stage: 'opi', reason: this.skipReason || 'Направлено в ОПИ' });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected moveToMeasures(): void {
    const row = this.claim();
    if (!row || !this.measuresKnown(row)) {
      this.opiSlot.set('measures');
      this.snack.open('Добавьте принятую меру ОПИ', 'OK');
      return;
    }
    this.act('move', { stage: 'opi_measures', reason: this.skipReason || 'Меры ОПИ приняты' });
  }

  protected openOpiSlot(id: string): void {
    this.opiSlot.set(id);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: 'opi', slot: id },
      queryParamsHandling: 'merge',
    });
    if (id === 'pris') this.pullPrisDraft();
  }

  protected markWrit(): void {
    this.act('pris/writ', {
      warning_delivered_on: this.warningDate || null,
      notary_tariff: this.tariff,
    });
  }

  protected uploadPrisPdf(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const row = this.claim();
    if (!file || !row) return;
    this.api.uploadFile(row.account, 'Исполнительная надпись', file).subscribe({
      next: (saved) => {
        input.value = '';
        this.prisPdf = Number(saved.id);
        this.api.claimAction(row.id, 'pris/draft', this.prisPayload()).subscribe({
          next: (next) => {
            this.apply(next);
            this.snack.open('PDF приложен', 'OK', { duration: 2000 });
          },
          error: (err) => this.snack.open(errorMessage(err), 'OK'),
        });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected uploadWrit(event: Event): void {
    this.uploadAccountFile(event, 'Исполнительная надпись', 'PDF надписи приложен');
  }

  protected uploadDecision(event: Event): void {
    this.uploadAccountFile(event, 'Судебное решение', 'PDF решения приложен');
  }

  private uploadAccountFile(event: Event, docType: string, done: string): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const row = this.claim();
    if (!file || !row) return;
    this.api.uploadFile(row.account, docType, file).subscribe({
      next: () => {
        input.value = '';
        this.reloadClaim();
        this.snack.open(done, 'OK', { duration: 2000 });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected uploadEnforcement(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const row = this.claim();
    if (!file || !row) return;
    this.api.uploadFile(row.account, 'Исполнительный документ', file).subscribe({
      next: () => {
        input.value = '';
        this.reloadClaim();
        this.snack.open('Исполнительный документ приложен', 'OK', { duration: 2000 });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private opiBody(): object {
    return {
      number: this.opiNumber,
      status: this.opiStatus,
      department: this.opiDepartment,
      sent_on: this.opiSentOn || null,
      started_on: this.opiStartedOn || null,
      ended_on: this.opiEndedOn || null,
      bailiff: this.opiBailiff,
      note: this.opiNote,
    };
  }

  private reloadClaim(): void {
    const id = this.claim()?.id;
    if (!id) return;
    this.api.claim(id).subscribe({
      next: (next) => this.apply(next),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected onMeasureKindChange(): void {
    const kinds = this.claim()?.opi_measure_kinds || this.defaultMeasureKinds;
    const found = kinds.find((item) => item.id === this.newMeasureKind);
    if (found) this.newMeasureTitle = found.label;
  }

  protected onMeasureFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.newMeasureFile = input.files?.[0] || null;
  }

  protected submitOpiMeasure(moveStage: boolean): void {
    const row = this.claim();
    if (!row) return;
    if (!this.newMeasureTitle.trim() || !this.newMeasureDate) {
      this.snack.open('Для меры нужны наименование и дата постановления', 'OK');
      return;
    }
    this.api.addOpiMeasure(
      row.id,
      {
        kind: this.newMeasureKind,
        title: this.newMeasureTitle,
        date: this.newMeasureDate || null,
        doc_number: this.newMeasureDocNum,
        note: this.newMeasureNote,
        move_stage: moveStage,
      },
      this.newMeasureFile,
    ).subscribe({
      next: (next) => {
        this.newMeasureDocNum = '';
        this.newMeasureNote = '';
        this.newMeasureFile = null;
        this.apply(next);
        this.snack.open('Мера ОПИ добавлена', 'OK', { duration: 2000 });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected removeMeasure(m: OpiMeasureTaken): void {
    const row = this.claim();
    if (!row) return;
    this.api.deleteOpiMeasure(row.id, m.id).subscribe({
      next: (next) => {
        this.apply(next);
        this.snack.open('Мера ОПИ удалена', 'OK', { duration: 2000 });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected onActFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.actFile = input.files?.[0] || null;
  }

  protected submitAct(): void {
    const row = this.claim();
    if (!row) return;
    if (!this.actTitle.trim() || !this.actNumber.trim() || !this.actDate || !this.actReason.trim() || !this.actFile) {
      this.snack.open('Для акта нужны наименование, номер, дата, основание и файл', 'OK');
      return;
    }
    this.api.uploadClaimAct(
      row.id,
      {
        title: this.actTitle || 'Акт о невозможности взыскания',
        act_number: this.actNumber,
        act_date: this.actDate || null,
        reason: this.actReason,
      },
      this.actFile,
    ).subscribe({
      next: (next) => {
        this.actNumber = '';
        this.actDate = '';
        this.actReason = '';
        this.actFile = null;
        this.apply(next);
        this.snack.open(`Акт ОПИ приложен (${next.acts_count} из 3)`, 'OK', { duration: 2500 });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected removeAct(act: ClaimActRow): void {
    const row = this.claim();
    if (!row) return;
    this.api.deleteClaimAct(row.id, act.id).subscribe({
      next: (next) => {
        this.apply(next);
        this.snack.open('Акт ОПИ удалён', 'OK', { duration: 2000 });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected downloadFileById(attachmentId: number, fileName: string): void {
    this.api.downloadAttachment(attachmentId).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName || 'document.pdf';
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private prisPulledFor = 0;

  private pullPrisDraft(): void {
    const row = this.claim();
    if (!row || this.prisPulledFor === row.id) return;
    const request = row.pris?.request || {};
    if (request['doc_num'] && request['doc_code'] && (request['opi'] || this.prisOpi) && (request['debtor_full_adr'] || request['debtor_np'])) return;
    this.prisPulledFor = row.id;
    this.api.autofillPris(row.id).subscribe({
      next: (next) => {
        if (this.alive && this.claim()?.id === row.id) this.apply(next);
      },
      error: () => {
        if (this.prisPulledFor === row.id) this.prisPulledFor = 0;
      },
    });
  }

  protected autofillPrisForm(): void {
    const row = this.claim();
    if (!row) return;
    this.api.autofillPris(row.id).subscribe({
      next: (next) => {
        this.apply(next);
        this.prisPulledFor = row.id;
        this.snack.open('Реквизиты для передачи в ОПИ заполнены из карточки', 'OK', { duration: 2500 });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
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

  protected signCourtPackage(): void {
    const row = this.claim();
    if (!row || this.signing || !this.courtSignOpen(row)) return;
    this.signing = true;
    this.api.ieSignTicket(row.id, 'all').subscribe({
      next: (issued) => {
        this.signing = false;
        const sep = issued.path.includes('?') ? '&' : '?';
        this.launchEdge(`${window.location.origin}${issued.path}${sep}_=${Date.now()}`);
        this.watchArchive();
        this.snack.open('Открывается окно подписи. Введите пароль ключа.', 'OK', { duration: 8000 });
      },
      error: (err) => {
        this.signing = false;
        this.snack.open(errorMessage(err), 'OK');
      },
    });
  }

  protected signAndAssemble(): void {
    const row = this.claim();
    if (!row || this.signing || !this.kitReady(row)) return;
    // Если свежий ticket уже предзагружен и нет несохранённых правок — открываем URL /ie-sign/?t=...
    // прямо синхронно в обработчике клика, чтобы Edge сразу запустил вкладку в режиме IE (без about:blank).
    if (
      this.readySignPath
      && this.readySignClaimId === row.id
      && !this.warningDirty
      && !this.tariffDirty
      && !this.withdrawnDirty
      && !this.emailDirty
    ) {
      const path = this.readySignPath;
      this.readySignPath = '';
      const sep = path.includes('?') ? '&' : '?';
      this.launchEdge(`${window.location.origin}${path}${sep}_=${Date.now()}`);
      this.watchArchive();
      this.snack.open(
        'Открывается окно подписи. Введите пароль ключа.',
        'OK',
        { duration: 8000 },
      );
      if (row.package) {
        this.api.claimAction(row.id, 'package', this.packageBody(row.package)).subscribe({
          next: (saved) => {
            if (!this.alive) return;
            this.apply(saved);
          },
        });
      }
      this.prefetchSignTicket(row.id);
      return;
    }
    const attempt = ++this.signAttempt;
    this.flushNotarySave(() => {
      if (!this.alive || attempt !== this.signAttempt) return;
      this.openSignWindow(null);
    });
  }

  private openSignWindow(popup: Window | null = null): void {
    const row = this.claim();
    const pack = row?.package;
    if (!row || !pack || this.signing) {
      try { popup?.close(); } catch { /* ignore */ }
      return;
    }
    if (!this.kitReady(row)) {
      try { popup?.close(); } catch { /* ignore */ }
      this.snack.open(this.kitGaps(row)[0] || 'Комплект неполный', 'OK');
      return;
    }
    this.signing = true;
    this.api.claimAction(row.id, 'package', this.packageBody(pack)).subscribe({
      next: (saved) => {
        if (!this.alive) {
          try { popup?.close(); } catch { /* ignore */ }
          return;
        }
        this.emailDirty = false;
        this.apply(saved);
        if (!this.kitReady(saved)) {
          this.signing = false;
          try { popup?.close(); } catch { /* ignore */ }
          this.snack.open(this.kitGaps(saved).join('; ') || 'Комплект неполный', 'OK');
          return;
        }
        this.api.ieSignTicket(saved.id, 'all').subscribe({
          next: (issued) => {
            this.signing = false;
            const sep = issued.path.includes('?') ? '&' : '?';
            this.launchEdge(`${window.location.origin}${issued.path}${sep}_=${Date.now()}`, popup);
            this.prefetchSignTicket(saved.id);
            this.watchArchive();
            this.snack.open(
              'Открывается окно подписи. Введите пароль ключа.',
              'OK',
              { duration: 8000 },
            );
          },
          error: (err) => {
            this.signing = false;
            try { popup?.close(); } catch { /* ignore */ }
            this.snack.open(errorMessage(err), 'OK');
          },
        });
      },
      error: (err) => {
        this.signing = false;
        try { popup?.close(); } catch { /* ignore */ }
        this.snack.open(errorMessage(err), 'OK');
      },
    });
  }

  private packageBody(pack: ClaimPackage): object {
    const serviceId = this.defaultServiceId(pack);
    const service = (pack.services || []).find((item) => item.id === serviceId);
    const typeId = service?.debt_type_ids?.[0] || '';
    return {
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
    };
  }

  private launchEdge(url: string, popup: Window | null = null): void {
    if (popup && !popup.closed) {
      try {
        popup.location.replace(url);
        popup.focus();
        return;
      } catch {
        /* fallback below */
      }
    }
    const isEdge = /\bEdg\//.test(navigator.userAgent || '');
    if (isEdge) {
      const opened = window.open(url, '_blank');
      if (opened) return;
    }
    const link = document.createElement('a');
    link.href = `microsoft-edge:${url}`;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  private watchPrisSignature(): void {
    this.watchingPris = true;
    this.watchArchive();
  }

  private watchArchive(): void {
    this.stopArchiveWatch();
    const started = Date.now();
    this.archiveWatch = setInterval(() => {
      if (!this.alive || Date.now() - started > 15 * 60 * 1000) {
        this.stopArchiveWatch();
        return;
      }
      this.refreshClaim();
    }, 4000);
    this.refreshClaim();
  }

  private stopArchiveWatch(): void {
    if (this.archiveWatch) clearInterval(this.archiveWatch);
    this.archiveWatch = null;
  }

  private refreshClaim(): void {
    const row = this.claim();
    if (!row || !this.alive) return;
    this.api.claim(row.id).subscribe({
      next: (next) => {
        if (!this.alive || this.viewedId !== row.id) return;
        this.apply(next);
        if (this.watchingPris) {
          if (this.prisSign) {
            this.watchingPris = false;
            this.stopArchiveWatch();
          }
          return;
        }
        if (this.archiveReady(next)) this.stopArchiveWatch();
      },
    });
  }

  protected sendArchive(): void {
    const row = this.claim();
    if (!row || this.signing || !this.archiveReady(row)) return;
    if (this.needsSkip(row) && !this.checklistSkip.trim()) {
      this.snack.open('Пропуск этапа записывается с причиной', 'OK');
      return;
    }
    this.act('sign-and-send', { skip_reason: this.checklistSkip.trim() });
  }

  protected prisSignTitle(): string {
    if (!this.prisPdf) return 'Сначала выберите PDF, который пойдёт в АИС ПРИС';
    return 'Подписать документ тем же ключом, что комплект нотариусу';
  }

  protected signPrisPdf(): void {
    const row = this.claim();
    if (!row || this.signing || !this.prisPdf) return;
    this.signing = true;
    this.api.ieSignTicket(row.id, 'pris', this.prisPdf).subscribe({
      next: (issued) => {
        this.signing = false;
        const sep = issued.path.includes('?') ? '&' : '?';
        this.launchEdge(`${window.location.origin}${issued.path}${sep}_=${Date.now()}`);
        this.watchPrisSignature();
        this.snack.open('Открывается окно подписи. Введите пароль ключа.', 'OK', { duration: 8000 });
      },
      error: (err) => {
        this.signing = false;
        this.snack.open(errorMessage(err), 'OK');
      },
    });
  }

  protected downloadArchive(): void {
    const row = this.claim();
    if (!row || !this.archiveReady(row)) return;
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

  protected prisSent(row: ClaimCase): boolean {
    return row.opi_mode === 'stub' || row.opi_mode === 'channel' || row.opi_mode === 'pris';
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
        unp: this.prisOrgUnp,
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
      error: (err) => {
        const blocked = funnelGate(err);
        if (blocked) {
          this.gate.set(blocked);
          return;
        }
        this.snack.open(errorMessage(err), 'OK');
      },
    });
  }

  private applySlot(slot: string): void {
    this.focusSlot.set(slot);
    const opi: Record<string, string> = {
      opi_act: 'measures',
      acts: 'acts',
      enforcement_doc: 'document',
      writ: 'document',
    };
    const picked = opi[slot];
    if (picked) this.opiSlot.set(picked);
  }

  protected openGate(): void {
    const blocked = this.gate();
    this.gate.set(null);
    if (!blocked) return;
    const here = this.claim()?.id;
    const tab = blocked.tab === 'pris' ? 'opi' : blocked.tab;
    if (blocked.claimId && here && blocked.claimId === here && (tab === 'pack' || tab === 'notary' || tab === 'court' || tab === 'opi' || tab === 'writeoff')) {
      if (blocked.tab === 'pris') this.opiSlot.set('pris');
      if (blocked.focus) this.applySlot(blocked.focus);
      this.setTab(tab as 'pack' | 'notary' | 'court' | 'opi' | 'writeoff');
      return;
    }
    const target = gateTarget(blocked);
    if (!target) return;
    this.router.navigate(target.path, { queryParams: target.query });
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
      opi_department: this.opiDepartment,
      opi_sent_on: this.opiSentOn || null,
      opi_started_on: this.opiStartedOn || null,
      opi_ended_on: this.opiEndedOn || null,
      opi_bailiff: this.opiBailiff,
      opi_note: this.opiNote,
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
    this.opiDepartment = row.opi_department || '';
    this.opiSentOn = row.opi_sent_on || '';
    this.opiStartedOn = row.opi_started_on || '';
    this.opiEndedOn = row.opi_ended_on || '';
    this.opiBailiff = row.opi_bailiff || '';
    this.opiNote = row.opi_note || '';
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
    if (this.opiSlot() === 'pris') this.pullPrisDraft();
    this.prisOrgUnp = String(claimant['unp'] || '');
    this.prisBankUnp = String(claimant['bank_unp'] || '');
    this.prisCurr = String(claimant['curr_code'] || '933');
    this.prisBudget = String(claimant['budget_code'] || '');
    this.eviction = row.eviction_stage;
    if (!this.emailDirty) this.notificationEmail = row.package?.notification_email || '';
    this.note = row.notary_note || '';
    this.lawsuitNote = row.lawsuit_note || '';
    if (row.package?.persisted && (this.readySignClaimId !== row.id || !this.readySignPath)) {
      this.prefetchSignTicket(row.id);
    }
    this.settleTab(row);
  }

  private settleTab(row: ClaimCase): void {
    if (this.tabOpen(this.tab(), row)) return;
    this.tab.set('pack');
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: 'pack' },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private prefetchSignTicket(claimId: number): void {
    this.api.ieSignTicket(claimId, 'all').subscribe({
      next: (issued) => {
        if (!this.alive || this.viewedId !== claimId) return;
        this.readySignClaimId = claimId;
        this.readySignPath = issued.path;
      },
      error: () => {
        if (this.readySignClaimId === claimId) this.readySignPath = '';
      },
    });
  }
}
