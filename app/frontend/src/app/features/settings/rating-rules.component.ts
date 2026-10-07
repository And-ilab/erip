import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';

import { ApiService, DebtGroupBand, ScenarioRuleRow, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DialSettings } from '../../core/models';

@Component({
  selector: 'app-rating-rules',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatSnackBarModule],
  template: `
    <p class="crumb">Настройка · Правила присвоения рейтинга и группы задолженности</p>
    <div class="rules">
      <section class="card">
        <h2>Группы задолженности</h2>
        <p class="muted">Границы групп по давности долга. Пересчёт выполняется при каждом обновлении данных из АИС «Расчет-ЖКУ». Изменение границ применяется со следующего регламентного пересчёта. Шкала — группы 1–6.</p>
        <table>
          <thead>
            <tr><th>Группа</th><th>Просрочка от</th><th>Просрочка до</th><th>Базовый сценарий</th></tr>
          </thead>
          <tbody>
            @for (band of bands(); track band.group) {
              <tr>
                <td><span [class]="'g-pill g' + band.group">Группа {{ band.group }}</span></td>
                <td>
                  @if (editable()) {
                    <input class="cell" type="number" [(ngModel)]="band.months_from" [name]="'from' + band.group" />
                  } @else {
                    {{ span(band.months_from) }}
                  }
                </td>
                <td>
                  @if (editable()) {
                    <input class="cell" type="number" [(ngModel)]="band.months_to" [name]="'to' + band.group" placeholder="без огран." />
                  } @else {
                    {{ band.months_to == null ? 'без огран.' : span(band.months_to) }}
                  }
                </td>
                <td>
                  @if (editable()) {
                    <input class="wide" [(ngModel)]="names[band.group]" [name]="'scenario' + band.group" />
                  } @else {
                    {{ names[band.group] }}
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
        <h3>Детализация длинной просрочки</h3>
        <mat-checkbox [checked]="splitLongDebt()" disabled>Выделять подгруппы «6–12 месяцев» и «свыше 12 месяцев» (для отчётности и сценариев)</mat-checkbox>
        <h3>Прочее</h3>
        <mat-checkbox [checked]="false" disabled>Разрешить локальную корректировку границ по решению Заказчика</mat-checkbox>
        <mat-checkbox [checked]="false" disabled>Учитывать частичную оплату как прерывание просрочки</mat-checkbox>
        <p class="muted">Границы групп сохраняет суперадминистратор. Частичная оплата пересчитывает группу по остаткам периодов и оставляет срок по непогашенному периоду.</p>
      </section>

      <section class="card">
        <h2>Правила рейтинга должника</h2>
        <p class="muted">Рейтинг рассчитывается по всем ЛС и договорам должника и отображается в реестрах, карточках и на канбан-доске. Буквы A–E: нормальный, уязвимый, негативный, критический, безнадёжный.</p>
        <table class="letters">
          <thead><tr><th>Рейтинг</th><th>Условие присвоения</th></tr></thead>
          <tbody>
            @for (row of letters(); track row.letter) {
              <tr>
                <td><span [class]="'rating-badge r' + row.letter">{{ row.letter }}</span></td>
                <td><strong>{{ row.title }}</strong> — {{ row.text }}</td>
              </tr>
            }
          </tbody>
        </table>
        @if (editable()) {
          <div class="thresholds">
            <label>B с группы <input type="number" [(ngModel)]="ratingB" name="ratingB" /></label>
            <label>C с группы <input type="number" [(ngModel)]="ratingCFrom" name="ratingCFrom" /></label>
            <label>C по группу <input type="number" [(ngModel)]="ratingCTo" name="ratingCTo" /></label>
            <label>E с группы <input type="number" [(ngModel)]="ratingE" name="ratingE" /></label>
          </div>
        }
        <h3>Отягчающие обстоятельства (для рейтинга D)</h3>
        <mat-checkbox [checked]="true" disabled>Не занят в экономике (данные регистрации)</mat-checkbox>
        <mat-checkbox [checked]="true" disabled>Юридическое лицо в стадии банкротства / ликвидации</mat-checkbox>
        <mat-checkbox [checked]="false" disabled>Повторная устойчивая просрочка в течение периода рейтинга</mat-checkbox>
        <mat-checkbox [checked]="false" disabled>Открытое наследственное дело</mat-checkbox>
        <mat-checkbox [checked]="false" disabled>Отказ нотариуса по предыдущей исполнительной надписи</mat-checkbox>
        <p class="muted">Подрейтинг считает входы в ту же букву за период рейтинга. Наследственное дело останавливает автомеры и букву не меняет.</p>
        <h3>Применение</h3>
        <mat-checkbox [checked]="true" disabled>Пересчитывать рейтинг при каждом обновлении задолженности</mat-checkbox>
        <mat-checkbox [checked]="true" disabled>Фиксировать историю изменений рейтинга в карточке</mat-checkbox>
        @if (editable()) {
          <mat-checkbox [(ngModel)]="applyRecorded" name="applyRecorded">Применить новые пороги к уже рассчитанным текущим значениям</mat-checkbox>
          <div class="actions">
            <button mat-flat-button color="primary" (click)="save()" [disabled]="busy()">Сохранить</button>
            <button mat-stroked-button (click)="load()" [disabled]="busy()">Отмена</button>
          </div>
        }
      </section>
    </div>
  `,
  styles: `
    .crumb { margin: 0 0 12px; color: var(--erip-muted); }
    .rules { display: grid; grid-template-columns: 1.05fr .95fr; gap: 16px; align-items: start; }
    .card {
      background: #fff; border: 1px solid var(--erip-border); border-radius: 12px; padding: 16px 18px;
      display: flex; flex-direction: column; gap: 8px;
    }
    h2, h3 { margin: 0; color: var(--erip-primary-dark); }
    h3 { margin-top: 8px; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: var(--erip-muted); }
    .muted { margin: 0; color: var(--erip-muted); font-size: 13px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--erip-border); font-size: 13px; vertical-align: middle; }
    th { color: var(--erip-muted); font-weight: 600; }
    .g-pill {
      display: inline-block; padding: 2px 10px; border-radius: 999px; font-weight: 700; font-size: 12px; white-space: nowrap;
      &.g1 { background: #dcfce7; color: #166534; }
      &.g2 { background: #ecfccb; color: #3f6212; }
      &.g3 { background: #fef9c3; color: #854d0e; }
      &.g4 { background: #ffedd5; color: #9a3412; }
      &.g5 { background: #fee2e2; color: #991b1b; }
      &.g6 { background: #fecaca; color: #7f1d1d; }
    }
    input.cell, .thresholds input, input.wide {
      border: 1px solid var(--erip-border); border-radius: 8px; padding: 6px 8px; font: inherit; background: #fff;
    }
    input.cell, .thresholds input { width: 72px; }
    input.wide { width: 100%; box-sizing: border-box; }
    .thresholds { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; }
    .thresholds label { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--erip-muted); }
    .actions { display: flex; gap: 8px; margin-top: 8px; }
    @media (max-width: 1100px) { .rules { grid-template-columns: 1fr; } }
  `,
})
export class RatingRulesComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly snack = inject(MatSnackBar);
  protected readonly auth = inject(AuthService);

  protected readonly bands = signal<DebtGroupBand[]>([]);
  protected readonly busy = signal(false);
  protected names: Record<number, string> = {};
  protected ruleIds: Record<number, number> = {};
  protected ratingB = 3;
  protected ratingCFrom = 4;
  protected ratingCTo = 5;
  protected ratingE = 6;
  protected applyRecorded = false;

  ngOnInit(): void {
    this.load();
  }

  protected editable(): boolean {
    return this.auth.isSuperadmin();
  }

  protected span(value: number): string {
    return `${Number(value)} мес.`;
  }

  protected splitLongDebt(): boolean {
    const fourth = this.bands().find((band) => band.group === 4);
    const fifth = this.bands().find((band) => band.group === 5);
    return Boolean(fourth && fifth && fourth.months_to != null && Number(fifth.months_from) >= Number(fourth.months_to));
  }

  protected letters(): { letter: string; title: string; text: string }[] {
    const b = Number(this.ratingB);
    const cFrom = Number(this.ratingCFrom);
    const cTo = Number(this.ratingCTo);
    const e = Number(this.ratingE);
    return [
      { letter: 'A', title: 'Нормальный', text: `нет устойчивой просрочки (группы младше ${b})` },
      { letter: 'B', title: 'Уязвимый', text: `устойчивая просрочка группы ${b}` },
      { letter: 'C', title: 'Негативный', text: `группы ${cFrom}–${cTo}` },
      { letter: 'D', title: 'Критический', text: `группы ${cFrom}–${cTo} и отягчающие обстоятельства` },
      { letter: 'E', title: 'Безнадёжный', text: `группа ${e} и старше` },
    ];
  }

  protected load(): void {
    this.applyRecorded = false;
    forkJoin({
      groups: this.api.debtGroups(),
      rules: this.api.scenarioRules(),
      dial: this.api.dialSettings(),
    }).subscribe({
      next: ({ groups, rules, dial }) => {
        this.bands.set(groups.results.map((band) => ({ ...band })));
        this.names = {};
        this.ruleIds = {};
        for (const band of groups.results) this.names[band.group] = '';
        this.readRules(rules.results);
        this.readRating(dial);
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected save(): void {
    if (!this.editable()) return;
    const bands = this.bands().map((band) => ({
      ...band,
      months_from: Number(band.months_from),
      months_to: band.months_to === null || band.months_to === undefined || String(band.months_to) === ''
        ? null
        : Number(band.months_to),
    }));
    for (const band of bands) {
      if (!(this.names[band.group] || '').trim()) {
        this.snack.open(`Укажите базовый сценарий группы ${band.group}`, 'OK');
        return;
      }
    }
    this.busy.set(true);
    this.api.saveDebtGroups(bands).subscribe({
      next: (saved) => {
        this.bands.set(saved.map((band) => ({ ...band })));
        this.saveRules(saved);
      },
      error: (err) => {
        this.busy.set(false);
        this.snack.open(errorMessage(err), 'OK');
      },
    });
  }

  private saveRules(bands: DebtGroupBand[]): void {
    const calls = bands.map((band) => {
      const name = this.names[band.group].trim();
      const id = this.ruleIds[band.group];
      return id
        ? this.api.saveScenarioRule({ id, group: band.group, name })
        : this.api.saveScenarioRule({ group: band.group, name });
    });
    if (!calls.length) {
      this.saveRating();
      return;
    }
    forkJoin(calls).subscribe({
      next: (saved: ScenarioRuleRow[]) => {
        this.readRules(saved);
        this.saveRating();
      },
      error: (err) => {
        this.busy.set(false);
        this.snack.open(errorMessage(err), 'OK');
      },
    });
  }

  private saveRating(): void {
    this.api.saveDialSettings({
      rating_b_group: Number(this.ratingB),
      rating_c_from: Number(this.ratingCFrom),
      rating_c_to: Number(this.ratingCTo),
      rating_e_from: Number(this.ratingE),
      apply_recorded: this.applyRecorded,
    } as Partial<DialSettings>).subscribe({
      next: (row) => {
        this.readRating(row);
        this.applyRecorded = false;
        this.busy.set(false);
        this.snack.open('Правила рейтинга и групп сохранены', 'OK', { duration: 2500 });
      },
      error: (err) => {
        this.busy.set(false);
        this.snack.open(errorMessage(err), 'OK');
      },
    });
  }

  private readRules(rows: ScenarioRuleRow[]): void {
    for (const row of rows) {
      if (row.category) continue;
      this.names[row.group] = row.name;
      if (row.id) this.ruleIds[row.group] = row.id;
    }
  }

  private readRating(row: DialSettings): void {
    this.ratingB = row.rating_b_group ?? 3;
    this.ratingCFrom = row.rating_c_from ?? 4;
    this.ratingCTo = row.rating_c_to ?? 5;
    this.ratingE = row.rating_e_from ?? 6;
  }
}
