import { Component, computed, input } from '@angular/core';

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
    <svg viewBox="0 0 174 214" role="img" aria-label="белорусский рубль" focusable="false">
      <path fill="currentColor" fill-rule="evenodd" d="M32 0H149V22H55V89H119L137 95L151 104L162 116L169 129L173 147L171 167L165 181L155 194L134 208L116 213H32V164H2V140H32ZM56 111H110L123 114L134 120L145 132L150 147L148 164L142 174L132 183L113 190H55V163H107V141H56Z" />
    </svg>
  `,
  styles: `
    :host { display: inline-block; line-height: 0; vertical-align: -0.12em; }
    svg { width: 0.82em; height: 1em; display: block; }
  `,
})
export class BynSignComponent {}

@Component({
  selector: 'app-money',
  standalone: true,
  imports: [BynSignComponent],
  template: `
    @if (text(); as shown) {
      <span class="money-figure">{{ shown }}@if (sign()) { <app-byn-sign /> }</span>
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
  /** Знак валюты у числа. В реестре ЛС валюту показывает заголовок столбца. */
  readonly sign = input(true);
  /** Крупные суммы на графиках: «12,5 тыс.» и знак. */
  readonly compact = input(false);

  protected readonly text = computed(() => formatMoney(this.value(), { blank: this.blank(), compact: this.compact() }));
}
