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
    <span class="byn" role="img" aria-label="белорусский рубль">
      <span class="bar" aria-hidden="true"></span>
      <span class="letter" aria-hidden="true">Б</span>
    </span>
  `,
  styles: `
    :host { display: inline-block; vertical-align: baseline; }
    .byn {
      position: relative; display: inline-block; padding-left: 0.2em;
      font-weight: 700; font-family: Roboto, "Segoe UI", Arial, sans-serif; line-height: 1;
    }
    .letter { font-weight: 700; }
    /* Нижняя перекладина печатной «Б», продолженная влево. */
    .bar {
      position: absolute; left: 0; top: 0.40em; width: 0.42em; height: 0.11em; background: currentColor;
    }
  `,
})
export class BynSignComponent {}

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
