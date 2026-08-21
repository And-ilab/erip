# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from gen_common import icon, wrap_page, NAVY, ACCENT, ACCENT_LIGHT, MUTED, RED, AMBER, GREEN, BORDER, TEXT

EXTRA_CSS = f"""
.listwrap {{ background:#fff; margin:16px 20px; border:1px solid {BORDER}; border-radius:6px; overflow:hidden; }}
table.evt {{ width:100%; border-collapse:collapse; font-size:12px; }}
table.evt th {{ text-align:left; color:{MUTED}; font-weight:600; padding:9px 14px; border-bottom:1px solid {BORDER}; background:#FAFBFC; }}
table.evt td {{ padding:9px 14px; border-bottom:1px solid #EEF1F3; }}
tr.grp td {{ background:#F4F6F8; font-weight:700; color:{TEXT}; border-bottom:1px solid {BORDER}; padding:8px 14px; }}
.stchip {{ font-size:10.5px; font-weight:700; padding:3px 8px; border-radius:10px; display:inline-flex; align-items:center; gap:5px; }}
.st-assigned {{ background:{ACCENT_LIGHT}; color:{ACCENT}; }}
.st-progress {{ background:#EFEAF8; color:#6B4FA0; }}
.st-done {{ background:#E7F2EA; color:{GREEN}; }}
.st-cancel {{ background:#F1F1F1; color:{MUTED}; }}
.st-error {{ background:#FAE6E3; color:{RED}; }}
.avatar-sm2 {{ width:22px; height:22px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:9.5px; font-weight:700; color:#fff; margin-right:6px; vertical-align:middle;}}

.sectiontitle {{ font-size:13px; font-weight:700; margin:22px 20px 8px; color:{TEXT}; display:flex; align-items:center; gap:8px;}}
.matrixwrap {{ background:#fff; margin:0 20px 20px; border:1px solid {BORDER}; border-radius:6px; overflow:hidden; }}
table.matrix {{ width:100%; border-collapse:collapse; font-size:11.5px; }}
table.matrix th {{ text-align:center; color:{MUTED}; font-weight:600; padding:8px 10px; border-bottom:1px solid {BORDER}; border-left:1px solid #EEF1F3; background:#FAFBFC; }}
table.matrix th:first-child {{ text-align:left; border-left:none; }}
table.matrix td {{ text-align:center; padding:8px 10px; border-bottom:1px solid #EEF1F3; border-left:1px solid #EEF1F3; }}
table.matrix td:first-child {{ text-align:left; border-left:none; font-weight:600; }}
.mcell {{ display:inline-block; font-size:10.5px; font-weight:700; padding:3px 7px; border-radius:4px; }}
"""

def row(title, debtor, ls, executor_initials, executor_color, next_action, next_ok, stage):
    icon_ok = icon('check',11,GREEN) if next_ok else icon('clock',11,AMBER)
    return f"""<tr>
  <td><input type="checkbox"> {icon('star-o',12,'#c7cdd3')} {title}</td>
  <td>{debtor}<div style="color:{MUTED};font-size:10.5px;margin-top:2px">ЛС {ls}</div></td>
  <td><span class="avatar-sm2" style="background:{executor_color}">{executor_initials}</span>{'' }</td>
  <td>{icon_ok} {next_action}</td>
  <td>{stage}</td>
</tr>"""

