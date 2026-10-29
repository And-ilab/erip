import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-settings-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="page">
      <nav class="tabs" aria-label="Настройка">
        <a routerLink="rules" routerLinkActive="on">Правила рейтинга и групп</a>
        @if (auth.canManageTemplates()) {
          <a routerLink="directory" routerLinkActive="on">Организации и пользователи</a>
        }
        <a routerLink="work" routerLinkActive="on">Сценарии и шаблоны</a>
        <a routerLink="integrations" routerLinkActive="on">Интеграции</a>
      </nav>
      <router-outlet />
    </div>
  `,
  styles: `
    .tabs {
      display: flex; gap: 0; flex-wrap: wrap; border-bottom: 1px solid var(--erip-border); margin-bottom: 16px;
    }
    .tabs a {
      padding: 10px 16px; margin-bottom: -1px; text-decoration: none; font-weight: 600;
      color: var(--erip-muted); border: 1px solid transparent; border-bottom: 0; border-radius: 8px 8px 0 0;
      background: transparent;
    }
    .tabs a.on {
      color: var(--erip-primary-dark); background: #fff; border-color: var(--erip-border);
    }
  `,
})
export class SettingsShellComponent {
  protected readonly auth = inject(AuthService);
}
