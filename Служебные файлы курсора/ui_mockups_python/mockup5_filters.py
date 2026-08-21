# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from gen_common import icon, wrap_page, NAVY, ACCENT, ACCENT_LIGHT, MUTED, RED, AMBER, GREEN, BORDER, TEXT
from mockup6_allgroups import card, column

EXTRA_CSS = f"""
.stagewrap {{ position:relative; }}
.stagewrap + .stagewrap {{ margin-top:26px; border-top:1px solid {BORDER}; }}
.caption {{ font-size:11.5px; font-weight:700; color:{MUTED}; text-transform:uppercase; letter-spacing:.03em; padding:14px 20px 0; }}

.dropdown {{
  background:#fff; border:1px solid {BORDER}; border-radius:6px;
  box-shadow:0 14px 34px rgba(20,30,40,.22); display:flex; padding:14px 0; width:620px;
}}
.dcol {{ padding:0 20px; border-right:1px solid {BORDER}; flex:1; }}
.dcol:last-child {{ border-right:none; }}
.dcol h4 {{ font-size:11px; color:{MUTED}; text-transform:uppercase; letter-spacing:.03em; margin-bottom:8px; display:flex; align-items:center; gap:6px; }}
.dcol .item {{ font-size:12.5px; padding:5px 0; color:{TEXT}; }}
.dcol .sep {{ border-top:1px solid {BORDER}; margin:8px 0; }}
.dcol .item.link {{ color:{ACCENT}; font-weight:600; }}
.favinput {{ border:1px solid {BORDER}; border-radius:4px; padding:5px 8px; font-size:11.5px; width:100%; margin:6px 0; color:{MUTED}; }}
.favchk {{ display:flex; align-items:center; gap:6px; font-size:11.5px; margin-top:4px; }}
.favchk .box {{ width:13px; height:13px; border:1.5px solid {BORDER}; border-radius:2px; }}

.dialog {{ background:#fff; border-radius:8px; box-shadow:0 24px 60px rgba(0,0,0,.3); padding:22px 26px; width:900px;}}
.dialog h3 {{ font-size:15px; font-weight:700; margin-bottom:16px; }}
.matchrow {{ font-size:12.5px; margin-bottom:12px; color:{TEXT}; }}
.matchrow b {{ color:{ACCENT}; }}
.rulerow {{ display:flex; align-items:center; gap:8px; margin-bottom:8px; }}
.rulerow .fld {{ border:1px solid {BORDER}; border-radius:4px; padding:6px 10px; font-size:12px; background:#fcfdfd; width:210px; display:flex; justify-content:space-between; }}
.rulerow .op {{ border:1px solid {BORDER}; border-radius:4px; padding:6px 10px; font-size:12px; background:#fcfdfd; width:110px; display:flex; justify-content:space-between; }}
.rulerow .valpill {{ display:flex; gap:6px; flex:1; }}
.rulerow .valpill span {{ background:{ACCENT_LIGHT}; color:{ACCENT}; font-size:11.5px; font-weight:600; padding:3px 8px; border-radius:3px; }}
.rulerow .rmicons {{ display:flex; gap:8px; color:#bcc4cb; }}
.newrule {{ color:{ACCENT}; font-size:12px; font-weight:600; margin:8px 0 18px; display:inline-flex; align-items:center; gap:5px; }}
.diagbtns {{ display:flex; gap:10px; margin-top:6px; }}
"""

def rule(field, op, values):
    chips = "".join(f"<span>{v}</span>" for v in values)
    return f"""<div class="rulerow">
  <div class="fld">{field} {icon('chevron-down',12,MUTED)}</div>
  <div class="op">{op} {icon('chevron-down',12,MUTED)}</div>
  <div class="valpill">{chips}</div>
  <div class="rmicons">{icon('plus',13)}{icon('kanban',13)}{icon('trash',13)}</div>
</div>"""

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
    <div class="company">{icon('building',14,'#fff')}Все организации<span style="opacity:.8">▾</span></div>
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
      <input placeholder="Поиск по ФИО, организации, ЛС, адресу...">
      {icon('chevron-down',14,'#8b97a2')}
    </div>
  </div>
  <div class="viewswitch">
    <div class="v active">{icon('kanban',15)}</div>
    <div class="v">{icon('list',15)}</div>
    <div class="v">{icon('calendar',15)}</div>
    <div class="v">{icon('bar-chart',15)}</div>
  </div>
