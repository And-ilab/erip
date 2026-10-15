import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';

export interface DomainRule {
  field?: string;
  op?: string;
  value?: string;
  not?: boolean;
  join?: 'and' | 'or';
  rules?: DomainRule[];
}

export interface DomainField {
  id: string;
  label: string;
  kind: 'choice' | 'text' | 'number' | 'date' | 'bool';
  options?: { id: string; label: string }[];
}

const STAGES = [
  { id: 'new', label: 'Новый должник' },
  { id: 'prevention', label: 'Автообзвон/уведомления' },
  { id: 'warning', label: 'Предупреждение вручено' },
  { id: 'disconnect', label: 'Отключение услуг' },
  { id: 'enforcement', label: 'Исполнительная надпись / иск' },
  { id: 'court', label: 'ОПИ' },
  { id: 'closed', label: 'Не должник' },
];

const GROUPS = [1, 2, 3, 4, 5, 6].map((group) => ({ id: String(group), label: String(group) }));
const RATINGS = ['A', 'B', 'C', 'D', 'E'].map((letter) => ({ id: letter, label: letter }));

export function accountDomainFields(): DomainField[] {
  return [
    { id: 'client_account', label: 'Номер ЛС', kind: 'text' },
    { id: 'unified_account', label: 'Уникальный единый номер (УЕН)', kind: 'number' },
    { id: 'account_id', label: 'ID ЛС', kind: 'number' },
    { id: 'short_fio', label: 'ФИО плательщика', kind: 'text' },
    { id: 'account_address', label: 'Адрес', kind: 'text' },
    { id: 'payer_identifier', label: 'Идентификационный номер (ИН)', kind: 'text' },
    { id: 'payer_unp', label: 'УНП', kind: 'text' },
    { id: 'provider_short_name', label: 'Обслуживающая организация', kind: 'text' },
    { id: 'schema_label', label: 'Наименование схемы', kind: 'text' },
    { id: 'debt_group', label: 'Группа задолженности', kind: 'choice', options: GROUPS },
    { id: 'rating', label: 'Рейтинг должника', kind: 'choice', options: RATINGS },
    { id: 'funnel_stage', label: 'Этап воронки', kind: 'choice', options: STAGES },
    { id: 'scenario_name', label: 'Сценарий', kind: 'text' },
    { id: 'assigned_name', label: 'Закреплённый специалист', kind: 'text' },
    { id: 'ownership', label: 'Тип собственности', kind: 'text' },
    { id: 'housing', label: 'Тип объекта жилфонда', kind: 'text' },
    { id: 'months_debt', label: 'Кол-во месяцев долга', kind: 'number' },
    { id: 'subj_count', label: 'Кол-во проживающих', kind: 'number' },
    { id: 'registered_count', label: 'Кол-во зарегистрированных', kind: 'number' },
    { id: 'debt_total', label: 'Сумма основного долга', kind: 'number' },
    { id: 'mulct_total', label: 'Сумма пени', kind: 'number' },
    { id: 'obligation_total', label: 'Суммарный долг по услугам ЛС', kind: 'number' },
    { id: 'services_debt_count', label: 'Количество услуг с задолженностью', kind: 'number' },
    { id: 'balance_out', label: 'Исходящее сальдо', kind: 'number' },
    { id: 'debt_started_on', label: 'Наиболее ранний период возникновения долга', kind: 'date' },
    { id: 'contract_number', label: 'Номер договора', kind: 'text' },
    { id: 'service_provider', label: 'Поставщик услуги', kind: 'text' },
    { id: 'last_payment_date', label: 'Дата последней оплаты', kind: 'date' },
    { id: 'inheritance_case', label: 'Наследственное дело', kind: 'bool' },
  ];
}

