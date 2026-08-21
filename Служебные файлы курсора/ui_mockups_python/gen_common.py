# -*- coding: utf-8 -*-
"""Общие стили и иконки для генерации UI-макетов ПМ «Взыскание задолженности за ЖКУ»."""

NAVY = "#0F4761"
ACCENT = "#156082"
ACCENT_LIGHT = "#E8F1F5"
BG = "#F4F6F8"
BORDER = "#DCE3E8"
TEXT = "#20282F"
MUTED = "#6B7785"
RED = "#B23A2E"
AMBER = "#B8862E"
GREEN = "#2E7D4A"
BLUE = "#2C6FA8"

def icon(name, size=16, color="currentColor", stroke_width=1.8):
    paths = {
        "grid": '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="10.5" y="3" width="6" height="6" rx="1"/><rect x="18" y="3" width="3.5" height="6" rx="1"/><rect x="3" y="10.5" width="6" height="6" rx="1"/><rect x="10.5" y="10.5" width="6" height="6" rx="1"/><rect x="18" y="10.5" width="3.5" height="6" rx="1"/>',
        "bell": '<path d="M12 3a5 5 0 0 0-5 5v3.5c0 .8-.3 1.6-.9 2.2L5 15h14l-1.1-1.3a3 3 0 0 1-.9-2.2V8a5 5 0 0 0-5-5z"/><path d="M9.5 18a2.5 2.5 0 0 0 5 0"/>',
        "clock": '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
        "search": '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/>',
        "chevron-down": '<path d="M5 8.5l7 7 7-7"/>',
        "chevron-right": '<path d="M8.5 5l7 7-7 7"/>',
        "star": '<path d="M12 3.7l2.4 5 5.5.6-4.1 3.8 1.1 5.4L12 15.7l-4.9 2.8 1.1-5.4-4.1-3.8 5.5-.6z"/>',
        "star-o": '<path d="M12 3.7l2.4 5 5.5.6-4.1 3.8 1.1 5.4L12 15.7l-4.9 2.8 1.1-5.4-4.1-3.8 5.5-.6z" fill="none"/>',
        "mail": '<rect x="3" y="5.5" width="18" height="13" rx="1.5"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>',
        "phone": '<path d="M6 3.5c-1.4 0-2.5 1.2-2.3 2.6.6 4.4 2.7 8.4 5.9 11.5 3.1 3.2 7.1 5.3 11.5 5.9 1.4.2 2.6-.9 2.6-2.3v-2.7c0-1-.7-1.9-1.7-2.1l-3.4-.8c-.8-.2-1.6.1-2.1.7l-.8 1c-2.2-1.1-4-2.9-5.1-5.1l1-.8c.6-.5.9-1.3.7-2.1l-.8-3.4c-.2-1-1.1-1.7-2.1-1.7z"/>',
        "calendar": '<rect x="3.5" y="5" width="17" height="15.5" rx="1.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
        "kanban": '<rect x="3.5" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10.5" rx="1"/><rect x="16.5" y="4" width="5" height="13.5" rx="1"/>',
        "list": '<path d="M8 6.5h13M8 12h13M8 17.5h13"/><circle cx="4" cy="6.5" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="17.5" r="1"/>',
        "bar-chart": '<path d="M4 20V10M11 20V4M18 20v-7"/>',
        "pie-chart": '<path d="M12 3.5v8.5h8.5"/><path d="M12 12a8.5 8.5 0 1 1 8.4-9.7"/>',
        "filter": '<path d="M4 5h16l-6 7.5V19l-4 2v-8.5z"/>',
        "plus": '<path d="M12 5v14M5 12h14"/>',
        "close": '<path d="M6 6l12 12M18 6L6 18"/>',
        "gear": '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M4.4 7l2.2 1.3M17.4 15.7l2.2 1.3M4.4 17l2.2-1.3M17.4 8.3l2.2-1.3M3 12h2.5M18.5 12H21"/>',
        "paperclip": '<path d="M8 12.5l6.5-6.5a3 3 0 0 1 4.2 4.2L11 18a4.5 4.5 0 0 1-6.4-6.4l7-7"/>',
        "check": '<path d="M4.5 12.5l5 5 10-11"/>',
        "refresh": '<path d="M4 12a8 8 0 0 1 14-5.2M20 12a8 8 0 0 1-14 5.2"/><path d="M18 3.5V7h-3.5M6 20.5V17h3.5"/>',
        "doc": '<path d="M6.5 3.5h8l3 3v14h-11z"/><path d="M14 3.5V7h3.5"/><path d="M9 12h6M9 15h6M9 9h2"/>',
        "trash": '<path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/>',
        "user": '<circle cx="12" cy="8.5" r="3.5"/><path d="M4.5 20c1-3.5 4-5.5 7.5-5.5s6.5 2 7.5 5.5"/>',
        "download": '<path d="M12 3.5v11M8 11l4 4 4-4"/><path d="M4.5 18.5h15v2h-15z"/>',
        "building": '<rect x="4" y="3.5" width="9" height="17"/><rect x="13" y="9" width="7" height="11.5"/><path d="M7 7h3M7 10.5h3M7 14h3M16 12.5h1.5M16 16h1.5"/>',
        "arrow-right": '<path d="M4 12h16M14 6l6 6-6 6"/>',
        "flag": '<path d="M6 21V4h11l-2.5 3.5L17 11H6"/>',
    }
    d = paths.get(name, "")
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" '
            f'stroke="{color}" stroke-width="{stroke_width}" stroke-linecap="round" '
            f'stroke-linejoin="round" style="flex:none">{d}</svg>')

