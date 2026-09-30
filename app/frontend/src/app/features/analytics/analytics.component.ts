import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DebtCharts } from '../../core/models';

type Mode = 'bar' | 'line' | 'pie';

interface StageBar {
  code: string;
  title: string;
  lines: string[];
  cases: number;
  principal: number;
  penalty: number;
  total: number;
  x: number;
  width: number;
  yPrincipal: number;
  hPrincipal: number;
  yPenalty: number;
  hPenalty: number;
  dark: string;
  light: string;
}

interface PieSlice {
  title: string;
  color: string;
  cases: number;
  amount: number;
  casesShare: number;
  amountShare: number;
  casesPath: string;
  amountPath: string;
  casesLabel: { x: number; y: number; text: string } | null;
  amountLabel: { x: number; y: number; text: string } | null;
}

interface LinePoint {
  label: string;
  cases: number;
  total: number;
  penalty: number;
  x: number;
  yTotal: number;
  yPenalty: number;
  penaltyBelow: boolean;
}

const STAGE_FILL: Record<string, [string, string]> = {
  new: ['#2e7d32', '#9ccc9c'],
  prevention: ['#1d4f63', '#8eb4c6'],
  warning: ['#c49a2c', '#f0d59a'],
  disconnect: ['#c4a36a', '#ead7b0'],
  enforcement: ['#a33b32', '#e4b4ae'],
  court: ['#7a2e2a', '#d7aaa4'],
  closed: ['#607d8b', '#cfd8dc'],
};

const GROUP_COLORS = ['#2e7d32', '#1d4f63', '#d4a017', '#c0392b', '#6d28d9', '#546e7a'];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

