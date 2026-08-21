# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from gen_common import icon, wrap_page, NAVY, ACCENT, ACCENT_LIGHT, MUTED, RED, AMBER, GREEN, BORDER, TEXT

G1, G2, G3, G4 = GREEN, ACCENT, AMBER, RED
G1BG, G2BG, G3BG, G4BG = "#E7F2EA", ACCENT_LIGHT, "#FBF0DD", "#FAE6E3"

EXTRA_CSS = f"""
.calwrap {{ display:flex; gap:16px; margin:16px 20px; align-items:flex-start; }}
.calmain {{ flex:1; background:#fff; border:1px solid {BORDER}; border-radius:6px; overflow:hidden; }}
.calbar {{ display:flex; align-items:center; gap:12px; padding:10px 16px; border-bottom:1px solid {BORDER}; }}
.calbar .month {{ font-size:15px; font-weight:700; }}
.calbar .nav {{ display:flex; gap:4px; }}
.calbar .nav .b {{ border:1px solid {BORDER}; border-radius:4px; padding:4px 9px; font-size:12px; color:{MUTED}; background:#fff; }}
.calbar .today {{ border:1px solid {BORDER}; border-radius:4px; padding:4px 12px; font-size:12px; font-weight:600; background:#fff; }}
.calbar .mode {{ margin-left:auto; display:flex; border:1px solid {BORDER}; border-radius:5px; overflow:hidden; font-size:12px; }}
.calbar .mode span {{ padding:5px 13px; color:{MUTED}; border-right:1px solid {BORDER}; }}
.calbar .mode span:last-child {{ border-right:none; }}
.calbar .mode span.on {{ background:{ACCENT_LIGHT}; color:{ACCENT}; font-weight:700; }}
table.cal {{ width:100%; border-collapse:collapse; table-layout:fixed; }}
table.cal th {{ font-size:11px; color:{MUTED}; font-weight:600; text-transform:uppercase; padding:7px 0; border-bottom:1px solid {BORDER}; }}
table.cal td {{ border:1px solid #EEF1F3; vertical-align:top; height:118px; padding:4px 5px; }}
table.cal td .d {{ font-size:11.5px; color:{MUTED}; font-weight:600; text-align:right; padding:1px 3px 3px; }}
table.cal td.out {{ background:#FAFBFC; }}
table.cal td.out .d {{ color:#c4ccd3; }}
table.cal td.today {{ background:#F3F8FB; }}
table.cal td.today .d {{ color:#fff; background:{NAVY}; border-radius:9px; display:inline-block; float:right; padding:1px 7px; }}
.ev {{ font-size:10.3px; font-weight:600; border-radius:3px; padding:2px 5px; margin-bottom:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; border-left:3px solid; }}
.more {{ font-size:10px; color:{MUTED}; padding:0 5px; }}

.calside {{ width:250px; flex:none; }}
.sidecard {{ background:#fff; border:1px solid {BORDER}; border-radius:6px; padding:14px 16px; margin-bottom:14px; }}
.sidecard h4 {{ font-size:11px; color:{MUTED}; text-transform:uppercase; letter-spacing:.03em; margin-bottom:10px; }}
.fitem {{ display:flex; align-items:center; gap:8px; font-size:12px; padding:4px 0; }}
.fitem .sw {{ width:13px; height:13px; border-radius:3px; }}
.fitem .cnt {{ margin-left:auto; color:{MUTED}; font-size:11px; }}
.legend-note {{ font-size:11px; color:{MUTED}; line-height:1.5; }}
"""

def ev(color, bg, text):
    return f'<div class="ev" style="border-left-color:{color};background:{bg};color:{color}">{text}</div>'

def build():
    top = f"""
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
    subbar = f"""
<div class="subbar">
  <button class="btn">{icon('plus',14,'#fff')}Новое дело</button>
  <div class="crumbs"><span>Дела</span><span>›</span><b>Все группы</b></div>
  <div class="searchwrap">
    <div class="searchbox">
      {icon('search',15,'#8b97a2')}
      <div class="chip">Организация: РСЦ Минска {icon('close',11,'#156082')}</div>
      <input placeholder="Поиск по ФИО, организации, ЛС, адресу...">
      {icon('chevron-down',14,'#8b97a2')}
    </div>
  </div>
  <div class="viewswitch">
    <div class="v">{icon('kanban',15)}</div>
    <div class="v">{icon('list',15)}</div>
    <div class="v active">{icon('calendar',15)}</div>
    <div class="v">{icon('bar-chart',15)}</div>
  </div>
