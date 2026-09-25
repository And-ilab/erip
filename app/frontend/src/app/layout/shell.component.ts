import { Component, inject } from '@angular/core';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../core/auth.service';
import { NotificationsPanelComponent } from '../features/notifications/notifications-panel.component';
import { NotificationsStore } from '../features/notifications/notifications.store';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive, MatToolbarModule, MatSidenavModule, MatListModule, MatIconModule,
    MatButtonModule, MatBadgeModule, MatTooltipModule, NotificationsPanelComponent,
  ],
  template: `
    <mat-toolbar color="primary">
      <span class="brand">ЕРИП · Работа с задолженностью</span>
      <span class="spacer"></span>
      <span class="user">{{ auth.me()?.display_name }} · {{ auth.me()?.organization_name ?? 'все схемы' }}</span>
      <button mat-icon-button (click)="panel.toggle()" matTooltip="Уведомления">
        <mat-icon [matBadge]="store.unread() || null" matBadgeColor="warn">notifications</mat-icon>
      </button>
      <button mat-icon-button (click)="auth.logout()" matTooltip="Выход"><mat-icon>logout</mat-icon></button>
    </mat-toolbar>

    <mat-sidenav-container class="container">
      <mat-sidenav mode="side" opened class="menu">
        <mat-nav-list>
          <a mat-list-item routerLink="/accounts" routerLinkActive="active">Реестр ЛС</a>
          <a mat-list-item routerLink="/contracts" routerLinkActive="active">Реестр договоров</a>
          <a mat-list-item routerLink="/measures" routerLinkActive="active">Мероприятия</a>
          <a mat-list-item routerLink="/password" routerLinkActive="active">Смена пароля</a>
          <a mat-list-item routerLink="/notifications" routerLinkActive="active">Оповещения</a>
          <a mat-list-item routerLink="/templates" routerLinkActive="active">Шаблоны сообщений</a>
          @if (auth.isSuperadmin()) {
            <a mat-list-item routerLink="/errors" routerLinkActive="active">Журнал ошибок</a>
          }
        </mat-nav-list>
      </mat-sidenav>

      <mat-sidenav #panel position="end" mode="over" class="panel">
        <app-notifications-panel (closed)="panel.close()" />
      </mat-sidenav>

      <mat-sidenav-content><router-outlet /></mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100vh; }
    .spacer { flex: 1; }
    .brand { font-weight: 600; }
    .user { font-size: 14px; margin-right: 8px; opacity: .9; }
    .container { flex: 1; }
    .menu { width: 220px; }
    .panel { width: 380px; }
    .active { background: rgba(0, 90, 200, .08); }
  `,
})
export class ShellComponent {
  protected readonly auth = inject(AuthService);
  protected readonly store = inject(NotificationsStore);
}
