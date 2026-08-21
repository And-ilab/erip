# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from gen_common import icon, wrap_page, NAVY, ACCENT, ACCENT_LIGHT, MUTED, RED, AMBER, GREEN, BORDER, TEXT

EXTRA_CSS = f"""
.settwrap {{ display:flex; gap:16px; margin:16px 20px; align-items:flex-start; }}
.orgs {{ width:390px; flex:none; background:#fff; border:1px solid {BORDER}; border-radius:6px; overflow:hidden; }}
.orgs .hd {{ padding:11px 14px; font-size:12.5px; font-weight:700; border-bottom:1px solid {BORDER}; background:#FAFBFC; display:flex; justify-content:space-between; align-items:center; }}
.org {{ padding:11px 14px; border-bottom:1px solid #EEF1F3; display:flex; align-items:center; gap:10px; }}
.org.sel {{ background:{ACCENT_LIGHT}; }}
.org .nm {{ font-size:12.5px; font-weight:700; }}
.org .meta {{ font-size:10.5px; color:{MUTED}; margin-top:2px; }}
.org .st {{ margin-left:auto; font-size:10px; font-weight:700; padding:2px 7px; border-radius:10px; }}
.usr {{ flex:1; background:#fff; border:1px solid {BORDER}; border-radius:6px; padding:18px 22px; }}
.usr h2 {{ font-size:15px; font-weight:700; }}
.usr .hint {{ color:{MUTED}; font-size:11.5px; margin-top:3px; margin-bottom:12px; }}
table.u {{ width:100%; border-collapse:collapse; font-size:12px; }}
table.u th {{ text-align:left; color:{MUTED}; font-weight:600; padding:8px 10px; border-bottom:1px solid {BORDER}; }}
table.u td {{ padding:8px 10px; border-bottom:1px solid #EEF1F3; vertical-align:middle; }}
.rolechip {{ font-size:10.5px; font-weight:700; padding:3px 9px; border-radius:10px; background:{ACCENT_LIGHT}; color:{ACCENT}; white-space:nowrap; }}
.uchip {{ font-size:10px; font-weight:700; padding:2px 8px; border-radius:10px; }}
.av3 {{ width:24px; height:24px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:9.5px; font-weight:700; color:#fff; margin-right:8px; vertical-align:middle; }}
.ubar {{ display:flex; gap:10px; margin-bottom:14px; }}
"""

def org(name, meta, sel=False, active=True):
    st = f'<span class="st" style="background:#E7F2EA;color:{GREEN}">активна</span>' if active else f'<span class="st" style="background:#F0F2F4;color:{MUTED}">отключена</span>'
    return f"""<div class="org {'sel' if sel else ''}">
  {icon('building',16,ACCENT if sel else MUTED)}
  <div><div class="nm">{name}</div><div class="meta">{meta}</div></div>
  {st}
</div>"""

def usr(av_cls, av, name, login, role, status_html, last):
    return f"""<tr>
  <td><span class="av3 {av_cls}">{av}</span><b>{name}</b></td>
  <td style="color:{MUTED}">{login}</td>
  <td><span class="rolechip">{role}</span></td>
  <td>{status_html}</td>
  <td style="color:{MUTED}">{last}</td>
  <td style="color:{MUTED}">{icon('gear',14)}</td>
</tr>"""

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
  <button class="btn">{icon('plus',14,'#fff')}Новая организация</button>
  <div class="crumbs"><span>Настройка</span><span>›</span><b>Организации и пользователи</b></div>
  <div class="searchwrap">
    <div class="searchbox">
      {icon('search',15,'#8b97a2')}
      <input placeholder="Поиск по организации, пользователю, логину...">
      {icon('chevron-down',14,'#8b97a2')}
    </div>
  </div>
</div>"""
    active_ok = f'<span class="uchip" style="background:#E7F2EA;color:{GREEN}">активен</span>'
    blocked = f'<span class="uchip" style="background:#FAE6E3;color:{RED}">заблокирован</span>'
    left = f"""
<div class="orgs">
  <div class="hd">Организации (14) <span style="color:{MUTED};font-weight:400;font-size:11px">изолированные контуры данных</span></div>
  {org("РСЦ Минска","48 пользователей · 612 400 ЛС · лок. администратор: Ткачук Н.В.",sel=True)}
  {org("РСЦ Гомеля","31 пользователь · 218 300 ЛС · лок. администратор: Зайцева О.Л.")}
  {org("ЖЭС №5 г. Могилёва","12 пользователей · 41 200 ЛС · лок. администратор: Романюк Д.А.")}
  {org("ТС «Восток-3»","3 пользователя · 480 ЛС · лок. администратор: Гулевич С.И.")}
  {org("КУП «Гродножилкомхоз»","19 пользователей · 96 700 ЛС · передано в ЮС",active=True)}
  {org("ЖЭС №2 г. Бреста","0 пользователей · подключение приостановлено",active=False)}
</div>"""
    right = f"""
<div class="usr">
  <h2>Пользователи — РСЦ Минска</h2>
  <div class="hint">Учётные записи ведутся в разрезе организации (X.3). Роль назначается в рамках организации; при деактивации пользователя его задания и «частные» мероприятия переназначаются автоматически (VII.3).</div>
  <div class="ubar">
    <button class="btn small">{icon('plus',12,'#fff')}Новый пользователь</button>
    <button class="btn secondary small">Группы прав</button>
    <button class="btn secondary small">{icon('download',12)}Экспорт</button>
  </div>
  <table class="u">
    <tr><th>Пользователь</th><th>Логин</th><th>Роль</th><th>Статус</th><th>Последний вход</th><th></th></tr>
    {usr('a1','ПИ','Петров Иван Иванович','i.petrov','Специалист с правами согласования',active_ok,'09.07.2026, 15:42')}
    {usr('a4','ОК','Ковальчук Ольга Николаевна','o.kovalchuk','Специалист',active_ok,'09.07.2026, 14:18')}
    {usr('a3','НТ','Терехова Наталья Викторовна','n.terekhova','Специалист',active_ok,'09.07.2026, 11:05')}
    {usr('a2','СМ','Мороз Сергей Павлович','s.moroz','Специалист',active_ok,'08.07.2026, 17:31')}
    {usr('a5','ЮК','Корзун Юлия Андреевна','y.korzun','Специалист ЮС с правами согласования',active_ok,'09.07.2026, 15:10')}
    {usr('a6','ВА','Астапенко Виктор Михайлович','v.astapenko','Пользователь поставщика услуг (ГВС)',active_ok,'07.07.2026, 09:44')}
    {usr('a6','ТН','Ткачук Нина Васильевна','n.tkachuk','Локальный администратор',active_ok,'09.07.2026, 08:02')}
    {usr('a2','ЛР','Рудак Леонид Иосифович','l.rudak','Специалист',blocked,'24.06.2026, 16:55')}
  </table>
</div>"""
    body = f'{top}{subbar}<div class="settwrap">{left}{right}</div>'
    return wrap_page(body, extra_style=EXTRA_CSS)

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "html", "mockup17_admin.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print("written", out)
