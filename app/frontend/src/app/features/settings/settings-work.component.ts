import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-settings-work',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <nav class="nested" aria-label="Сценарии и шаблоны">
      <a routerLink="scenario" routerLinkActive="on">Сценарий</a>
      <a routerLink="messages" routerLinkActive="on">Шаблоны сообщений</a>
      <a routerLink="forms" routerLinkActive="on">Печатные формы</a>
    </nav>
    <router-outlet />
  `,
  styles: `
    .nested {
      display: flex; gap: 0; border-bottom: 1px solid var(--erip-border); margin: 0 0 16px;
    }
    .nested a {
      padding: 8px 14px; margin-bottom: -1px; text-decoration: none; color: var(--erip-muted);
      font-weight: 600; border: 1px solid transparent; border-bottom: 0; border-radius: 8px 8px 0 0;
    }
    .nested a.on {
      color: var(--erip-primary-dark); background: #fff; border-color: var(--erip-border);
    }
  `,
})
export class SettingsWorkComponent {}
