# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from gen_common import icon, wrap_page, NAVY, ACCENT, ACCENT_LIGHT, MUTED, RED, AMBER, GREEN, BORDER, TEXT
from mockup10_bar import topbar, EXTRA_CSS, gtoolbar

def line_svg():
    months = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл"]
    total = [196, 204, 215, 209, 222, 231, 227]   # тыс. р., долг с пеней
    pen   = [38, 41, 45, 43, 47, 52, 50]          # тыс. р., пеня
    cnt   = [61, 63, 68, 66, 71, 74, 70]          # количество дел
    W, H = 1240, 470
    left, right, top, bottom = 70, 30, 30, 50
    plot_w, plot_h = W - left - right, H - top - bottom
    ymax = 250.0
    def pt(i, v):
        x = left + plot_w * i / (len(months) - 1)
        y = top + plot_h - plot_h * v / ymax
        return x, y
    parts = [f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="-apple-system, Arial, sans-serif">']
    for v in range(0, 251, 50):
        y = top + plot_h - plot_h * v / ymax
        parts.append(f'<line x1="{left}" y1="{y:.1f}" x2="{W-right}" y2="{y:.1f}" stroke="#EDF0F3"/>')
        parts.append(f'<text x="{left-10}" y="{y+4:.1f}" font-size="11" fill="{MUTED}" text-anchor="end">{v}</text>')
    parts.append(f'<text x="18" y="{top-12}" font-size="11" fill="{MUTED}">тыс. р.</text>')
    for i, m in enumerate(months):
        x, _ = pt(i, 0)
        parts.append(f'<text x="{x:.1f}" y="{top+plot_h+22}" font-size="11.5" fill="{TEXT}" text-anchor="middle">{m} 2026</text>')
    # заливка под общим долгом
    area = f'M {pt(0,total[0])[0]:.1f} {pt(0,total[0])[1]:.1f} ' + " ".join(
        f'L {pt(i,v)[0]:.1f} {pt(i,v)[1]:.1f}' for i, v in enumerate(total)) + \
        f' L {pt(len(total)-1,0)[0]:.1f} {top+plot_h} L {left} {top+plot_h} Z'
    parts.append(f'<path d="{area}" fill="{ACCENT}" opacity="0.08"/>')
    for series, color, w in ((total, NAVY, 2.5), (pen, RED, 2)):
        path = "M " + " L ".join(f'{pt(i,v)[0]:.1f} {pt(i,v)[1]:.1f}' for i, v in enumerate(series))
        parts.append(f'<path d="{path}" fill="none" stroke="{color}" stroke-width="{w}"/>')
        for i, v in enumerate(series):
            x, y = pt(i, v)
            parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" fill="#fff" stroke="{color}" stroke-width="2"/>')
            parts.append(f'<text x="{x:.1f}" y="{y-11:.1f}" font-size="11" font-weight="700" fill="{color}" text-anchor="middle">{v}</text>')
    # количество дел — подписи под осью
    for i, c in enumerate(cnt):
        x, _ = pt(i, 0)
        parts.append(f'<text x="{x:.1f}" y="{top+plot_h+38}" font-size="10" fill="{MUTED}" text-anchor="middle">{c} дел</text>')
    parts.append(f'<line x1="{left}" y1="{top+plot_h}" x2="{W-right}" y2="{top+plot_h}" stroke="{BORDER}" stroke-width="1.5"/>')
    parts.append('</svg>')
    return "".join(parts)

def build():
    subbar = f"""
<div class="subbar">
  <button class="btn">{icon('plus',14,'#fff')}Новое дело</button>
  <div class="crumbs"><span>Дела</span><span>›</span><b>Все группы</b></div>
  <div class="searchwrap">
    <div class="searchbox">
      {icon('search',15,'#8b97a2')}
      <div class="chip">Организация: РСЦ Минска {icon('close',11,'#156082')}</div>
      <div class="chip">Период: январь – июль 2026 {icon('close',11,'#156082')}</div>
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
{gtoolbar('line')}
<div class="chartcard">
  <h2>Динамика задолженности по месяцам</h2>
  <div class="sub">Все группы · РСЦ Минска · январь – июль 2026 · под осью — количество дел на конец месяца</div>
  <div class="legend">
    <div class="li"><div class="sw" style="background:{NAVY}"></div>Задолженность всего (с пеней)</div>
    <div class="li"><div class="sw" style="background:{RED}"></div>в т.ч. пеня</div>
  </div>
  {line_svg()}
</div>"""
    return wrap_page(topbar() + subbar + chart, extra_style=EXTRA_CSS)

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "html", "mockup12_line.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print("written", out)