export function contractDomainFields(): DomainField[] {
  return [
    { id: 'debt_group', label: 'Группа задолженности', kind: 'choice', options: GROUPS },
    { id: 'funnel_stage', label: 'Этап воронки', kind: 'choice', options: STAGES },
    { id: 'assigned_name', label: 'Закреплённый специалист', kind: 'text' },
    { id: 'ownership', label: 'Тип собственности', kind: 'text' },
    { id: 'housing', label: 'Тип объекта жилфонда', kind: 'text' },
    { id: 'months_debt', label: 'Кол-во месяцев долга', kind: 'number' },
    { id: 'subj_count', label: 'Кол-во проживающих', kind: 'number' },
    { id: 'balance_out', label: 'Исходящее сальдо услуги', kind: 'number' },
    { id: 'debt_started_on', label: 'Дата возникновения долга', kind: 'date' },
    { id: 'inheritance_case', label: 'Наследственное дело', kind: 'bool' },
    { id: 'billing', label: 'Обслуживающая организация', kind: 'text' },
  ];
}

export function measureDomainFields(): DomainField[] {
  return [
    { id: 'debt_group', label: 'Группа задолженности', kind: 'choice', options: GROUPS },
    { id: 'rating', label: 'Рейтинг должника', kind: 'choice', options: RATINGS },
    { id: 'funnel_stage', label: 'Этап воронки', kind: 'choice', options: STAGES },
    {
      id: 'kind', label: 'Вид мероприятия', kind: 'choice',
      options: [
        { id: 'call', label: 'Автообзвон' },
        { id: 'notice', label: 'Уведомление' },
        { id: 'warning', label: 'Предупреждение' },
        { id: 'disconnect', label: 'Отключение' },
        { id: 'collection', label: 'Взыскание' },
      ],
    },
    {
      id: 'status', label: 'Статус мероприятия', kind: 'choice',
      options: [
        { id: 'assigned', label: 'Назначено' },
        { id: 'running', label: 'Выполняется' },
        { id: 'done', label: 'Завершено' },
        { id: 'paused', label: 'Приостановлено' },
        { id: 'cancelled', label: 'Прервано' },
        { id: 'failed', label: 'Завершено с ошибкой' },
      ],
    },
  ];
}

export function emptyDomain(): DomainRule {
  return { join: 'and', not: false, rules: [blankRule()] };
}

export function compactDomain(node: DomainRule | null | undefined): DomainRule | null {
  if (!node) return null;
  if (node.rules) {
    const rules = node.rules.map((rule) => compactDomain(rule)).filter((rule): rule is DomainRule => !!rule);
    if (!rules.length) return null;
    return { join: node.join === 'or' ? 'or' : 'and', not: !!node.not, rules };
  }
  if (!node.field || node.value == null || String(node.value).trim() === '') return null;
  return { field: node.field, op: node.op || 'eq', value: String(node.value).trim(), not: !!node.not };
}

export function parseDomain(raw: unknown): DomainRule | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return compactDomain(JSON.parse(raw) as DomainRule);
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') return compactDomain(raw as DomainRule);
  return null;
}

function blankRule(): DomainRule {
  return { field: '', op: 'eq', value: '', not: false };
}