</div>"""

def kanban_board():
    g1 = card("Соловьёва Марина Дмитриевна","0061102","ул. Октябрьская, д.3, кв.15","A","310,00","0,00","a4","ОК","Новый должник",icons=())
    g2 = card("Иванова Анна Петровна","0032451","ул. Захарова, д.14, кв.56","B","842,50","130,20","a1","ПИ","Автообзвон",icons=("mail",))
    g3 = card("Костюк Елена Леонидовна","0027745","ул. Тимирязева, д.65, кв.9","B","11 200,00","3 050,00","a5","ЮК","Отключение услуг",icons=("flag",))
    g4 = card("Дубровская Наталья Павловна","0044556","ул. Красная, д.2, кв.77","C","6 780,00","1 640,00","a6","ВА","Исполнительная надпись",icons=("flag",))
    return f"""
<div class="body">
  <div class="kanban">
    {column("Группа 1","просрочка до 1 мес.",14,g1,GREEN)}
    {column("Группа 2","просрочка 1–3 мес.",31,g2,ACCENT)}
    {column("Группа 3","просрочка 3–6 мес.",18,g3,AMBER)}
    {column("Группа 4","просрочка свыше 6 мес.",7,g4,RED)}
  </div>
</div>"""

def build():
    dropdown = f"""
<div class="dropdown">
    <div class="dcol">
      <h4>{icon('filter',13)} Фильтры</h4>
      <div class="item">Мои дела</div>
      <div class="item">Просрочка &gt; 90 дней</div>
      <div class="item">Юридические лица</div>
      <div class="item">Услуги приостановлены</div>
      <div class="item">Наследственное дело</div>
      <div class="sep"></div>
      <div class="item">Дата возникновения долга ▸</div>
      <div class="sep"></div>
      <div class="item link">+ Добавить пользовательский фильтр</div>
    </div>
    <div class="dcol">
      <h4>{icon('kanban',13)} Группировать по</h4>
      <div class="item">Организация</div>
      <div class="item">Группа задолженности</div>
      <div class="item">Рейтинг должника (A/B/C)</div>
      <div class="item">Этап воронки взыскания</div>
      <div class="item">Закреплённый специалист</div>
      <div class="sep"></div>
      <div class="item link">+ Добавить группировку</div>
    </div>
    <div class="dcol">
      <h4>{icon('star',13,'#D9A916')} Избранное</h4>
      <div class="item" style="font-weight:600">Сохранить текущий поиск</div>
      <input class="favinput" value="Группа 3–4 · по организациям">
      <div class="favchk"><div class="box"></div> Использовать по умолчанию</div>
      <div class="favchk"><div class="box"></div> Общий для всех пользователей</div>
      <div class="sep"></div>
      <div class="item">★ Мингаз · должники &gt; 6 мес.</div>
      <div class="item">★ Могилёвская обл. · все организации</div>
    </div>
</div>"""
    stage1 = f"""
<div class="caption">Открыта панель поиска (Фильтры / Группировать по / Избранное) — раскрывается поверх текущей канбан-доски</div>
<div class="stagewrap" style="min-height:430px;">
  {topbar()}{subbar()}{kanban_board()}
  <div class="popover" style="top:96px; left:600px;">{dropdown}</div>
</div>"""
    dialog = f"""
<div class="dialog">
  <h3>Добавить пользовательский фильтр</h3>
  <div class="matchrow">Соответствует <b>любому</b> из следующих условий: <span style="color:{MUTED}">(переключатель «любому» / «всем»)</span></div>
  {rule('Группа задолженности','равно',['Группа 3','Группа 4'])}
  {rule('Организация','входит в',['Мингаз'])}
  <div style="margin-left:26px">
    <div class="matchrow" style="color:{MUTED}">все из:</div>
    {rule('Рейтинг должника','равно',['C'])}
    {rule('Сумма долга','&gt;',['5 000 р.'])}
  </div>
  <div class="newrule">{icon('plus',13,ACCENT)} Новое правило</div>
  <div class="diagbtns">
    <button class="btn">Добавить</button>
    <button class="btn secondary">Отмена</button>
  </div>
</div>"""
    stage2 = f"""
<div class="caption">Нажата кнопка «Добавить пользовательский фильтр» — диалог открывается модальным окном поверх доски</div>
<div class="stagewrap" style="min-height:460px;">
  {topbar()}{subbar()}{kanban_board()}
  <div class="modal-backdrop"></div>
  <div class="modal-box" style="top:78px; left:390px;">{dialog}</div>
</div>"""
    body = f"{stage1}{stage2}"
    return wrap_page(body, extra_style=EXTRA_CSS, app_height="min-height:1000px;")

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "html", "mockup5_filters.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print("written", out)
