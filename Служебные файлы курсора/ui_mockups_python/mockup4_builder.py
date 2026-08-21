# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from gen_common import icon, wrap_page, NAVY, ACCENT, ACCENT_LIGHT, MUTED, RED, AMBER, GREEN, BORDER, TEXT

EXTRA_CSS = f"""
.settwrap {{ display:flex; gap:16px; margin:16px 20px; align-items:flex-start; }}
.settleft {{ width:420px; flex:none; background:#fff; border:1px solid {BORDER}; border-radius:6px; overflow:hidden; }}
.settleft .hd {{ padding:10px 14px; font-size:12.5px; font-weight:700; border-bottom:1px solid {BORDER}; background:#FAFBFC; display:flex; justify-content:space-between; align-items:center;}}
table.sctab {{ width:100%; border-collapse:collapse; font-size:11.8px; }}
table.sctab th {{ text-align:left; color:{MUTED}; font-weight:600; padding:8px 12px; border-bottom:1px solid {BORDER}; }}
table.sctab td {{ padding:8px 12px; border-bottom:1px solid #EEF1F3; }}
table.sctab tr.sel td {{ background:{ACCENT_LIGHT}; }}
.typetag {{ font-size:10px; font-weight:700; padding:2px 6px; border-radius:3px; }}
.tt-auto {{ background:#EFEAF8; color:#6B4FA0; }}
.tt-manual {{ background:{ACCENT_LIGHT}; color:{ACCENT}; }}

.settright {{ flex:1; background:#fff; border:1px solid {BORDER}; border-radius:6px; padding:20px 24px; }}
.settright h2 {{ font-size:16px; font-weight:700; margin-bottom:4px; }}
.settright .hint {{ color:{MUTED}; font-size:11.5px; margin-bottom:16px; }}
.frow {{ display:grid; grid-template-columns:190px 1fr; align-items:center; gap:8px; padding:10px 0; border-bottom:1px solid #F0F2F4; }}
.frow label {{ font-size:12px; color:{TEXT}; font-weight:600; }}
.frow .inp {{ border:1px solid {BORDER}; border-radius:4px; padding:6px 10px; font-size:12px; color:{TEXT}; background:#fcfdfd; display:flex; justify-content:space-between; align-items:center; }}
.frow .inp.ph {{ color:#a9b2ba; }}
.sectionlbl {{ font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; color:{MUTED}; margin:22px 0 4px; }}
.chk {{ display:flex; align-items:center; gap:8px; font-size:12px; margin-top:12px; }}
.chk .box {{ width:16px; height:16px; border:1.5px solid {ACCENT}; border-radius:3px; background:{ACCENT}; display:flex; align-items:center; justify-content:center; }}
.savebar {{ display:flex; gap:10px; margin-top:20px; }}
"""

def build():
    top = f"""
<div class="topbar">
  <div class="grid-btn">{icon('grid',18,'#fff')}</div>
  <div class="appname">Взыскание задолженности</div>
  <nav><span>Дела</span><span>Мероприятия</span><span>Претензионно-исковая работа</span><span>Отчётность</span><span class="active">Настройка</span></nav>
  <div class="spacer"></div>
  <div class="tools">
    <div class="badge-dot" data-n="5">{icon('mail',18,'#fff')}</div>
    <div class="badge-dot" data-n="12">{icon('clock',18,'#fff')}</div>
    <div class="company">{icon('building',14,'#fff')}Заказчик (централиз.)<span style="opacity:.8">▾</span></div>
    <div class="avatar">АД</div>
  </div>
</div>"""
    subbar = f"""
<div class="subbar">
  <button class="btn">{icon('plus',14,'#fff')}Новый тип мероприятия</button>
  <div class="crumbs"><span>Настройка</span><span>›</span><b>Конструктор сценариев и шаблонов мероприятий</b></div>
</div>"""
    left = f"""
<div class="settleft">
  <div class="hd">Типы мероприятий (9) <span style="color:{MUTED};font-weight:400">Группа 2 · Базовый сценарий</span></div>
  <table class="sctab">
    <tr><th>Название</th><th>Через, дн.</th><th>Тип</th></tr>
    <tr><td>Автообзвон</td><td>0</td><td><span class="typetag tt-auto">Авто</span></td></tr>
    <tr class="sel"><td>E-mail напоминание</td><td>2</td><td><span class="typetag tt-auto">Авто</span></td></tr>
    <tr><td>Ручной звонок</td><td>3</td><td><span class="typetag tt-manual">Ручное</span></td></tr>
    <tr><td>Предупреждение (печать)</td><td>5</td><td><span class="typetag tt-auto">Авто</span></td></tr>
    <tr><td>Вручение предупреждения</td><td>7</td><td><span class="typetag tt-manual">Ручное</span></td></tr>
    <tr><td>Отключение услуг</td><td>5</td><td><span class="typetag tt-auto">Авто</span></td></tr>
    <tr><td>Запрос согласования списания</td><td>0</td><td><span class="typetag tt-manual">Ручное</span></td></tr>
    <tr><td>Исполнительная надпись</td><td>10</td><td><span class="typetag tt-manual">Ручное</span></td></tr>
    <tr><td>Направление в ОПИ</td><td>15</td><td><span class="typetag tt-auto">Авто</span></td></tr>
  </table>
</div>"""
    right = f"""
<div class="settright">
  <h2>E-mail напоминание</h2>
  <div class="hint">Настройка правил срабатывания мероприятия внутри сценария «Группа 2 · Базовый». Изменения не затрагивают уже выполненные мероприятия.</div>

  <div class="sectionlbl">Условия запуска</div>
  <div class="frow"><label>Предшествующее мероприятие</label><div class="inp">Автообзвон {icon('chevron-down',13,MUTED)}</div></div>
  <div class="frow"><label>Через сколько дней</label><div class="inp">2 дня после предшествующего {icon('chevron-down',13,MUTED)}</div></div>
  <div class="frow"><label>Применимо к группам</label><div class="inp">Группа 1, Группа 2 {icon('chevron-down',13,MUTED)}</div></div>
  <div class="frow"><label>Исключить, если</label><div class="inp">Оплата поступила / долг погашен {icon('chevron-down',13,MUTED)}</div></div>

  <div class="sectionlbl">Действие</div>
  <div class="frow"><label>Действие мероприятия</label><div class="inp">Отправить e-mail (SMTP) {icon('chevron-down',13,MUTED)}</div></div>
  <div class="frow"><label>Шаблон сообщения</label><div class="inp"><a style="color:{ACCENT}">«Напоминание о задолженности — стандарт» →</a></div></div>
  <div class="frow"><label>Ответственный по умолчанию</label><div class="inp">Роль: Специалист (по ЛС) {icon('chevron-down',13,MUTED)}</div></div>

  <div class="sectionlbl">Переход к следующему этапу</div>
  <div class="frow"><label>Обязателен для перехода</label><div class="inp ph">не блокирует переход на следующий этап</div></div>
  <div class="chk"><div class="box">{icon('check',11,'#fff')}</div>Считать выполненным автоматически при успешной отправке (без ручного подтверждения)</div>

  <div class="savebar">
    <button class="btn">Сохранить</button>
    <button class="btn secondary">Отмена</button>
  </div>
</div>"""
    body = f"""{top}{subbar}<div class="settwrap">{left}{right}</div>"""
    return wrap_page(body, extra_style=EXTRA_CSS)

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "html", "mockup4_builder.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print("written", out)
