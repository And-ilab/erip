import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { catchError, concatMap, from, map, of } from 'rxjs';

import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ImportJob, OrganizationOption } from '../../core/models';

const ENTITIES: { id: string; label: string }[] = [
  { id: 'account', label: 'Карточка ЛС' },
  { id: 'service', label: 'Услуги' },
  { id: 'payment', label: 'Оплаты' },
  { id: 'registration', label: 'Регистрация' },
];

const ENTITY_ORDER: Record<string, number> = { account: 0, service: 1, payment: 2, registration: 3 };

const PREFIXES: [string, string][] = [
  ['Карточка ЛС', 'account'],
  ['Услуги', 'service'],
  ['Оплата', 'payment'],
  ['Регистрация', 'registration'],
];

interface QueuedFile {
  key: string;
  file: File;
  entity: string;
  schemaCode: string;
  organizationId: number | null;
  note: string;
  state: 'ready' | 'blocked' | 'running' | 'done' | 'failed';
  result: ImportJob | null;
  error: string;
}

function classify(name: string): { entity: string; schemaCode: string } {
  const schema = name.match(/\b([A-Z]{2}\d{4})\b/);
  let entity = '';
  for (const [prefix, kind] of PREFIXES) {
    if (name.startsWith(prefix)) {
      entity = kind;
      break;
    }
  }
  return { entity, schemaCode: schema?.[1] ?? '' };
}

