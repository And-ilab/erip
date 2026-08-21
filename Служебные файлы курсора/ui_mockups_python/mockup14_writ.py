# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from gen_common import icon, wrap_page, NAVY, ACCENT, ACCENT_LIGHT, MUTED, RED, AMBER, GREEN, BORDER, TEXT

EXTRA_CSS = f"""
.listwrap {{ background:#fff; margin:16px 20px; border:1px solid {BORDER}; border-radius:6px; overflow:hidden; }}
table.reg {{ width:100%; border-collapse:collapse; font-size:12px; }}
table.reg th {{ text-align:left; color:{MUTED}; font-weight:600; padding:9px 14px; border-bottom:1px solid {BORDER}; background:#FAFBFC; }}
table.reg td {{ padding:9px 14px; border-bottom:1px solid #EEF1F3; }}
.stchip {{ font-size:10.5px; font-weight:700; padding:3px 8px; border-radius:10px; }}

.stagewrap {{ position:relative; }}
.wmodal {{ position:absolute; top:70px; left:50%; transform:translateX(-50%); width:920px;
  background:#fff; border-radius:8px; box-shadow:0 24px 60px rgba(0,0,0,.3); padding:24px 30px; z-index:21; }}
.wmodal h3 {{ font-size:16px; font-weight:700; margin-bottom:4px; }}
.wmodal .hint {{ color:{MUTED}; font-size:11.5px; margin-bottom:16px; }}
.frow {{ display:grid; grid-template-columns:230px 1fr; align-items:center; gap:8px; padding:9px 0; border-bottom:1px solid #F0F2F4; }}
.frow label {{ font-size:12px; color:{TEXT}; font-weight:600; }}
.frow .inp {{ border:1px solid {BORDER}; border-radius:4px; padding:6px 10px; font-size:12px; color:{TEXT}; background:#fcfdfd; display:flex; justify-content:space-between; align-items:center; }}
.frow .stat {{ font-size:12px; display:flex; align-items:center; gap:7px; }}
.seclbl {{ font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; color:{MUTED}; margin:18px 0 2px; }}
.docitem {{ display:flex; align-items:center; gap:9px; font-size:12px; padding:7px 0; border-bottom:1px solid #F0F2F4; }}
.docitem .st {{ margin-left:auto; font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:10px; }}
.btnbar {{ display:flex; gap:10px; margin-top:18px; }}
"""

