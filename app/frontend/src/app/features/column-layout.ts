/** Порядок столбцов реестра. Скрытый столбец остаётся на месте, с которого его убрали. */

export interface ColumnLayout {
  order: string[];
  visible: string[];
}

export function resolveColumnOrder(stored: readonly string[], visible: readonly string[], catalog: readonly string[]): string[] {
  const allowed = new Set(catalog);
  const layout: string[] = [];
  const seen = new Set<string>();
  const take = (name: string) => {
    if (!allowed.has(name) || seen.has(name)) return;
    layout.push(name);
    seen.add(name);
  };
  for (const name of stored) take(name);
  if (!layout.length) {
    for (const name of visible) take(name);
  }
  for (const name of catalog) {
    if (seen.has(name)) continue;
    insertByCatalog(layout, name, catalog);
    seen.add(name);
  }
  return layout;
}

export function hideColumn(layout: ColumnLayout, name: string): ColumnLayout {
  if (!layout.visible.includes(name) || layout.visible.length < 2) return layout;
  const order = layout.order.includes(name) ? layout.order : [...layout.order, name];
  return { order, visible: layout.visible.filter((item) => item !== name) };
}

export function showColumn(layout: ColumnLayout, catalog: readonly string[], name: string): ColumnLayout {
  if (layout.visible.includes(name)) return layout;
  const order = layout.order.includes(name) ? layout.order : resolveColumnOrder(layout.order, layout.visible, catalog);
  const shown = new Set(layout.visible);
  shown.add(name);
  return { order, visible: order.filter((item) => shown.has(item)) };
}

export function moveColumn(layout: ColumnLayout, from: string, to: string): ColumnLayout {
  const order = [...layout.order];
  for (const name of layout.visible) {
    if (!order.includes(name)) order.push(name);
  }
  const source = order.indexOf(from);
  const target = order.indexOf(to);
  if (source < 0 || target < 0 || source === target) return layout;
  order.splice(source, 1);
  order.splice(target, 0, from);
  const shown = new Set(layout.visible);
  return { order, visible: order.filter((name) => shown.has(name)) };
}

function insertByCatalog(layout: string[], name: string, catalog: readonly string[]): void {
  const rank = new Map(catalog.map((item, index) => [item, index]));
  const nameRank = rank.get(name) ?? catalog.length;
  let insertAt = 0;
  for (let index = 0; index < layout.length; index += 1) {
    if ((rank.get(layout[index]) ?? -1) < nameRank) insertAt = index + 1;
  }
  layout.splice(insertAt, 0, name);
}
