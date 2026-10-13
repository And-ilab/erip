import { FormBuilder, FormControl, FormGroup } from '@angular/forms';

/** Подписи полей счёта. Та же карта, что в apps/nsi/services/form_sheet.py. */
export const FIELD_LABELS: Record<string, string> = {
  fio: 'Должник',
  account: 'Лицевой счёт',
  amount: 'Задолженность',
  penalty: 'Пеня',
  address: 'Адрес',
  services: 'Услуги',
  last_payment: 'Последняя оплата',
  organization: 'Организация',
  due_days: 'Срок, дней',
  tariff: 'Нотариальный тариф',
  debt_group: 'Группа задолженности',
  rating: 'Рейтинг',
  months_debt: 'Месяцев долга',
  personal_id: 'Идентификационный номер',
  unp: 'УНП',
  warning_date: 'Дата вручения',
  debt_started: 'Начало долга',
};

export const KNOWN_TOKENS = Object.keys(FIELD_LABELS);

const LABEL_TOKENS: Record<string, string> = {
  'должник': 'fio',
  'ответчик': 'fio',
  'заявитель': 'organization',
  'истец': 'organization',
  'организация': 'organization',
  'лицевой счёт': 'account',
  'лицевой счет': 'account',
  'адрес': 'address',
  'идентификационный номер': 'personal_id',
  'унп': 'unp',
  'услуги': 'services',
  'задолженность': 'amount',
  'исходящее сальдо': 'amount',
  'исходящее сальдо по данным аис «расчет-жку»': 'amount',
  'исходящее сальдо с пенями': 'amount',
  'пеня': 'penalty',
  'исходящие пени': 'penalty',
  'пеня по данным аис «расчет-жку»': 'penalty',
  'нотариальный тариф': 'tariff',
  'дата вручения предупреждения': 'warning_date',
  'группа задолженности': 'debt_group',
  'рейтинг': 'rating',
  'месяцев долга': 'months_debt',
  'наиболее ранний период': 'debt_started',
};

const FIELD_LINE = /^([^:{]{1,80}):\s*\{([a-z0-9_]+)\}\s*$/;
const BARE_LINE = /^\{([a-z0-9_]+)\}\s*$/;
const FILLED_LINE = /^([^:{]{1,80}):\s*(.*?)\s*$/;

export interface SheetBlock {
  key: string;
  title: string;
  enabled: boolean;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
  font_size: number;
  text: string;
  columns: { title: string; width: number }[];
  rows: string[][];
  x: number;
  y: number;
  w: number;
}

export interface TextPart { kind: 'text'; text: string; control: string }
export interface FieldPart { kind: 'field'; token: string }
export interface TitleNode { kind: 'title'; control: string; text: string }
export interface GapNode { kind: 'gap' }
export interface FieldItem {
  label: string;
  token: string;
  bare: boolean;
  literal: boolean;
  value: string;
  labelControl: string;
}
export interface FieldsNode { kind: 'fields'; framed: boolean; items: FieldItem[] }
export interface ParagraphNode { kind: 'paragraph'; parts: Array<TextPart | FieldPart> }
export type FlowNode = TitleNode | GapNode | FieldsNode | ParagraphNode;
export interface FlowBlock { key: string; nodes: FlowNode[] }
export type SheetMode = 'template' | 'filled';

export function normalizeBlock(block: Partial<SheetBlock> & { key: string }, index = 0): SheetBlock {
  const align = block.align === 'center' || block.align === 'right' ? block.align : 'left';
  const size = Number(block.font_size);
  return {
    key: block.key,
    title: block.title || 'Блок',
    enabled: block.enabled !== false,
    align,
    bold: !!block.bold,
    italic: !!block.italic,
    font_size: size >= 8 && size <= 24 ? size : 12,
    text: block.text || '',
    columns: (block.columns || []).map((col) => ({
      title: String(col.title || '').slice(0, 40),
      width: Math.min(80, Math.max(8, Number(col.width) || 20)),
    })),
    rows: (block.rows || []).map((row) => [...row]),
    x: block.x ?? 4,
    y: block.y ?? 12 + index * 96,
    w: block.w ?? 92,
  };
}

export function bodyBlock(text: string): SheetBlock {
  return normalizeBlock({ key: 'body', title: 'Текст', text, enabled: true }, 0);
}

export function bareToken(cell: string): string | null {
  const match = BARE_LINE.exec((cell || '').trim());
  return match ? match[1] : null;
}

export function cellKey(blockKey: string, row: number, col: number): string {
  return `c_${safe(blockKey)}_${row}_${col}`;
}

export function parseFlow(blockKey: string, text: string, asTitle: boolean): FlowNode[] {
  const id = safe(blockKey);
  const lines = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length === 1 && lines[0] === '') {
    return [{ kind: 'paragraph', parts: [{ kind: 'text', text: '', control: `${id}_text_0` }] }];
  }
  const nodes: FlowNode[] = [];
  let cursor = 0;
  let index = 0;
  if (asTitle && lines.length && isTitle(lines[0])) {
    nodes.push({ kind: 'title', control: `${id}_title`, text: lines[0] });
    cursor = 1;
  }
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line === '') {
      nodes.push({ kind: 'gap' });
      cursor += 1;
      continue;
    }
    if (classify(line) === 'text') {
      nodes.push({ kind: 'paragraph', parts: splitParts(line, `${id}_p${index}`) });
      index += 1;
      cursor += 1;
      continue;
    }
    const items: FieldItem[] = [];
    while (cursor < lines.length && lines[cursor] !== '' && classify(lines[cursor]) !== 'text') {
      items.push(fieldItem(lines[cursor], id, index));
      index += 1;
      cursor += 1;
    }
    nodes.push({ kind: 'fields', framed: isFramed(items), items });
  }
  return nodes;
}

