# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from gen_common import icon, wrap_page, NAVY, ACCENT, ACCENT_LIGHT, MUTED, RED, AMBER, GREEN, BORDER, TEXT

EXTRA_CSS = f"""
.listwrap {{ background:#fff; margin:16px 20px; border:1px solid {BORDER}; border-radius:6px; overflow:hidden; }}
table.reg {{ width:100%; border-collapse:collapse; font-size:12px; }}
table.reg th {{ text-align:left; color:{MUTED}; font-weight:600; padding:9px 12px; border-bottom:1px solid {BORDER}; background:#FAFBFC; white-space:nowrap; }}
table.reg td {{ padding:8px 12px; border-bottom:1px solid #EEF1F3; vertical-align:middle; }}
table.reg th.num, table.reg td.num {{ text-align:right; }}
tr.grp td {{ background:#F4F6F8; font-weight:700; color:{TEXT}; border-bottom:1px solid {BORDER}; padding:8px 12px; }}
tr.grp td .agg {{ font-weight:700; }}
tr.total td {{ background:#EEF3F6; font-weight:700; border-top:2px solid {BORDER}; }}
.gpill {{ font-size:10.5px; font-weight:700; border-radius:3px; padding:2px 7px; margin-left:8px; }}
.stagechip {{ font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:10px; white-space:nowrap; }}
.ratedot2 {{ width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:800; color:#fff; }}
.av2 {{ width:22px; height:22px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:9.5px; font-weight:700; color:#fff; margin-right:6px; vertical-align:middle; }}
.subls {{ color:{MUTED}; font-size:10.5px; margin-top:2px; }}
"""

STAGE_COLORS = {
    "Новый должник": ("#E7F2EA", GREEN),
    "Автообзвон/уведомления": (ACCENT_LIGHT, ACCENT),
    "Предупреждение вручено": ("#FBF0DD", AMBER),
    "Отключение услуг": ("#F7E8D9", "#C77B3E"),
    "Испол. надпись / иск": ("#FAE6E3", RED),
    "ОПИ": ("#F0DCDC", "#7A2E2E"),
}

def stagechip(name):
    bg, fg = STAGE_COLORS[name]
    return f'<span class="stagechip" style="background:{bg};color:{fg}">{name}</span>'

def row(name, ls, addr, rating, stage, main, pen, total, sp_cls, sp_txt):
    rc = {"A":"rA","B":"rB","C":"rC"}[rating]
    return f"""<tr>
  <td><input type="checkbox"></td>
  <td><b>{name}</b><div class="subls">ЛС {ls}</div></td>
  <td>{addr}</td>
  <td style="text-align:center"><span class="ratedot2 {rc}">{rating}</span></td>
  <td>{stagechip(stage)}</td>
  <td class="num">{main}</td>
  <td class="num" style="color:{RED}">{pen}</td>
  <td class="num"><b>{total}</b></td>
  <td><span class="av2 {sp_cls}">{sp_txt}</span></td>
</tr>"""

def grp(label, pill_cls, count, total):
    return f"""<tr class="grp">
  <td colspan="5">{icon('chevron-down',12,MUTED)} {label}<span class="pill {pill_cls} gpill">{count} дел</span></td>
  <td class="num" colspan="2"></td>
  <td class="num agg">{total}</td>
  <td></td>
</tr>"""

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
      <div class="chip">Группировать по: Группа задолженности {icon('close',11,'#156082')}</div>
      <input placeholder="Поиск по ФИО, организации, ЛС, адресу...">
      {icon('chevron-down',14,'#8b97a2')}
    </div>
  </div>
  <div class="viewswitch">
    <div class="v">{icon('kanban',15)}</div>
    <div class="v active">{icon('list',15)}</div>
    <div class="v">{icon('calendar',15)}</div>
    <div class="v">{icon('bar-chart',15)}</div>
  </div>
</div>"""
    table = f"""
