# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from gen_common import icon, wrap_page, NAVY, ACCENT, ACCENT_LIGHT, MUTED, RED, AMBER, GREEN, BORDER, TEXT

EXTRA_CSS = f"""
.tcard {{ background:#fff; border:1px solid {BORDER}; border-radius:6px; padding:10px 11px; margin-bottom:10px; box-shadow:0 1px 2px rgba(20,30,40,.05); }}
.tcard .tt {{ font-weight:700; font-size:12.5px; line-height:1.35; }}
.tcard .obj {{ color:{MUTED}; font-size:10.5px; margin-top:3px; }}
.tcard .meta {{ display:flex; align-items:center; gap:6px; margin-top:8px; flex-wrap:wrap; }}
.prio {{ font-size:10px; font-weight:700; border-radius:3px; padding:2px 6px; }}
.p-high {{ background:#FAE6E3; color:{RED}; }}
.p-mid {{ background:#FBF0DD; color:{AMBER}; }}
.p-low {{ background:#F0F2F4; color:{MUTED}; }}
.tcard .brow {{ display:flex; align-items:center; justify-content:space-between; margin-top:9px; }}
.tcard .due {{ font-size:11px; color:{MUTED}; display:flex; align-items:center; gap:5px; }}
.tcard .due.over {{ color:{RED}; font-weight:700; }}
.flow {{ display:flex; align-items:center; gap:3px; }}
"""

def tcard(title, obj, prio_cls, prio, due, over, from_av, from_txt, to_av, to_txt):
    over_cls = "over" if over else ""
    return f"""
<div class="tcard">
  <div class="tt">{title}</div>
  <div class="obj">{obj}</div>
  <div class="meta"><span class="prio {prio_cls}">{prio}</span></div>
  <div class="brow">
    <div class="due {over_cls}">{icon('clock',12)} {due}</div>
    <div class="flow">
      <div class="avatar-sm {from_av}" title="постановщик">{from_txt}</div>
      {icon('arrow-right',11,MUTED)}
      <div class="avatar-sm {to_av}" title="исполнитель">{to_txt}</div>
    </div>
  </div>
</div>"""

def column(title, count, cards_html, bar_color):
    return f"""
<div class="col" style="width:290px">
  <div class="col-head"><div class="title">{title}</div><div class="head-actions"><span class="count">{count}</span>{icon('plus',14,MUTED)}</div></div>
  <div class="progressbar"><div style="width:100%;background:{bar_color}"></div></div>
  {cards_html}
</div>"""

def build():
    top = f"""
<div class="topbar">
  <div class="grid-btn">{icon('grid',18,'#fff')}</div>
  <div class="appname">Взыскание задолженности</div>
  <nav><span>Дела</span><span>Мероприятия</span><span class="active">Задания</span><span>Претензионно-исковая работа</span><span>Отчётность</span><span>Настройка</span></nav>
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
  <button class="btn">{icon('plus',14,'#fff')}Новое задание</button>
  <div class="crumbs"><span>Задания</span><span>›</span><b>Реестр заданий</b></div>
  <div class="searchwrap">
    <div class="searchbox">
      {icon('search',15,'#8b97a2')}
      <div class="chip">Организация: РСЦ Минска {icon('close',11,'#156082')}</div>
      <div class="chip">Срок: июль 2026 {icon('close',11,'#156082')}</div>
      <input placeholder="Поиск по исполнителю, типу, ЛС...">
      {icon('chevron-down',14,'#8b97a2')}
    </div>
  </div>
  <div class="viewswitch">
    <div class="v active">{icon('kanban',15)}</div>
    <div class="v">{icon('list',15)}</div>
    <div class="v">{icon('calendar',15)}</div>
  </div>
</div>"""
    new = (
        tcard("Позвонить должнику после 3 недозвонов","Дело: ЛС 0012098 · Барановский И.К.","p-high","Высокий","до 10.07",False,"a6","СИС","a3","НТ") +
        tcard("Указать способ и дату направления уведомления","Дело: ЛС 0032451 · Иванова А.П.","p-mid","Средний","до 11.07",False,"a6","СИС","a1","ПИ") +
        tcard("Загрузить выписку о зарегистрированных лицах","Испол. надпись: ЛС 0009917 · Сидорчук В.Л.","p-mid","Средний","до 14.07",False,"a5","ЮК","a5","ЮК")
    )
    work = (
        tcard("Вручить предупреждение под роспись (обход)","Дело: ЛС 0029981 · Ефремова О.И.","p-mid","Средний","до 15.07",False,"a1","ПИ","a4","ОК") +
        tcard("Подготовить пакет документов на испол. надпись","Дело: ЛС 0044556 · Дубровская Н.П.","p-high","Высокий","до 13.07",False,"a1","ПИ","a5","ЮК")
    )
    review = (
        tcard("Согласовать передачу списка на отключение (12 ЛС)","Партия: список на отключение от 08.07","p-high","Высокий","до 10.07",False,"a4","ОК","a1","ПИ") +
        tcard("Согласовать списание безнадёжной задолженности","Дело: ЛС 0005511 · умерший, наследников нет","p-mid","Средний","до 17.07",False,"a5","ЮК","a1","ПИ")
    )
    overdue = (
        tcard("Внести дату фактического отключения ГВС","Заказ-наряд №118 · ЛС 0044556 · Дубровская Н.П.","p-high","Высокий","просрочено 2 дня",True,"a1","ПИ","a6","ВА")
    )
    done = (
        tcard("Сформировать предупреждение из шаблона","Дело: ЛС 0055321 · Мельник Т.В.","p-low","Выполнено 05.07",  "05.07",False,"a6","СИС","a5","ЮК") +
        tcard("Подтвердить приоритетный номер телефона","Карточка должника · Иванова А.П.","p-low","Выполнено 02.07","02.07",False,"a1","ПИ","a4","ОК")
    )
    body = f"""
{top}{subbar}
<div class="body">
  <div class="kanban">
    {column("Новое",4,new,ACCENT)}
    {column("В работе",6,work,'#7C6FA8')}
    {column("На проверке / согласовании",2,review,AMBER)}
    {column("Просрочено",1,overdue,RED)}
    {column("Выполнено",12,done,GREEN)}
  </div>
</div>"""
    return wrap_page(body, extra_style=EXTRA_CSS)

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "html", "mockup15_tasks.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print("written", out)