export function serializeFlow(nodes: FlowNode[], form: FormGroup, mode: SheetMode): string {
  const lines: string[] = [];
  for (const node of nodes) {
    if (node.kind === 'gap') {
      lines.push('');
      continue;
    }
    if (node.kind === 'title') {
      lines.push(read(form, 'pieces', node.control));
      continue;
    }
    if (node.kind === 'fields') {
      for (const item of node.items) lines.push(serializeField(item, form, mode));
      continue;
    }
    lines.push(node.parts.map((part) => {
      if (part.kind === 'field') {
        if (mode === 'template') return `{${part.token}}`;
        return read(form, 'values', part.token) || `{${part.token}}`;
      }
      return read(form, 'pieces', part.control);
    }).join(''));
  }
  return lines.join('\n');
}

export class SheetEditor {
  flows: FlowBlock[] = [];
  form: FormGroup;

  constructor(private readonly fb: FormBuilder) {
    this.form = emptyForm(fb);
  }

  load(blocks: SheetBlock[]): void {
    const values: Record<string, string> = {};
    for (const token of KNOWN_TOKENS) values[token] = '';
    const pieces: Record<string, string> = {};
    const cells: Record<string, string> = {};
    this.flows = blocks.map((block) => ({
      key: block.key,
      nodes: parseFlow(block.key, block.text, block.key === 'body'),
    }));
    for (const flow of this.flows) {
      for (const node of flow.nodes) {
        if (node.kind === 'title') pieces[node.control] = node.text;
        if (node.kind === 'fields') {
          for (const item of node.items) {
            if (item.labelControl) pieces[item.labelControl] = item.label;
            if (!(item.token in values)) values[item.token] = '';
            if (item.literal) values[item.token] = item.value;
          }
        }
        if (node.kind === 'paragraph') {
          for (const part of node.parts) {
            if (part.kind === 'text') pieces[part.control] = part.text;
            else if (!(part.token in values)) values[part.token] = '';
          }
        }
      }
    }
    for (const block of blocks) {
      block.rows.forEach((row, rowIndex) => {
        row.forEach((cell, colIndex) => {
          const token = bareToken(cell);
          if (token) {
            if (!(token in values)) values[token] = '';
            return;
          }
          cells[cellKey(block.key, rowIndex, colIndex)] = cell;
        });
      });
      for (const token of tokensIn(block.text)) {
        if (!(token in values)) values[token] = '';
      }
    }
    this.form = this.fb.group({
      values: groupOf(this.fb, values),
      pieces: groupOf(this.fb, pieces),
      cells: groupOf(this.fb, cells),
    });
  }

