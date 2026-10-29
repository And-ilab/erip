import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/** Субвкладки каналов. Новый канал — пункт здесь и маршрут в app.routes. */
export const INTEGRATION_TABS: { path: string; label: string }[] = [
  { path: 'smtp', label: 'SMTP' },
  { path: 'asterisk', label: 'Asterisk AMI' },
  { path: 'sms', label: 'SMS' },
  { path: 'messengers', label: 'Мессенджеры' },
  { path: 'belpochta', label: 'Белпочта' },
  { path: 'pris', label: 'АИС ПРИС' },
  { path: 'bnp', label: 'ЛК БНП' },
  { path: 'ais', label: 'АИС «Расчет-ЖКУ»' },
];

@Component({
  selector: 'app-settings-integrations',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <p class="lead">Настройки каналов доставки и внешних систем. Секреты шлюза задаются в окружении сервера; здесь — статус и параметры схемы.</p>
    <nav class="nested" aria-label="Интеграции">
      @for (tab of tabs; track tab.path) {
        <a [routerLink]="tab.path" routerLinkActive="on">{{ tab.label }}</a>
      }
    </nav>
    <router-outlet />
  `,
  styles: `
    .lead { margin: 0 0 12px; max-width: 72ch; color: var(--erip-muted); }
    .nested {
      display: flex; gap: 0; flex-wrap: wrap; border-bottom: 1px solid var(--erip-border); margin: 0 0 16px;
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
export class SettingsIntegrationsComponent {
  protected readonly tabs = INTEGRATION_TABS;
}
