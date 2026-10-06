import { Component, computed, input } from '@angular/core';

/** Буква «Б» с чертой — графический знак белорусского рубля. В шрифтах его ещё нет. */
export const BYN_SIGN_PATH =
  'M14 2H42V14H26V30H40C58 30 66 42 66 54C66 68 52 70 40 70H14Z' +
  'M2 30H14V42H2Z' +
  'M26 42H34C50 42 52 48 52 54C52 62 46 58 34 58H26Z';

const amountFormat = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export function formatMoney(
  value: string | number | null | undefined,
  options: { blank?: boolean; compact?: boolean } = {},
): string | null {
  const blank = options.blank !== false;
  if (value === null || value === undefined || value === '') return blank ? null : amountFormat.format(0);
  const number = typeof value === 'number' ? value : Number(String(value).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(number)) return String(value);
  if (options.compact && Math.abs(number) >= 1000) return `${compactFormat.format(number / 1000)} тыс.`;
  return amountFormat.format(number);
}

@Component({
  selector: 'app-byn-sign',
  standalone: true,
  template: `
    <svg viewBox="0 0 68 72" role="img" aria-label="белорусский рубль" focusable="false">
      <path [attr.d]="path" fill="currentColor" fill-rule="evenodd" />
    </svg>
  `,
  styles: `
    :host { display: inline-flex; align-items: center; line-height: 0; vertical-align: -0.12em; }
    svg { width: 0.82em; height: 1em; display: block; }
  `,
})
export class BynSignComponent {
  protected readonly path = BYN_SIGN_PATH;
}

@Component({
  selector: 'app-money',
  standalone: true,
  imports: [BynSignComponent],
  template: `
    @if (text(); as shown) {
      <span class="money-figure">{{ shown }}<app-byn-sign /></span>
    } @else {
      {{ empty() }}
    }
  `,
  styles: `
    :host { display: inline; }
    .money-figure { white-space: nowrap; }
    app-byn-sign { margin-left: 0.18em; }
  `,
})
export class MoneyComponent {
  readonly value = input<string | number | null | undefined>(null);
  readonly empty = input('—');
  /** Пустое значение — прочерк без знака. Ноль остаётся суммой. */
  readonly blank = input(true);
  /** Крупные суммы на графиках: «12,5 тыс.» и знак. */
  readonly compact = input(false);

  protected readonly text = computed(() => formatMoney(this.value(), { blank: this.blank(), compact: this.compact() }));
}