@Component({
  selector: 'app-analytics',
  standalone: true,
  template: `
    <div class="charts">
      <div class="toolbar">
        <div class="modes" role="group" aria-label="Вид диаграммы">
          <button type="button" [class.on]="mode() === 'bar'" (click)="mode.set('bar')">Столбчатая</button>
          <button type="button" [class.on]="mode() === 'line'" (click)="mode.set('line')">Линейная</button>
          <button type="button" [class.on]="mode() === 'pie'" (click)="mode.set('pie')">Круговая</button>
        </div>
        <button type="button" class="export" (click)="exportCsv()" [disabled]="!chart()">Экспорт CSV</button>
      </div>

      @if (error()) { <p class="error">{{ error() }}</p> }
      @if (loading()) { <p class="muted">Считаю сводку…</p> }

      @if (chart(); as data) {
        <section class="surface panel">
          <h3>{{ heading() }}</h3>
          <p class="sub">{{ subtitle() }}</p>

          @if (data.cases === 0) {
            <p class="empty">В контуре нет лицевых счетов.</p>
          } @else if (mode() === 'bar') {
            <div class="legend-row">
              <span><i class="swatch dark"></i> Насыщенная часть столбца — основной долг</span>
              <span><i class="swatch light"></i> Светлая часть — пеня</span>
            </div>
            <svg [attr.viewBox]="'0 0 ' + bar().width + ' ' + bar().height" role="img" [attr.aria-label]="heading()">
              <text class="axis-name" x="8" y="16">{{ bar().unitLabel }}</text>
              @for (tick of bar().ticks; track tick.y) {
                <line [attr.x1]="bar().left" [attr.x2]="bar().width - 12" [attr.y1]="tick.y" [attr.y2]="tick.y" class="grid" />
                <text class="tick" [attr.x]="bar().left - 8" [attr.y]="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
              }
              @for (item of bar().bars; track item.code) {
                @if (item.hPrincipal > 0) {
                  <rect [attr.x]="item.x" [attr.y]="item.yPrincipal" [attr.width]="item.width" [attr.height]="item.hPrincipal" [attr.fill]="item.dark" />
                }
                @if (item.hPenalty > 0) {
                  <rect [attr.x]="item.x" [attr.y]="item.yPenalty" [attr.width]="item.width" [attr.height]="item.hPenalty" [attr.fill]="item.light" />
                }
                <text class="bar-count" [attr.x]="item.x + item.width / 2" [attr.y]="item.yPenalty - 18" text-anchor="middle">{{ item.cases }} дел</text>
                <text class="bar-total" [attr.x]="item.x + item.width / 2" [attr.y]="item.yPenalty - 4" text-anchor="middle">{{ axisValue(item.total, bar().unit) }}</text>
                @for (line of item.lines; track line; let i = $index) {
                  <text class="bar-name" [attr.x]="item.x + item.width / 2" [attr.y]="bar().baseline + 18 + i * 14" text-anchor="middle">{{ line }}</text>
                }
              }
            </svg>
          } @else if (mode() === 'pie') {
            @if (slices().length === 0) {
              <p class="empty">Нет дел с группой задолженности.</p>
            } @else {
              <div class="pie-layout">
                <svg viewBox="0 0 640 340" role="img" aria-label="Распределение по группам">
                  @for (slice of slices(); track slice.title) {
                    @if (slice.casesPath) {
                      <path [attr.d]="slice.casesPath" [attr.fill]="slice.color" />
                    }
                    @if (slice.amountPath) {
                      <path [attr.d]="slice.amountPath" [attr.fill]="slice.color" />
                    }
                    @if (slice.casesLabel) {
                      <text class="pie-label" [attr.x]="slice.casesLabel.x" [attr.y]="slice.casesLabel.y" text-anchor="middle">{{ slice.casesLabel.text }}</text>
                    }
                    @if (slice.amountLabel) {
                      <text class="pie-label" [attr.x]="slice.amountLabel.x" [attr.y]="slice.amountLabel.y" text-anchor="middle">{{ slice.amountLabel.text }}</text>
                    }
                  }
                  <text class="pie-caption" x="160" y="312" text-anchor="middle">Количество дел</text>
                  <text class="pie-total" x="160" y="328" text-anchor="middle">{{ data.cases }} дел</text>
                  <text class="pie-caption" x="460" y="312" text-anchor="middle">Сумма задолженности (с пеней)</text>
                  <text class="pie-total" x="460" y="328" text-anchor="middle">{{ money(totalAmount()) }}</text>
                </svg>
                <ul class="legend">
                  @for (slice of slices(); track slice.title) {
                    <li>
                      <i [style.background]="slice.color"></i>
                      <span>{{ slice.title }}</span>
                      <b>{{ slice.cases }} дел</b>
                      <b>{{ money(slice.amount) }}</b>
                    </li>
                  }
                </ul>
              </div>
            }
          } @else {
            <div class="legend-row">
              <span><i class="swatch dark"></i> Задолженность всего (с пеней)</span>
              <span><i class="swatch penalty"></i> в т.ч. пеня</span>
            </div>
            @if (data.monthsSource === 'current') {
              <p class="hint">Истории сумм по периодам ещё нет: на графике текущий срез.</p>
            }
            <svg [attr.viewBox]="'0 0 ' + line().width + ' ' + line().height" role="img" [attr.aria-label]="heading()">
              <text class="axis-name" x="8" y="16">{{ line().unitLabel }}</text>
              @for (tick of line().ticks; track tick.y) {
                <line [attr.x1]="line().left" [attr.x2]="line().width - 16" [attr.y1]="tick.y" [attr.y2]="tick.y" class="grid" />
                <text class="tick" [attr.x]="line().left - 8" [attr.y]="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
              }
              <polyline [attr.points]="line().totalPoints" class="series total" />
              <polyline [attr.points]="line().penaltyPoints" class="series penalty" />
              @for (point of line().points; track point.label) {
                <circle [attr.cx]="point.x" [attr.cy]="point.yTotal" r="4.5" class="dot total" />
                <circle [attr.cx]="point.x" [attr.cy]="point.yPenalty" r="4.5" class="dot penalty" />
                <text class="point" [attr.x]="point.x" [attr.y]="point.yTotal - 10" text-anchor="middle">{{ axisValue(point.total, line().unit) }}</text>
                <text class="point penalty" [attr.x]="point.x" [attr.y]="point.penaltyBelow ? point.yPenalty + 16 : point.yPenalty - 10" text-anchor="middle">{{ axisValue(point.penalty, line().unit) }}</text>
                <text class="bar-name" [attr.x]="point.x" [attr.y]="line().baseline + 20" text-anchor="middle">{{ point.label }}</text>
                <text class="tick" [attr.x]="point.x" [attr.y]="line().baseline + 36" text-anchor="middle">{{ point.cases }} дел</text>
              }
            </svg>
          }
        </section>
      }
    </div>
  `,
  styles: `
    h3 { margin: 0 0 4px; font-size: 16px; color: #1f2933; }
    .toolbar { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; flex-wrap: wrap; }
    .modes { display: flex; background: #fff; border: 1px solid var(--erip-border); border-radius: 8px; overflow: hidden; }
    .modes button, .export {
      border: 0; background: transparent; padding: 8px 14px; cursor: pointer; color: var(--erip-muted); font: inherit;
    }
    .modes button.on { color: var(--erip-primary); font-weight: 600; box-shadow: inset 0 -2px 0 var(--erip-primary); }
    .export { border: 1px solid var(--erip-border); border-radius: 8px; background: #fff; color: var(--erip-primary); }
    .export:disabled { opacity: .5; cursor: default; }
    .panel { padding: 16px 18px 8px; }
    .sub, .hint, .empty { color: var(--erip-muted); margin: 0 0 12px; font-size: 13px; }
    .error { color: var(--erip-danger); }
    .legend-row { display: flex; gap: 18px; flex-wrap: wrap; font-size: 13px; color: #425466; margin-bottom: 8px; }
    .swatch { display: inline-block; width: 14px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
    .swatch.dark { background: var(--erip-primary); }
    .swatch.light { background: #d5e4ec; }
    .swatch.penalty { background: #c0392b; }
    svg { width: 100%; height: auto; }
    .grid { stroke: #e6edf2; stroke-width: 1; }
    .tick { font-size: 11px; fill: var(--erip-muted); }
    .axis-name { font-size: 11px; fill: var(--erip-muted); }
    .bar-count { font-size: 11px; fill: #607d8b; }
    .bar-total { font-size: 13px; font-weight: 700; fill: #1f2933; }
    .bar-name { font-size: 11px; fill: #334e68; }
    .pie-layout { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 8px; align-items: center; }
    .pie-label { font-size: 13px; font-weight: 700; fill: #fff; }
    .pie-caption { font-size: 13px; fill: #334e68; }
    .pie-total { font-size: 12px; fill: var(--erip-muted); }
    .legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .legend li { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto auto; gap: 8px; align-items: center; font-size: 13px; }
    .legend i { width: 14px; height: 14px; border-radius: 3px; }
    .legend b { font-weight: 600; color: #334e68; white-space: nowrap; }
    .series { fill: none; stroke-width: 2.5; }
    .series.total, .dot.total { stroke: var(--erip-primary); }
    .series.penalty, .dot.penalty { stroke: #c0392b; }
    .dot { fill: #fff; stroke-width: 2.5; }
    .point { font-size: 11px; fill: var(--erip-primary); font-weight: 600; }
    .point.penalty { fill: #c0392b; }
    @media (max-width: 900px) {
      .pie-layout { grid-template-columns: 1fr; }
    }
  `,
})
export class AnalyticsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  protected readonly mode = signal<Mode>('bar');
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly chart = signal<ParsedCharts | null>(null);

  protected readonly heading = computed(() => {
    if (this.mode() === 'pie') return 'Распределение дел и суммы задолженности по группам';
    if (this.mode() === 'line') return 'Динамика задолженности по месяцам';
    return 'Задолженность по этапам воронки взыскания';
  });

  protected readonly subtitle = computed(() => {
    const data = this.chart();
    if (!data) return '';
    const org = this.auth.me()?.organization_name || 'все схемы';
    const when = ruDate(data.asOf);
    if (this.mode() === 'line') {
      const note = data.monthsSource === 'current'
        ? 'текущий срез'
        : `${monthLabel(data.months[0]?.period)} – ${monthLabel(data.months[data.months.length - 1]?.period)}`;
      return `Все группы · ${org} · ${note} · под осью — число дел`;
    }
    const total = data.principal + data.penalty;
    return `Все группы · ${org} · по состоянию на ${when} · ${data.cases} дел на сумму ${rub(total)} (в т.ч. пеня ${rub(data.penalty)})`;
  });

  protected readonly bar = computed(() => buildBars(this.chart()?.stages ?? []));
  protected readonly slices = computed(() => buildPies(this.chart()?.groups ?? []));
  protected readonly line = computed(() => buildLine(this.chart()?.months ?? []));
  protected readonly totalAmount = computed(() => {
    const data = this.chart();
    return data ? data.principal + data.penalty : 0;
  });

  ngOnInit(): void {
    this.api.charts().subscribe({
      next: (payload) => {
        this.chart.set(parseCharts(payload));
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(errorMessage(err));
        this.loading.set(false);
      },
    });
  }

  protected money(value: number): string {
    return money(value);
  }

  protected axisValue(value: number, unit: number): string {
    return axisValue(value, unit);
  }

  protected exportCsv(): void {
    const data = this.chart();
    if (!data) return;
    const lines = csvLines(this.mode(), data);
    const blob = new Blob([`\ufeff${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `analytics-${this.mode()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
}

interface ParsedStage {
  code: string;
  title: string;
  cases: number;
  principal: number;
  penalty: number;
}

interface ParsedGroup {
  title: string;
  cases: number;
  principal: number;
  penalty: number;
}

interface ParsedMonth {
  period: string;
  cases: number;
  principal: number;
  penalty: number;
}

interface ParsedCharts {
  asOf: string;
  cases: number;
  principal: number;
  penalty: number;
  monthsSource: 'history' | 'current';
  stages: ParsedStage[];
  groups: ParsedGroup[];
  months: ParsedMonth[];
}

function num(value: string): number {
  return Number(value) || 0;
}

function parseCharts(payload: DebtCharts): ParsedCharts {
  return {
    asOf: payload.as_of,
    cases: payload.cases,
    principal: num(payload.principal),
    penalty: num(payload.penalty),
    monthsSource: payload.months_source,
    stages: payload.stages.map((row) => ({
      code: row.code, title: row.title, cases: row.cases, principal: num(row.principal), penalty: num(row.penalty),
    })),
    groups: payload.groups.map((row) => ({
      title: row.title, cases: row.cases, principal: num(row.principal), penalty: num(row.penalty),
    })),
    months: payload.months.map((row) => ({
      period: row.period, cases: row.cases, principal: num(row.principal), penalty: num(row.penalty),
    })),
  };
}

function ruDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

function monthLabel(iso: string | undefined): string {
  if (!iso) return '';
  const month = Number(iso.slice(5, 7));
  const name = MONTHS[(month || 1) - 1] ?? '';
  return `${name} ${iso.slice(0, 4)}`;
}

function rub(value: number): string {
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} р.`;
}

function money(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} тыс. р.`;
  }
  return rub(value);
}

function axisValue(value: number, unit: number): string {
  const shown = value / unit;
  return shown.toLocaleString('ru-RU', { maximumFractionDigits: shown >= 100 ? 0 : 1 });
}

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const n = max / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * pow;
}

