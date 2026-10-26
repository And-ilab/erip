import { Component, computed, input, output, signal } from '@angular/core';

import { FUNNEL_CHAIN, FUNNEL_TERMINAL, FunnelStage, funnelId } from '../funnel-stages';

/** Лента этапа как у сделки: текущий залит, слева пройденный, справа два следующих. */
@Component({
  selector: 'app-funnel-bar',
  standalone: true,
  template: `
    <div class="ribbon-wrap">
      <div class="ribbon" role="list" aria-label="Этап взыскания">
        @if (hiddenBefore().length) {
          <button type="button" class="arrow" title="Предыдущие этапы" [disabled]="!canChange()"
            (click)="menu.set(menu() === 'before' ? '' : 'before')">‹</button>
        }
        @for (stage of window(); track stage.id) {
          <button type="button" class="step" role="listitem"
            [class.done]="rank(stage) < currentRank() && !terminal()"
            [class.now]="stage.id === current() && !terminal()"
            [class.ahead]="rank(stage) > currentRank() || terminal()"
            [disabled]="!canChange()"
            [title]="stage.title"
            (click)="pick(stage.id)">
            <span class="mark">{{ stage.mark }}</span> {{ stage.short }}
          </button>
        }
        @if (hiddenAfter().length) {
          <button type="button" class="arrow" title="Следующие этапы" [disabled]="!canChange()"
            (click)="menu.set(menu() === 'after' ? '' : 'after')">›</button>
        }
        <button type="button" class="terminal" [class.now]="terminal()" [disabled]="!canChange()"
          [title]="terminalTitle()" (click)="menu.set(menu() === 'terminal' ? '' : 'terminal')">
          {{ terminalLabel() }}
        </button>
        @if (menu(); as which) {
          <div class="menu" (click)="$event.stopPropagation()">
            @for (stage of menuStages(); track stage.id) {
              <button type="button" (click)="pick(stage.id)">{{ stage.mark }} {{ stage.title }}</button>
            }
          </div>
        }
      </div>
      @if (showParallel()) {
        <div class="parallel" role="list" aria-label="Ветвь выселения">
          <button type="button" class="step" [class.now]="!parallel()" [disabled]="!canChange()"
            title="Ветвь не начата" (click)="parallelChange.emit('')">не начата</button>
          <button type="button" class="step" [class.done]="parallel() === 'p2'" [class.now]="parallel() === 'p1'"
            [disabled]="!canChange()" title="Уведомление о возможном выселении/отчуждении"
            (click)="parallelChange.emit('p1')">Уведомление о выселении</button>
          <button type="button" class="step" [class.now]="parallel() === 'p2'" [disabled]="!canChange()"
            title="Выселение/принудительная продажа" (click)="parallelChange.emit('p2')">Выселение / продажа</button>
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .ribbon-wrap { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; min-width: 0; }
    .ribbon, .parallel { display: flex; align-items: stretch; position: relative; min-width: 0; }
    .step, .arrow, .terminal {
      border: 1px solid #d5dee6; background: #f4f7f8; color: #5c6b7a; font: inherit; font-size: 12px;
      line-height: 1.2; padding: 6px 10px; cursor: pointer; white-space: nowrap;
    }
    .step:first-child, .arrow:first-child { border-radius: 4px 0 0 4px; }
    .terminal { border-radius: 0 4px 4px 0; margin-left: 8px; border-radius: 4px; }
    .step + .step, .arrow + .step, .step + .arrow { margin-left: -1px; }
    .step.done { background: #e7eef2; color: #1d4f63; }
    .step.now, .terminal.now { background: #1d4f63; color: #fff; border-color: #1d4f63; font-weight: 650; }
    .step:disabled, .arrow:disabled, .terminal:disabled { cursor: default; }
    .mark { font-weight: 700; margin-right: 4px; }
    .menu {
      position: absolute; z-index: 6; top: calc(100% + 4px); right: 0; min-width: 280px; max-height: 320px;
      overflow: auto; background: #fff; border: 1px solid #d5dee6; border-radius: 6px;
      box-shadow: 0 8px 24px rgba(16, 42, 67, .16); padding: 4px;
    }
    .menu button {
      display: block; width: 100%; text-align: left; border: 0; background: transparent;
      padding: 6px 8px; font: inherit; font-size: 13px; border-radius: 4px; cursor: pointer;
    }
    .menu button:hover { background: #f3f6f8; }
    .parallel { margin-top: 2px; }
    .parallel .step:last-child { border-radius: 0 4px 4px 0; }
  `,
})
export class FunnelBarComponent {
  readonly stage = input('');
  readonly parallel = input('');
  readonly group = input<number | null>(null);
  readonly canChange = input(false);
  readonly stageChange = output<string>();
  readonly parallelChange = output<string>();
  protected readonly menu = signal<'' | 'before' | 'after' | 'terminal'>('');

  protected readonly current = computed(() => funnelId(this.stage()));
  protected readonly currentRank = computed(() => FUNNEL_CHAIN.findIndex((item) => item.id === this.current()));
  protected readonly terminal = computed(() => this.current() === 'impossible' || this.current() === 'writeoff');
  protected readonly showParallel = computed(() => (this.group() || 0) >= 4);

  protected readonly window = computed(() => {
    const chain = FUNNEL_CHAIN;
    let index = this.currentRank();
    if (index < 0) index = chain.length - 1;
    const start = Math.max(0, Math.min(index - 1, chain.length - 4));
    return chain.slice(start, start + 4);
  });

  protected readonly hiddenBefore = computed(() => {
    const first = this.window()[0];
    const cut = FUNNEL_CHAIN.findIndex((item) => item.id === first?.id);
    return cut > 0 ? FUNNEL_CHAIN.slice(0, cut) : [];
  });

  protected readonly hiddenAfter = computed(() => {
    const shown = this.window();
    const last = shown[shown.length - 1];
    const cut = FUNNEL_CHAIN.findIndex((item) => item.id === last?.id);
    return cut >= 0 ? FUNNEL_CHAIN.slice(cut + 1) : [];
  });

  protected readonly menuStages = computed(() => {
    if (this.menu() === 'before') return this.hiddenBefore();
    if (this.menu() === 'after') return this.hiddenAfter();
    if (this.menu() === 'terminal') return FUNNEL_TERMINAL;
    return [];
  });

  protected rank(stage: FunnelStage): number {
    return FUNNEL_CHAIN.findIndex((item) => item.id === stage.id);
  }

  protected terminalLabel(): string {
    if (this.current() === 'impossible') return 'E13 Невозможность';
    if (this.current() === 'writeoff') return 'E14 Списание';
    return 'E13 / E14';
  }

  protected terminalTitle(): string {
    if (this.current() === 'impossible') return 'Невозможность взыскания';
    if (this.current() === 'writeoff') return 'Подготовка документов о списании безнадежной задолженности';
    return 'Невозможность взыскания или списание';
  }

  protected pick(stage: string): void {
    this.menu.set('');
    if (!this.canChange() || funnelId(stage) === this.current()) return;
    this.stageChange.emit(stage);
  }
}
