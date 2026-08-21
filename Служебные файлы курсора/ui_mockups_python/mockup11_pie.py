# -*- coding: utf-8 -*-
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from gen_common import icon, wrap_page, NAVY, ACCENT, ACCENT_LIGHT, MUTED, RED, AMBER, GREEN, BORDER, TEXT
from mockup10_bar import topbar, EXTRA_CSS, gtoolbar

def pie_svg(data, cx, cy, r, title, unit):
    """data: [(label, value, color)]"""
    total = sum(v for _, v, _ in data)
    parts = []
    angle = -90.0
    for label, value, color in data:
        frac = value / total
        sweep = frac * 360.0
        a0 = math.radians(angle)
        a1 = math.radians(angle + sweep)
        x0, y0 = cx + r * math.cos(a0), cy + r * math.sin(a0)
        x1, y1 = cx + r * math.cos(a1), cy + r * math.sin(a1)
        large = 1 if sweep > 180 else 0
        parts.append(f'<path d="M {cx} {cy} L {x0:.2f} {y0:.2f} A {r} {r} 0 {large} 1 {x1:.2f} {y1:.2f} Z" fill="{color}" stroke="#fff" stroke-width="2"/>')
        amid = math.radians(angle + sweep / 2)
        lx, ly = cx + r * 0.62 * math.cos(amid), cy + r * 0.62 * math.sin(amid)
        parts.append(f'<text x="{lx:.1f}" y="{ly:.1f}" font-size="13" font-weight="700" fill="#fff" text-anchor="middle">{frac*100:.1f}%</text>')
        angle += sweep
    parts.append(f'<text x="{cx}" y="{cy+r+34}" font-size="12.5" font-weight="700" fill="{TEXT}" text-anchor="middle">{title}</text>')
    parts.append(f'<text x="{cx}" y="{cy+r+50}" font-size="11" fill="{MUTED}" text-anchor="middle">{unit}</text>')
    return "".join(parts)

def build():
    cases = [
        ("Группа 1 · до 1 мес.", 14, GREEN),
        ("Группа 2 · 1–3 мес.", 31, ACCENT),
        ("Группа 3 · 3–6 мес.", 18, AMBER),
        ("Группа 4 · свыше 6 мес.", 7, RED),
    ]
    sums = [
        ("Группа 1 · до 1 мес.", 12.4, GREEN),
        ("Группа 2 · 1–3 мес.", 48.9, ACCENT),
        ("Группа 3 · 3–6 мес.", 64.2, AMBER),
        ("Группа 4 · свыше 6 мес.", 96.4, RED),
    ]
    legend_rows = ""
    for (label, cnt, color), (_, s, _) in zip(cases, sums):
        legend_rows += f"""<tr>
  <td><div style="width:12px;height:12px;border-radius:2px;background:{color}"></div></td>
  <td style="padding:6px 10px;font-size:12.5px">{label}</td>
  <td style="padding:6px 10px;font-size:12.5px;text-align:right;font-weight:700">{cnt} дел</td>
  <td style="padding:6px 10px;font-size:12.5px;text-align:right;font-weight:700">{str(s).replace('.',',')} тыс. р.</td>
</tr>"""
    svg = f"""<svg width="1240" height="480" viewBox="0 0 1240 480" font-family="-apple-system, Arial, sans-serif">
  {pie_svg(cases, 250, 210, 165, "Количество дел", "70 дел")}
  {pie_svg(sums, 660, 210, 165, "Сумма задолженности (с пеней)", "221,9 тыс. р.")}
  <foreignObject x="900" y="60" width="330" height="300">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:-apple-system, Arial, sans-serif">
      <table style="border-collapse:collapse;width:100%">{legend_rows}</table>
    </div>
  </foreignObject>
</svg>"""
    subbar = f"""
<div class="subbar">
  <button class="btn">{icon('plus',14,'#fff')}Новое дело</button>
  <div class="crumbs"><span>Дела</span><span>›</span><b>Все группы</b></div>
  <div class="searchwrap">
    <div class="searchbox">
      {icon('search',15,'#8b97a2')}
      <div class="chip">Организация: РСЦ Минска {icon('close',11,'#156082')}</div>
      <div class="chip">Группировать по: Группа задолженности {icon('close',11,'#156082')}</div>
      <input placeholder="Поиск по ФИО, организации, ЛС, адресу...">
      {icon('chevron-down',14,'#8b97a2')}
    </div>
  </div>
  <div class="viewswitch">
    <div class="v">{icon('kanban',15)}</div>
    <div class="v">{icon('list',15)}</div>
    <div class="v">{icon('calendar',15)}</div>
    <div class="v active">{icon('bar-chart',15)}</div>
  </div>
</div>"""
    chart = f"""
{gtoolbar('pie')}
<div class="chartcard">
  <h2>Распределение дел и суммы задолженности по группам</h2>
  <div class="sub">Все группы · РСЦ Минска · по состоянию на 09.07.2026</div>
  {svg}
</div>"""
    return wrap_page(topbar() + subbar + chart, extra_style=EXTRA_CSS)

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "html", "mockup11_pie.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print("written", out)
