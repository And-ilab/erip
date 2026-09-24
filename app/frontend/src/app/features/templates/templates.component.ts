import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Channel, MessageTemplate } from '../../core/models';

@Component({
  selector: 'app-templates',
  standalone: true,
  imports: [
    ReactiveFormsModule, MatListModule, MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonModule, MatSnackBarModule,
  ],
  template: `
    <div class="page layout">
      <mat-card class="list">
        <mat-card-header><mat-card-title>Шаблоны сообщений</mat-card-title></mat-card-header>
        <mat-card-content>
          @if (auth.canManageTemplates()) { <button mat-stroked-button (click)="edit(null)">+ Новый шаблон</button> }
          <mat-nav-list>
            @for (t of templates(); track t.id) {
              <a mat-list-item (click)="edit(t)" [class.selected]="current()?.id === t.id">
                <span matListItemTitle>{{ t.name }}</span>
                <span matListItemLine class="muted">{{ t.channel_display }} · {{ t.debt_group ? 'группа ' + t.debt_group : 'без группы' }} · {{ t.is_central ? 'центральный' : 'локальный' }}</span>
              </a>
            }
          </mat-nav-list>
        </mat-card-content>
      </mat-card>

      <mat-card class="editor">
        <mat-card-content>
          <form [formGroup]="form">
            <div class="filters">
              <mat-form-field><mat-label>Код</mat-label><input matInput formControlName="code" /></mat-form-field>
              <mat-form-field class="grow"><mat-label>Наименование</mat-label><input matInput formControlName="name" /></mat-form-field>
              <mat-form-field>
                <mat-label>Канал</mat-label>
                <mat-select formControlName="channel">
                  @for (c of channels; track c.value) { <mat-option [value]="c.value">{{ c.label }}</mat-option> }
                </mat-select>
              </mat-form-field>
              <mat-form-field>
                <mat-label>Группа долга</mat-label>
                <mat-select formControlName="debt_group">
                  <mat-option [value]="null">Не привязан</mat-option>
                  @for (g of groups; track g) { <mat-option [value]="g">{{ g }}</mat-option> }
                </mat-select>
              </mat-form-field>
            </div>
            <mat-form-field class="full-width"><mat-label>Тема (e-mail)</mat-label><input matInput formControlName="subject" /></mat-form-field>
            <mat-form-field class="full-width">
              <mat-label>Текст</mat-label>
              <textarea matInput rows="6" formControlName="body"></textarea>
              <mat-hint>Переменные: {{ '{fio}' }}, {{ '{account}' }}, {{ '{amount}' }}, {{ '{address}' }}, {{ '{debt_group}' }}, {{ '{group_name}' }}. Приветствие и подпись добавит шлюз.</mat-hint>
            </mat-form-field>
          </form>
          <div class="filters actions">
            @if (auth.canManageTemplates()) {
              <button mat-flat-button color="primary" [disabled]="form.invalid" (click)="save()">Сохранить</button>
              @if (current()) { <button mat-button color="warn" (click)="remove()">Деактивировать</button> }
            }
            <mat-form-field><mat-label>Имя для предпросмотра</mat-label><input #name matInput value="Иван Иванович" /></mat-form-field>
            <button mat-stroked-button [disabled]="!current()" (click)="preview(name.value)">Предпросмотр через шлюз</button>
          </div>
          @if (previewText()) { <pre class="message">{{ previewText() }}</pre> }
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    .layout { display: grid; grid-template-columns: 340px 1fr; gap: 16px; }
    .grow { flex: 1; }
    .actions { margin-top: 12px; }
    .selected { background: rgba(0, 90, 200, .08); }
  `,
})
export class TemplatesComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly snack = inject(MatSnackBar);
  protected readonly auth = inject(AuthService);

  protected readonly groups = [1, 2, 3, 4, 5, 6];
  protected readonly channels: { value: Channel; label: string }[] = [
    { value: 'email', label: 'E-mail' },
    { value: 'sms', label: 'SMS' },
    { value: 'voice', label: 'Голосовой звонок (TTS)' },
    { value: 'inbox', label: 'Панель уведомлений ПМ' },
  ];
  protected readonly templates = signal<MessageTemplate[]>([]);
  protected readonly current = signal<MessageTemplate | null>(null);
  protected readonly previewText = signal('');
  protected readonly form = inject(FormBuilder).nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^[a-z0-9_-]+$/)]],
    name: ['', Validators.required],
    channel: ['email' as Channel, Validators.required],
    subject: [''],
    body: ['', Validators.required],
    debt_group: [null as number | null],
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.api.templates({ is_active: true, page_size: 200 }).subscribe((page) => this.templates.set(page.results));
  }

  edit(template: MessageTemplate | null): void {
    this.current.set(template);
    this.previewText.set('');
    this.form.reset(template ?? { code: '', name: '', channel: 'email', subject: '', body: '', debt_group: null });
  }

  save(): void {
    const body = { ...this.form.getRawValue(), id: this.current()?.id };
    this.api.saveTemplate(body).subscribe({
      next: (saved) => {
        this.snack.open('Шаблон сохранён', 'OK', { duration: 3000 });
        this.current.set(saved);
        this.load();
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  remove(): void {
    const template = this.current();
    if (!template) return;
    this.api.deleteTemplate(template.id).subscribe({
      next: () => {
        this.edit(null);
        this.load();
      },
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }

  preview(userName: string): void {
    const template = this.current();
    if (!template) return;
    const context = {
      fio: 'Иванов И.И.', account: '00001001', amount: '150.00', address: 'г. Минск, ул. Примерная, 1-1',
      debt_group: '4', group_name: '6–12 месяцев',
    };
    this.api.previewTemplate(template.id, userName, this.form.controls.body.value, context).subscribe({
      next: (r) => this.previewText.set(r.text),
      error: (e) => this.snack.open(errorMessage(e), 'OK'),
    });
  }
}
