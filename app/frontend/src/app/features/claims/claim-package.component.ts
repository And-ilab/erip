import { Component, effect, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { DateFieldComponent } from '../../core/date-field.component';
import {
  ApiService, BnpDebt, BnpDebtor, BnpDocument, ClaimCase, ClaimPackage, errorMessage,
} from '../../core/api.service';

/** С карточки дела не показывается: должник и суммы берутся из лицевого счёта при сборке архива. */
@Component({
  selector: 'app-claim-package',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatSnackBarModule, DateFieldComponent],
  template: `
    <p class="hint">
      Пункт перечня выбирается здесь. Для задолженности за ЖКУ в справочнике отмечены услуги 571, 572 и 576.
      Суммы подставляет АИС: сумма исходящего сальдо услуг (как «Сумма основного долга» на карточке) и, отдельной строкой, пеня. ПМ их не правит.
      Документы комплекта смотрят и правят в списке выше. Отсоединённую подпись PKCS#7 ставит плагин AvCMXWebP (в Internet Explorer; Chrome/Edge плагин не загружают)
      ключом AvPass: представитель — документы заявителя, руководитель — доверенность.
      В кабинет БНП пакет не передаётся, пока нет промышленного обмена.
    </p>

    <mat-form-field class="wide">
      <mat-label>Услуга БНП</mat-label>
      <mat-select [(ngModel)]="serviceId">
        @for (service of housing(); track service.id) {
          <mat-option [value]="service.id">ЖКУ · {{ service.id }} · {{ service.name }}</mat-option>
        }
        @for (service of rest(); track service.id) {
          <mat-option [value]="service.id">{{ service.id }} · {{ service.name }}</mat-option>
        }
      </mat-select>
    </mat-form-field>
    <div class="line">
      <mat-form-field><mat-label>Контактные данные</mat-label><input matInput [(ngModel)]="contact" /></mat-form-field>
      <mat-form-field><mat-label>E-mail для уведомлений</mat-label><input matInput [(ngModel)]="email" /></mat-form-field>
    </div>
    <mat-form-field class="wide">
      <mat-label>Сообщение нотариусу</mat-label>
      <textarea matInput rows="2" [(ngModel)]="message"></textarea>
    </mat-form-field>

    <h4>Должники</h4>
    @for (debtor of debtors; track $index) {
      <div class="person">
        <mat-form-field>
          <mat-label>Тип лица</mat-label>
          <mat-select [(ngModel)]="debtor.personType">
            <mat-option value="natural">Физическое лицо</mat-option>
            <mat-option value="sole_trader">ИП</mat-option>
            <mat-option value="legal">Юридическое лицо</mat-option>
          </mat-select>
        </mat-form-field>
        @if (debtor.personType !== 'legal') {
          <mat-form-field><mat-label>Личный номер</mat-label><input matInput [(ngModel)]="debtor.personalId" /></mat-form-field>
          <mat-form-field><mat-label>Фамилия</mat-label><input matInput [(ngModel)]="debtor.secondName" /></mat-form-field>
          <mat-form-field><mat-label>Имя</mat-label><input matInput [(ngModel)]="debtor.firstName" /></mat-form-field>
          <mat-form-field><mat-label>Отчество</mat-label><input matInput [(ngModel)]="debtor.middleName" /></mat-form-field>
        }
        @if (debtor.personType !== 'natural') {
          <mat-form-field><mat-label>УНП</mat-label><input matInput [(ngModel)]="debtor.unp" /></mat-form-field>
        }
        @if (debtor.personType === 'legal') {
          <mat-form-field><mat-label>Регистрационный номер</mat-label><input matInput [(ngModel)]="debtor.regNumber" /></mat-form-field>
          <mat-form-field><mat-label>Наименование</mat-label><input matInput [(ngModel)]="debtor.regName" /></mat-form-field>
        }
        <span class="tag">{{ debtor.solidary ? 'Солидарный' : 'Должник' }}</span>
        @if (debtors.length > 1) {
          <button mat-button type="button" (click)="debtors.splice($index, 1)">Убрать</button>
        }
      </div>
    }
    <button mat-button type="button" (click)="addDebtor()">Добавить солидарного должника</button>

    <h4>Задолженность</h4>
    @for (debt of debts; track $index) {
      <div class="person">
        <mat-form-field>
          <mat-label>Тип задолженности</mat-label>
          <mat-select [(ngModel)]="debt.typeId">
            @for (type of typesForService(); track type.id) {
              <mat-option [value]="type.id">{{ type.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <app-date-field label="С" [value]="debt.startDate || ''" (valueChange)="debt.startDate = $event" />
        <app-date-field label="По" [value]="debt.endDate || ''" (valueChange)="debt.endDate = $event" />
        <app-date-field label="Либо одна дата" [value]="debt.dateAt || ''" (valueChange)="debt.dateAt = $event" />
        <span class="tag">{{ debt.source === 'penalty' ? 'Пеня' : 'Исходящее сальдо' }} {{ debt.amount }} {{ debt.currency }}</span>
        @if (debts.length > 1) {
          <button mat-button type="button" (click)="removeDebt(debt.source)">Убрать</button>
        }
      </div>
    }
    @if (!hasPenalty()) {
      <button mat-button type="button" (click)="addPenalty()">Добавить строку пени</button>
    }

    <div class="actions">
      <button mat-stroked-button type="button" [disabled]="busy" (click)="save()">Сохранить состав</button>
      <button mat-stroked-button type="button" [disabled]="busy" (click)="generate()">Собрать заявление PDF</button>
      <button mat-flat-button color="primary" type="button" [disabled]="busy" (click)="form()">Сформировать пакет</button>
      @if (pack().formed_at) {
        <button mat-button type="button" (click)="downloadManifest()">Скачать манифест</button>
      }
      @if (pack().has_archive) {
        <button mat-button type="button" (click)="downloadArchive()">Скачать архив для БНП</button>
      }
    </div>

    <h4>Документы комплекта</h4>
    <p class="hint">Обязательны заявление, расчёт задолженности и доверенность. Файл PDF не больше 15 МБ. Просмотр — в списке выше, без скачивания.</p>
    @for (code of pack().required_docs; track code) {
      @if (missing(code)) {
        <div class="slot">
          <span>{{ docLabel(code) }}</span>
          @if (code === 'application') {
            <button mat-button type="button" [disabled]="busy" (click)="generate()">Собрать PDF</button>
          } @else {
            <input type="file" accept="application/pdf,.pdf" (change)="onPdf(code, $event)" />
          }
        </div>
      }
    }
    @for (doc of pack().documents; track doc.id) {
      <div class="slot">
        <div>
          <b>{{ doc.doc_type_label }}</b>
          <span>{{ doc.file_name }}</span>
        </div>
        <button mat-button type="button" (click)="remove(doc)">Удалить</button>
      </div>
    }
    <div class="slot">
      <select [(ngModel)]="extraType">
        @for (type of optionalTypes(); track type.id) {
          <option [value]="type.id">{{ type.name }}</option>
        }
      </select>
      <input type="file" accept="application/pdf,.pdf" (change)="onPdf(extraType, $event)" />
    </div>

    @if ((pack().problems || []).length) {
      <ul class="blockers">
        @for (problem of pack().problems; track $index) { <li>{{ problem }}</li> }
      </ul>
    }
    @if ((pack().send_blockers || []).length) {
      <ul class="blockers">
        @for (problem of pack().send_blockers; track $index) { <li>{{ problem }}</li> }
      </ul>
    } @else if (pack().formed_at) {
      <p class="ok">Пакет собран. Подпись ставит AvCMXWebP на компьютере с ключом AvPass. Направление в кабинет остаётся заглушкой.</p>
    }
  `,
  styles: `
    .hint { color: var(--erip-muted); font-size: 13px; }
    .wide { width: 100%; }
    .line, .person, .actions, .slot { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .person, .slot { margin: 6px 0; padding: 8px; background: #f7f8fa; border-radius: 8px; }
    .tag { font-size: 13px; color: var(--erip-muted); }
    h4 { margin: 14px 0 6px; }
    .blockers { color: var(--erip-warning); margin: 8px 0; }
    .ok { color: var(--erip-success, #1b7f4e); }
    input[type="file"] { max-width: 220px; font-size: 12px; }
  `,
})
export class ClaimPackageComponent {
  readonly claimId = input.required<number>();
  readonly pack = input.required<ClaimPackage>();
  readonly changed = output<ClaimCase>();

