import { Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ApiService, ClaimCase, Named, errorMessage } from '../../core/api.service';

@Component({
  selector: 'app-claims-board',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatSnackBarModule],
  template: `
    <div class="page">
      <p class="back"><a routerLink="/measures">Мероприятия</a></p>
      <header class="head">
        <div>
          <h2>Взыскание</h2>
          <p>Канбан дел и список по группам. Суммы читаются из АИС и здесь не правятся.</p>
        </div>
        <div class="modes">
          <button mat-stroked-button [class.on]="mode() === 'kanban'" (click)="mode.set('kanban')">Канбан</button>
          <button mat-stroked-button [class.on]="mode() === 'list'" (click)="mode.set('list')">Список</button>
        </div>
      </header>
      <div class="chips">
        <button type="button" [class.on]="group() === 0" (click)="group.set(0)">Все группы</button>
        @for (item of groupChips; track item) {
          <button type="button" [class.on]="group() === item" (click)="group.set(item)">Группа {{ item }}</button>
        }
      </div>
      @if (error()) { <p class="error">{{ error() }}</p> }
      @if (!cards().length && !error()) {
        <p class="empty">Дел пока нет. Откройте счёт и вкладку «Надпись» или выполните выборку из README.</p>
      }

      @if (mode() === 'kanban') {
        <div class="board">
          @for (stage of stages(); track stage.id) {
            <section class="column" [attr.data-stage]="stage.id">
              <h3><span>{{ stage.label }}</span><b>{{ column(stage.id).length }}</b></h3>
              @for (card of column(stage.id); track card.id) {
                <a class="card" [routerLink]="['/claims', card.id]">
                  <strong>{{ card.short_fio || 'Без ФИО' }}</strong>
                  <span class="ls">ЛС {{ card.client_account }}</span>
                  <span class="addr">{{ card.account_address || 'Адрес не указан' }}</span>
                  <span class="meta">
                    <em class="rating">{{ card.rating || '—' }}</em>
                    <em>Гр. {{ card.debt_group || '—' }}</em>
                  </span>
                  <span class="money">{{ money(card.balance_out) }} <small>+ пеня {{ money(card.penalty) }}</small></span>
                  <span class="who">{{ initials(card.specialist) }}</span>
                </a>
              }
            </section>
          }
        </div>
      } @else {
        @for (block of grouped(); track block.id) {
          <section class="group">
            <h3>Группа {{ block.id || 'без группы' }} <span>{{ block.cards.length }}</span></h3>
            <table>
              <thead>
                <tr>
                  <th>Должник</th><th>Адрес</th><th>Рейтинг</th><th>Этап</th>
                  <th>Долг</th><th>Пеня</th><th>Итого</th><th></th>
                </tr>
              </thead>
              <tbody>
                @for (card of block.cards; track card.id) {
                  <tr>
                    <td><a [routerLink]="['/claims', card.id]">{{ card.short_fio || card.client_account }}</a><small>ЛС {{ card.client_account }}</small></td>
                    <td>{{ card.account_address || '—' }}</td>
                    <td><em class="rating">{{ card.rating || '—' }}</em></td>
                    <td><span class="chip">{{ card.stage_label }}</span></td>
                    <td>{{ money(card.balance_out) }}</td>
                    <td>{{ money(card.penalty) }}</td>
                    <td>{{ total(card) }}</td>
                    <td class="who">{{ initials(card.specialist) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </section>
        }
      }
    </div>
  `,
  styles: `
    .back a { color: var(--erip-link); }
    .head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    h2 { margin: 0; color: var(--erip-primary-dark); }
    .head p, .empty { color: var(--erip-muted); margin: 4px 0 0; }
    .modes { display: flex; gap: 8px; }
    .modes .on { background: var(--erip-primary-soft); }
    .chips { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
    .chips button { border: 1px solid var(--erip-border); background: #fff; border-radius: 999px; padding: 4px 12px; cursor: pointer; }
    .chips button.on { background: var(--erip-primary); color: #fff; border-color: var(--erip-primary); }
    .board { display: flex; gap: 10px; overflow-x: auto; align-items: flex-start; padding-bottom: 12px; }
    .column { width: 240px; flex: 0 0 240px; background: #f7f8fa; border-radius: 10px; padding: 0 8px 8px; }
    .column h3 { margin: 0 -8px 8px; padding: 8px 10px; border-radius: 10px 10px 0 0; color: #fff; font-size: 13px; display: flex; justify-content: space-between; background: var(--erip-claim); }
    .column[data-stage="prep"] h3 { background: #2e7d32; }
    .column[data-stage="notary"] h3, .column[data-stage="writ_done"] h3 { background: var(--erip-claim); }
    .column[data-stage="refused"] h3 { background: var(--erip-danger); }
    .column[data-stage="lawsuit"] h3, .column[data-stage="court"] h3 { background: var(--erip-notice); }
    .column[data-stage="opi"] h3, .column[data-stage="opi_measures"] h3 { background: var(--erip-cut); }
    .column[data-stage="recovered"] h3 { background: var(--erip-success); }
    .column[data-stage="impossible"] h3, .column[data-stage="writeoff"] h3 { background: #6b7280; }
    .card { display: flex; flex-direction: column; gap: 3px; background: #fff; border-radius: 8px; padding: 10px; margin-bottom: 8px; text-decoration: none; color: inherit; box-shadow: 0 1px 2px rgba(16, 24, 40, .08); }
    .card strong { font-size: 14px; }
    .ls, .addr, .money small { color: var(--erip-muted); font-size: 12px; }
    .meta { display: flex; gap: 6px; }
    .rating { background: var(--erip-accent-soft); color: var(--erip-warning); border-radius: 999px; padding: 0 6px; font-style: normal; font-size: 12px; }
    .who { align-self: flex-end; width: 28px; height: 28px; border-radius: 50%; background: var(--erip-primary-soft); color: var(--erip-primary); display: grid; place-items: center; font-size: 11px; font-weight: 700; }
    .group { margin-bottom: 18px; }
    .group h3 { margin: 0 0 8px; color: var(--erip-primary-dark); }
    .group h3 span { color: var(--erip-muted); font-weight: 500; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--erip-border); font-size: 13px; vertical-align: top; }
    th { color: var(--erip-muted); font-weight: 600; }
    td small { display: block; color: var(--erip-muted); }
    td a { color: var(--erip-link); text-decoration: none; font-weight: 600; }
    .chip { background: var(--erip-claim-soft); color: var(--erip-claim); border-radius: 999px; padding: 2px 8px; }
    .error { color: var(--erip-danger); }
  `,
})
export class ClaimsBoardComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  protected readonly groupChips = [1, 2, 3, 4, 5, 6];
  protected readonly stages = signal<Named[]>([]);
  protected readonly cards = signal<ClaimCase[]>([]);
  protected readonly error = signal('');
  protected readonly mode = signal<'kanban' | 'list'>('kanban');
  protected readonly group = signal(0);

  ngOnInit(): void {
    const account = this.route.snapshot.queryParamMap.get('account');
    if (account) {
      this.api.openClaim(Number(account)).subscribe({
        next: (row) => this.router.navigate(['/claims', row.id]),
        error: (err) => this.snack.open(errorMessage(err), 'OK'),
      });
    }
    this.reload();
  }

  protected column(stage: string): ClaimCase[] {
    return this.visible().filter((card) => card.stage === stage);
  }

  protected grouped(): { id: number; cards: ClaimCase[] }[] {
    const buckets = new Map<number, ClaimCase[]>();
    for (const card of this.visible()) {
      const key = card.debt_group || 0;
      buckets.set(key, [...(buckets.get(key) || []), card]);
    }
    return [...buckets.entries()].sort(([left], [right]) => left - right).map(([id, rows]) => ({ id, cards: rows }));
  }

  protected money(value: string | null): string {
    if (!value) return '—';
    const number = Number(value);
    if (Number.isNaN(number)) return value;
    return number.toLocaleString('ru-BY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected total(card: ClaimCase): string {
    const debt = Number(card.balance_out || 0);
    const penalty = Number(card.penalty || 0);
    return this.money(String(debt + penalty));
  }

  protected initials(name: string): string {
    const parts = (name || '').split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('');
  }

  private visible(): ClaimCase[] {
    const group = this.group();
    return this.cards().filter((card) => !group || card.debt_group === group);
  }

  private reload(): void {
    this.api.claims().subscribe({
      next: (page) => {
        this.stages.set(page.stages);
        this.cards.set(page.results);
      },
      error: (err) => this.error.set(errorMessage(err)),
    });
  }
}