@Component({
  selector: 'app-domain-filter',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet],
  template: `
    <div class="backdrop" (click)="cancel.emit()">
      <div class="dialog" (click)="$event.stopPropagation()" role="dialog" aria-label="Пользовательский фильтр">
        <h3>Добавить пользовательский фильтр</h3>
        <p>Условие добавляется к уже выбранным фильтрам. Группа объединяет строки через «и» или «или», флаг «кроме» отрицает строку или группу.</p>
        <ng-container *ngTemplateOutlet="groupTpl; context: { node: draft, root: true }" />
        @if (error) { <p class="error">{{ error }}</p> }
        <div class="dialog-actions">
          <button type="button" class="primary" (click)="submit()">Применить</button>
          <button type="button" (click)="cancel.emit()">Отмена</button>
        </div>
      </div>
    </div>

    <ng-template #groupTpl let-node="node" let-root="root">
      <section class="group" [class.root]="root">
        <div class="group-head">
          <label class="except"><input type="checkbox" [(ngModel)]="node.not" /> кроме</label>
          <span>Соответствует</span>
          <select [(ngModel)]="node.join">
            <option value="and">всем условиям (И)</option>
            <option value="or">любому условию (ИЛИ)</option>
          </select>
          <button type="button" class="link" (click)="addRule(node)">Добавить условие</button>
          <button type="button" class="link" (click)="addGroup(node)">Добавить группу</button>
          @if (!root) {
            <button type="button" class="link danger" (click)="removeNode(node)">Убрать группу</button>
          }
        </div>
        @for (rule of node.rules; track $index) {
          @if (rule.rules) {
            <ng-container *ngTemplateOutlet="groupTpl; context: { node: rule, root: false }" />
          } @else {
            <div class="rule">
              <label class="except"><input type="checkbox" [(ngModel)]="rule.not" /> кроме</label>
              <select [ngModel]="rule.field" (ngModelChange)="setField(rule, $event)">
                <option value="">Поле</option>
                @for (field of fields; track field.id) {
                  <option [value]="field.id">{{ field.label }}</option>
                }
              </select>
              <select [(ngModel)]="rule.op">
                @for (op of operators(rule); track op.id) {
                  <option [value]="op.id">{{ op.label }}</option>
                }
              </select>
              @switch (kindOf(rule)) {
                @case ('choice') {
                  <select [(ngModel)]="rule.value">
                    <option value="">Значение</option>
                    @for (option of optionsOf(rule); track option.id) {
                      <option [value]="option.id">{{ option.label }}</option>
                    }
                  </select>
                }
                @case ('bool') {
                  <select [(ngModel)]="rule.value">
                    <option value="">Значение</option>
                    <option value="true">да</option>
                    <option value="false">нет</option>
                  </select>
                }
                @case ('number') { <input type="number" [(ngModel)]="rule.value" placeholder="Значение" /> }
                @case ('date') { <input type="date" [(ngModel)]="rule.value" /> }
                @default { <input [(ngModel)]="rule.value" placeholder="Значение" /> }
              }
              <button type="button" class="link danger" (click)="removeRule(node, rule)" [disabled]="node.rules.length < 2 && root">Убрать</button>
            </div>
          }
        }
      </section>
    </ng-template>
  `,
  styles: `
    .backdrop {
      position: fixed; inset: 0; z-index: 80; background: rgba(15, 23, 42, .45);
      display: grid; place-items: center; padding: 24px;
    }
    .dialog {
      width: min(860px, 100%); max-height: min(86vh, 760px); overflow: auto;
      background: #fff; border-radius: 8px; padding: 20px 22px 16px;
      box-shadow: 0 16px 40px rgba(16, 42, 67, .24);
    }
    h3 { margin: 0 0 6px; font-size: 18px; color: #1f2933; }
    .dialog > p { margin: 0 0 14px; color: var(--erip-muted); font-size: 13px; }
    .group { border: 1px solid var(--erip-border); border-radius: 8px; padding: 10px; margin-top: 8px; background: #f8fafb; }
    .group.root { background: #fff; border-color: transparent; padding: 0; margin: 0; }
    .group-head, .rule { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .rule { margin-top: 8px; }
    select, input {
      height: 32px; border: 1px solid var(--erip-border); border-radius: 4px; font: inherit; font-size: 13px;
      padding: 0 8px; background: #fff; color: #1f2933;
    }
    input { min-width: 140px; }
    .except { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--erip-muted); }
    .link {
      border: 0; background: transparent; color: var(--erip-link); font: inherit; font-size: 13px; cursor: pointer; padding: 4px;
    }
    .link.danger { color: var(--erip-danger); }
    .link:disabled { color: #b0b8c0; cursor: default; }
    .error { color: var(--erip-danger); font-size: 13px; }
    .dialog-actions { display: flex; gap: 8px; margin-top: 16px; }
    .dialog-actions button {
      height: 34px; padding: 0 16px; border-radius: 4px; border: 1px solid var(--erip-border);
      background: #fff; font: inherit; cursor: pointer;
    }
    .dialog-actions .primary { background: var(--erip-primary); color: #fff; border-color: var(--erip-primary); }
  `,
})
export class DomainFilterComponent implements OnInit {
  @Input() fields: DomainField[] = [];
  @Input() domain: DomainRule | null = null;
  @Output() readonly apply = new EventEmitter<DomainRule | null>();
  @Output() readonly cancel = new EventEmitter<void>();