  private readonly api = inject(ApiService);
  private readonly snack = inject(MatSnackBar);

  protected serviceId: number | null = null;
  protected contact = '';
  protected email = '';
  protected message = '';
  protected debtors: BnpDebtor[] = [];
  protected debts: BnpDebt[] = [];
  protected extraType = 'agreement_contract';
  protected busy = false;

  constructor() {
    effect(() => {
      const pack = this.pack();
      this.serviceId = pack.service_id;
      this.contact = pack.contact_data;
      this.email = pack.notification_email;
      this.message = pack.user_message;
      this.debtors = (pack.debtors || []).map((row) => ({ ...row }));
      this.debts = (pack.debts || []).map((row) => ({
        ...row,
        startDate: row.startDate || '',
        endDate: row.endDate || '',
        dateAt: row.dateAt || '',
      }));
    });
  }

  protected housing() {
    return (this.pack().services || []).filter((service) => service.housing);
  }

  protected rest() {
    return (this.pack().services || []).filter((service) => !service.housing);
  }

  protected typesForService() {
    const service = (this.pack().services || []).find((item) => item.id === this.serviceId);
    const allowed = new Set(service?.debt_type_ids || []);
    return (this.pack().debt_types || []).filter((type) => allowed.has(type.id));
  }

  protected optionalTypes() {
    const required = new Set(this.pack().required_docs || []);
    return (this.pack().doc_types || []).filter((type) => !required.has(type.id));
  }