<div class="listwrap">
<table class="reg">
<tr>
  <th style="width:26px"><input type="checkbox"></th>
  <th>ФИО должника / наименование</th>
  <th>Адрес</th>
  <th style="text-align:center">Рейтинг</th>
  <th>Этап воронки</th>
  <th class="num">Долг по услугам</th>
  <th class="num">Пеня</th>
  <th class="num">Итого</th>
  <th>Специалист</th>
</tr>
{grp('Группа 1 · просрочка до 1 мес.','g1',14,'12 400,00 р.')}
{row('Соловьёва Марина Дмитриевна','0061102','ул. Октябрьская, д.3, кв.15','A','Новый должник','310,00','0,00','310,00','a4','ОК')}
{row('Гриценко Павел Олегович','0061980','пр. Independence, д.140, кв.6','A','Новый должник','95,40','0,00','95,40','a2','СМ')}
{row('ЧУП «Сервис-Плюс»','0062210','ул. Гикало, д.19','B','Новый должник','1 250,00','0,00','1 250,00','a3','НТ')}
{row('Крупенько Виктор Адамович','0063311','ул. Мельникайте, д.8, кв.21','A','Новый должник','180,00','0,00','180,00','a2','СМ')}
{grp('Группа 2 · просрочка 1–3 мес.','g2',31,'48 900,00 р.')}
{row('Иванова Анна Петровна','0032451','ул. Захарова, д.14, кв.56','B','Автообзвон/уведомления','712,30','130,20','842,50','a1','ПИ')}
{row('Ефремова Ольга Ивановна','0029981','ул. Мясникова, д.22, кв.101','B','Автообзвон/уведомления','1 569,80','410,60','1 980,40','a4','ОК')}
{row('ООО «Гарант-Сервис»','0038890','ул. Есенина, д.9, кв.3','B','Автообзвон/уведомления','2 770,00','640,00','3 410,00','a3','НТ')}
{grp('Группа 3 · просрочка 3–6 мес.','g3',18,'64 200,00 р.')}
{row('Мельник Татьяна Викторовна','0055321','ул. Сурганова, д.30, кв.8','B','Предупреждение вручено','1 820,00','520,00','2 340,00','a5','ЮК')}
{row('Костюк Елена Леонидовна','0027745','ул. Тимирязева, д.65, кв.9','B','Предупреждение вручено','8 150,00','3 050,00','11 200,00','a5','ЮК')}
{row('Барановский Игорь Казимирович','0012098','ул. Веры Хоружей, д.11, кв.19','B','Предупреждение вручено','3 140,00','980,00','4 120,00','a3','НТ')}
{grp('Группа 4 · просрочка свыше 6 мес.','g4',7,'96 400,00 р.')}
{row('Дубровская Наталья Павловна','0044556','ул. Красная, д.2, кв.77','C','Отключение услуг','5 140,00','1 640,00','6 780,00','a6','ВА')}
{row('Сидорчук Вадим Леонидович','0009917','ул. Чкалова, д.40, кв.5','C','Испол. надпись / иск','13 240,00','5 220,00','18 460,00','a5','ЮК')}
{row('Кравцов Олег Станиславович','0008120','ул. Одоевского, д.15, кв.2','C','Испол. надпись / иск','6 730,00','2 610,00','9 340,00','a6','ВА')}
{row('Ярошевич Инна Брониславовна','0007745','ул. Толбухина, д.6, кв.31','C','ОПИ','16 740,00','7 380,00','24 120,00','a5','ЮК')}
<tr class="total">
  <td></td>
  <td>Итого: 70 дел</td>
  <td></td><td></td><td></td>
  <td class="num">181 320,00</td>
  <td class="num" style="color:{RED}">40 580,00</td>
  <td class="num">221 900,00 р.</td>
  <td></td>
</tr>
</table>
</div>"""
    return wrap_page(top + subbar + table, extra_style=EXTRA_CSS)

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "html", "mockup8_list.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print("written", out)
