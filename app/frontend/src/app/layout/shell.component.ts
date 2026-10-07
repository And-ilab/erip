import { Component, inject, signal } from '@angular/core';
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
    <mat-toolbar class="topbar">
      <button mat-icon-button type="button" (click)="navCompact.set(!navCompact())"
        [matTooltip]="navCompact() ? 'Развернуть меню' : 'Свернуть меню'"
        [attr.aria-expanded]="!navCompact()" aria-controls="app-menu">
        <mat-icon>apps</mat-icon>
      </button>
      <span class="brand">ЕРИП · Работа с задолженностью</span>
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
      <mat-sidenav id="app-menu" mode="side" opened class="menu" [class.compact]="navCompact()">
        <mat-nav-list>
          @for (item of navItems(); track item.link) {
            <a mat-list-item [routerLink]="item.link" routerLinkActive="active"
              [matTooltip]="item.label" [matTooltipDisabled]="!navCompact()" matTooltipPosition="right">
              <mat-icon matListItemIcon>{{ item.icon }}</mat-icon>
              <span matListItemTitle>{{ item.label }}</span>
            </a>
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
    .brand { font-weight: 600; font-size: 17px; }
    .org, .user { font-size: 13px; }
    .org { padding: 4px 12px; border-radius: 6px; background: rgba(255, 255, 255, .14); }
    .user { opacity: .92; }
    .avatar {
      display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%;
      background: rgba(255, 255, 255, .2); font-size: 13px; font-weight: 600; cursor: default;
    }
    .container { flex: 1; min-height: 0; }
    mat-sidenav-content { display: flex; flex-direction: column; min-height: 0; }
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
    .menu mat-icon { color: rgba(255, 255, 255, .85); }
    .menu a.active {
      background: rgba(255, 255, 255, .14); border-left-color: var(--erip-accent); font-weight: 600;
      --mdc-list-list-item-label-text-color: #fff;
    }
    .menu a.active mat-icon { color: #fff; }
    .menu.compact { width: 72px; }
    .menu.compact a { padding-left: 12px; padding-right: 12px; }
    .menu.compact .mdc-list-item__content { display: none; }
    .panel { width: 380px; }
  `,
})
export class ShellComponent {
  protected readonly auth = inject(AuthService);
  protected readonly store = inject(NotificationsStore);
  protected readonly navCompact = signal(false);

  protected navItems(): { link: string; label: string; icon: string }[] {
    const items = [
      { link: '/accounts', label: 'Реестр ЛС', icon: 'badge' },
      { link: '/contracts', label: 'Реестр договоров', icon: 'article' },
      { link: '/measures', label: 'Мероприятия', icon: 'event_note' },
      { link: '/claims', label: 'Претензионно-исковая работа', icon: 'gavel' },
    ];
    if (this.auth.canWrite() && this.auth.me()?.contour !== 'supplier') {
      items.push({ link: '/settings', label: 'Настройка', icon: 'tune' });
    }
    if (this.auth.canManageTemplates()) {
      items.push({ link: '/imports', label: 'Загрузка АИС', icon: 'upload_file' });
    }
    items.push(
      { link: '/password', label: 'Смена пароля', icon: 'lock' },
      { link: '/notifications', label: 'Оповещения', icon: 'notifications' },
    );
    if (this.auth.isSuperadmin()) {
      items.push({ link: '/errors', label: 'Журнал ошибок', icon: 'error_outline' });
    }
    return items;
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
