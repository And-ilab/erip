import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-settings-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="page">
      <nav class="subnav">
        <a routerLink="rules" routerLinkActive="on">Правила рейтинга и групп</a>
        @if (auth.canManageTemplates()) {
          <a routerLink="directory" routerLinkActive="on">Организации и пользователи</a>
        }
        <a routerLink="work" routerLinkActive="on">Сценарии и шаблоны</a>
      </nav>
      <router-outlet />
    </div>
  `,
  styles: `
    .subnav { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
    .subnav a {
      padding: 8px 14px; border-radius: 8px; background: #fff; border: 1px solid var(--erip-border);
      color: var(--erip-primary-dark); text-decoration: none; font-weight: 600;
    }
    .subnav a.on { background: var(--erip-primary); color: #fff; border-color: var(--erip-primary); }
  `,
})
export class SettingsShellComponent {
  protected readonly auth = inject(AuthService);
}
