import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, filter, of, switchMap, timer } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Notification } from '../../core/models';

const POLL_MS = 30_000;

/** Панель уведомлений: опрос backend раз в 30 секунд. */
@Injectable({ providedIn: 'root' })
export class NotificationsStore {
  private readonly api = inject(ApiService);

  readonly unread = signal(0);
  readonly items = signal<Notification[]>([]);

  constructor() {
    const destroyRef = inject(DestroyRef);
    const auth = inject(AuthService);
    timer(0, POLL_MS)
      .pipe(
        filter(() => !!auth.accessToken),
        switchMap(() => this.api.unreadCount().pipe(catchError(() => of({ count: 0 })))),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe(({ count }) => this.unread.set(count));
  }

  load(): void {
    this.api
      .notifications({ mine: 1, channel: 'inbox', page_size: 50, ordering: '-created_at' })
      .subscribe((page) => this.items.set(page.results));
  }

  markRead(item: Notification): void {
    if (item.is_read) return;
    this.api.markRead(item.id).subscribe((updated) => {
      this.items.update((list) => list.map((n) => (n.id === updated.id ? updated : n)));
      this.unread.update((n) => Math.max(0, n - 1));
    });
  }
}