function scaleOf(max: number): { axisMax: number; unit: number; unitLabel: string } {
  const unit = max >= 1000 ? 1000 : 1;
  return {
    axisMax: niceMax(max / unit) * unit,
    unit,
    unitLabel: unit === 1000 ? 'тыс. р.' : 'р.',
  };
}

function ticksOf(axisMax: number, unit: number, top: number, plotH: number): { y: number; label: string }[] {
  return [0, 0.25, 0.5, 0.75, 1].map((part) => ({
    y: top + plotH * (1 - part),
    label: axisValue(axisMax * part, unit),
  }));
}

function wrapTitle(title: string): string[] {
  if (title.length <= 16) return [title];
  const parts = title.split(' ');
  if (parts.length < 2) return [title];
  const mid = Math.ceil(parts.length / 2);
  return [parts.slice(0, mid).join(' '), parts.slice(mid).join(' ')];
}

function buildBars(stages: ParsedStage[]): { width: number; height: number; left: number; plotTop: number; baseline: number; unit: number; unitLabel: string; ticks: { y: number; label: string }[]; bars: StageBar[] } {
  const width = 920;
  const height = 420;
  const left = 64;
  const plotTop = 36;
  const baseline = 320;
  const plotH = baseline - plotTop;
  const max = Math.max(0, ...stages.map((row) => row.principal + row.penalty));
  const { axisMax, unit, unitLabel } = scaleOf(max);
  const step = stages.length ? (width - left - 24) / stages.length : 0;
  const barWidth = Math.min(64, step * 0.62);
  const bars = stages.map((row, index) => {
    const total = row.principal + row.penalty;
    const hPrincipal = axisMax ? (row.principal / axisMax) * plotH : 0;
    const hPenalty = axisMax ? (row.penalty / axisMax) * plotH : 0;
    const yPrincipal = baseline - hPrincipal;
    const [dark, light] = STAGE_FILL[row.code] ?? ['#607d8b', '#cfd8dc'];
    return {
      ...row,
      lines: wrapTitle(row.title),
      total,
      x: left + index * step + (step - barWidth) / 2,
      width: barWidth,
      yPrincipal,
      hPrincipal,
      yPenalty: yPrincipal - hPenalty,
      hPenalty,
      dark,
      light,
    };
  });
  return { width, height, left, plotTop, baseline, unit, unitLabel, ticks: ticksOf(axisMax, unit, plotTop, plotH), bars };
}

