import { Component, inject } from '@angular/core';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

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
    <mat-toolbar class="topbar">
      <mat-icon class="brand-icon">apps</mat-icon>
      <span class="brand">ЕРИП · Работа с задолженностью</span>
      <nav class="module-tabs" aria-label="Разделы взыскания">
        <a routerLink="/accounts" [class.on]="tab() === 'cases'">Дела</a>
        <a routerLink="/measures" [class.on]="tab() === 'measures'">Мероприятия</a>
        <a routerLink="/claims" [class.on]="tab() === 'claims'">Претензионно-исковая работа</a>
        <a routerLink="/accounts" [queryParams]="{ view: 'charts' }" [class.on]="tab() === 'reports'">Отчётность</a>
        <a routerLink="/scenarios" [class.on]="tab() === 'settings'">Настройка</a>
      </nav>
      <span class="spacer"></span>
      <button mat-icon-button (click)="panel.toggle()" matTooltip="Уведомления">
        <mat-icon [matBadge]="store.unread() || null" matBadgeColor="warn">notifications</mat-icon>
      </button>
      <span class="org">{{ orgLabel() }}</span>
      <span class="user">{{ auth.me()?.display_name }}</span>
      <span class="avatar" [matTooltip]="auth.me()?.display_name ?? ''">{{ initials() }}</span>
      <button mat-icon-button (click)="auth.logout()" matTooltip="Выход"><mat-icon>logout</mat-icon></button>
    </mat-toolbar>

    <mat-sidenav-container class="container">
      <mat-sidenav mode="side" opened class="menu">
        <mat-nav-list>
          <a mat-list-item routerLink="/accounts" routerLinkActive="active">Реестр ЛС</a>
          <a mat-list-item routerLink="/contracts" routerLinkActive="active">Реестр договоров</a>
          <a mat-list-item routerLink="/measures" routerLinkActive="active">Мероприятия</a>
          <a mat-list-item routerLink="/claims" routerLinkActive="active">Претензионно-исковая работа</a>
          <a mat-list-item routerLink="/password" routerLinkActive="active">Смена пароля</a>
          <a mat-list-item routerLink="/notifications" routerLinkActive="active">Оповещения</a>
          @if (auth.canManageTemplates() || (auth.canWrite() && auth.me()?.contour !== 'supplier')) {
            <a mat-list-item routerLink="/templates" routerLinkActive="active">Шаблоны сообщений</a>
          }
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
    .topbar { gap: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, .2); z-index: 2; }
    .topbar .mat-mdc-icon-button { color: #fff; }
    .brand-icon { opacity: .85; }
    .brand { font-weight: 600; font-size: 15px; white-space: nowrap; }
    .module-tabs { display: flex; gap: 2px; margin-left: 12px; flex-wrap: wrap; }
    .module-tabs a {
      color: rgba(255, 255, 255, .82); text-decoration: none; font-size: 14px; font-weight: 500;
      padding: 6px 10px; border-radius: 6px; border-bottom: 2px solid transparent;
    }
    .module-tabs a.on { color: #fff; border-bottom-color: var(--erip-accent); }
    .module-tabs a:hover { color: #fff; background: rgba(255, 255, 255, .08); }
    .org, .user { font-size: 13px; }
    .org { padding: 4px 12px; border-radius: 6px; background: rgba(255, 255, 255, .14); }
    .user { opacity: .92; }
    .avatar {
      display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%;
      background: rgba(255, 255, 255, .2); font-size: 13px; font-weight: 600; cursor: default;
    }
    .container { flex: 1; }
    .menu {
      width: 260px; border-right: 0; border-radius: 0; background: var(--erip-primary);
      border-top: 1px solid rgba(255, 255, 255, .12);
      --mat-sidenav-container-background-color: var(--erip-primary);
      --mdc-list-list-item-label-text-color: rgba(255, 255, 255, .85);
      --mdc-list-list-item-hover-label-text-color: #fff;
      --mdc-list-list-item-focus-label-text-color: #fff;
      --mdc-list-list-item-hover-state-layer-color: #fff;
      --mdc-list-list-item-hover-state-layer-opacity: .08;
    }
    .menu a { border-left: 3px solid transparent; border-radius: 0; }
    .menu a.active {
      background: rgba(255, 255, 255, .14); border-left-color: var(--erip-accent); font-weight: 600;
      --mdc-list-list-item-label-text-color: #fff;
    }
    .panel { width: 380px; }
  `,
})
export class ShellComponent {
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly store = inject(NotificationsStore);

  protected tab(): string {
    const [path, query] = this.router.url.split('?');
    if (path.startsWith('/measures')) return 'measures';
    if (path.startsWith('/claims')) return 'claims';
    if (path.startsWith('/scenarios') || path.startsWith('/templates')) return 'settings';
    if (path.startsWith('/accounts') && (query || '').includes('view=charts')) return 'reports';
    if (path.startsWith('/accounts')) return 'cases';
    return '';
  }

  protected orgLabel(): string {
    const me = this.auth.me();
    if (!me) return '';
    if (me.contour === 'supplier') {
      return me.supplier_name || `${me.organization_name ?? 'поставщик'} · поставщик`;
    }
    return me.organization_name ?? 'все схемы';
  }

  protected initials(): string {
    const name = this.auth.me()?.display_name ?? '';
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
  }
}