@Component({
  selector: 'app-imports',
  standalone: true,
  imports: [DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTableModule],
  template: `
    <div class="page">
      <div class="page-header">
        <h2>Загрузка АИС</h2>
      </div>
      <p class="muted">
        CSV или Excel до 50 МБ, заголовки как в выгрузке. Повтор того же файла не плодит дубли.
        Сначала уходит карточка лицевого счёта, затем услуги, оплаты и регистрация.
        Код схемы в файле должен совпадать со схемой, в которую идёт загрузка.
      </p>

      <div class="filters">
        @if (auth.isSuperadmin()) {
          <mat-form-field>
            <mat-label>Схема, если её нет в имени файла</mat-label>
            <mat-select [(ngModel)]="defaultOrg" (selectionChange)="rebind()">
              <mat-option [value]="0">Не выбрана</mat-option>
              @for (org of organizations(); track org.id) {
                <mat-option [value]="org.id">{{ org.schema_name }} — {{ org.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        } @else {
          <p>Схема: <b>{{ auth.me()?.organization_name }}</b></p>
        }
        <button mat-stroked-button type="button" (click)="picker.click()">Выбрать файлы</button>
        <input #picker hidden type="file" multiple accept=".csv,.txt,.xlsx,.xlsm,.xls" (change)="addFiles(picker)" />
        <button mat-flat-button color="primary" type="button" [disabled]="!canUpload()" (click)="upload()">Загрузить</button>
        @if (queue().length) {
          <button mat-button type="button" (click)="queue.set([])">Очистить</button>
        }
      </div>

      @if (auth.isSuperadmin()) {
        <div class="filters">
          <mat-form-field>
            <mat-label>Код новой схемы</mat-label>
            <input matInput [(ngModel)]="newSchema" placeholder="BR2000" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Наименование схемы</mat-label>
            <input matInput [(ngModel)]="newName" />
          </mat-form-field>
          <button mat-stroked-button type="button" [disabled]="!newSchema.trim() || !newName.trim() || creating()" (click)="createSchema()">
            Добавить схему
          </button>
        </div>
      }

      @if (error()) { <p class="status-failed">{{ error() }}</p> }

      @if (queue().length) {
        <div class="list-pane">
          <table mat-table [dataSource]="queue()">
            <ng-container matColumnDef="file"><th mat-header-cell *matHeaderCellDef>Файл</th><td mat-cell *matCellDef="let row">{{ row.file.name }}</td></ng-container>
            <ng-container matColumnDef="entity">
              <th mat-header-cell *matHeaderCellDef>Тип</th>
              <td mat-cell *matCellDef="let row">
                <mat-form-field>
                  <mat-select [(ngModel)]="row.entity" [disabled]="row.state === 'running' || row.state === 'done'" (selectionChange)="rebind()">
                    @for (item of entities; track item.id) {
                      <mat-option [value]="item.id">{{ item.label }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              </td>
            </ng-container>
            <ng-container matColumnDef="schema"><th mat-header-cell *matHeaderCellDef>Схема</th><td mat-cell *matCellDef="let row">{{ schemaLabel(row) }}</td></ng-container>
            <ng-container matColumnDef="state"><th mat-header-cell *matHeaderCellDef>Итог</th><td mat-cell *matCellDef="let row">{{ outcome(row) }}</td></ng-container>
            <tr mat-header-row *matHeaderRowDef="queueColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: queueColumns"></tr>
          </table>
        </div>
        @for (row of queue(); track row.key) {
          @if (row.note) { <p class="muted">{{ row.file.name }}: {{ row.note }}</p> }
          @if (row.error) { <p class="status-failed">{{ row.file.name }}: {{ row.error }}</p> }
          @if (row.result?.errors?.length) {
            <p class="status-failed">{{ row.file.name }}: {{ errorLines(row.result!) }}</p>
          }
          @if (row.result?.unknown_columns?.length) {
            <p class="muted">{{ row.file.name }}: столбцы без отдельного поля — {{ row.result!.unknown_columns.join(', ') }}</p>
          }
        }
      }

      <h3>Журнал</h3>
      @if (jobsError()) { <p class="status-failed">{{ jobsError() }}</p> }
      <div class="list-pane">
        <table mat-table [dataSource]="jobs()">
          <ng-container matColumnDef="created_at"><th mat-header-cell *matHeaderCellDef>Когда</th><td mat-cell *matCellDef="let job">{{ job.created_at | date: 'dd.MM.yyyy HH:mm' }}</td></ng-container>
          <ng-container matColumnDef="file_name"><th mat-header-cell *matHeaderCellDef>Файл</th><td mat-cell *matCellDef="let job">{{ job.file_name }}</td></ng-container>
          <ng-container matColumnDef="entity_display"><th mat-header-cell *matHeaderCellDef>Тип</th><td mat-cell *matCellDef="let job">{{ job.entity_display }}</td></ng-container>
          <ng-container matColumnDef="status_display"><th mat-header-cell *matHeaderCellDef>Статус</th><td mat-cell *matCellDef="let job">{{ job.status_display }}</td></ng-container>
          <ng-container matColumnDef="total"><th mat-header-cell *matHeaderCellDef>Строк</th><td mat-cell *matCellDef="let job">{{ job.total }}</td></ng-container>
          <ng-container matColumnDef="created"><th mat-header-cell *matHeaderCellDef>Создано</th><td mat-cell *matCellDef="let job">{{ job.created }}</td></ng-container>
          <ng-container matColumnDef="updated"><th mat-header-cell *matHeaderCellDef>Обновлено</th><td mat-cell *matCellDef="let job">{{ job.updated }}</td></ng-container>
          <ng-container matColumnDef="unchanged"><th mat-header-cell *matHeaderCellDef>Без изменений</th><td mat-cell *matCellDef="let job">{{ job.unchanged }}</td></ng-container>
          <ng-container matColumnDef="rejected"><th mat-header-cell *matHeaderCellDef>Отклонено</th><td mat-cell *matCellDef="let job">{{ job.rejected }}</td></ng-container>
          <tr mat-header-row *matHeaderRowDef="jobColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: jobColumns"></tr>
        </table>
      </div>
    </div>
  `,
  styles: `
    mat-form-field { min-width: 220px; }
    h3 { margin: 20px 0 8px; }
  `,
})
export class ImportsComponent implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  protected readonly entities = ENTITIES;
  protected readonly queueColumns = ['file', 'entity', 'schema', 'state'];
  protected readonly jobColumns = ['created_at', 'file_name', 'entity_display', 'status_display', 'total', 'created', 'updated', 'unchanged', 'rejected'];
  protected readonly organizations = signal<OrganizationOption[]>([]);
  protected readonly queue = signal<QueuedFile[]>([]);
  protected readonly jobs = signal<ImportJob[]>([]);
  protected readonly error = signal('');
  protected readonly jobsError = signal('');
  protected readonly running = signal(false);
  protected readonly creating = signal(false);
  protected defaultOrg = 0;
  protected newSchema = '';
  protected newName = '';

  ngOnInit(): void {
    this.api.organizations().subscribe({
      next: (page) => {
        this.organizations.set(page.results);
        this.rebind();
      },
      error: (err) => this.error.set(errorMessage(err)),
    });
    this.reloadJobs();
  }

  protected addFiles(input: HTMLInputElement): void {
    const files = Array.from(input.files ?? []);
    input.value = '';
    const next = [...this.queue()];
    for (const file of files) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (next.some((row) => row.key === key)) continue;
      const detected = classify(file.name);
      next.push({
        key,
        file,
        entity: detected.entity,
        schemaCode: detected.schemaCode,
        organizationId: null,
        note: '',
        state: 'ready',
        result: null,
        error: '',
      });
    }
    this.queue.set(next);
    this.rebind();
  }

  protected rebind(): void {
    const orgs = this.organizations();
    const mine = this.auth.me()?.organization ?? null;
    this.queue.update((rows) => rows.map((row) => {
      if (row.state === 'running' || row.state === 'done') return row;
      const copy = { ...row, note: '', error: row.state === 'failed' ? row.error : '' };
      if (!copy.entity) {
        copy.state = 'blocked';
        copy.note = 'Выберите тип выгрузки';
        copy.organizationId = null;
        return copy;
      }
      if (this.auth.isSuperadmin()) {
        const matched = copy.schemaCode ? orgs.find((org) => org.schema_name === copy.schemaCode) : undefined;
        const fallback = orgs.find((org) => org.id === this.defaultOrg);
        const org = matched ?? fallback;
        if (!org) {
          copy.state = 'blocked';
          copy.organizationId = null;
          copy.note = copy.schemaCode
            ? `Схемы ${copy.schemaCode} ещё нет. Добавьте её выше`
            : 'Выберите схему';
          return copy;
        }
        copy.organizationId = org.id;
        if (copy.schemaCode && org.schema_name !== copy.schemaCode) {
          copy.note = `В имени файла схема ${copy.schemaCode}, загрузка пойдёт в ${org.schema_name}. Строки с другим кодом схемы будут отклонены`;
        }
      } else {
        copy.organizationId = mine;
        const own = orgs.find((org) => org.id === mine);
        if (copy.schemaCode && own && own.schema_name !== copy.schemaCode) {
          copy.note = `В имени файла схема ${copy.schemaCode}, загрузка пойдёт в ${own.schema_name}. Строки с другим кодом схемы будут отклонены`;
        }
      }
      copy.state = 'ready';
      copy.error = '';
      return copy;
    }));
  }

  protected schemaLabel(row: QueuedFile): string {
    const org = this.organizations().find((item) => item.id === row.organizationId);
    if (org) return `${org.schema_name} — ${org.name}`;
    return row.schemaCode || '—';
  }

  protected outcome(row: QueuedFile): string {
    if (row.state === 'running') return 'Загрузка…';
    if (row.state === 'blocked') return 'Не готово';
    if (row.state === 'failed') return 'Ошибка';
    if (row.result) {
      return `${row.result.status_display}: создано ${row.result.created}, обновлено ${row.result.updated}, без изменений ${row.result.unchanged}, отклонено ${row.result.rejected}`;
    }
    return 'Готово к загрузке';
  }

  protected errorLines(job: ImportJob): string {
    return job.errors.slice(0, 5).map((item) => `строка ${item.line}: ${item.reason}`).join('; ');
  }

  protected canUpload(): boolean {
    const rows = this.queue();
    return !this.running() && rows.some((row) => row.state === 'ready' || row.state === 'failed') && rows.every((row) => row.state !== 'blocked');
  }

  protected upload(): void {
    const pending = this.queue()
      .filter((row) => (row.state === 'ready' || row.state === 'failed') && row.organizationId != null && row.entity)
      .slice()
      .sort((a, b) => (ENTITY_ORDER[a.entity] ?? 9) - (ENTITY_ORDER[b.entity] ?? 9) || a.file.name.localeCompare(b.file.name, 'ru'));
    if (!pending.length) return;
    this.running.set(true);
    this.error.set('');
    from(pending).pipe(
      concatMap((row) => {
        this.patch(row.key, { state: 'running', error: '', result: null });
        return this.api.uploadImport(row.entity, row.file, row.organizationId).pipe(
          map((job) => {
            this.patch(row.key, { state: 'done', result: job, error: '' });
            return job;
          }),
          catchError((err: unknown) => {
            this.patch(row.key, { state: 'failed', error: errorMessage(err) });
            return of(null);
          }),
        );
      }),
    ).subscribe({
      complete: () => {
        this.running.set(false);
        this.reloadJobs();
      },
    });
  }

  protected createSchema(): void {
    const schema = this.newSchema.trim();
    const name = this.newName.trim();
    if (!schema || !name) return;
    this.creating.set(true);
    this.error.set('');
    this.api.createOrganization(schema, name).subscribe({
      next: (org) => {
        this.organizations.update((rows) => [...rows, org].sort((a, b) => a.schema_name.localeCompare(b.schema_name)));
        this.defaultOrg = org.id;
        this.newSchema = '';
        this.newName = '';
        this.creating.set(false);
        this.rebind();
      },
      error: (err) => {
        this.creating.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }

  private reloadJobs(): void {
    this.api.importJobs().subscribe({
      next: (page) => this.jobs.set(page.results),
      error: (err) => this.jobsError.set(errorMessage(err)),
    });
  }

  private patch(key: string, changes: Partial<QueuedFile>): void {
    this.queue.update((rows) => rows.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }
}