SHARED_CSS = f"""
* {{ box-sizing: border-box; margin:0; padding:0; }}
body {{
  font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
  background: {BG};
  color: {TEXT};
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}}
.app {{ width: 1680px; min-height: 900px; background:{BG}; display:flex; flex-direction:column; }}

/* Верхняя панель */
.topbar {{
  background: {NAVY};
  color: #fff;
  display:flex; align-items:center;
  height: 46px; padding:0 14px;
  gap: 18px;
}}
.topbar .grid-btn {{ opacity:.9; display:flex; align-items:center; }}
.topbar .appname {{ font-weight:600; font-size:14.5px; letter-spacing:.2px; }}
.topbar nav {{ display:flex; gap:20px; font-size:13px; opacity:.92; }}
.topbar nav span {{ cursor:default; padding:2px 0; }}
.topbar nav span.active {{ border-bottom:2px solid #fff; font-weight:600; opacity:1; }}
.topbar .spacer {{ flex:1; }}
.topbar .tools {{ display:flex; align-items:center; gap:16px; opacity:.95; }}
.topbar .company {{ display:flex; align-items:center; gap:6px; font-size:12.5px; background:rgba(255,255,255,.12); padding:4px 10px; border-radius:5px; }}
.topbar .avatar {{ width:26px; height:26px; border-radius:50%; background:#3E7590; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; }}
.badge-dot {{ position:relative; }}
.badge-dot::after {{ content:attr(data-n); position:absolute; top:-6px; right:-8px; background:{AMBER}; color:#fff; font-size:9px; font-weight:700; border-radius:7px; padding:1px 4px; line-height:1.3; }}

/* Хлебные крошки + панель поиска */
.subbar {{
  background:#fff; border-bottom:1px solid {BORDER};
  display:flex; align-items:center; padding:10px 16px; gap:14px;
}}
.btn {{
  background:{NAVY}; color:#fff; border:none; border-radius:5px;
  padding:7px 14px; font-size:12.5px; font-weight:600; cursor:default;
  display:flex; align-items:center; gap:6px;
}}
.btn.secondary {{ background:#fff; color:{TEXT}; border:1px solid {BORDER}; }}
.btn.small {{ padding:4px 9px; font-size:11.5px; }}
.crumbs {{ display:flex; align-items:center; gap:6px; font-size:12.5px; color:{MUTED}; }}
.crumbs b {{ color:{TEXT}; font-weight:600; }}
.searchwrap {{ flex:1; display:flex; align-items:center; gap:8px; }}
.searchbox {{
  flex:1; display:flex; align-items:center; gap:8px; border:1px solid {BORDER};
  border-radius:5px; padding:6px 10px; background:#fcfdfd; max-width:900px;
}}
.chip {{
  display:flex; align-items:center; gap:6px; background:{ACCENT_LIGHT}; color:{ACCENT};
  border-radius:4px; padding:3px 8px; font-size:12px; font-weight:600;
}}
.searchbox input {{ border:none; outline:none; background:transparent; font-size:12.5px; flex:1; color:{MUTED}; }}
.viewswitch {{ display:flex; border:1px solid {BORDER}; border-radius:5px; overflow:hidden; }}
.viewswitch .v {{ padding:6px 9px; display:flex; color:{MUTED}; border-right:1px solid {BORDER}; background:#fff; }}
.viewswitch .v:last-child {{ border-right:none; }}
.viewswitch .v.active {{ background:{ACCENT_LIGHT}; color:{ACCENT}; }}

.body {{ flex:1; padding:16px 20px; }}

/* Канбан */
.kanban {{ display:flex; gap:14px; align-items:flex-start; overflow:hidden; }}
.col {{ width:236px; flex:none; }}
.col-head {{ display:flex; align-items:flex-start; justify-content:space-between; padding:2px 4px 8px; gap:6px; }}
.col-head .title {{ font-weight:700; font-size:12.5px; text-transform:none; color:{TEXT}; line-height:1.3; }}
.col-head .head-actions {{ display:flex; align-items:center; gap:7px; flex:none; margin-top:1px; }}
.col-head .count {{ color:{MUTED}; font-weight:600; font-size:11.5px; }}
.progressbar {{ height:4px; border-radius:3px; background:{BORDER}; margin:0 4px 10px; overflow:hidden; display:flex; }}
.card {{
  background:#fff; border:1px solid {BORDER}; border-left:3px solid {ACCENT};
  border-radius:6px; padding:10px 11px; margin-bottom:10px; box-shadow:0 1px 2px rgba(20,30,40,.05);
}}
.card .top-row {{ display:flex; justify-content:space-between; align-items:flex-start; gap:6px;}}
.card .ls {{ font-weight:700; font-size:12.5px; }}
.card .addr {{ color:{MUTED}; font-size:11.5px; margin-top:2px; line-height:1.35; }}
.card .name {{ font-weight:700; font-size:12.5px; line-height:1.3; }}
.card .subinfo {{ color:{MUTED}; font-size:10.5px; margin-top:3px; line-height:1.35; }}
.card .metarow {{ display:flex; align-items:center; gap:6px; margin-top:8px; flex-wrap:wrap; }}
.pill {{ font-size:10.5px; font-weight:700; border-radius:3px; padding:2px 6px; }}
.pill.g1 {{ background:#E7F2EA; color:{GREEN}; }}
.pill.g2 {{ background:{ACCENT_LIGHT}; color:{ACCENT}; }}
.pill.g3 {{ background:#FBF0DD; color:{AMBER}; }}
.pill.g4 {{ background:#FAE6E3; color:{RED}; }}
.ratedot {{ width:17px; height:17px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:800; color:#fff; }}
.rA {{ background:{GREEN}; }} .rB {{ background:{AMBER}; }} .rC {{ background:{RED}; }}
.card .sum {{ font-weight:700; font-size:13px; margin-top:7px; color:{TEXT}; }}
.card .sum small {{ font-weight:500; color:{MUTED}; font-size:10.5px; }}
.card .bottom-row {{ display:flex; align-items:center; justify-content:space-between; margin-top:9px; }}
.card .icons {{ display:flex; gap:8px; color:{MUTED}; align-items:center; }}
.card .icons .overdue {{ color:{RED}; font-weight:700; }}
.avatar-sm {{ width:23px; height:23px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:9.5px; font-weight:700; color:#fff; }}
.a1{{background:{ACCENT};}} .a2{{background:#7C6FA8;}} .a3{{background:{AMBER};}} .a4{{background:{GREEN};}} .a5{{background:{RED};}} .a6{{background:#5A7D93;}}
.addcol {{ width:180px; flex:none; }}
.addcol .btn {{ width:100%; justify-content:center; background:#fff; color:{MUTED}; border:1px dashed {BORDER}; }}
.col-empty {{ color:#B7C0C8; font-size:11.5px; text-align:center; padding:24px 6px; font-style:italic; }}

.footer-note {{ padding:8px 20px 14px; color:{MUTED}; font-size:11px; border-top:1px solid {BORDER}; background:#fff; }}

/* Чек-лист этапа */
.cl-progress-wrap {{ display:flex; align-items:center; gap:10px; margin:14px 0 10px; }}
.cl-progress-bar {{ flex:1; height:6px; border-radius:4px; background:{BORDER}; overflow:hidden; }}
.cl-progress-bar > div {{ height:100%; }}
.cl-progress-label {{ font-size:11.5px; color:{MUTED}; font-weight:600; flex:none; }}
.cl-item {{ display:flex; gap:10px; align-items:flex-start; padding:10px 2px; border-bottom:1px solid #EEF1F3; }}
.cl-item:last-child {{ border-bottom:none; }}
.cl-box {{ width:18px; height:18px; border-radius:4px; flex:none; display:flex; align-items:center; justify-content:center; margin-top:1px; }}
.cl-box.done {{ background:{GREEN}; }}
.cl-box.pending {{ border:1.5px solid {BORDER}; background:#fff; }}
.cl-txt .t1 {{ font-size:12.5px; font-weight:600; }}
.cl-txt .t1.done {{ color:{MUTED}; text-decoration:line-through; text-decoration-color:#c7cdd3; }}
.cl-txt .t2 {{ font-size:11px; color:{MUTED}; margin-top:2px; }}
.cl-footer {{ margin-top:8px; padding:12px 14px; background:#FBF6E9; border:1px solid #EFE1B8; border-radius:6px; font-size:12px; color:#7A5B12; display:flex; justify-content:space-between; align-items:center; gap:14px; }}
.stage-btn-disabled {{ background:#E4E7EA; color:#9AA4AC; padding:7px 14px; border-radius:5px; font-size:12px; font-weight:600; flex:none; }}

/* Оверлеи: выпадающая панель и модальное окно поверх канбана */
.overlay-stage {{ position:relative; }}
.dim-layer {{ position:absolute; inset:0; background:rgba(15,25,35,.10); z-index:5; }}
.popover {{ position:absolute; background:#fff; border:1px solid {BORDER}; border-radius:6px; box-shadow:0 14px 34px rgba(15,25,35,.22); z-index:10; }}
.modal-backdrop {{ position:absolute; inset:0; background:rgba(12,18,24,.5); z-index:20; }}
.modal-box {{ position:absolute; background:#fff; border-radius:8px; box-shadow:0 24px 60px rgba(0,0,0,.3); padding:22px 26px; z-index:21; }}
"""

def wrap_page(body_html, extra_style="", app_height="min-height:900px;"):
    return f"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<style>{SHARED_CSS}{extra_style}</style></head>
<body><div class="app" style="{app_height}">{body_html}</div></body></html>"""
