# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from gen_common import icon, wrap_page, NAVY, ACCENT, ACCENT_LIGHT, MUTED, RED, AMBER, GREEN, BORDER, TEXT

EXTRA_CSS = f"""
.gtoolbar {{ display:flex; align-items:center; gap:10px; margin:16px 20px 0; }}
.gtoolbar .btn2 {{ border:1px solid {BORDER}; background:#fff; border-radius:5px; padding:6px 13px; font-size:12px; font-weight:600; color:{TEXT}; display:flex; align-items:center; gap:6px; }}
.gswitch {{ display:flex; border:1px solid {BORDER}; border-radius:5px; overflow:hidden; }}
.gswitch .g {{ padding:6px 11px; font-size:12px; color:{MUTED}; border-right:1px solid {BORDER}; background:#fff; display:flex; align-items:center; gap:5px; }}
.gswitch .g:last-child {{ border-right:none; }}
.gswitch .g.on {{ background:{ACCENT_LIGHT}; color:{ACCENT}; font-weight:700; }}
.chartcard {{ background:#fff; border:1px solid {BORDER}; border-radius:6px; margin:14px 20px; padding:20px 26px; }}
.chartcard h2 {{ font-size:15px; font-weight:700; }}
.chartcard .sub {{ color:{MUTED}; font-size:11.5px; margin-top:3px; margin-bottom:14px; }}
.legend {{ display:flex; gap:22px; margin:6px 0 4px; font-size:12px; }}
.legend .li {{ display:flex; align-items:center; gap:7px; }}
.legend .sw {{ width:12px; height:12px; border-radius:2px; }}
"""

def topbar():
    return f"""
<div class="topbar">
  <div class="grid-btn">{icon('grid',18,'#fff')}</div>
  <div class="appname">Взыскание задолженности</div>
  <nav><span class="active">Дела</span><span>Мероприятия</span><span>Претензионно-исковая работа</span><span>Отчётность</span><span>Настройка</span></nav>
  <div class="spacer"></div>
  <div class="tools">
    <div class="badge-dot" data-n="5">{icon('mail',18,'#fff')}</div>
    <div class="badge-dot" data-n="12">{icon('clock',18,'#fff')}</div>
    <div class="company">{icon('building',14,'#fff')}РСЦ Минска<span style="opacity:.8">▾</span></div>
    <div class="avatar">ИП</div>
  </div>
</div>"""

def subbar():
    return f"""
<div class="subbar">
  <button class="btn">{icon('plus',14,'#fff')}Новое дело</button>
  <div class="crumbs"><span>Дела</span><span>›</span><b>Все группы</b></div>
  <div class="searchwrap">
    <div class="searchbox">
      {icon('search',15,'#8b97a2')}
      <div class="chip">Организация: РСЦ Минска {icon('close',11,'#156082')}</div>
      <div class="chip">Группировать по: Этап воронки {icon('close',11,'#156082')}</div>
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

def gtoolbar(active):
    on = lambda k: "on" if k == active else ""
    return f"""
<div class="gtoolbar">
  <div class="btn2">Показатели {icon('chevron-down',12,MUTED)}</div>
  <div class="gswitch">
    <div class="g {on('bar')}">{icon('bar-chart',13)} Столбчатая</div>
    <div class="g {on('line')}">{icon('arrow-right',13)} Линейная</div>
    <div class="g {on('pie')}">{icon('pie-chart',13)} Круговая</div>
  </div>
  <div class="btn2">{icon('download',13,MUTED)} Экспорт в Excel</div>
</div>"""

def bar_svg():
    # (этап, основной долг, пеня, кол-во дел), тыс. р.
    data = [
        ("Новый\nдолжник", 12.4, 0.0, 14, GREEN),
        ("Автообзвон/\nуведомления", 40.2, 8.7, 31, ACCENT),
        ("Предупреждение\nвручено", 49.8, 14.4, 18, AMBER),
        ("Отключение\nуслуг", 16.1, 5.2, 3, "#C77B3E"),
        ("Испол. надпись\n/ иск", 27.8, 7.8, 2, RED),
        ("ОПИ", 33.1, 11.6, 2, "#7A2E2E"),
    ]
    W, H = 1240, 470
    left, right, top, bottom = 70, 20, 30, 60
    plot_w, plot_h = W - left - right, H - top - bottom
    ymax = 70.0
    parts = [f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="-apple-system, Arial, sans-serif">']
    # сетка и ось Y
    for v in range(0, 71, 10):
        y = top + plot_h - plot_h * v / ymax
        parts.append(f'<line x1="{left}" y1="{y:.1f}" x2="{W-right}" y2="{y:.1f}" stroke="#EDF0F3" stroke-width="1"/>')
        parts.append(f'<text x="{left-10}" y="{y+4:.1f}" font-size="11" fill="{MUTED}" text-anchor="end">{v}</text>')
    parts.append(f'<text x="18" y="{top-12}" font-size="11" fill="{MUTED}">тыс. р.</text>')
    slot = plot_w / len(data)
    bw = 92
    for i, (label, main, pen, cnt, color) in enumerate(data):
        cx = left + slot * i + slot / 2
        x = cx - bw / 2
        h_main = plot_h * main / ymax
        h_pen = plot_h * pen / ymax
        y_main = top + plot_h - h_main
        y_pen = y_main - h_pen
        parts.append(f'<rect x="{x:.1f}" y="{y_main:.1f}" width="{bw}" height="{h_main:.1f}" fill="{color}" rx="2"/>')
        if pen > 0:
            parts.append(f'<rect x="{x:.1f}" y="{y_pen:.1f}" width="{bw}" height="{h_pen:.1f}" fill="{color}" opacity="0.38" rx="2"/>')
        total = main + pen
        parts.append(f'<text x="{cx:.1f}" y="{y_pen-8:.1f}" font-size="12" font-weight="700" fill="{TEXT}" text-anchor="middle">{str(round(total,1)).replace(".",",")}</text>')
        parts.append(f'<text x="{cx:.1f}" y="{y_pen-24:.1f}" font-size="10.5" fill="{MUTED}" text-anchor="middle">{cnt} дел</text>')
        for j, ln in enumerate(label.split("\n")):
            parts.append(f'<text x="{cx:.1f}" y="{top+plot_h+18+j*13}" font-size="11" fill="{TEXT}" text-anchor="middle">{ln}</text>')
    parts.append(f'<line x1="{left}" y1="{top+plot_h}" x2="{W-right}" y2="{top+plot_h}" stroke="{BORDER}" stroke-width="1.5"/>')
    parts.append('</svg>')
    return "".join(parts)

def build():
    chart = f"""
{gtoolbar('bar')}
<div class="chartcard">
  <h2>Задолженность по этапам воронки взыскания</h2>
  <div class="sub">Все группы · РСЦ Минска · по состоянию на 09.07.2026 · 70 дел на сумму 221 900,00 р. (в т.ч. пеня 40 580,00 р.)</div>
  <div class="legend">
    <div class="li"><div class="sw" style="background:{MUTED}"></div>Насыщенная часть столбца — основной долг</div>
    <div class="li"><div class="sw" style="background:{MUTED};opacity:.38"></div>Светлая часть — пеня</div>
  </div>
  {bar_svg()}
</div>"""
    return wrap_page(topbar() + subbar() + chart, extra_style=EXTRA_CSS)

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "html", "mockup10_bar.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print("written", out)