  protected draft: DomainRule = emptyDomain();
  protected error = '';

  ngOnInit(): void {
    this.draft = this.domain ? structuredClone(this.domain) : emptyDomain();
    if (!this.draft.rules?.length) this.draft = emptyDomain();
  }

  protected operators(rule: DomainRule): { id: string; label: string }[] {
    const kind = this.kindOf(rule);
    if (kind === 'text') {
      return [
        { id: 'contains', label: 'содержит' },
        { id: 'ncontains', label: 'не содержит' },
        { id: 'eq', label: 'равно' },
        { id: 'ne', label: 'не равно' },
      ];
    }
    if (kind === 'number') {
      return [
        { id: 'eq', label: 'равно' },
        { id: 'ne', label: 'не равно' },
        { id: 'gt', label: 'больше' },
        { id: 'gte', label: 'больше или равно' },
        { id: 'lt', label: 'меньше' },
        { id: 'lte', label: 'меньше или равно' },
      ];
    }
    if (kind === 'date') {
      return [
        { id: 'eq', label: 'равно' },
        { id: 'gte', label: 'с даты' },
        { id: 'lte', label: 'по дату' },
      ];
    }
    return [
      { id: 'eq', label: 'равно' },
      { id: 'ne', label: 'не равно' },
    ];
  }

  protected kindOf(rule: DomainRule): DomainField['kind'] | 'text' {
    return this.fields.find((field) => field.id === rule.field)?.kind || 'text';
  }

  protected optionsOf(rule: DomainRule): { id: string; label: string }[] {
    return this.fields.find((field) => field.id === rule.field)?.options || [];
  }

  protected setField(rule: DomainRule, field: string): void {
    rule.field = field;
    rule.value = '';
    const ops = this.operators(rule);
    if (!ops.some((item) => item.id === rule.op)) rule.op = ops[0]?.id || 'eq';
  }

  protected addRule(node: DomainRule): void {
    node.rules = [...(node.rules || []), blankRule()];
  }

  protected addGroup(node: DomainRule): void {
    node.rules = [...(node.rules || []), { join: 'or', not: false, rules: [blankRule()] }];
  }

  protected removeRule(node: DomainRule, rule: DomainRule): void {
    node.rules = (node.rules || []).filter((item) => item !== rule);
    if (!node.rules.length) node.rules = [blankRule()];
  }

  protected removeNode(node: DomainRule): void {
    this.drop(this.draft, node);
  }

  protected submit(): void {
    const filled = this.filledCount(this.draft);
    const incomplete = this.incompleteCount(this.draft);
    if (incomplete) {
      this.error = 'Заполните поле, оператор и значение в каждой строке или уберите пустую строку.';
      return;
    }
    this.error = '';
    this.apply.emit(filled ? compactDomain(this.draft) : null);
  }

  private drop(parent: DomainRule, target: DomainRule): boolean {
    const rules = parent.rules || [];
    const index = rules.indexOf(target);
    if (index >= 0) {
      parent.rules = rules.filter((item) => item !== target);
      return true;
    }
    return rules.some((item) => !!item.rules && this.drop(item, target));
  }

  private filledCount(node: DomainRule): number {
    if (node.rules) return node.rules.reduce((sum, rule) => sum + this.filledCount(rule), 0);
    return node.field && String(node.value ?? '').trim() ? 1 : 0;
  }

  private incompleteCount(node: DomainRule): number {
    if (node.rules) return node.rules.reduce((sum, rule) => sum + this.incompleteCount(rule), 0);
    const hasField = !!node.field;
    const hasValue = String(node.value ?? '').trim() !== '';
    if (!hasField && !hasValue) return 0;
    return hasField && hasValue ? 0 : 1;
  }
}
