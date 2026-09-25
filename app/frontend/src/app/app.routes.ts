import { Routes } from '@angular/router';

import { authGuard, superadminGuard } from './core/auth.guard';
import { ShellComponent } from './layout/shell.component';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent) },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'accounts' },
      {
        path: 'accounts',
        loadComponent: () => import('./features/accounts/accounts-list.component').then((m) => m.AccountsListComponent),
      },
      {
        path: 'accounts/:id',
        loadComponent: () => import('./features/accounts/account-detail.component').then((m) => m.AccountDetailComponent),
      },
      {
        path: 'password',
        loadComponent: () => import('./features/password/password.component').then((m) => m.PasswordComponent),
      },
      {
        path: 'notifications',
        loadComponent: () =>
          import('./features/notifications/notifications-page.component').then((m) => m.NotificationsPageComponent),
      },
      {
        path: 'templates',
        loadComponent: () => import('./features/templates/templates.component').then((m) => m.TemplatesComponent),
      },
      {
        path: 'errors',
        canActivate: [superadminGuard],
        loadComponent: () => import('./features/errors/errors.component').then((m) => m.ErrorsComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
