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
          @if (roleTicket()) {
            <div class="roles">
              <p class="muted">{{ pendingUser() }}. Выберите роль для этой сессии.</p>
              @for (role of accountRoles(); track role.id) {
                <button type="button" mat-stroked-button class="full-width" [disabled]="loading()" (click)="pick(role.id)">
                  {{ role.label }}
                </button>
              }
              <button type="button" mat-button class="full-width" [disabled]="loading()" (click)="back()">Другой логин</button>
              @if (error()) { <p class="status-failed">{{ error() }}</p> }
            </div>
          } @else {
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
          }
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    :host { display: block; height: 100%; min-height: 0; }
    .wrap { display: flex; justify-content: center; align-items: center; height: 100%; }
    .card { width: 420px; max-width: calc(100vw - 32px); padding: 8px; }
    .roles { display: flex; flex-direction: column; gap: 8px; padding-top: 4px; }
    .roles p { margin: 0 0 4px; }
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
  protected readonly accountRoles = signal<{ id: string; label: string }[]>([]);
  protected readonly roleTicket = signal('');
  protected readonly pendingUser = signal('');

  submit(): void {
    const { username, password } = this.form.getRawValue();
    this.loading.set(true);
    this.error.set('');
    this.auth.login(username, password).subscribe({
      next: (body) => {
        if (body.choose_role && body.ticket && body.roles?.length) {
          this.loading.set(false);
          this.pendingUser.set(username.trim());
          this.roleTicket.set(body.ticket);
          this.accountRoles.set(body.roles);
          return;
        }
        this.router.navigate(['/accounts']);
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(e.status === 401 ? 'Неверный логин или пароль' : errorMessage(e));
      },
    });
  }

  pick(role: string): void {
    this.loading.set(true);
    this.error.set('');
    this.auth.chooseRole(this.roleTicket(), role).subscribe({
      next: () => this.router.navigate(['/accounts']),
      error: (e) => {
        this.loading.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }

  back(): void {
    this.roleTicket.set('');
    this.accountRoles.set([]);
    this.pendingUser.set('');
    this.error.set('');
  }
}
