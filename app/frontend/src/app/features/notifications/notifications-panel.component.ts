import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';

import { NotificationsStore } from './notifications.store';

@Component({
  selector: 'app-notifications-panel',
  standalone: true,
  imports: [DatePipe, MatListModule, MatIconModule, MatButtonModule],
  template: `
    <div class="head">
      <h3>Уведомления</h3>
      <button mat-icon-button (click)="store.load()" title="Обновить"><mat-icon>refresh</mat-icon></button>
      <button mat-icon-button (click)="closed.emit()" title="Закрыть"><mat-icon>close</mat-icon></button>
    </div>
    @for (item of store.items(); track item.id) {
      <div class="item" [class.unread]="!item.is_read" (click)="store.markRead(item)">
        <div class="muted">{{ item.created_at | date: 'dd.MM.yyyy HH:mm' }} · {{ item.status_display }}</div>
        <pre class="message">{{ item.rendered_text || item.body }}</pre>
      </div>
    } @empty {
      <p class="muted">Уведомлений нет</p>
    }
  `,
  styles: `
    :host { display: block; padding: 12px; }
    .head { display: flex; align-items: center; h3 { flex: 1; margin: 0; } }
    .item { border-bottom: 1px solid #e5e7eb; padding: 8px 0; cursor: pointer; }
    .unread pre { border-left: 3px solid #2563eb; }
  `,
})
export class NotificationsPanelComponent implements OnInit {
  protected readonly store = inject(NotificationsStore);
  readonly closed = output<void>();

  ngOnInit(): void {
    this.store.load();
  }
}
