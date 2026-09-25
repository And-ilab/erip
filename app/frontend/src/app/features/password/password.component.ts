import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-password',
  standalone: true,
  imports: [ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <div class="page">
      <h2>Смена пароля</h2>
      <mat-card>
        <mat-card-content>
          <form [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field class="full">
              <mat-label>Текущий пароль</mat-label>
              <input matInput type="password" formControlName="oldPassword" autocomplete="current-password" />
            </mat-form-field>
            <mat-form-field class="full">
              <mat-label>Новый пароль</mat-label>
              <input matInput type="password" formControlName="newPassword" autocomplete="new-password" />
            </mat-form-field>
            @if (error()) { <p class="status-failed">{{ error() }}</p> }
            <button mat-flat-button color="primary" [disabled]="form.invalid || loading()">Сохранить</button>
          </form>
          <p class="muted">После смены все сессии этой учётной записи завершаются, потребуется войти снова.</p>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    .full { display: block; max-width: 360px; }
    .muted { color: #6b7280; margin-top: 12px; }
  `,
})
export class PasswordComponent {
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  protected readonly error = signal('');
  protected readonly loading = signal(false);
  protected readonly form = this.fb.nonNullable.group({
    oldPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
  });

  submit(): void {
    if (this.form.invalid || this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    const { oldPassword, newPassword } = this.form.getRawValue();
    this.auth.changePassword(oldPassword, newPassword).subscribe({
      next: () => this.auth.logout(),
      error: (err) => {
        this.loading.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}
