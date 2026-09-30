import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ApiService, ClaimCase, errorMessage } from '../../core/api.service';

@Component({
  selector: 'app-claim-detail',
  standalone: true,
  imports: [
    FormsModule, RouterLink, MatCardModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatCheckboxModule, MatSnackBarModule,
  ],
  template: `
    <div class="page">
      <p><a routerLink="/claims">Все дела</a></p>
      @if (claim(); as row) {
        <h2>ЛС {{ row.client_account }} · {{ row.short_fio }}</h2>
        <p>Этап: <b>{{ row.stage_label }}</b>. Сальдо АИС: {{ row.balance_out || '—' }} (поле не редактируется).</p>
        @if (row.submission_mode === 'stub') {
          <p class="banner">Пакет в личный кабинет БНП не уходил. Номер заглушки: {{ row.submission_id }}.</p>
        }
        @if (row.opi_mode === 'manual') {
          <p class="banner">Статус ОПИ внесён вручную. Сервисы 3.11.01–3.11.05 не вызывались.</p>
        }
        @if (row.blockers.length) {
          <ul class="blockers">
            @for (item of row.blockers; track item) { <li>{{ item }}</li> }
          </ul>
        }

        <div class="grid">
          <mat-card>
            <mat-card-title>Надпись</mat-card-title>
            <mat-card-content class="fields">
              <mat-form-field><mat-label>Дата вручения предупреждения</mat-label>
                <input matInput type="date" [(ngModel)]="warningDate" />
              </mat-form-field>
              <mat-form-field><mat-label>Нотариальный тариф</mat-label>
                <input matInput [(ngModel)]="tariff" />
              </mat-form-field>
              <mat-checkbox [(ngModel)]="withdrawn">Заявление отозвано</mat-checkbox>
              <button mat-stroked-button (click)="save()">Сохранить поля</button>
              <button mat-flat-button color="primary" (click)="act('send-notary')">Направить нотариусу</button>
              <button mat-stroked-button (click)="act('notary-result', { result: 'done', note: note })">Надпись совершена</button>
              <button mat-stroked-button (click)="act('notary-result', { result: 'refused', note: note || 'Спор о праве' })">Отказ нотариуса</button>
              <mat-form-field class="wide"><mat-label>Комментарий к ответу</mat-label><input matInput [(ngModel)]="note" /></mat-form-field>
            </mat-card-content>
          </mat-card>

          <mat-card>
            <mat-card-title>Иск и суд</mat-card-title>
            <mat-card-content class="fields">
              <mat-form-field><mat-label>Номер иска</mat-label><input matInput [(ngModel)]="lawsuitNumber" /></mat-form-field>
              <mat-form-field><mat-label>Вид</mat-label>
                <mat-select [(ngModel)]="lawsuitKind">
                  @for (kind of row.lawsuit_kinds || []; track kind.id) {
                    <mat-option [value]="kind.id">{{ kind.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field><mat-label>Ответчик</mat-label><input matInput [(ngModel)]="defendant" /></mat-form-field>
              <mat-form-field><mat-label>Дата подачи</mat-label><input matInput type="date" [(ngModel)]="lawsuitDate" /></mat-form-field>
              <mat-form-field><mat-label>Госпошлина</mat-label><input matInput [(ngModel)]="duty" /></mat-form-field>
              <mat-form-field><mat-label>Дата пакета на выселение</mat-label><input matInput type="date" [(ngModel)]="packageDate" /></mat-form-field>
              <mat-form-field><mat-label>Статус суда</mat-label>
                <mat-select [(ngModel)]="court">
                  <mat-option value="">Не подано</mat-option>
                  <mat-option value="pending">На рассмотрении</mat-option>
                  <mat-option value="granted">Удовлетворено</mat-option>
                  <mat-option value="denied">Отказано в иске</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field class="wide"><mat-label>Причина пропуска этапа</mat-label><input matInput [(ngModel)]="skipReason" /></mat-form-field>
              <button mat-stroked-button (click)="save()">Сохранить иск</button>
              <button mat-stroked-button (click)="act('move', { stage: 'lawsuit', reason: skipReason })">К иску</button>
              <button mat-stroked-button (click)="act('move', { stage: 'court', reason: skipReason })">Решение суда</button>
            </mat-card-content>
          </mat-card>

          <mat-card>
            <mat-card-title>ОПИ и списание</mat-card-title>
            <mat-card-content class="fields">
              <mat-form-field><mat-label>Номер производства</mat-label><input matInput [(ngModel)]="opiNumber" /></mat-form-field>
              <mat-form-field><mat-label>Статус вручную</mat-label><input matInput [(ngModel)]="opiStatus" /></mat-form-field>
              <button mat-stroked-button (click)="act('opi', { number: opiNumber, status: opiStatus })">Записать статус ОПИ</button>
              <button mat-stroked-button (click)="act('move', { stage: 'opi', reason: skipReason })">Направлено в ОПИ</button>
              <button mat-stroked-button (click)="act('move', { stage: 'opi_measures', reason: skipReason })">Меры приняты</button>
              <mat-form-field class="wide"><mat-label>Новый акт ОПИ</mat-label><input matInput [(ngModel)]="actTitle" /></mat-form-field>
              <button mat-stroked-button (click)="act('acts', { title: actTitle })">Приложить акт</button>
              <p>Актов: {{ row.acts_count }}. @for (item of row.acts; track item.id) { {{ item.title }}; }</p>
              <button mat-stroked-button (click)="act('move', { stage: 'impossible' })">Невозможность взыскания</button>
              <button mat-stroked-button (click)="act('ais-receipt')">Имитация выгрузки АИС: долг и тариф закрыты</button>
              <button mat-stroked-button (click)="act('move', { stage: 'recovered' })">Взыскано</button>
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
              <button mat-stroked-button (click)="act('decide', { decision: 'yes', reason: decisionReason })">Согласовать</button>
              <button mat-stroked-button (click)="act('decide', { decision: 'no', reason: decisionReason })">Отказать</button>
              <mat-form-field><mat-label>Ветвь выселения</mat-label>
                <mat-select [(ngModel)]="eviction">
                  <mat-option value="">Нет</mat-option>
                  <mat-option value="notice">Уведомление</mat-option>
                  <mat-option value="lawsuit">Иск</mat-option>
                  <mat-option value="court">Решение</mat-option>
                  <mat-option value="enforced">Выселение / продажа</mat-option>
                </mat-select>
              </mat-form-field>
            </mat-card-content>
          </mat-card>
        </div>

        <h3>История</h3>
        <ul>
          @for (event of row.events; track event.at + event.reason) {
            <li>{{ event.actor }}: {{ event.old_stage }} → {{ event.new_stage }}. {{ event.reason }}</li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    h2 { margin: 0 0 8px; color: var(--erip-primary-dark); }
    .banner { background: #fff8e1; border-radius: 8px; padding: 8px 12px; }
    .blockers { color: #8a5a00; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
    .fields { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; }
    .wide { width: 100%; }
    mat-card-title { padding: 16px 16px 0; }
  `,
})
export class ClaimDetailComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly snack = inject(MatSnackBar);

  protected readonly claim = signal<ClaimCase | null>(null);
  protected warningDate = '';
  protected tariff = '';
  protected withdrawn = false;
  protected note = '';
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
  protected actTitle = 'Акт о невозможности взыскания';
  protected approvers: number[] = [];
  protected decisionReason = '';
  protected eviction = '';

  ngOnInit(): void {
    this.load(Number(this.route.snapshot.paramMap.get('id')));
  }

  protected save(): void {
    const row = this.claim();
    if (!row) return;
    this.api.patchClaim(row.id, {
      warning_delivered_on: this.warningDate || null,
      notary_tariff: this.tariff || null,
      application_withdrawn: this.withdrawn,
      lawsuit_number: this.lawsuitNumber,
      lawsuit_kind: this.lawsuitKind,
      defendant_name: this.defendant,
      lawsuit_filed_on: this.lawsuitDate || null,
      state_duty: this.duty || null,
      package_filed_on: this.packageDate || null,
      court_status: this.court,
      skip_reason: this.skipReason,
      eviction_stage: this.eviction,
      lawsuit_note: this.note,
    }).subscribe({
      next: (next) => this.apply(next),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
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
    this.eviction = row.eviction_stage;
    this.note = row.notary_note || row.lawsuit_note;
  }
}