  commit(blocks: SheetBlock[], mode: SheetMode): void {
    const byKey = new Map(blocks.map((block) => [block.key, block]));
    for (const flow of this.flows) {
      const block = byKey.get(flow.key);
      if (!block) continue;
      block.text = serializeFlow(flow.nodes, this.form, mode);
      block.rows = block.rows.map((row, rowIndex) => row.map((cell, colIndex) => {
        const token = bareToken(cell);
        if (token) {
          if (mode === 'template') return `{${token}}`;
          return read(this.form, 'values', token) || `{${token}}`;
        }
        const control = this.form.get(['cells', cellKey(block.key, rowIndex, colIndex)]);
        return control ? String(control.value ?? '') : cell;
      }));
    }
  }

  fillEmpty(values: Record<string, string>): void {
    const group = this.form.get('values');
    if (!group) return;
    for (const [key, value] of Object.entries(values)) {
      const control = group.get(key);
      if (control && !control.value && value) control.setValue(value);
    }
  }
}

function serializeField(item: FieldItem, form: FormGroup, mode: SheetMode): string {
  const value = read(form, 'values', item.token);
  if (item.bare) {
    if (mode === 'template' || !value) return `{${item.token}}`;
    return `${FIELD_LABELS[item.token] || item.label}: ${value}`;
  }
  const label = (item.labelControl ? read(form, 'pieces', item.labelControl) : item.label).trim() || item.label;
  if (!item.literal && (mode === 'template' || !value)) return `${label}: {${item.token}}`;
  return `${label}: ${value}`;
}

function emptyForm(fb: FormBuilder): FormGroup {
  return fb.group({ values: fb.group({}), pieces: fb.group({}), cells: fb.group({}) });
}

function groupOf(fb: FormBuilder, data: Record<string, string>): FormGroup {
  const controls: Record<string, FormControl<string>> = {};
  for (const [key, value] of Object.entries(data)) controls[key] = fb.nonNullable.control(value);
  return fb.group(controls);
}

function read(form: FormGroup, group: string, name: string): string {
  return String(form.get([group, name])?.value ?? '');
}

function splitParts(line: string, prefix: string): Array<TextPart | FieldPart> {
  const parts: Array<TextPart | FieldPart> = [];
  const pattern = /\{([a-z0-9_]+)\}/g;
  let position = 0;
  let index = 0;
  for (const match of line.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > position) {
      parts.push({ kind: 'text', text: line.slice(position, start), control: `${prefix}_t${index}` });
      index += 1;
    }
    parts.push({ kind: 'field', token: match[1] });
    position = start + match[0].length;
  }
  if (position < line.length || !parts.length) {
    parts.push({ kind: 'text', text: line.slice(position), control: `${prefix}_t${index}` });
  }
  return parts;
}

function fieldItem(line: string, id: string, index: number): FieldItem {
  const bare = BARE_LINE.exec(line);
  if (bare) {
    return {
      label: FIELD_LABELS[bare[1]] || bare[1],
      token: bare[1],
      bare: true,
      literal: false,
      value: '',
      labelControl: '',
    };
  }
  const tokenLine = FIELD_LINE.exec(line);
  if (tokenLine) {
    return {
      label: tokenLine[1].trim(),
      token: tokenLine[2],
      bare: false,
      literal: false,
      value: '',
      labelControl: `${id}_label_${index}`,
    };
  }
  const filled = FILLED_LINE.exec(line);
  const label = (filled?.[1] || line).trim();
  const value = (filled?.[2] || '').trim();
  return {
    label,
    token: LABEL_TOKENS[label.toLowerCase()] || `extra_${id}_${index}`,
    bare: false,
    literal: true,
    value,
    labelControl: `${id}_label_${index}`,
  };
}

function isTitle(line: string): boolean {
  return line.length > 0 && line.length <= 90 && !line.includes('{') && classify(line) === 'text';
}

function classify(line: string): 'bare' | 'field' | 'filled' | 'text' {
  if (BARE_LINE.test(line)) return 'bare';
  if (FIELD_LINE.test(line)) return 'field';
  const filled = FILLED_LINE.exec(line);
  if (filled && !filled[2].includes('{') && !filled[2].includes(':')) return 'filled';
  return 'text';
}

function isFramed(items: FieldItem[]): boolean {
  return items.some((item) => {
    const label = item.label.toLowerCase();
    return item.token === 'fio' || item.token === 'address' || label === 'должник' || label === 'ответчик' || label.startsWith('адрес');
  });
}

function tokensIn(text: string): string[] {
  return [...(text || '').matchAll(/\{([a-z0-9_]+)\}/g)].map((match) => match[1]);
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '_') || 'block';
}
