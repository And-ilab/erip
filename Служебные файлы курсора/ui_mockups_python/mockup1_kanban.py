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
  <div class="crumbs"><span>Дела</span><span>›</span><b>Группа 2 · просрочка 1–3&nbsp;мес.</b></div>
  <div class="searchwrap">
    <div class="searchbox">
      {icon('search',15,'#8b97a2')}
      <div class="chip">Группа: Группа 2 {icon('close',11,'#156082')}</div>
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

def card(name, ls, addr, rating, sumdebt, pen, avatar_cls, avatar_txt, due, due_overdue=False, icons=("mail",)):
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
    <span style="color:{MUTED};font-size:11px">рейтинг должника</span>
  </div>
  <div class="sum">{sumdebt} р. <small>+ пеня {pen} р.</small></div>
  <div class="bottom-row">
    <div class="icons">{icon_html}<span class="{due_cls}">{icon('clock',12)} {due}</span></div>
    <div class="avatar-sm {avatar_cls}">{avatar_txt}</div>
  </div>
</div>"""

def column(title, count, cards_html, bar_color):
    body = cards_html if cards_html else '<div class="col-empty">Нет дел на этом этапе<br>(за пределами Группы 2)</div>'
    return f"""
<div class="col">
  <div class="col-head"><div class="title">{title}</div><div class="head-actions"><span class="count">{count}</span>{icon('plus',14,MUTED)}</div></div>
  <div class="progressbar"><div style="width:100%;background:{bar_color}"></div></div>
  {body}
</div>"""

def build():
    # Отбор ограничен Группой 2 — по бизнес-правилу каждая стадия воронки закреплена
    # за одной группой (см. макет «Все группы»), поэтому дела Группы 2 есть ТОЛЬКО
    # на стадии «Автообзвон/уведомления»; остальные стадии на этом отборе пустые.
    c_autodial = (
        card("Иванова Анна Петровна","0032451","ул. Захарова, д.14, кв.56","B","842,50","130,20","a1","ПИ","Через 2 дня",icons=("mail",)) +
        card("ООО «Гарант-Сервис»","0038890","ул. Есенина, д.9, кв.3","B","3 410,00","640,00","a3","НТ","Через 4 дня",icons=()) +
        card("Ковалёв Сергей Николаевич","0041207","пр. Пушкина, д.5, кв.12","A","215,00","8,10","a2","СМ","Сегодня",icons=("mail",)) +
        card("Ефремова Ольга Ивановна","0029981","ул. Мясникова, д.22, кв.101","B","1 980,40","410,60","a4","ОК","Завтра",icons=("phone",)) +
        card("Шевчук Роман Александрович","0017754","ул. Кальварийская, д.7, кв.44","B","760,00","95,00","a1","ПИ","3 дня назад",due_overdue=True,icons=("phone","mail"))
    )
    body = f"""
{topbar()}{subbar()}
<div class="body">
  <div class="kanban">
    {column("Новый должник",0,"",GREEN)}
    {column("Автообзвон/уведомления",31,c_autodial,ACCENT)}
    {column("Предупреждение вручено",0,"",AMBER)}
    {column("Отключение услуг",0,"",'#C77B3E')}
    {column("Испол. надпись / иск",0,"",RED)}
    {column("ОПИ",0,"",'#7A2E2E')}
    <div class="addcol"><button class="btn">{icon('plus',13,MUTED)}Этап</button></div>
  </div>
</div>
"""
    return wrap_page(body)

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "html", "mockup1_kanban.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print("written", out)