</div>"""

    # События июля 2026 по данным доски «Все группы, все статусы»
    events = {
        2:  [ev(G3,G3BG,"Вручение предупреждения — Барановский И.К.")],
        3:  [ev(G3,G3BG,"Вручение предупреждения — Костюк Е.Л.")],
        4:  [ev(G4,G4BG,"Подача на испол. надпись — Сидорчук В.Л.")],
        5:  [ev(G3,G3BG,"Вручение предупреждения — Мельник Т.В.")],
        7:  [ev(G4,G4BG,"Заказ-наряд на отключение — Дубровская Н.П.")],
        9:  [ev(G1,G1BG,"Автообзвон — Соловьёва М.Д."), ev(G1,G1BG,"Автообзвон — Гриценко П.О.")],
        10: [ev(G1,G1BG,"Автообзвон — ЧУП «Сервис-Плюс»"), ev(G1,G1BG,"Автообзвон — Крупенько В.А."), ev(G2,G2BG,"Уведомление e-mail — Ефремова О.И.")],
        11: [ev(G2,G2BG,"Автообзвон — Иванова А.П.")],
        13: [ev(G2,G2BG,"Уведомление e-mail — ООО «Гарант-Сервис»")],
        14: [ev(G4,G4BG,"Контроль статуса в ОПИ — Ярошевич И.Б.")],
        16: [ev(G3,G3BG,"Контроль оплаты после предупреждения — Мельник Т.В.")],
        17: [ev(G2,G2BG,"Повторный автообзвон — Иванова А.П."), ev(G3,G3BG,"Контроль оплаты — Костюк Е.Л.")],
        20: [ev(G4,G4BG,"Срок ответа нотариуса — Сидорчук В.Л.")],
        21: [ev(G3,G3BG,"Формирование списка на отключение — Барановский И.К.")],
        24: [ev(G2,G2BG,"Печать предупреждений (партия) — Группа 2")],
        27: [ev(G1,G1BG,"Старт автообзвона за июль (партия) — Группа 1–2")],
        28: [ev(G4,G4BG,"Подача на испол. надпись — Кравцов О.С.")],
        31: [ev(G3,G3BG,"Контроль перехода в Группу 4 — Костюк Е.Л.")],
    }

    # Июль 2026: 1-е — среда; сетка с понедельника (29.06 – 02.08)
    weeks = [
        [(29,'out'),(30,'out'),(1,''),(2,''),(3,''),(4,''),(5,'')],
        [(6,''),(7,''),(8,''),(9,'today'),(10,''),(11,''),(12,'')],
        [(13,''),(14,''),(15,''),(16,''),(17,''),(18,''),(19,'')],
        [(20,''),(21,''),(22,''),(23,''),(24,''),(25,''),(26,'')],
        [(27,''),(28,''),(29,''),(30,''),(31,''),(1,'out'),(2,'out')],
    ]
    rows = ""
    for wk in weeks:
        rows += "<tr>"
        for day, cls in wk:
            evs = "".join(events.get(day, [])) if cls != 'out' else ""
            rows += f'<td class="{cls}"><div class="d">{day}</div>{evs}</td>'
        rows += "</tr>"

    cal = f"""
<div class="calwrap">
  <div class="calmain">
    <div class="calbar">
      <div class="nav"><div class="b">‹</div><div class="b">›</div></div>
      <div class="today">Сегодня</div>
      <div class="month">Июль 2026 — мероприятия по делам</div>
      <div class="mode"><span>День</span><span>Неделя</span><span class="on">Месяц</span></div>
    </div>
    <table class="cal">
      <tr><th>Пн</th><th>Вт</th><th>Ср</th><th>Чт</th><th>Пт</th><th>Сб</th><th>Вс</th></tr>
      {rows}
    </table>
  </div>
  <div class="calside">
    <div class="sidecard">
      <h4>Группы задолженности</h4>
      <div class="fitem"><div class="sw" style="background:{G1}"></div>Группа 1 · до 1 мес.<span class="cnt">6</span></div>
      <div class="fitem"><div class="sw" style="background:{G2}"></div>Группа 2 · 1–3 мес.<span class="cnt">7</span></div>
      <div class="fitem"><div class="sw" style="background:{G3}"></div>Группа 3 · 3–6 мес.<span class="cnt">7</span></div>
      <div class="fitem"><div class="sw" style="background:{G4}"></div>Группа 4 · свыше 6 мес.<span class="cnt">5</span></div>
    </div>
    <div class="sidecard">
      <h4>Тип мероприятия</h4>
      <div class="fitem"><input type="checkbox" checked>Автообзвон</div>
      <div class="fitem"><input type="checkbox" checked>Уведомления (e-mail)</div>
      <div class="fitem"><input type="checkbox" checked>Предупреждения</div>
      <div class="fitem"><input type="checkbox" checked>Отключение услуг</div>
      <div class="fitem"><input type="checkbox" checked>Испол. надпись / иск / ОПИ</div>
    </div>
    <div class="sidecard">
      <h4>Подсказка</h4>
      <div class="legend-note">Мероприятия и дедлайны, жёстко определённые законодательством, отображаются в календаре по датам. Цвет соответствует группе задолженности дела.</div>
    </div>
  </div>
</div>"""
    return wrap_page(top + subbar + cal, extra_style=EXTRA_CSS)

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "html", "mockup9_calendar.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print("written", out)
