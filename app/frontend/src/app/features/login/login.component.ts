import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';

import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <div class="wrap">
      <mat-card class="card">
        <mat-card-header><mat-card-title>Вход в ПМ «Работа с задолженностью»</mat-card-title></mat-card-header>
        <mat-card-content>
          <form [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field class="full-width">
              <mat-label>Логин</mat-label>
              <input matInput formControlName="username" autocomplete="username" />
            </mat-form-field>
            <mat-form-field class="full-width">
              <mat-label>Пароль</mat-label>
              <input matInput type="password" formControlName="password" autocomplete="current-password" />
            </mat-form-field>
            @if (error()) { <p class="status-failed">{{ error() }}</p> }
            <button mat-flat-button color="primary" class="full-width" [disabled]="form.invalid || loading()">Войти</button>
          </form>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    .wrap { display: flex; justify-content: center; align-items: center; height: 100vh; }
    .card { width: 380px; padding: 8px; }
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  submit(): void {
    const { username, password } = this.form.getRawValue();
    this.loading.set(true);
    this.error.set('');
    this.auth.login(username, password).subscribe({
      next: () => this.router.navigate(['/accounts']),
      error: (e) => {
        this.loading.set(false);
        this.error.set(e.status === 401 ? 'Неверный логин или пароль' : errorMessage(e));
      },
    });
  }
}
