# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from gen_common import icon, wrap_page, NAVY, ACCENT, MUTED, RED, AMBER, GREEN

def topbar():
    return f"""
<div class="topbar">
  <div class="grid-btn">{icon('grid',18,'#fff')}</div>
  <div class="appname">Взыскание задолженности</div>
  <nav>
    <span class="active">Дела</span>
    <span>Мероприятия</span>
    <span>Претензионно-исковая работа</span>
    <span>Отчётность</span>
    <span>Настройка</span>
  </nav>
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

def card(name, ls, addr, rating, group_cls, group_label, sumdebt, pen, avatar_cls, avatar_txt, due, due_overdue=False, icons=("mail",)):
    rate_cls = {"A":"rA","B":"rB","C":"rC"}[rating]
    due_cls = "overdue" if due_overdue else ""
    icon_html = "".join(icon(i,13,MUTED) for i in icons)
    return f"""
<div class="card">
  <div class="top-row">
    <div><div class="name">{name}</div><div class="subinfo">ЛС {ls} · {addr}</div></div>
    {icon('star-o',14,'#c7cdd3')}
  </div>
  <div class="metarow">
    <span class="ratedot {rate_cls}">{rating}</span>
    <span class="pill {group_cls}">{group_label}</span>
  </div>
  <div class="sum">{sumdebt} р. <small>+ пеня {pen} р.</small></div>
  <div class="bottom-row">
    <div class="icons">{icon_html}<span class="{due_cls}">{icon('clock',12)} {due}</span></div>
    <div class="avatar-sm {avatar_cls}">{avatar_txt}</div>
  </div>
</div>"""

def column(title, count, cards_html, bar_color):
    return f"""
<div class="col">
  <div class="col-head"><div class="title">{title}</div><div class="head-actions"><span class="count">{count}</span>{icon('plus',14,MUTED)}</div></div>
  <div class="progressbar"><div style="width:100%;background:{bar_color}"></div></div>
  {cards_html}
</div>"""

def build():
    # Каждая стадия воронки закреплена ровно за одной группой задолженности:
    # Новый должник = Группа 1, Автообзвон/уведомления = Группа 2, Предупреждение вручено = Группа 3,
    # Отключение услуг / Испол. надпись-иск / ОПИ = Группа 4 (три завершающих стадии одной группы).
    c1 = (
        card("Соловьёва Марина Дмитриевна","0061102","ул. Октябрьская, д.3, кв.15","A","g1","Группа 1","310,00","0,00","a4","ОК","Сегодня",icons=()) +
        card("Гриценко Павел Олегович","0061980","пр. Independence, д.140, кв.6","A","g1","Группа 1","95,40","0,00","a2","СМ","Сегодня",icons=()) +
        card("ЧУП «Сервис-Плюс»","0062210","ул. Гикало, д.19","B","g1","Группа 1","1 250,00","0,00","a3","НТ","Завтра",icons=()) +
        card("Крупенько Виктор Адамович","0063311","ул. Мельникайте, д.8, кв.21","A","g1","Группа 1","180,00","0,00","a2","СМ","Завтра",icons=())
    )
    c2 = (
        card("Иванова Анна Петровна","0032451","ул. Захарова, д.14, кв.56","B","g2","Группа 2","842,50","130,20","a1","ПИ","Через 2 дня",icons=("mail",)) +
        card("Ефремова Ольга Ивановна","0029981","ул. Мясникова, д.22, кв.101","B","g2","Группа 2","1 980,40","410,60","a4","ОК","Завтра",icons=("phone",)) +
        card("ООО «Гарант-Сервис»","0038890","ул. Есенина, д.9, кв.3","B","g2","Группа 2","3 410,00","640,00","a3","НТ","Через 4 дня",icons=())
    )
    c3 = (
        card("Мельник Татьяна Викторовна","0055321","ул. Сурганова, д.30, кв.8","B","g3","Группа 3","2 340,00","520,00","a5","ЮК","Вручено 05.07",icons=("doc",)) +
        card("Костюк Елена Леонидовна","0027745","ул. Тимирязева, д.65, кв.9","B","g3","Группа 3","11 200,00","3 050,00","a5","ЮК","Вручено 03.07",icons=("doc",)) +
        card("Барановский Игорь Казимирович","0012098","ул. Веры Хоружей, д.11, кв.19","B","g3","Группа 3","4 120,00","980,00","a3","НТ","Вручено 02.07",icons=("doc",))
    )
    c4 = (
        card("Дубровская Наталья Павловна","0044556","ул. Красная, д.2, кв.77","C","g4","Группа 4","6 780,00","1 640,00","a6","ВА","Наряд от 07.07",icons=("flag",))
    )
    c5 = (
        card("Сидорчук Вадим Леонидович","0009917","ул. Чкалова, д.40, кв.5","C","g4","Группа 4","18 460,00","5 220,00","a5","ЮК","Подано 04.07",due_overdue=True,icons=("flag",)) +
        card("Кравцов Олег Станиславович","0008120","ул. Одоевского, д.15, кв.2","C","g4","Группа 4","9 340,00","2 610,00","a6","ВА","Подано 28.06",due_overdue=True,icons=("flag",))
    )
    c6 = (
        card("Ярошевич Инна Брониславовна","0007745","ул. Толбухина, д.6, кв.31","C","g4","Группа 4","24 120,00","7 380,00","a5","ЮК","Передано 20.06",due_overdue=True,icons=("flag","doc"))
    )
    body = f"""
{topbar()}{subbar()}
<div class="body">
  <div class="kanban">
    {column("Новый должник",14,c1,GREEN)}
    {column("Автообзвон/уведомления",31,c2,ACCENT)}
    {column("Предупреждение вручено",18,c3,AMBER)}
    {column("Отключение услуг",3,c4,'#C77B3E')}
    {column("Испол. надпись / иск",2,c5,RED)}
    {column("ОПИ",2,c6,'#7A2E2E')}
  </div>
</div>
"""
    return wrap_page(body)

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "html", "mockup7_allstages.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print("written", out)
