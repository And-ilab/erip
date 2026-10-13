import { Component, input } from '@angular/core';

import { MoneyComponent } from '../core/money.component';
import { ratingMark, ratingMarkClass, ratingMarkTitle } from './rating-mark';

/** Карточка канбана реестров: имя и овал «рейтинг-группа», затем те же строки, что у лицевого счёта. */
@Component({
  selector: 'app-kanban-debtor',
  standalone: true,
  imports: [MoneyComponent],
  template: `
    <div class="card-head">
      <div class="name">{{ name() || 'Без наименования' }}</div>
      @if (rating() || group()) {
        <div class="card-marks">
          <span [class]="markClass()" tabindex="0" [attr.title]="markTitle()">{{ markText() }}</span>
        </div>
      }
    </div>
    @if (account() || address()) {
      <div class="line">
        @if (account()) { <span tabindex="0" [attr.title]="accountTitle()">{{ account() }}</span> }
        @if (account() && address()) { · }
        @if (address()) { <span tabindex="0" title="Адрес">{{ address() }}</span> }
      </div>
    }
    @if (showScenario()) {
      <div class="line one-line" tabindex="0" [attr.title]="scenarioTitle()">{{ scenario() || '—' }}</div>
    }
    @if (ownership() || housing()) {
      <div class="line">
        @if (ownership()) { <span tabindex="0" title="Тип собственности">{{ ownership() }}</span> }
        @if (ownership() && housing()) { · }
        @if (housing()) { <span tabindex="0" title="Тип объекта жилфонда">{{ housing() }}</span> }
      </div>
    }
    @if (showPeople()) {
      <div class="line">
        <span tabindex="0" title="Кол-во месяцев долга">{{ months() ?? '—' }}</span>
        · <span tabindex="0" title="Проживающих">{{ residents() ?? '—' }}</span>
        · <span tabindex="0" title="Зарегистрированных">{{ registered() ?? '—' }}</span>
      </div>
    }
    <ng-content />
    @if (showMoney()) {
      <div class="money">
        <span tabindex="0" title="Сумма задолженности"><app-money [value]="total()" [blank]="false" [sign]="false" /></span>
        <small>
          <span class="principal" tabindex="0" title="Сумма основного долга"><app-money [value]="principal()" [blank]="false" [sign]="false" /></span>
          · <span class="amount-danger" tabindex="0" title="Сумма пени"><app-money [value]="penalty()" [blank]="false" [sign]="false" /></span>
        </small>
      </div>
    }
    <div class="foot">
      @if (when()) {
        <span class="when">
          <svg class="cal" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.2" y="3.2" width="11.6" height="10.4" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.2 6.4h11.6M5 2v2.6M11 2v2.6" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>
          {{ when() }}
        </span>
      } @else { <span></span> }
      @if (initials(); as who) {
        <span class="who" [style.background]="avatarColor()" tabindex="0" [attr.title]="specialistCaption() + ': ' + specialist()">{{ who }}</span>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .name { font-weight: 700; font-size: 14px; line-height: 1.25; flex: 1; min-width: 0; color: #1f2933; }
    .card-marks { display: flex; align-items: center; flex: 0 0 auto; }
    .line { margin-top: 3px; font-size: 12px; line-height: 1.35; color: #6b7280; }
    .one-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .money { margin-top: 6px; font-size: 13px; font-weight: 700; color: #1f2933; }
    .money > span, .money small { display: block; }
    .money small { font-weight: 400; color: #6b7280; }
    .money .amount-danger { color: var(--erip-danger); }
    .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; min-height: 26px; }
    .when { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #6b7280; }
    .cal { width: 14px; height: 14px; flex: 0 0 14px; }
    .who {
      width: 26px; height: 26px; border-radius: 50%; color: #fff; font-size: 10px; font-weight: 700;
      display: grid; place-items: center; flex: 0 0 26px;
    }
  `,
})
export class KanbanDebtorComponent {
  readonly name = input<string | null | undefined>('');
  readonly rating = input<string | null | undefined>('');
  readonly group = input<number | null | undefined>(null);
  readonly account = input<string | null | undefined>('');
  readonly accountTitle = input('Номер ЛС');
  readonly address = input<string | null | undefined>('');
  readonly scenario = input<string | null | undefined>('');
  readonly scenarioTitle = input('Сценарий');
  readonly showScenario = input(true);
  readonly ownership = input<string | null | undefined>('');
  readonly housing = input<string | null | undefined>('');
  readonly showPeople = input(true);
  readonly months = input<number | null | undefined>(null);
  readonly residents = input<number | null | undefined>(null);
  readonly registered = input<number | null | undefined>(null);
  readonly showMoney = input(true);
  readonly total = input<string | number | null | undefined>(null);
  readonly principal = input<string | number | null | undefined>(null);
  readonly penalty = input<string | number | null | undefined>(null);
  readonly when = input<string | null | undefined>('');
  readonly specialist = input<string | null | undefined>('');
  readonly specialistCaption = input('Закреплённый специалист');

  protected markText(): string {
    return ratingMark(this.rating(), this.group());
  }

  protected markClass(): string {
    return ratingMarkClass(this.rating(), this.group());
  }

  protected markTitle(): string {
    return ratingMarkTitle(this.rating(), this.group());
  }

  protected initials(): string {
    const parts = (this.specialist() || '').split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('');
  }

  protected avatarColor(): string {
    const palette = ['#2e7d32', '#7c3aed', '#ea580c', '#c62828', '#1d4ed8', '#0f766e'];
    let hash = 0;
    for (const char of this.specialist() || '') hash = (hash + char.charCodeAt(0)) % palette.length;
    return palette[hash];
  }
}
