# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from gen_common import icon, wrap_page, NAVY, ACCENT, ACCENT_LIGHT, MUTED, RED, AMBER, GREEN, BORDER, TEXT

EXTRA_CSS = f"""
.formtop {{ background:#fff; border-bottom:1px solid {BORDER}; padding:8px 20px; display:flex; align-items:center; gap:10px; }}
.formcard {{ background:#fff; margin:16px 20px; border:1px solid {BORDER}; border-radius:6px; padding:20px 24px; }}
.formhead {{ display:flex; justify-content:space-between; align-items:flex-start; }}
.formhead h1 {{ font-size:19px; font-weight:700; }}
.formhead .sub {{ color:{MUTED}; font-size:12px; margin-top:3px; }}
.badges {{ display:flex; gap:8px; align-items:center; }}
.tag {{ font-size:10.5px; font-weight:700; border-radius:3px; padding:3px 8px; }}
.fields {{ display:grid; grid-template-columns:1fr 1fr; gap:16px 40px; margin-top:18px; }}
.f label {{ font-size:11px; color:{MUTED}; display:block; margin-bottom:3px; }}
.f .val {{ font-size:13px; font-weight:500; }}
.f .val a {{ color:{ACCENT}; text-decoration:none; }}
.tabsrow {{ display:flex; gap:22px; margin-top:22px; border-bottom:1px solid {BORDER}; }}
.tabsrow .tab {{ padding:9px 2px; font-size:12.5px; color:{MUTED}; border-bottom:2px solid transparent; }}
.tabsrow .tab.active {{ color:{TEXT}; font-weight:700; border-color:{NAVY}; }}
table.dtab {{ width:100%; border-collapse:collapse; margin-top:14px; font-size:12px; }}
table.dtab th {{ text-align:left; color:{MUTED}; font-weight:600; padding:7px 8px; border-bottom:1px solid {BORDER}; }}
table.dtab td {{ padding:8px 8px; border-bottom:1px solid #EEF1F3; }}
table.dtab td.num, table.dtab th.num {{ text-align:right; }}
.contact {{ display:flex; align-items:center; gap:8px; font-size:12.5px; padding:6px 0; }}
.contact .lbl {{ font-size:10px; font-weight:700; border-radius:3px; padding:2px 6px; }}
.enrich {{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-top:14px; }}
.enrich .src {{ border:1px solid {BORDER}; border-radius:6px; padding:12px 14px; }}
.enrich .src h5 {{ font-size:11px; color:{MUTED}; text-transform:uppercase; letter-spacing:.03em; margin-bottom:7px; }}
.enrich .src .v {{ font-size:12.5px; font-weight:600; display:flex; align-items:center; gap:7px; }}
.enrich .src .d {{ font-size:10.5px; color:{MUTED}; margin-top:5px; }}
.cols2 {{ display:flex; gap:36px; margin-top:6px; }}
.cols2 > div {{ flex:1; }}
.blocklbl {{ font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; color:{MUTED}; margin:20px 0 4px; }}
"""