function buildPies(groups: ParsedGroup[]): PieSlice[] {
  const casesTotal = groups.reduce((sum, row) => sum + row.cases, 0);
  const amountTotal = groups.reduce((sum, row) => sum + row.principal + row.penalty, 0);
  let casesAngle = -Math.PI / 2;
  let amountAngle = -Math.PI / 2;
  return groups.map((row, index) => {
    const amount = row.principal + row.penalty;
    const casesShare = casesTotal ? row.cases / casesTotal : 0;
    const amountShare = amountTotal ? amount / amountTotal : 0;
    const casesEnd = casesAngle + casesShare * Math.PI * 2;
    const amountEnd = amountAngle + amountShare * Math.PI * 2;
    const slice: PieSlice = {
      title: row.title,
      color: GROUP_COLORS[index % GROUP_COLORS.length],
      cases: row.cases,
      amount,
      casesShare,
      amountShare,
      casesPath: casesShare ? piePath(160, 150, 110, casesAngle, casesEnd) : '',
      amountPath: amountShare ? piePath(460, 150, 110, amountAngle, amountEnd) : '',
      casesLabel: labelAt(160, 150, 70, casesAngle, casesEnd, casesShare),
      amountLabel: labelAt(460, 150, 70, amountAngle, amountEnd, amountShare),
    };
    casesAngle = casesEnd;
    amountAngle = amountEnd;
    return slice;
  });
}