  protected missing(code: string): boolean {
    return !(this.pack().documents || []).some((doc) => doc.doc_type === code);
  }

  protected docLabel(code: string): string {
    return this.pack().doc_types.find((type) => type.id === code)?.name || code;
  }

  protected hasPenalty(): boolean {
    return this.debts.some((debt) => debt.source === 'penalty');
  }

  protected addDebtor(): void {
    this.debtors = [...this.debtors, {
      personType: 'natural', personalId: '', secondName: '', firstName: '', middleName: '',
      unp: '', regNumber: '', regName: '', solidary: true,
    }];
  }

  protected addPenalty(): void {
    const sample = this.debts[0];
    this.debts = [...this.debts, {
      source: 'penalty', typeId: '', amount: '', currency: 'BYN',
      dateAt: sample?.dateAt || '', startDate: sample?.startDate || '', endDate: sample?.endDate || '',
    }];
  }

  protected removeDebt(source: string): void {
    this.debts = this.debts.filter((debt) => debt.source !== source);
  }

  protected save(): void {
    this.persist((row) => {
      this.snack.open('Состав пакета сохранён', 'OK', { duration: 2000 });
      this.changed.emit(row);
    });
  }

  protected generate(): void {
    this.persist(() => {
      this.api.claimAction(this.claimId(), 'package/application').subscribe({
        next: (row) => {
          this.changed.emit(row);
          this.snack.open('Заявление собрано', 'OK', { duration: 2000 });
        },
        error: (err) => this.fail(err),
      });
    });
  }

  protected form(): void {
    this.persist(() => {
      this.api.claimAction(this.claimId(), 'package/form').subscribe({
        next: (row) => {
          this.changed.emit(row);
          this.snack.open('Пакет сформирован', 'OK', { duration: 2000 });
        },
        error: (err) => {
          this.fail(err);
          this.api.claim(this.claimId()).subscribe({ next: (row) => this.changed.emit(row) });
        },
      });
    });
  }

  protected onPdf(docType: string, event: Event, docId?: number): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.persist(() => {
      this.api.uploadClaimDocument(this.claimId(), docType, file, null, 'p7s', docId).subscribe({
        next: (row) => this.changed.emit(row),
        error: (err) => this.fail(err),
      });
    });
    input.value = '';
  }

  protected remove(doc: BnpDocument): void {
    this.api.deleteClaimDocument(this.claimId(), doc.id).subscribe({
      next: (row) => this.changed.emit(row),
      error: (err) => this.fail(err),
    });
  }

  protected downloadManifest(): void {
    this.saveBlob(this.api.claimManifest(this.claimId()), `bnp-claim-${this.claimId()}.json`);
  }

  protected downloadArchive(): void {
    this.saveBlob(this.api.claimArchive(this.claimId()), `bnp-claim-${this.claimId()}.zip`);
  }

  private persist(next: (row: ClaimCase) => void): void {
    this.busy = true;
    this.api.claimAction(this.claimId(), 'package', this.body()).subscribe({
      next: (row) => {
        this.busy = false;
        next(row);
      },
      error: (err) => this.fail(err),
    });
  }

  private body() {
    return {
      service_id: this.serviceId,
      contact_data: this.contact,
      notification_email: this.email,
      user_message: this.message,
      debtors: this.debtors,
      debts: this.debts.map((debt) => ({
        source: debt.source,
        typeId: debt.typeId,
        startDate: debt.startDate || '',
        endDate: debt.endDate || '',
        dateAt: debt.dateAt || '',
      })),
    };
  }

  private fail(err: unknown): void {
    this.busy = false;
    this.snack.open(errorMessage(err), 'OK');
  }

  private saveBlob(source: { subscribe: Function }, filename: string): void {
    source.subscribe({
      next: (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (err: unknown) => this.fail(err),
    });
  }
}