def build():
    top = f"""
<div class="topbar">
  <div class="grid-btn">{icon('grid',18,'#fff')}</div>
  <div class="appname">Взыскание задолженности</div>
  <nav><span>Дела</span><span>Мероприятия</span><span class="active">Претензионно-исковая работа</span><span>Отчётность</span><span>Настройка</span></nav>
  <div class="spacer"></div>
  <div class="tools">
    <div class="badge-dot" data-n="5">{icon('mail',18,'#fff')}</div>
    <div class="badge-dot" data-n="12">{icon('clock',18,'#fff')}</div>
    <div class="company">{icon('building',14,'#fff')}РСЦ Минска<span style="opacity:.8">▾</span></div>
    <div class="avatar">ЮК</div>
  </div>
</div>"""
    subbar = f"""
<div class="subbar">
  <button class="btn">{icon('plus',14,'#fff')}Добавить исполнительную надпись</button>
  <div class="crumbs"><span>Претензионно-исковая работа</span><span>›</span><b>Исполнительные надписи</b></div>
  <div class="searchwrap">
    <div class="searchbox">
      {icon('search',15,'#8b97a2')}
      <div class="chip">Статус: В работе {icon('close',11,'#156082')}</div>
      <input placeholder="Поиск по ФИО, ЛС, нотариусу...">
      {icon('chevron-down',14,'#8b97a2')}
    </div>
  </div>
  <div class="viewswitch">
    <div class="v active">{icon('list',15)}</div>
    <div class="v">{icon('kanban',15)}</div>
    <div class="v">{icon('calendar',15)}</div>
  </div>
</div>"""
    table = f"""
<div class="listwrap">
<table class="reg">
<tr><th>Должник</th><th>ЛС</th><th>Сумма к взысканию</th><th>Нотариус</th><th>Дата подачи</th><th>Статус</th></tr>
<tr><td><b>Кравцов Олег Станиславович</b></td><td>0008120</td><td>9 340,00 р.</td><td>Нотар. контора №1 г. Минска</td><td>28.06.2026</td><td><span class="stchip" style="background:{ACCENT_LIGHT};color:{ACCENT}">Направлено нотариусу</span></td></tr>
<tr><td><b>Ярошевич Инна Брониславовна</b></td><td>0007745</td><td>24 120,00 р.</td><td>Нотар. контора №3 г. Минска</td><td>02.06.2026</td><td><span class="stchip" style="background:#E7F2EA;color:{GREEN}">Надпись совершена</span></td></tr>
<tr><td><b>Гусев Валентин Романович</b></td><td>0006632</td><td>7 810,00 р.</td><td>Нотар. контора №1 г. Минска</td><td>25.05.2026</td><td><span class="stchip" style="background:#FAE6E3;color:{RED}">Отказ нотариуса</span></td></tr>
</table>
</div>"""
    modal = f"""
<div class="modal-backdrop"></div>
<div class="wmodal">
  <h3>Добавление исполнительной надписи</h3>
  <div class="hint">Пакет документов формируется автоматически из шаблонов; переход возможен только при выполненном чек-листе этапа «Предупреждение вручено».</div>

  <div class="seclbl">Дело</div>
  <div class="frow"><label>ЛС / должник</label><div class="inp">0009917 — Сидорчук Вадим Леонидович (Группа 4) {icon('chevron-down',13,MUTED)}</div></div>
  <div class="frow"><label>Период задолженности</label><div class="inp">01.11.2025 — 30.06.2026</div></div>
  <div class="frow"><label>Дата вручения предупреждения</label><div class="stat">{icon('check',14,GREEN)} 12.05.2026 — вручено лично (условие чек-листа выполнено)</div></div>

  <div class="seclbl">Суммы</div>
  <div class="frow"><label>Основной долг</label><div class="inp">13 240,00 р.</div></div>
  <div class="frow"><label>Пеня</label><div class="inp">5 220,00 р.</div></div>
  <div class="frow"><label>Нотариальный тариф</label><div class="inp">320,00 р. <span style="color:{MUTED};font-size:11px">рассчитан автоматически, относится на должника (V.5)</span></div></div>
  <div class="frow"><label>Итого к взысканию</label><div class="stat" style="font-weight:700;font-size:13.5px">18 780,00 р.</div></div>

  <div class="seclbl">Нотариус</div>
  <div class="frow"><label>Нотариальная контора</label><div class="inp">Нотариальная контора №1 г. Минска — Ковалевская И.М. {icon('chevron-down',13,MUTED)}</div></div>

  <div class="seclbl">Пакет документов</div>
  <div class="docitem">{icon('doc',14,MUTED)} Заявление о совершении исполнительной надписи <span class="st" style="background:#E7F2EA;color:{GREEN}">сформировано из шаблона</span></div>
  <div class="docitem">{icon('doc',14,MUTED)} Расчёт задолженности по ЛС 0009917 <span class="st" style="background:#E7F2EA;color:{GREEN}">сформировано</span></div>
  <div class="docitem">{icon('doc',14,MUTED)} Копия предупреждения с отметкой о вручении <span class="st" style="background:#E7F2EA;color:{GREEN}">приложено</span></div>
  <div class="docitem">{icon('paperclip',14,MUTED)} Выписка о зарегистрированных лицах <span class="st" style="background:#FBF0DD;color:{AMBER}">ожидает загрузки</span></div>

  <div class="btnbar">
    <button class="btn">Сформировать пакет и направить</button>
    <button class="btn secondary">Сохранить черновик</button>
    <button class="btn secondary">Отмена</button>
  </div>
</div>"""
    body = f'<div class="stagewrap" style="min-height:1000px">{top}{subbar}{table}{modal}</div>'
    return wrap_page(body, extra_style=EXTRA_CSS, app_height="min-height:1010px;")

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "html", "mockup14_writ.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print("written", out)