def build():
    top = f"""
<div class="topbar">
  <div class="grid-btn">{icon('grid',18,'#fff')}</div>
  <div class="appname">Взыскание задолженности</div>
  <nav><span>Дела</span><span class="active">Мероприятия</span><span>Претензионно-исковая работа</span><span>Отчётность</span><span>Настройка</span></nav>
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
  <div class="crumbs"><b>Реестр мероприятий</b></div>
  <div class="searchwrap">
    <div class="searchbox">
      {icon('search',15,'#8b97a2')}
      <div class="chip">Период: июль 2026 {icon('close',11,'#156082')}</div>
      <input placeholder="Поиск по ЛС, должнику, типу мероприятия...">
      {icon('chevron-down',14,'#8b97a2')}
    </div>
  </div>
  <div class="viewswitch">
    <div class="v">{icon('kanban',15)}</div>
    <div class="v active">{icon('list',15)}</div>
    <div class="v">{icon('calendar',15)}</div>
  </div>
</div>"""
    table = f"""
<div class="listwrap">
<table class="evt">
<tr><th style="width:30%">Мероприятие</th><th>Должник</th><th>Исполнитель</th><th>Следующее действие</th><th>Статус</th></tr>
<tr class="grp"><td colspan="5">Назначено (12)</td></tr>
{row('Автообзвон — партия №118','Ефремова Ольга Ивановна','0029981','ОК','#B8862E','Через 3 часа',False,'<span class="stchip st-assigned">Назначено</span>')}
{row('Рассылка e-mail — напоминание','Шевчук Роман Александрович','0017754','—','#8b97a2','Сегодня, 14:00',False,'<span class="stchip st-assigned">Назначено</span>')}
<tr class="grp"><td colspan="5">Выполняется (5)</td></tr>
{row('Автообзвон — партия №117','ООО «Гарант-Сервис»','0038890','НТ','#B8862E','Дозвон...',False,'<span class="stchip st-progress">Выполняется</span>')}
<tr class="grp"><td colspan="5">Завершено (238)</td></tr>
{row('Предупреждение вручено лично','Мельник Татьяна Викторовна','0055321','ЮК','#B23A2E','Вручено 05.07',True,'<span class="stchip st-done">Завершено</span>')}
{row('Отключение услуг — заказ-наряд','Дубровская Наталья Павловна','0044556','ВА','#2C6FA8','Отключено 01.07',True,'<span class="stchip st-done">Завершено</span>')}
<tr class="grp"><td colspan="5">Завершено с ошибкой (3)</td></tr>
{row('Автообзвон — недозвон (3 попытки)','Барановский Игорь Казимирович','0012098','НТ','#B8862E','Требуется ручной звонок',False,'<span class="stchip st-error">Ошибка</span>')}
</table>
</div>
<div class="sectiontitle">{icon('kanban',15,ACCENT)} Мероприятия по типам (представление «Матрица»)</div>
<div class="matrixwrap">
<table class="matrix">
<tr><th style="text-align:left">ФИО должника</th><th>ЛС</th><th>Автообзвон</th><th>E-mail</th><th>Предупреждение</th><th>Отключение услуг</th><th>Испол. надпись</th></tr>
<tr><td>Иванова Анна Петровна</td><td>0032451</td><td><span class="mcell" style="background:#E7F2EA;color:{GREEN}">09.07</span></td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
<tr><td>Ефремова Ольга Ивановна</td><td>0029981</td><td><span class="mcell" style="background:{ACCENT_LIGHT};color:{ACCENT}">через 3ч</span></td><td><span class="mcell" style="background:#E7F2EA;color:{GREEN}">07.07</span></td><td>—</td><td>—</td><td>—</td></tr>
<tr><td>Мельник Татьяна Викторовна</td><td>0055321</td><td><span class="mcell" style="background:#E7F2EA;color:{GREEN}">01.07</span></td><td><span class="mcell" style="background:#E7F2EA;color:{GREEN}">02.07</span></td><td><span class="mcell" style="background:#E7F2EA;color:{GREEN}">05.07</span></td><td>—</td><td>—</td></tr>
<tr><td>Дубровская Наталья Павловна</td><td>0044556</td><td><span class="mcell" style="background:#E7F2EA;color:{GREEN}">25.06</span></td><td><span class="mcell" style="background:#E7F2EA;color:{GREEN}">26.06</span></td><td><span class="mcell" style="background:#E7F2EA;color:{GREEN}">28.06</span></td><td><span class="mcell" style="background:#E7F2EA;color:{GREEN}">01.07</span></td><td>—</td></tr>
<tr><td>Барановский Игорь Казимирович</td><td>0012098</td><td><span class="mcell" style="background:#FAE6E3;color:{RED}">ошибка</span></td><td><span class="mcell" style="background:#E7F2EA;color:{GREEN}">20.06</span></td><td><span class="mcell" style="background:#E7F2EA;color:{GREEN}">02.07</span></td><td><span class="mcell" style="background:#FBF0DD;color:{AMBER}">ожидается</span></td><td>—</td></tr>
</table>
</div>
"""
    return wrap_page(top + subbar + table, extra_style=EXTRA_CSS)

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "html", "mockup3_events.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print("written", out)