function piePath(cx: number, cy: number, r: number, start: number, end: number): string {
  if (end - start >= Math.PI * 2 - 0.001) {
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy}`;
  }
  const x1 = cx + r * Math.cos(start);
  const y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end);
  const y2 = cy + r * Math.sin(end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

function labelAt(cx: number, cy: number, r: number, start: number, end: number, share: number): { x: number; y: number; text: string } | null {
  if (share < 0.06) return null;
  const mid = (start + end) / 2;
  return {
    x: cx + r * Math.cos(mid),
    y: cy + r * Math.sin(mid) + 4,
    text: `${(share * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`,
  };
}

function buildLine(months: ParsedMonth[]): { width: number; height: number; left: number; plotTop: number; baseline: number; unit: number; unitLabel: string; ticks: { y: number; label: string }[]; points: LinePoint[]; totalPoints: string; penaltyPoints: string } {
  const width = 920;
  const height = 400;
  const left = 64;
  const plotTop = 28;
  const baseline = 300;
  const plotH = baseline - plotTop;
  const max = Math.max(0, ...months.map((row) => row.principal + row.penalty));
  const { axisMax, unit, unitLabel } = scaleOf(max);
  const plotW = width - left - 28;
  const points = months.map((row, index) => {
    const x = months.length === 1 ? left + plotW / 2 : left + (plotW * index) / (months.length - 1);
    const total = row.principal + row.penalty;
    const yTotal = baseline - (total / axisMax) * plotH;
    const yPenalty = baseline - (row.penalty / axisMax) * plotH;
    return {
      label: monthLabel(row.period),
      cases: row.cases,
      total,
      penalty: row.penalty,
      x,
      yTotal,
      yPenalty,
      penaltyBelow: Math.abs(yTotal - yPenalty) < 18,
    };
  });
  const join = (pick: (point: LinePoint) => number) => points.map((point) => `${point.x},${pick(point)}`).join(' ');
  return {
    width, height, left, plotTop, baseline, unit, unitLabel,
    ticks: ticksOf(axisMax, unit, plotTop, plotH),
    points,
    totalPoints: join((point) => point.yTotal),
    penaltyPoints: join((point) => point.yPenalty),
  };
}

function csvLines(mode: Mode, data: ParsedCharts): string[] {
  const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const row = (values: (string | number)[]) => values.map(cell).join(';');
  if (mode === 'pie') {
    const amountTotal = data.groups.reduce((sum, item) => sum + item.principal + item.penalty, 0);
    const casesTotal = data.groups.reduce((sum, item) => sum + item.cases, 0);
    return [
      row(['Группа', 'Дел', 'Доля дел', 'Сумма', 'Доля суммы']),
      ...data.groups.map((item) => {
        const amount = item.principal + item.penalty;
        return row([
          item.title,
          item.cases,
          casesTotal ? (item.cases / casesTotal).toFixed(3) : 0,
          amount.toFixed(2),
          amountTotal ? (amount / amountTotal).toFixed(3) : 0,
        ]);
      }),
    ];
  }
  if (mode === 'line') {
    return [
      row(['Период', 'Дел', 'Задолженность', 'Пеня']),
      ...data.months.map((item) => row([item.period, item.cases, (item.principal + item.penalty).toFixed(2), item.penalty.toFixed(2)])),
    ];
  }
  return [
    row(['Этап', 'Дел', 'Основной долг', 'Пеня']),
    ...data.stages.map((item) => row([item.title, item.cases, item.principal.toFixed(2), item.penalty.toFixed(2)])),
  ];
}