def build():
    top = f"""
<div class="topbar">
  <div class="grid-btn">{icon('grid',18,'#fff')}</div>
  <div class="appname">Взыскание задолженности</div>
  <nav><span>Дела</span><span class="active">Должники</span><span>Мероприятия</span><span>Претензионно-исковая работа</span><span>Отчётность</span><span>Настройка</span></nav>
  <div class="spacer"></div>
  <div class="tools">
    <div class="badge-dot" data-n="5">{icon('mail',18,'#fff')}</div>
    <div class="badge-dot" data-n="12">{icon('clock',18,'#fff')}</div>
    <div class="company">{icon('building',14,'#fff')}РСЦ Минска<span style="opacity:.8">▾</span></div>
    <div class="avatar">ИП</div>
  </div>
</div>"""
    formtop = f"""
<div class="formtop">
  <div class="crumbs"><span>Должники</span><span>›</span><span>Физические лица</span><span>›</span><b>Иванова А.П.</b></div>
</div>"""
    body = f"""
<div class="formcard">
  <div class="formhead">
    <div>
      <h1>Иванова Анна Петровна</h1>
      <div class="sub">Физическое лицо &nbsp;·&nbsp; идентификационный № 4120585А000РВ1 &nbsp;·&nbsp; дата рождения 12.05.1985</div>
    </div>
    <div class="badges">
      <span class="tag" style="background:{ACCENT_LIGHT};color:{ACCENT}">Собственник</span>
      <span class="tag" style="background:#E7F2EA;color:{GREEN}">Занята в экономике</span>
      <span class="ratedot rB" style="width:22px;height:22px;font-size:12px;display:inline-flex">B</span>
      <button class="btn secondary small">{icon('refresh',13)}Обновить из внешних источников</button>
    </div>
  </div>

  <div class="fields">
    <div class="f"><label>Категория должника</label><div class="val">Собственник (частный жилфонд)</div></div>
    <div class="f"><label>Суммарная задолженность по всем ЛС</label><div class="val" style="font-weight:700">887,70 р. <span style="color:{RED};font-weight:600;font-size:11.5px">(в т.ч. пеня 130,20 р.)</span></div></div>
    <div class="f"><label>Документ, удостоверяющий личность</label><div class="val">Паспорт МР2345678, выдан 14.03.2019</div></div>
    <div class="f"><label>Солидарные должники</label><div class="val"><a>Иванов П.С. (муж)</a> · <a>Иванова М.П. (дочь)</a></div></div>
  </div>

  <div class="tabsrow">
    <div class="tab active">Лицевые счета (2)</div>
    <div class="tab">Контактные данные</div>
    <div class="tab">Мероприятия (7)</div>
    <div class="tab">Категории и статусы</div>
    <div class="tab">История изменений</div>
  </div>

  <table class="dtab">
    <tr><th>ЛС</th><th>Адрес</th><th>Организация</th><th>Группа</th><th>Этап воронки</th><th class="num">Долг</th><th class="num">Пеня</th><th class="num">Итого</th></tr>
    <tr>
      <td><a style="color:{ACCENT}">0032451 →</a></td><td>ул. Захарова, д. 14, кв. 56</td><td>РСЦ Минска</td>
      <td><span class="pill g2">Группа 2</span></td><td>Автообзвон/уведомления</td>
      <td class="num">712,30</td><td class="num" style="color:{RED}">130,20</td><td class="num"><b>842,50</b></td>
    </tr>
    <tr>
      <td><a style="color:{ACCENT}">0071234 →</a></td><td>ул. Захарова, д. 14, м/м 8 (паркинг)</td><td>РСЦ Минска</td>
      <td><span class="pill g1">Группа 1</span></td><td>Новый должник</td>
      <td class="num">45,20</td><td class="num" style="color:{RED}">0,00</td><td class="num"><b>45,20</b></td>
    </tr>
  </table>

  <div class="cols2">
    <div>
      <div class="blocklbl">Контактные данные (приоритет для автообзвона)</div>
      <div class="contact">{icon('phone',14,MUTED)} +375 29 612-44-XX <span class="lbl" style="background:#E7F2EA;color:{GREEN}">приоритетный · подтверждён 02.07.2026</span></div>
      <div class="contact">{icon('phone',14,MUTED)} +375 17 284-10-XX <span class="lbl" style="background:#F0F2F4;color:{MUTED}">городской</span></div>
      <div class="contact">{icon('mail',14,MUTED)} a.ivanova85@mail.ru <span class="lbl" style="background:{ACCENT_LIGHT};color:{ACCENT}">для уведомлений</span></div>
    </div>
    <div>
      <div class="blocklbl">Признаки, влияющие на сценарий</div>
      <div class="contact">{icon('check',13,GREEN)} Согласие на электронные уведомления — есть</div>
      <div class="contact">{icon('close',13,MUTED)} Наследственное дело — не открыто</div>
      <div class="contact">{icon('close',13,MUTED)} Признаки банкротства / недееспособности — нет</div>
    </div>
  </div>

  <div class="blocklbl">Обогащение данных из внешних источников</div>
  <div class="enrich">
    <div class="src">
      <h5>Минтруда — занятость</h5>
      <div class="v">{icon('check',14,GREEN)} Занята в экономике</div>
      <div class="d">Обновлено 01.07.2026 · регламентная загрузка</div>
    </div>
    <div class="src">
      <h5>ЗАГС — акты гражданского состояния</h5>
      <div class="v">{icon('check',14,GREEN)} Сведений о смерти нет</div>
      <div class="d">Обновлено 01.07.2026 · регламентная загрузка</div>
    </div>
    <div class="src">
      <h5>АИС «Расчёт-ЖКУ» — регистрация</h5>
      <div class="v">{icon('user',14,ACCENT)} Зарегистрировано 3 чел.</div>
      <div class="d">Обновлено 09.07.2026, 03:00 · синхронизация</div>
    </div>
  </div>
</div>"""
    return wrap_page(top + formtop + body, extra_style=EXTRA_CSS)

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "html", "mockup13_debtor.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print("written", out)
