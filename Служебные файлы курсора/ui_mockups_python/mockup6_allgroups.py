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

def card(name, ls, addr, rating, sumdebt, pen, avatar_cls, avatar_txt, stage, icons=("mail",)):
    rate_cls = {"A":"rA","B":"rB","C":"rC"}[rating]
    icon_html = "".join(icon(i,13,MUTED) for i in icons)
    return f"""
<div class="card">
  <div class="top-row">
    <div><div class="name">{name}</div><div class="subinfo">ЛС {ls} · {addr}</div></div>
    {icon('star-o',14,'#c7cdd3')}
  </div>
  <div class="metarow">
    <span class="ratedot {rate_cls}">{rating}</span>
    <span style="color:{MUTED};font-size:11px">{stage}</span>
  </div>
  <div class="sum">{sumdebt} р. <small>+ пеня {pen} р.</small></div>
  <div class="bottom-row">
    <div class="icons">{icon_html}</div>
    <div class="avatar-sm {avatar_cls}">{avatar_txt}</div>
  </div>
</div>"""

def column(title, subtitle, count, cards_html, bar_color):
    return f"""
<div class="col">
  <div class="col-head"><div class="title">{title}<div style="font-weight:500;color:{MUTED};font-size:10.5px;margin-top:2px">{subtitle}</div></div><div class="head-actions"><span class="count">{count}</span></div></div>
  <div class="progressbar"><div style="width:100%;background:{bar_color}"></div></div>
  {cards_html}
</div>"""

def build():
    # Каждый столбик — ровно одна группа задолженности, без пересечений между столбиками.
    g1 = (
        card("Соловьёва Марина Дмитриевна","0061102","ул. Октябрьская, д.3, кв.15","A","310,00","0,00","a4","ОК","Новый должник",icons=()) +
        card("Гриценко Павел Олегович","0061980","пр. Independence, д.140, кв.6","A","95,40","0,00","a2","СМ","Новый должник",icons=()) +
        card("ЧУП «Сервис-Плюс»","0062210","ул. Гикало, д.19","B","1 250,00","0,00","a3","НТ","Автообзвон запланирован",icons=("mail",))
    )
    g2 = (
        card("Иванова Анна Петровна","0032451","ул. Захарова, д.14, кв.56","B","842,50","130,20","a1","ПИ","Автообзвон",icons=("mail",)) +
        card("ООО «Гарант-Сервис»","0038890","ул. Есенина, д.9, кв.3","B","3 410,00","640,00","a3","НТ","Предупреждение вручено",icons=()) +
        card("Ефремова Ольга Ивановна","0029981","ул. Мясникова, д.22, кв.101","B","1 980,40","410,60","a4","ОК","Уведомление направлено",icons=("phone",))
    )
    g3 = (
        card("Костюк Елена Леонидовна","0027745","ул. Тимирязева, д.65, кв.9","B","11 200,00","3 050,00","a5","ЮК","Отключение услуг",icons=("flag",)) +
        card("Барановский Игорь Казимирович","0012098","ул. Веры Хоружей, д.11, кв.19","B","4 120,00","980,00","a3","НТ","Претензия направлена",icons=("doc",))
    )
    g4 = (
        card("Дубровская Наталья Павловна","0044556","ул. Красная, д.2, кв.77","C","6 780,00","1 640,00","a6","ВА","Исполнительная надпись",icons=("flag",)) +
        card("Мельник Татьяна Викторовна","0055321","ул. Сурганова, д.30, кв.8","C","18 460,00","5 220,00","a5","ЮК","Иск в суд",icons=("doc","flag",))
    )
    body = f"""
{topbar()}{subbar()}
<div class="body">
  <div class="kanban">
    {column("Группа 1","просрочка до 1 мес.",14,g1,GREEN)}
    {column("Группа 2","просрочка 1–3 мес.",31,g2,ACCENT)}
    {column("Группа 3","просрочка 3–6 мес.",18,g3,AMBER)}
    {column("Группа 4","просрочка свыше 6 мес.",7,g4,RED)}
  </div>
</div>
"""
    return wrap_page(body)

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "html", "mockup6_allgroups.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print("written", out)
