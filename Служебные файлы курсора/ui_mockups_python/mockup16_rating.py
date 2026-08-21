# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from gen_common import icon, wrap_page, NAVY, ACCENT, ACCENT_LIGHT, MUTED, RED, AMBER, GREEN, BORDER, TEXT

EXTRA_CSS = f"""
.settwrap {{ display:flex; gap:16px; margin:16px 20px; align-items:flex-start; }}
.panel {{ background:#fff; border:1px solid {BORDER}; border-radius:6px; padding:20px 24px; }}
.panel h2 {{ font-size:15px; font-weight:700; }}
.panel .hint {{ color:{MUTED}; font-size:11.5px; margin-top:3px; margin-bottom:14px; }}
table.set {{ width:100%; border-collapse:collapse; font-size:12px; }}
table.set th {{ text-align:left; color:{MUTED}; font-weight:600; padding:8px 10px; border-bottom:1px solid {BORDER}; }}
table.set td {{ padding:8px 10px; border-bottom:1px solid #EEF1F3; vertical-align:middle; }}
.inpx {{ border:1px solid {BORDER}; border-radius:4px; padding:5px 9px; font-size:12px; background:#fcfdfd; display:inline-flex; align-items:center; gap:6px; }}
.ratebig {{ width:24px; height:24px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; color:#fff; }}
.chk {{ display:flex; align-items:center; gap:9px; font-size:12px; padding:6px 0; }}
.chk .box {{ width:15px; height:15px; border-radius:3px; flex:none; display:flex; align-items:center; justify-content:center; }}
.chk .box.on {{ background:{ACCENT}; }}
.chk .box.off {{ border:1.5px solid {BORDER}; background:#fff; }}
.seclbl {{ font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; color:{MUTED}; margin:18px 0 6px; }}
.lockchip {{ font-size:10px; font-weight:700; padding:2px 7px; border-radius:3px; background:#F0F2F4; color:{MUTED}; }}
.savebar {{ display:flex; gap:10px; margin-top:20px; }}
"""

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
  <div class="crumbs"><span>Настройка</span><span>›</span><b>Правила присвоения рейтинга и группы задолженности</b></div>
  <div class="searchwrap"></div>
  <span class="lockchip">{icon('gear',11,MUTED)} управление: централизованно, Заказчик (VI.3, X.4)</span>
</div>"""
    left = f"""
<div class="panel" style="width:640px;flex:none">
  <h2>Группы задолженности</h2>
  <div class="hint">Границы групп по давности долга. Пересчёт выполняется автоматически при каждом обновлении данных из АИС «Расчёт-ЖКУ» (II.7). Изменение границ применяется со следующего регламентного пересчёта.</div>
  <table class="set">
    <tr><th>Группа</th><th>Просрочка от</th><th>Просрочка до</th><th>Базовый сценарий</th></tr>
    <tr><td><span class="pill g1">Группа 1</span></td><td><div class="inpx">1 день</div></td><td><div class="inpx">1 мес.</div></td><td>Превентивные напоминания</td></tr>
    <tr><td><span class="pill g2">Группа 2</span></td><td><div class="inpx">1 мес.</div></td><td><div class="inpx">3 мес.</div></td><td>Автообзвон + уведомления</td></tr>
    <tr><td><span class="pill g3">Группа 3</span></td><td><div class="inpx">3 мес.</div></td><td><div class="inpx">6 мес.</div></td><td>Предупреждение, отключение</td></tr>
    <tr><td><span class="pill g4">Группа 4</span></td><td><div class="inpx">6 мес.</div></td><td><div class="inpx">без огранич.</div></td><td>Испол. надпись / иск / ОПИ</td></tr>
  </table>
  <div class="seclbl">Детализация группы 4</div>
  <div class="chk"><div class="box on">{icon('check',10,'#fff')}</div>Выделять подгруппы «6–12 месяцев» и «свыше 12 месяцев» (для отчётности и сценариев)</div>
  <div class="seclbl">Прочее</div>
  <div class="chk"><div class="box on">{icon('check',10,'#fff')}</div>Разрешить локальную корректировку границ по решению Заказчика (X.4)</div>
  <div class="chk"><div class="box off"></div>Учитывать частичную оплату как прерывание просрочки</div>
</div>"""
    right = f"""
<div class="panel" style="flex:1">
  <h2>Правила рейтинга должника</h2>
  <div class="hint">Рейтинг рассчитывается по всем ЛС/договорам должника и отображается в реестрах, карточках и на канбан-доске (Концепция §7).</div>
  <table class="set">
    <tr><th style="width:52px">Рейтинг</th><th>Условие присвоения</th></tr>
    <tr><td><span class="ratebig rA">A</span></td><td><b>Нормальный</b> — нет устойчивой просрочки (нет ЛС/договоров в группах 3–4)</td></tr>
    <tr><td><span class="ratebig rB">B</span></td><td><b>Негативный</b> — есть устойчивая просрочка по любому из ЛС/договоров</td></tr>
    <tr><td><span class="ratebig rC">C</span></td><td><b>Критический</b> — устойчивая просрочка + отягчающие обстоятельства</td></tr>
  </table>
  <div class="seclbl">Отягчающие обстоятельства (для рейтинга C)</div>
  <div class="chk"><div class="box on">{icon('check',10,'#fff')}</div>Не занят в экономике (данные Минтруда, III.7)</div>
  <div class="chk"><div class="box on">{icon('check',10,'#fff')}</div>Юридическое лицо в стадии банкротства / ликвидации</div>
  <div class="chk"><div class="box on">{icon('check',10,'#fff')}</div>Повторная устойчивая просрочка в течение 12 месяцев</div>
  <div class="chk"><div class="box off"></div>Открытое наследственное дело (умерший должник)</div>
  <div class="chk"><div class="box off"></div>Отказ нотариуса по предыдущей исполнительной надписи</div>
  <div class="seclbl">Применение</div>
  <div class="chk"><div class="box on">{icon('check',10,'#fff')}</div>Пересчитывать рейтинг при каждом обновлении задолженности</div>
  <div class="chk"><div class="box on">{icon('check',10,'#fff')}</div>Фиксировать историю изменений рейтинга в карточке (II.5)</div>
  <div class="savebar">
    <button class="btn">Сохранить</button>
    <button class="btn secondary">Отмена</button>
  </div>
</div>"""
    body = f'{top}{subbar}<div class="settwrap">{left}{right}</div>'
    return wrap_page(body, extra_style=EXTRA_CSS)

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "html", "mockup16_rating.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print("written", out)
