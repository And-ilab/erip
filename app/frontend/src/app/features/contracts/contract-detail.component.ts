import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';

import { ApiService, errorMessage } from '../../core/api.service';
import {
  AccountDetail,
  AccountService,
  ContactRow,
  ContractPeriod,
  DebtorCategory,
  HistoryRow,
  MeasureRow,
  Registration,
} from '../../core/models';

@Component({
  selector: 'app-contract-detail',
  standalone: true,
  imports: [
    DatePipe, DecimalPipe, FormsModule, RouterLink, MatCardModule, MatButtonModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatCheckboxModule, MatSnackBarModule,
  ],
  template: `
    <div class="page">
      <div class="page-header">
        <a mat-button routerLink="/contracts">← Реестр договоров</a>
        <h2>Договор {{ contract()?.service_list_id }} · {{ contract()?.service_name }}</h2>
      </div>
      @if (error()) { <p class="status-failed">{{ error() }}</p> }
      @if (contract(); as c) {
        <div class="grid">
          <mat-card><mat-card-content>
            <h3>{{ personTitle() }}</h3>
            <dl>
              @if (mainPerson()?.subj_legal_entity) {
                <dt>УНП</dt><dd>{{ c.payer_unp || mainPerson()?.personal_num }}</dd>
                <dt>Юридический адрес</dt><dd>{{ mainPerson()?.registration_address || c.address }}</dd>
                <dt>Статус</dt><dd>{{ legalLabel() }}</dd>
              } @else {
                <dt>ФИО</dt><dd>{{ mainPerson()?.full_name || c.payer }}</dd>
                <dt>Дата рождения</dt><dd>{{ mainPerson()?.birthday | date: 'dd.MM.yyyy' }}</dd>
                <dt>Адрес регистрации</dt><dd>{{ mainPerson()?.registration_address || c.address }}</dd>
                <dt>Место работы</dt><dd>{{ mainPerson()?.work_place_name || '—' }}</dd>
                <dt>ИН</dt><dd>{{ c.payer_identifier }}</dd>
              }
              <dt>Категория</dt><dd>{{ c.category_name || '—' }}</dd>
              <dt>Рейтинг</dt><dd>{{ c.rating_label || '—' }}</dd>
            </dl>
          </mat-card-content></mat-card>
          <mat-card><mat-card-content>
            <dl>
              <dt>Договор</dt><dd>{{ c.service_list_id }} с {{ c.start_date | date: 'dd.MM.yyyy' }}</dd>
              <dt>Услуга</dt><dd>{{ c.service_name }}</dd>
              <dt>Поставщик</dt><dd>{{ c.full_name || c.shot_name }}</dd>
              <dt>Первоначальный долг</dt><dd>{{ c.initial_principal | number: '1.2-2' }}</dd>
              <dt>Первоначальная пеня</dt><dd>{{ c.initial_penalty | number: '1.2-2' }}</dd>
              <dt>Остаток долга</dt><dd><b>{{ c.balance_out | number: '1.2-2' }}</b></dd>
              <dt>Остаток пени</dt><dd>{{ c.balance_mulct_out | number: '1.2-2' }}</dd>
              <dt>Возникновение</dt><dd>{{ c.debt_started_on | date: 'dd.MM.yyyy' }}</dd>
              <dt>Срок погашения</dt><dd>{{ c.repayment_due_on | date: 'dd.MM.yyyy' }}</dd>
              <dt>Последняя оплата</dt><dd>{{ c.last_payment_date | date: 'dd.MM.yyyy' }}</dd>
              <dt>Группа услуги</dt><dd>{{ c.effective_group }}</dd>
              <dt>Сценарий</dt><dd>{{ c.scenario_name }}</dd>
            </dl>
          </mat-card-content></mat-card>
        </div>

        <h3>Услуги этого поставщика</h3>
        @for (service of services(); track service.id) {
          <p>
            <a [routerLink]="['/contracts', service.id]">{{ service.service_name }}</a>
            · ЛС {{ service.account_number }}
            · долг {{ service.balance_out | number: '1.2-2' }}
            · пеня {{ service.balance_mulct_out | number: '1.2-2' }}
            · группа {{ service.effective_group }}
          </p>
        }

        <h3>Остатки по периодам</h3>
        @for (period of periods(); track period.service_id + period.period) {
          <p>
            {{ period.service_name }} · {{ period.period }}
            · долг {{ period.principal | number: '1.2-2' }}
            · пеня {{ period.penalty | number: '1.2-2' }}
            · срок {{ period.due_on }}
          </p>
        }

        <h3>Ручная группа этого договора</h3>
        <div class="filters">
          <mat-form-field>
            <mat-label>Группа</mat-label>
            <mat-select [(ngModel)]="manualGroup">
              <mat-option [value]="null">По расчёту</mat-option>
              @for (g of [1, 2, 3, 4, 5, 6]; track g) { <mat-option [value]="g">{{ g }}</mat-option> }
            </mat-select>
          </mat-form-field>
          <mat-form-field class="reason"><mat-label>Причина</mat-label><input matInput [(ngModel)]="reason" /></mat-form-field>
          <button mat-stroked-button (click)="saveGroup()">Сохранить</button>
        </div>

        <h3>Зарегистрированные лица</h3>
        @for (person of people(); track person.id) {
          <p>
            {{ person.full_name }}
            · {{ person.debtor_role }}
            · {{ person.subj_legal_entity ? 'ЮЛ' : 'ФЛ' }}
            · {{ person.relation_degree_name || 'родство не указано' }}
            · {{ person.is_close_relative ? 'член семьи' : 'не член семьи' }}
            · {{ person.birthday | date: 'dd.MM.yyyy' }}
            · {{ person.registration_address }}
            · {{ person.work_place_name }}
            · {{ person.idler_val ? 'не занят в экономике' : '' }}
            · наследство {{ person.legacy_start_date || '—' }} / принятие {{ person.subj_heritage_date || '—' }}
          </p>
          <div class="filters">
            <mat-form-field><mat-label>Социальная категория</mat-label><input matInput [(ngModel)]="person.social_category" /></mat-form-field>
            <mat-checkbox [(ngModel)]="person.unfit_for_work">Нетрудоспособен</mat-checkbox>
            <mat-form-field>
              <mat-label>Переход прав</mat-label>
              <mat-select [(ngModel)]="person.heritage_transfer">
                <mat-option value="">Не указан</mat-option>
                <mat-option value="accept">Принятие наследства</mat-option>
                <mat-option value="escheat">Выморочное</mat-option>
                <mat-option value="other">Иной</mat-option>
              </mat-select>
            </mat-form-field>
            <button mat-stroked-button (click)="savePerson(person)">Сохранить лицо</button>
          </div>
        }

        <h3>Контакты</h3>
        <div class="filters">
          <mat-form-field>
            <mat-label>Источник обзвона</mat-label>
            <mat-select [(ngModel)]="contactMode" (selectionChange)="saveProfile()">
              <mat-option value="pm">Только ПМ</mat-option>
              <mat-option value="ais">Только АИС</mat-option>
              <mat-option value="combined">Комбинированный</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Лицо</mat-label>
            <mat-select [(ngModel)]="contactPersonId">
              <mat-option [value]="null">Плательщик счёта</mat-option>
              @for (person of people(); track person.id) { <mat-option [value]="person.id">{{ person.full_name }}</mat-option> }
            </mat-select>
          </mat-form-field>
          <mat-form-field><mat-label>Телефон или e-mail</mat-label><input matInput [(ngModel)]="contactValue" /></mat-form-field>
          <mat-form-field><mat-label>Приоритет</mat-label><input matInput type="number" [(ngModel)]="contactPriority" /></mat-form-field>
          <mat-form-field>
            <mat-label>Тип</mat-label>
            <mat-select [(ngModel)]="contactKind">
              <mat-option value="mobile">Мобильный</mat-option>
              <mat-option value="city">Городской</mat-option>
              <mat-option value="email">E-mail</mat-option>
              <mat-option value="messenger">Мессенджер</mat-option>
            </mat-select>
          </mat-form-field>
          <button mat-stroked-button (click)="addContact()">Добавить</button>
        </div>
        @for (contact of contacts(); track contact.id) {
          <p>
            {{ contact.person_name || 'счёт' }} · {{ contact.kind }} · {{ contact.value }} · приоритет {{ contact.priority }}
            · {{ contact.source === 'ais' ? 'АИС «Расчет-ЖКУ»' : 'внесено в ПМ' }}
            {{ contact.ais_updated_at | date: 'dd.MM.yyyy' }}
            @if (contact.source === 'pm') {
              <button mat-button (click)="editContact(contact)">Изменить</button>
              <button mat-button (click)="removeContact(contact)">Удалить</button>
            }
          </p>
        }

        <h3>Категория, проживание, наследство</h3>
        <div class="filters">
          <mat-form-field>
            <mat-label>Категория</mat-label>
            <mat-select [(ngModel)]="categoryId">
              <mat-option [value]="null">Не задана</mat-option>
              @for (item of categories(); track item.id) { <mat-option [value]="item.id">{{ item.name }}</mat-option> }
            </mat-select>
          </mat-form-field>
          <mat-form-field class="reason"><mat-label>Фактическое проживание</mat-label><input matInput [(ngModel)]="residence" /></mat-form-field>
          <mat-checkbox [(ngModel)]="inheritance">Наследственное дело</mat-checkbox>
          <mat-form-field><mat-label>Приостановка до</mat-label><input matInput type="date" [(ngModel)]="inheritanceUntil" /></mat-form-field>
          <mat-form-field>
            <mat-label>Статус юрлица</mat-label>
            <mat-select [(ngModel)]="legalStatus">
              <mat-option value="active">Действующее</mat-option>
              <mat-option value="liquidation">В стадии ликвидации</mat-option>
              <mat-option value="bankruptcy">Банкротство</mat-option>
            </mat-select>
          </mat-form-field>
          <button mat-stroked-button (click)="saveProfile()">Сохранить</button>
          <mat-form-field><mat-label>Новая категория</mat-label><input matInput [(ngModel)]="newCategory" /></mat-form-field>
          <button mat-stroked-button (click)="addCategory()">Добавить в справочник</button>
          <button mat-stroked-button (click)="removeCategory()">Удалить выбранную</button>
        </div>

        <h3>Мероприятия по услугам поставщика</h3>
        <p><a routerLink="/measures">Реестр мероприятий</a></p>
        @for (measure of measures(); track measure.id) {
          <p>
            {{ measure.kind_display }} · {{ measure.status_display }} · срок {{ measure.due_on || '—' }}
            @if (measure.kind === 'disconnect') {
              <button mat-button (click)="confirm(measure, 'suspend', 'pm')">Факт приостановления, ПМ</button>
              <button mat-button (click)="confirm(measure, 'suspend', 'ais')">По данным АИС</button>
              <button mat-button (click)="confirm(measure, 'resume', 'pm')">Возобновление, ПМ</button>
              <button mat-button (click)="confirm(measure, 'resume', 'ais')">Возобновление по АИС</button>
            }
            @if (measure.suspension_confirmed_on) { · приостановлено {{ measure.suspension_confirmed_on }} ({{ measure.suspension_source }}) }
            @if (measure.resumed_on) { · возобновлено {{ measure.resumed_on }} ({{ measure.resume_source }}) }
          </p>
        }

        <h3>История изменений</h3>
        @for (row of journal(); track row.id) {
          <p>{{ row.created_at | date: 'dd.MM.yyyy HH:mm' }} · {{ row.author_name || 'система' }} · {{ row.kind }} · {{ row.old_value }} → {{ row.new_value }} · {{ row.reason }}</p>
        }
      }
    </div>
  `,
  styles: `
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    dl { display: grid; grid-template-columns: 220px 1fr; row-gap: 6px; }
    dt { color: #6b7280; } dd { margin: 0; }
    .reason { min-width: 240px; }
  `,
})
export class ContractDetailComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly snack = inject(MatSnackBar);
  readonly id = input.required<string>();
  protected readonly contract = signal<AccountService | null>(null);
  protected readonly account = signal<AccountDetail | null>(null);
  protected readonly services = signal<AccountService[]>([]);
  protected readonly people = signal<Registration[]>([]);
  protected readonly contacts = signal<ContactRow[]>([]);
  protected readonly periods = signal<ContractPeriod[]>([]);
  protected readonly measures = signal<MeasureRow[]>([]);
  protected readonly journal = signal<HistoryRow[]>([]);
  protected readonly categories = signal<DebtorCategory[]>([]);
  protected readonly error = signal('');
  protected manualGroup: number | null = null;
  protected reason = '';
  protected contactMode = 'combined';
  protected contactValue = '';
  protected contactPriority = 1;
  protected contactKind = 'mobile';
  protected categoryId: number | null = null;
  protected residence = '';
  protected inheritance = false;
  protected inheritanceUntil = '';
  protected legalStatus = 'active';
  protected contactPersonId: number | null = null;
  protected newCategory = '';

  ngOnInit(): void {
    this.load();
    this.api.categories().subscribe((page) => this.categories.set(page.results));
  }

  personTitle(): string {
    return this.mainPerson()?.subj_legal_entity ? 'Юридическое лицо' : 'Физическое лицо';
  }

  mainPerson(): Registration | undefined {
    return this.people().find((person) => person.subj_is_main) || this.people()[0];
  }

  legalLabel(): string {
    const labels: Record<string, string> = {
      active: 'Действующее', liquidation: 'В стадии ликвидации', bankruptcy: 'Банкротство',
    };
    return labels[this.account()?.legal_status || 'active'] || 'Действующее';
  }

  saveGroup(): void {
    const row = this.contract();
    if (!row) return;
    this.api.httpPatchContract(row.id, this.manualGroup, this.reason).subscribe({
      next: () => {
        this.snack.open('Группа договора сохранена', 'OK', { duration: 3000 });
        this.load();
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  savePerson(person: Registration): void {
    this.api.saveRegistration(person.id, {
      social_category: person.social_category,
      unfit_for_work: person.unfit_for_work,
      heritage_transfer: person.heritage_transfer,
    }).subscribe({
      next: () => {
        this.snack.open('Сведения о лице сохранены', 'OK', { duration: 3000 });
        this.load();
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  addContact(): void {
    const account = this.account();
    if (!account || !this.contactValue.trim()) return;
    this.api.saveContact({
      account: account.id, registration: this.contactPersonId, kind: this.contactKind,
      value: this.contactValue.trim(), priority: this.contactPriority,
    }).subscribe({
      next: () => {
        this.contactValue = '';
        this.load();
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  editContact(contact: ContactRow): void {
    const value = this.contactValue.trim();
    if (!value) {
      this.snack.open('Введите новое значение в поле контакта', 'OK');
      return;
    }
    this.api.saveContact({ id: contact.id, kind: this.contactKind, value, priority: this.contactPriority }).subscribe({
      next: () => this.load(),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  removeContact(contact: ContactRow): void {
    this.api.deleteContact(contact.id).subscribe({
      next: () => this.load(),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  saveProfile(): void {
    const account = this.account();
    if (!account) return;
    this.api.updateAccount(account.id, {
      debtor_category: this.categoryId,
      residence_note: this.residence,
      inheritance_case: this.inheritance,
      inheritance_until: this.inheritanceUntil || null,
      legal_status: this.legalStatus,
      contact_source_mode: this.contactMode,
    }).subscribe({
      next: () => {
        this.snack.open('Сохранено', 'OK', { duration: 3000 });
        this.load();
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  addCategory(): void {
    const name = this.newCategory.trim();
    if (!name) return;
    this.api.saveCategory({ code: name.toLowerCase().replace(/\s+/g, '-'), name }).subscribe({
      next: (row) => {
        this.categories.update((list) => [...list, row]);
        this.categoryId = row.id;
        this.newCategory = '';
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  removeCategory(): void {
    if (!this.categoryId) return;
    this.api.deleteCategory(this.categoryId).subscribe({
      next: () => {
        this.categories.update((list) => list.filter((item) => item.id !== this.categoryId));
        this.categoryId = null;
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  confirm(measure: MeasureRow, action: 'suspend' | 'resume', source: 'pm' | 'ais'): void {
    this.api.confirmMeasure(measure.id, action, source).subscribe({
      next: () => this.load(),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  private load(): void {
    this.api.contractDossier(Number(this.id())).subscribe({
      next: (dossier) => {
        this.contract.set(dossier.contract);
        this.account.set(dossier.account);
        this.services.set(dossier.services);
        this.people.set(dossier.people);
        this.contacts.set(dossier.contacts);
        this.periods.set(dossier.periods);
        this.measures.set(dossier.measures);
        this.journal.set(dossier.journal);
        this.manualGroup = dossier.contract.debt_group_manual ?? null;
        this.reason = dossier.contract.debt_group_manual_reason || '';
        this.contactMode = dossier.account.contact_source_mode || 'combined';
        this.categoryId = dossier.account.debtor_category;
        this.residence = dossier.account.residence_note;
        this.inheritance = dossier.account.inheritance_case;
        this.inheritanceUntil = dossier.account.inheritance_until || '';
        this.legalStatus = dossier.account.legal_status || 'active';
        this.error.set('');
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }
}
