import {
  AfterViewInit, ChangeDetectorRef, Component, ElementRef, Input, NgZone, OnChanges, OnDestroy, inject, signal, viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { BlankPenaltyRow, BlankPeriodPair, BlankResident } from '../../core/api.service';

const LOCKED = new Set([
  'fio', 'address', 'account', 'amount', 'penalty', 'principal', 'total', 'services',
  'due_days', 'months_debt', 'as_of', 'due_date', 'area', 'living_area', 'rooms',
  'residents_count', 'registered_count', 'tenants', 'beneficiaries', 'ownership',
  'duty_from', 'unp', 'bank', 'bik', 'bank_account', 'debt_started', 'address_org',
]);

@Component({
  selector: 'app-official-sheet',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet],
  template: `
    <div class="desk" #desk>
      <div class="stage" [style.width.px]="stageWidth()" [style.height.px]="stageHeight()">
        <div class="clip">
          <article
            class="a4" #page
            [class.warning]="family === 'warning'"
            [class.notice]="family === 'notice'"
            [class.reminder]="family === 'reminder'"
            [class.calculation]="family === 'calculation'"
            [style.transform]="'scale(' + scale() + ')'">
            @if (family === 'warning') {
              <header class="letterhead">
                <div>{{ copy['country'] }}</div>
                <div class="org"><ng-container *ngTemplateOutlet="slot; context: { $implicit: 'organization' }" /></div>
                <div><ng-container *ngTemplateOutlet="slot; context: { $implicit: 'locality' }" /></div>
              </header>
              <p class="meta"><ng-container *ngTemplateOutlet="slot; context: { $implicit: 'date' }" />, № <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'doc_number' }" /></p>
              <p class="addressee">
                {{ copy['addressee_prefix'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'fio' }" />,<br />
                {{ copy['living'] }}<br />
                <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'address' }" />
              </p>
              <h1>{{ copy['title'] }}</h1>
              <p>
                {{ copy['before_amount'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'amount' }" />
                {{ copy['after_amount'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'due_days' }" />
                {{ copy['after_days'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'services' }" />
                {{ copy['law'] }}
              </p>
              <p>
                {{ copy['p2_before'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'organization' }" />
                {{ copy['p2_after'] }}
              </p>
              <p class="phone">{{ copy['phone_label'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'phone' }" /></p>
              <div class="signs">
                <div>
                  <div>{{ copy['handed'] }}</div>
                  <div class="sign-line"></div>
                  <div class="hint">{{ copy['handed_sign'] }}</div>
                </div>
                <div>
                  <div>{{ copy['received'] }}</div>
                  <div class="sign-line"></div>
                  <div class="hint">{{ copy['received_sign'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'fio' }" /></div>
                </div>
              </div>
              <p class="stamp">{{ copy['stamp'] }}</p>
            } @else if (family === 'notice') {
              <p class="addressee">
                <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'fio' }" /><br />
                <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'address' }" />
              </p>
              <h1>{{ copy['title'] }}</h1>
              <p>
                {{ copy['before_amount'] }}
                @if (showServices) { <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'services' }" /> }
                {{ copy['mid_amount'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'amount' }" />
                {{ copy['after_amount'] }}
              </p>
              @if (copy['p2']) { <p>{{ copy['p2'] }}</p> }
              <p>
                {{ copy['contact_before'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'organization' }" />
                {{ copy['contact_mid'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'address_org' }" />
                {{ copy['hours_label'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'hours' }" />,
                {{ copy['phone_label'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'phone' }" />.
              </p>
              <header class="letterhead">
                <div>{{ copy['country'] }}</div>
                <div class="org"><ng-container *ngTemplateOutlet="slot; context: { $implicit: 'organization' }" /></div>
                <div><ng-container *ngTemplateOutlet="slot; context: { $implicit: 'locality' }" /></div>
              </header>
              <p class="meta"><ng-container *ngTemplateOutlet="slot; context: { $implicit: 'date' }" />, {{ copy['out_label'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'doc_number' }" /></p>
              <p class="stamp">{{ copy['stamp'] }}</p>
            } @else if (family === 'reminder') {
              <p class="meta">{{ copy['issued'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'date' }" /></p>
              <p><span class="lbl">{{ copy['where'] }}</span> <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'address' }" /></p>
              <p><span class="lbl">{{ copy['whom'] }}</span> <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'fio' }" /></p>
              <p>
                {{ copy['account_label'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'account' }" />
                {{ copy['area_label'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'area' }" /> {{ copy['area_unit'] }}
                {{ copy['live_label'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'residents_count' }" /> {{ copy['live_unit'] }}
              </p>
              <p>{{ copy['sender'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'address_org' }" /></p>
              <h1>{{ copy['title'] }}</h1>
              <p>
                {{ copy['on_date'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'as_of' }" />
                {{ copy['debt_text'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'months_debt' }" />
              </p>
              <table class="sum">
                <thead><tr><th>{{ copy['debt'] }}</th><th>{{ copy['mulct'] }}</th><th>{{ copy['grand'] }}</th></tr></thead>
                <tbody><tr>
                  <td><ng-container *ngTemplateOutlet="slot; context: { $implicit: 'principal' }" /></td>
                  <td><ng-container *ngTemplateOutlet="slot; context: { $implicit: 'penalty' }" /></td>
                  <td><ng-container *ngTemplateOutlet="slot; context: { $implicit: 'total' }" /></td>
                </tr></tbody>
              </table>
              <p class="sub">{{ copy['penalty_title'] }}</p>
              <table class="grid">
                <thead><tr><th>{{ copy['month'] }}</th><th>{{ copy['debt'] }}</th><th>{{ copy['mulct'] }}</th></tr></thead>
                <tbody>
                  @for (row of penaltyRows; track $index) {
                    <tr><td>{{ row.month }}</td><td class="num">{{ row.principal }}</td><td class="num">{{ row.penalty }}</td></tr>
                  } @empty {
                    <tr><td></td><td></td><td></td></tr>
                  }
                </tbody>
              </table>
              <p>{{ copy['pay_before'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'due_date' }" /> {{ copy['pay_after'] }}</p>
              <p class="phone">{{ copy['phone_label'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'phone' }" /></p>
              <p><ng-container *ngTemplateOutlet="slot; context: { $implicit: 'address_org' }" /></p>
            } @else if (family === 'calculation') {
              <h1>
                {{ copy['title_before'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'account' }" />
                {{ copy['title_after'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'as_of' }" />
              </h1>
              <header class="letterhead">
                <div>{{ copy['country'] }}</div>
                <div class="org"><ng-container *ngTemplateOutlet="slot; context: { $implicit: 'organization' }" /></div>
                <div><ng-container *ngTemplateOutlet="slot; context: { $implicit: 'locality' }" /></div>
              </header>
              <p>{{ copy['agent_label'] }} {{ copy['agent'] }}</p>
              <p>{{ copy['bank_label'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'bank' }" /></p>
              <p>
                {{ copy['bik_label'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'bik' }" />
                {{ copy['acc_label'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'bank_account' }" />
              </p>
              <p>{{ copy['unp_label'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'unp' }" /></p>
              <p class="reg">{{ copy['reg_label'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'doc_number' }" /></p>
              <table class="payer">
                <tbody>
                  <tr>
                    <th>{{ copy['payer'] }}</th>
                    <td><ng-container *ngTemplateOutlet="slot; context: { $implicit: 'fio' }" /></td>
                    <th>{{ copy['counts'] }}</th>
                    <td>
                      <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'registered_count' }" />/<ng-container *ngTemplateOutlet="slot; context: { $implicit: 'tenants' }" />/<ng-container *ngTemplateOutlet="slot; context: { $implicit: 'beneficiaries' }" />
                    </td>
                  </tr>
                  <tr>
                    <th>{{ copy['address'] }}</th>
                    <td><ng-container *ngTemplateOutlet="slot; context: { $implicit: 'address' }" /></td>
                    <th>{{ copy['rooms'] }}</th>
                    <td><ng-container *ngTemplateOutlet="slot; context: { $implicit: 'rooms' }" /></td>
                  </tr>
                  <tr>
                    <th>{{ copy['ownership'] }}</th>
                    <td><ng-container *ngTemplateOutlet="slot; context: { $implicit: 'ownership' }" /></td>
                    <th>{{ copy['space'] }}</th>
                    <td><ng-container *ngTemplateOutlet="slot; context: { $implicit: 'area' }" />/<ng-container *ngTemplateOutlet="slot; context: { $implicit: 'living_area' }" /></td>
                  </tr>
                </tbody>
              </table>
              <p>{{ copy['duty'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'duty_from' }" /></p>
              @for (pair of pairs; track $index) {
                <table class="grid calc">
                  <thead>
                    <tr>
                      <th rowspan="2">{{ copy['service'] }}</th>
                      <th colspan="3">{{ pair.left_label }}</th>
                      <th colspan="3">{{ pair.right_label }}</th>
                    </tr>
                    <tr>
                      <th>{{ copy['col_debt'] }}</th><th>{{ copy['col_mulct'] }}</th><th>{{ copy['col_all'] }}</th>
                      <th>{{ copy['col_debt'] }}</th><th>{{ copy['col_mulct'] }}</th><th>{{ copy['col_all'] }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of pair.rows; track row.name) {
                      <tr>
                        <td class="name">{{ row.name }}</td>
                        <td class="num">{{ row.l_principal }}</td><td class="num">{{ row.l_penalty }}</td><td class="num">{{ row.l_total }}</td>
                        <td class="num">{{ row.r_principal }}</td><td class="num">{{ row.r_penalty }}</td><td class="num">{{ row.r_total }}</td>
                      </tr>
                    }
                    <tr class="sum">
                      <td>{{ copy['row_total'] }}</td>
                      <td class="num">{{ pair.l_principal }}</td><td class="num">{{ pair.l_penalty }}</td><td class="num">{{ pair.l_total }}</td>
                      <td class="num">{{ pair.r_principal }}</td><td class="num">{{ pair.r_penalty }}</td><td class="num">{{ pair.r_total }}</td>
                    </tr>
                  </tbody>
                </table>
              } @empty {
                <table class="grid calc">
                  <thead>
                    <tr>
                      <th rowspan="2">{{ copy['service'] }}</th>
                      <th colspan="3"></th>
                      <th colspan="3"></th>
                    </tr>
                    <tr>
                      <th>{{ copy['col_debt'] }}</th><th>{{ copy['col_mulct'] }}</th><th>{{ copy['col_all'] }}</th>
                      <th>{{ copy['col_debt'] }}</th><th>{{ copy['col_mulct'] }}</th><th>{{ copy['col_all'] }}</th>
                    </tr>
                  </thead>
                </table>
              }
              <p class="total">{{ values['total_sentence'] }}</p>
              <p class="sub">{{ copy['people'] }}</p>
              <table class="grid people">
                <thead>
                  <tr>
                    <th>{{ copy['arrived'] }}</th><th>{{ copy['left'] }}</th><th>{{ copy['registered'] }}</th>
                    <th>{{ copy['ended'] }}</th><th>{{ copy['person'] }}</th><th>{{ copy['birthday'] }}</th>
                    <th>{{ copy['relation'] }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (person of residents; track $index) {
                    <tr>
                      <td>{{ person.arrived }}</td><td>{{ person.left }}</td><td>{{ person.registered }}</td>
                      <td>{{ person.ended }}</td><td>{{ person.fio }}</td><td>{{ person.birthday }}</td>
                      <td>{{ person.relation }}</td>
                    </tr>
                  } @empty {
                    <tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
                  }
                </tbody>
              </table>
              <p>{{ copy['after_hand'] }} <ng-container *ngTemplateOutlet="slot; context: { $implicit: 'warning_date' }" /> {{ copy['close'] }}</p>
              <div class="signs">
                <div><div class="sign-line"></div><div class="hint">(должность) (подпись) (И.О.Фамилия)</div></div>
                <div><div class="sign-line"></div><div class="hint">(должность) (подпись) (И.О.Фамилия)</div></div>
              </div>
            }
          </article>
        </div>
      </div>
    </div>
    <ng-template #slot let-key>
      @if (locked(key)) {
        <span class="slot" [class.empty]="empty(key)">{{ values[key] }}</span>
      } @else {
        <input class="slot" [class.empty]="empty(key)" [(ngModel)]="values[key]" [attr.aria-label]="key" />
      }
    </ng-template>
  `,
  styleUrl: './official-sheet.component.scss',
})
export class OfficialSheetComponent implements AfterViewInit, OnChanges, OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly desk = viewChild<ElementRef<HTMLElement>>('desk');
  private readonly page = viewChild<ElementRef<HTMLElement>>('page');
  private observer: ResizeObserver | null = null;

  @Input() family = '';
  @Input() copy: Record<string, string> = {};
  @Input() values: Record<string, string> = {};
  @Input() pairs: BlankPeriodPair[] = [];
  @Input() residents: BlankResident[] = [];
  @Input() penaltyRows: BlankPenaltyRow[] = [];
  @Input() showServices = true;

  protected readonly scale = signal(1);
  protected readonly stageWidth = signal(794);
  protected readonly stageHeight = signal(1123);

  ngAfterViewInit(): void {
    const desk = this.desk()?.nativeElement;
    const page = this.page()?.nativeElement;
    if (!desk) return;
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(desk);
    if (page) this.observer.observe(page);
    this.fit();
  }

  ngOnChanges(): void {
    queueMicrotask(() => this.fit());
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  protected locked(key: string): boolean {
    return LOCKED.has(key);
  }

  protected empty(key: string): boolean {
    return !(this.values?.[key] || '').trim();
  }

  private fit(): void {
    const desk = this.desk()?.nativeElement;
    const page = this.page()?.nativeElement;
    if (!desk || !page) return;
    const natural = (210 / 25.4) * 96;
    const available = Math.max(desk.clientWidth - 40, 180);
    const scale = Math.min(1, Math.round((available / natural) * 100) / 100);
    const height = Math.max(page.offsetHeight, (297 / 25.4) * 96);
    const stageWidth = Math.ceil(natural * scale);
    const stageHeight = Math.ceil(height * scale) + 8;
    if (Math.abs(scale - this.scale()) < 0.01 && Math.abs(stageHeight - this.stageHeight()) < 2) return;
    this.zone.run(() => {
      this.scale.set(scale);
      this.stageWidth.set(stageWidth);
      this.stageHeight.set(stageHeight);
      this.cdr.markForCheck();
    });
  }
}
