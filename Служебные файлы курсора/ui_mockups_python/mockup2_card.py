# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from gen_common import icon, wrap_page, NAVY, ACCENT, ACCENT_LIGHT, MUTED, RED, AMBER, GREEN, BORDER, TEXT

EXTRA_CSS = f"""
.formtop {{ background:#fff; border-bottom:1px solid {BORDER}; padding:8px 20px; display:flex; align-items:center; gap:10px; }}
.formtop .crumbs {{ flex:none; }}
.statusbar {{ display:flex; align-items:center; margin-left:auto; gap:0; }}
.statusbar .stage {{ font-size:11.5px; color:{MUTED}; padding:6px 14px; background:#F0F2F4; position:relative; }}
.statusbar .stage:not(:last-child)::after {{ content:''; position:absolute; right:-7px; top:0; bottom:0; width:14px; background:inherit;
  clip-path: polygon(0 0, 60% 0, 100% 50%, 60% 100%, 0 100%); }}
.statusbar .stage.done {{ background:#E4ECE7; color:{GREEN}; }}
.statusbar .stage.current {{ background:{NAVY}; color:#fff; font-weight:700; }}

.formcard {{ background:#fff; margin:16px 20px 0; border:1px solid {BORDER}; border-radius:6px; padding:20px 24px; }}
.formhead {{ display:flex; justify-content:space-between; align-items:flex-start; }}
.formhead h1 {{ font-size:19px; font-weight:700; display:flex; align-items:center; gap:8px; }}
.formhead .sub {{ color:{MUTED}; font-size:12px; margin-top:3px; }}
.badges {{ display:flex; gap:8px; align-items:center; }}
.fields {{ display:grid; grid-template-columns:1fr 1fr; gap:18px 40px; margin-top:18px; }}
.f {{ display:flex; flex-direction:column; gap:3px; }}
.f label {{ font-size:11px; color:{MUTED}; }}
.f .val {{ font-size:13px; font-weight:500; }}
.f .val a {{ color:{ACCENT}; text-decoration:none; }}
.f .val.money {{ font-weight:700; }}
.tabsrow {{ display:flex; gap:22px; margin-top:22px; border-bottom:1px solid {BORDER}; }}
.tabsrow .tab {{ padding:9px 2px; font-size:12.5px; color:{MUTED}; border-bottom:2px solid transparent; }}
.tabsrow .tab.active {{ color:{TEXT}; font-weight:700; border-color:{NAVY}; }}
table.dtab {{ width:100%; border-collapse:collapse; margin-top:14px; font-size:12px; }}
table.dtab th {{ text-align:left; color:{MUTED}; font-weight:600; padding:7px 8px; border-bottom:1px solid {BORDER}; }}
table.dtab td {{ padding:8px 8px; border-bottom:1px solid #EEF1F3; }}
table.dtab tr:last-child td {{ border-bottom:none; }}
.tagstatus {{ font-size:10.5px; font-weight:700; padding:2px 7px; border-radius:3px; }}
.ts-done {{ background:#E7F2EA; color:{GREEN}; }}
.ts-wait {{ background:{ACCENT_LIGHT}; color:{ACCENT}; }}
.ts-warn {{ background:#FBF0DD; color:{AMBER}; }}

.chatter {{ margin:18px 24px 22px; border-top:1px solid {BORDER}; padding-top:14px; }}
.chatter .btns {{ display:flex; gap:8px; }}
.chatter .btns button {{ font-size:12px; padding:6px 12px; border-radius:5px; border:1px solid {BORDER}; background:#fff; color:{TEXT}; }}
.chatter .btns button.primary {{ background:{NAVY}; color:#fff; border:none; }}
.activity-item {{ background:#F3F8EF; border:1px solid #D8ECD0; border-radius:6px; padding:10px 14px; margin-top:14px; display:flex; justify-content:space-between; align-items:center; }}
.activity-item .lead {{ font-size:12.5px; }}
.activity-item .lead b {{ color:{GREEN}; }}
.activity-item .acts {{ display:flex; gap:14px; font-size:11.5px; color:{ACCENT}; }}
.log-item {{ display:flex; gap:10px; margin-top:16px; }}
.log-item .dot {{ width:28px; height:28px; border-radius:50%; background:{ACCENT}; color:#fff; font-size:10.5px; font-weight:700; display:flex; align-items:center; justify-content:center; flex:none; }}
.log-item .txt {{ font-size:12px; }}
.log-item .txt .who {{ font-weight:700; }}
.log-item .txt .when {{ color:{MUTED}; font-size:11px; margin-left:6px; }}
.log-item .txt .desc {{ color:{MUTED}; margin-top:2px; }}
"""

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
    formtop = f"""
<div class="formtop">
  <div class="crumbs"><span>Дела</span><span>›</span><span>Группа 2</span><span>›</span><b>Иванова А.П.</b></div>
  <div class="statusbar">
    <div class="stage current">Автообзвон</div>
    <div class="stage">Уведомление направлено</div>
    <div class="stage">Предупреждение вручено</div>
    <div class="stage">Подготовка к отключению</div>
    <div class="stage">Переход в Группу 3</div>
  </div>
</div>"""
    formcard = f"""
<div class="formcard">
  <div class="formhead">
    <div>
      <h1>Иванова Анна Петровна</h1>
      <div class="sub">ЛС 0032451 &nbsp;·&nbsp; ул. Захарова, д. 14, кв. 56 &nbsp;·&nbsp; РСЦ Минска &nbsp;·&nbsp; частная собственность &nbsp;·&nbsp; 54,2 м², 2 комнаты</div>
    </div>
    <div class="badges">
      <span class="pill g2">Группа 2 · 1–3 мес.</span>
      <span class="ratedot rB" style="width:22px;height:22px;font-size:12px;">B</span>
      <button class="btn secondary small">{icon('refresh',13)}Обновить сейчас</button>
    </div>
  </div>
  <div class="fields">
    <div class="f"><label>Плательщик</label><div class="val"><a>Иванова Анна Петровна →</a></div></div>
    <div class="f"><label>Сумма долга по услугам</label><div class="val money">712,30 р.</div></div>
    <div class="f"><label>Солидарные должники</label><div class="val">2 (Иванов П.С., Иванова М.П.)</div></div>
    <div class="f"><label>Пеня</label><div class="val money" style="color:{RED}">130,20 р.</div></div>
    <div class="f"><label>Дата возникновения долга</label><div class="val">26.03.2026</div></div>
    <div class="f"><label>Итого к взысканию</label><div class="val money" style="font-size:15px">842,50 р.</div></div>
    <div class="f"><label>Закреплённый специалист</label><div class="val">Петров И.И.</div></div>
    <div class="f"><label>Сценарий мероприятий</label><div class="val"><a>Группа 2 · Базовый →</a></div></div>
  </div>
  <div class="tabsrow">
    <div class="tab active">Чек-лист этапа</div>
    <div class="tab">Работа с задолженностью</div>
    <div class="tab">Мероприятия (7)</div>
    <div class="tab">Договоры</div>
    <div class="tab">История изменений</div>
    <div class="tab">Документы (3)</div>
  </div>
  <div class="cl-progress-wrap">
    <div class="cl-progress-label">Готово к переходу на след. этап: 2 / 4</div>
    <div class="cl-progress-bar"><div style="width:50%;background:{AMBER}"></div></div>
  </div>
  <div class="cl-item">
    <div class="cl-box done">{icon('check',12,'#fff')}</div>
    <div class="cl-txt"><div class="t1 done">Выполнен автообзвон должнику (не менее 1 попытки)</div><div class="t2">Автоматически · 08.07.2026, 09:14 · сервис автообзвона</div></div>
  </div>
  <div class="cl-item">
    <div class="cl-box done">{icon('check',12,'#fff')}</div>
    <div class="cl-txt"><div class="t1 done">Оплата не поступила на дату проверки</div><div class="t2">Автоматически подтверждено при синхронизации с АИС «Расчёт-ЖКУ» · 08.07.2026</div></div>
  </div>
  <div class="cl-item">
    <div class="cl-box pending"></div>
    <div class="cl-txt"><div class="t1">Сформирован документ «Уведомление о задолженности»</div><div class="t2">Требуется действие специалиста — сформировать из шаблона</div></div>
  </div>
  <div class="cl-item">
    <div class="cl-box pending"></div>
    <div class="cl-txt"><div class="t1">Указаны способ и дата направления уведомления</div><div class="t2">Требуется действие специалиста</div></div>
  </div>
  <div class="cl-footer">
    <div>{icon('flag',14,'#7A5B12')} Переход на следующий этап («Уведомление направлено») недоступен до выполнения всех обязательных пунктов чек-листа</div>
    <div class="stage-btn-disabled">Перейти на след. этап →</div>
  </div>

  <div class="chatter">
    <div class="btns">
      <button class="primary">Отправить сообщение</button>
      <button>Добавить заметку</button>
      <button>{icon('clock',13)} Мероприятия</button>
      <button>{icon('paperclip',13)} Документы</button>
    </div>
    <div class="activity-item">
      <div class="lead">{icon('phone',14,'#2E7D4A')} Через 2 дня: <b>Автообзвон</b> — ответственный Петров И.И., шаблон «Группа 2 · Стандарт»</div>
      <div class="acts"><span>Выполнить</span><span>Изменить</span><span>Отменить</span></div>
    </div>
    <div class="log-item">
      <div class="dot">ПИ</div>
      <div class="txt"><span class="who">Петров И.И.</span><span class="when">08.07.2026, 09:14</span><div class="desc">Дело переведено в Группу 2, этап «Автообзвон»</div></div>
    </div>
    <div class="log-item">
      <div class="dot" style="background:{MUTED}">СИС</div>
      <div class="txt"><span class="who">Система</span><span class="when">08.07.2026, 03:00</span><div class="desc">Регламентная синхронизация с АИС «Расчёт-ЖКУ»: сумма долга обновлена (+42,10 р. пени)</div></div>
    </div>
  </div>
</div>
"""
    return wrap_page(top + formtop + formcard, extra_style=EXTRA_CSS)

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "html", "mockup2_card.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print("written", out)
