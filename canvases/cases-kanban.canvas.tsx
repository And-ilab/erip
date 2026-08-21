import {
  BarChart,
  PieChart,
  useCanvasState,
  useHostTheme,
} from "cursor/canvas";

/** Brand tokens from PNG mockup — navy + white */
const C = {
  navy: "#1A3044",
  navyBtn: "#1B3A4F",
  white: "#FFFFFF",
  pageBg: "#E8EAED",
  barBg: "#F3F4F6",
  border: "#D8DCE0",
  borderLight: "#E6E8EB",
  text: "#1F2933",
  textMuted: "#6B7280",
  textLabel: "#374151",
  link: "#2563EB",
  avatar: "#9AA3AD",
  notifHeader: "#E8B923",
  star: "#C4C9CE",
  starOn: "#E6A817",
  g1: "#2F9E5F",
  g2: "#3B82C4",
  g3: "#C4A035",
  g4: "#C45C4A",
  badgeA: "#2F9E5F",
  badgeB: "#E0893A",
  badgeC: "#C45C4A",
  warnBg: "#FBF6E9",
  warnBorder: "#EFE1B8",
  warnText: "#7A5B12",
  mapBg: "#DCE8F0",
  mapLand: "#F4F7F5",
  mapRoad: "#C5D0D8",
};

type ViewMode = "kanban" | "list" | "calendar" | "charts" | "map";
type NavId = "cases" | "events" | "legal" | "reports" | "settings";
type Page =
  | { kind: "board" }
  | { kind: "case"; id: string; tab: string }
  | { kind: "notif"; id: string }
  | { kind: "new-case" };

type StageLetter = "A" | "B" | "C";
type GroupId = 1 | 2 | 3 | 4;

type CaseCard = {
  id: string;
  group: GroupId;
  name: string;
  ls: string;
  address: string;
  district: string;
  stage: StageLetter;
  stageLabel: string;
  debt: string;
  debtNum: number;
  penalty: string;
  assignee: string;
  assigneeColor: string;
  favorite: boolean;
  channels: ("phone" | "mail" | "doc")[];
  /** WGS84 coordinates (Minsk) */
  lat: number;
  lon: number;
  debtDate: string;
  solidary: string;
  area: string;
};

type Notif = {
  id: string;
  who: string;
  initials: string;
  avatarColor: string;
  time: string;
  section: "today" | "week";
  context: string;
  title: string;
  snippet: string;
  caseId: string | null;
  unread: boolean;
  extra: number;
};

type CalEvent = {
  id: string;
  day: number;
  title: string;
  caseId: string;
  tone: string;
};

const GROUPS: {
  id: GroupId;
  title: string;
  subtitle: string;
  color: string;
  tone: "success" | "info" | "warning" | "danger";
}[] = [
  {
    id: 1,
    title: "Группа 1",
    subtitle: "просрочка до 1 мес.",
    color: C.g1,
    tone: "success",
  },
  {
    id: 2,
    title: "Группа 2",
    subtitle: "просрочка 1–3 мес.",
    color: C.g2,
    tone: "info",
  },
  {
    id: 3,
    title: "Группа 3",
    subtitle: "просрочка 3–6 мес.",
    color: C.g3,
    tone: "warning",
  },
  {
    id: 4,
    title: "Группа 4",
    subtitle: "просрочка свыше 6 мес.",
    color: C.g4,
    tone: "danger",
  },
];

const CASES0: CaseCard[] = [
  {
    id: "c1",
    group: 1,
    name: "Соловьёва Марина Дмитриевна",
    ls: "0061102",
    address: "ул. Октябрьская, д.3, кв.15",
    district: "Центр",
    stage: "A",
    stageLabel: "Новый должник",
    debt: "310,00",
    debtNum: 310,
    penalty: "0,00",
    assignee: "ОК",
    assigneeColor: "#2F9E5F",
    favorite: false,
    channels: ["phone"],
    lat: 53.9048,
    lon: 27.5615,
    debtDate: "12.06.2026",
    solidary: "—",
    area: "42,0 м², 1 комната",
  },
  {
    id: "c2",
    group: 1,
    name: "ООО «Чистый дом»",
    ls: "0098841",
    address: "пр. Независимости, 88",
    district: "Первомайский",
    stage: "B",
    stageLabel: "Автообзвон",
    debt: "1 240,00",
    debtNum: 1240,
    penalty: "18,40",
    assignee: "ПИ",
    assigneeColor: "#3B82C4",
    favorite: true,
    channels: ["phone", "mail"],
    lat: 53.9275,
    lon: 27.6302,
    debtDate: "01.06.2026",
    solidary: "—",
    area: "нежил. помещение",
  },
  {
    id: "c3",
    group: 1,
    name: "Козлов Игорь Сергеевич",
    ls: "0045520",
    address: "ул. Я.Коласа, д.12, кв.4",
    district: "Советский",
    stage: "A",
    stageLabel: "Новый должник",
    debt: "185,50",
    debtNum: 185.5,
    penalty: "0,00",
    assignee: "ЮК",
    assigneeColor: "#9D4EDD",
    favorite: false,
    channels: ["mail"],
    lat: 53.9382,
    lon: 27.6051,
    debtDate: "20.06.2026",
    solidary: "1 (Козлова Е.В.)",
    area: "38,5 м², 1 комната",
  },
  {
    id: "c4",
    group: 2,
    name: "Петрова Анна Викторовна",
    ls: "0072210",
    address: "ул. Сурганова, д.50, кв.9",
    district: "Первомайский",
    stage: "B",
    stageLabel: "E-mail напоминание",
    debt: "842,50",
    debtNum: 842.5,
    penalty: "130,20",
    assignee: "ОК",
    assigneeColor: "#2F9E5F",
    favorite: false,
    channels: ["mail", "doc"],
    lat: 53.9204,
    lon: 27.5998,
    debtDate: "26.03.2026",
    solidary: "2 (Петров П.С., Петрова М.П.)",
    area: "54,2 м², 2 комнаты",
  },
  {
    id: "c5",
    group: 2,
    name: "Сидорович Павел Николаевич",
    ls: "0031188",
    address: "ул. Тимирязева, д.67, кв.22",
    district: "Московский",
    stage: "B",
    stageLabel: "Ручной звонок",
    debt: "2 015,00",
    debtNum: 2015,
    penalty: "210,00",
    assignee: "СМ",
    assigneeColor: "#E0893A",
    favorite: false,
    channels: ["phone"],
    lat: 53.9112,
    lon: 27.5315,
    debtDate: "10.02.2026",
    solidary: "—",
    area: "61,0 м², 2 комнаты",
  },
  {
    id: "c6",
    group: 2,
    name: "УП «ЖЭС №14» (субабонент)",
    ls: "0019022",
    address: "ул. Кальварийская, 25",
    district: "Фрунзенский",
    stage: "C",
    stageLabel: "Предупреждение",
    debt: "4 680,00",
    debtNum: 4680,
    penalty: "520,10",
    assignee: "ПИ",
    assigneeColor: "#3B82C4",
    favorite: true,
    channels: ["doc", "mail"],
    lat: 53.9055,
    lon: 27.5098,
    debtDate: "15.01.2026",
    solidary: "—",
    area: "здан. обслужив.",
  },
  {
    id: "c7",
    group: 3,
    name: "Морозова Елена Александровна",
    ls: "0084412",
    address: "ул. Притыцкого, д.79, кв.41",
    district: "Фрунзенский",
    stage: "C",
    stageLabel: "Отключение услуг",
    debt: "3 420,00",
    debtNum: 3420,
    penalty: "610,00",
    assignee: "НТ",
    assigneeColor: "#C45C4A",
    favorite: false,
    channels: ["doc", "phone"],
    lat: 53.9148,
    lon: 27.4542,
    debtDate: "05.11.2025",
    solidary: "1 (Морозов А.И.)",
    area: "48,0 м², 2 комнаты",
  },
  {
    id: "c8",
    group: 3,
    name: "ИП Гаврилов Д.В.",
    ls: "0027765",
    address: "ул. Куйбышева, д.10",
    district: "Центр",
    stage: "C",
    stageLabel: "Согласование отключения",
    debt: "5 110,80",
    debtNum: 5110.8,
    penalty: "890,00",
    assignee: "ЮК",
    assigneeColor: "#9D4EDD",
    favorite: false,
    channels: ["mail", "doc"],
    lat: 53.8995,
    lon: 27.5548,
    debtDate: "20.10.2025",
    solidary: "—",
    area: "офис 32 м²",
  },
  {
    id: "c9",
    group: 4,
    name: "Васильев Сергей Петрович",
    ls: "0009844",
    address: "ул. Маяковского, д.5, кв.2",
    district: "Ленинский",
    stage: "C",
    stageLabel: "Исполнительная надпись",
    debt: "12 450,00",
    debtNum: 12450,
    penalty: "2 180,00",
    assignee: "БА",
    assigneeColor: "#5B6B7C",
    favorite: false,
    channels: ["doc"],
    lat: 53.8842,
    lon: 27.5585,
    debtDate: "12.05.2025",
    solidary: "—",
    area: "36,0 м², 1 комната",
  },
  {
    id: "c10",
    group: 4,
    name: "ООО «СервисПлюс»",
    ls: "0066001",
    address: "пр. Дзержинского, 104",
    district: "Московский",
    stage: "C",
    stageLabel: "Направление в ОПИ",
    debt: "28 900,00",
    debtNum: 28900,
    penalty: "4 320,00",
    assignee: "КК",
    assigneeColor: "#C45C4A",
    favorite: true,
    channels: ["doc", "mail"],
    lat: 53.8698,
    lon: 27.5205,
    debtDate: "03.03.2025",
    solidary: "—",
    area: "нежил. 120 м²",
  },
];

const NOTIFS0: Notif[] = [
  {
    id: "n1",
    who: "Asterisk",
    initials: "А",
    avatarColor: "#3B82C4",
    time: "10:11",
    section: "today",
    context: "Автообзвон",
    title: "Не доставлен — Козлов И.С.",
    snippet: "Нет ответа. Нужен ручной звонок.",
    caseId: "c3",
    unread: true,
    extra: 0,
  },
  {
    id: "n2",
    who: "Водоканал",
    initials: "В",
    avatarColor: "#2F9E5F",
    time: "09:42",
    section: "today",
    context: "Отключение",
    title: "Принять задание — Морозова Е.А.",
    snippet: "Задание на отключение услуги.",
    caseId: "c7",
    unread: true,
    extra: 2,
  },
  {
    id: "n3",
    who: "Иванова П.А.",
    initials: "ИП",
    avatarColor: "#9D4EDD",
    time: "08:55",
    section: "today",
    context: "Согласование",
    title: "Списание — ООО «СервисПлюс»",
    snippet: "Ждёт руководителя РСЦ и бухгалтерию.",
    caseId: "c10",
    unread: true,
    extra: 0,
  },
  {
    id: "n4",
    who: "Белпочта",
    initials: "Б",
    avatarColor: "#E0893A",
    time: "вчера",
    section: "week",
    context: "ШПИ",
    title: "Вручено — Петрова А.В.",
    snippet: "Статус: вручено. Контроль 5 дней.",
    caseId: "c4",
    unread: false,
    extra: 0,
  },
  {
    id: "n5",
    who: "Система",
    initials: "С",
    avatarColor: "#5B6B7C",
    time: "пн",
    section: "week",
    context: "Оплата",
    title: "Оплата — Соловьёва М.Д.",
    snippet: "Остаток 0. Можно закрыть сценарий.",
    caseId: "c1",
    unread: false,
    extra: 1,
  },
  {
    id: "n6",
    who: "Юрист РСЦ",
    initials: "Ю",
    avatarColor: "#C45C4A",
    time: "пт",
    section: "week",
    context: "ОПИ",
    title: "Пакет готов — Васильев С.П.",
    snippet: "Проверьте комплект документов.",
    caseId: "c9",
    unread: true,
    extra: 0,
  },
];

const CAL_EVENTS: CalEvent[] = [
  { id: "e1", day: 8, title: "Автообзвон · Козлов", caseId: "c3", tone: C.g1 },
  { id: "e2", day: 10, title: "E-mail · Петрова", caseId: "c4", tone: C.g2 },
  { id: "e3", day: 14, title: "Контроль 5 дн. · Петрова", caseId: "c4", tone: C.g2 },
  { id: "e4", day: 16, title: "Отключение · Морозова", caseId: "c7", tone: C.g3 },
  { id: "e5", day: 18, title: "Согласование · Гаврилов", caseId: "c8", tone: C.g3 },
  { id: "e6", day: 21, title: "ОПИ · Васильев", caseId: "c9", tone: C.g4 },
  { id: "e7", day: 22, title: "Ручной звонок · Сидорович", caseId: "c5", tone: C.g2 },
  { id: "e8", day: 25, title: "Списание · СервисПлюс", caseId: "c10", tone: C.g4 },
];

function stageColor(s: StageLetter) {
  if (s === "A") return C.badgeA;
  if (s === "B") return C.badgeB;
  return C.badgeC;
}

function parseMoney(s: string) {
  return Number(s.replace(/\s/g, "").replace(",", ".")) || 0;
}

function TopBar({
  nav,
  setNav,
  unreadCount,
  notifOpen,
  setNotifOpen,
  setToast,
}: {
  nav: NavId;
  setNav: (n: NavId) => void;
  unreadCount: number;
  notifOpen: boolean;
  setNotifOpen: (v: boolean) => void;
  setToast: (t: string) => void;
}) {
  return (
    <div
      style={{
        height: 48,
        background: C.navy,
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
        gap: 18,
      }}
    >
      <span style={{ color: "#9FB0C0", fontSize: 16 }}>▦</span>
      <span style={{ color: C.white, fontWeight: 600, fontSize: 14 }}>
        Взыскание задолженности
      </span>
      {(
        [
          ["cases", "Дела"],
          ["events", "Мероприятия"],
          ["legal", "Претензионно-исковая работа"],
          ["reports", "Отчётность"],
          ["settings", "Настройка"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => {
            setNav(id);
            if (id !== "cases") setToast(`Раздел «${label}»`);
            else setToast("");
          }}
          style={{
            border: "none",
            background: "transparent",
            color: nav === id ? C.white : "rgba(255,255,255,0.72)",
            fontSize: 13,
            fontWeight: nav === id ? 600 : 400,
            cursor: "pointer",
            borderBottom:
              nav === id ? "2px solid #FFFFFF" : "2px solid transparent",
            paddingBottom: 12,
            marginBottom: -14,
          }}
        >
          {label}
        </button>
      ))}
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={() => setNotifOpen(!notifOpen)}
        style={{
          border: "none",
          background: "rgba(255,255,255,0.1)",
          color: C.white,
          fontSize: 12,
          cursor: "pointer",
          borderRadius: 4,
          padding: "4px 8px",
        }}
      >
        Уведомления{unreadCount ? ` · ${unreadCount}` : ""}
      </button>
      <span style={{ color: "rgba(255,255,255,0.9)", fontSize: 12 }}>
        Специалист · Иванова П.А.
      </span>
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          background: C.avatar,
          color: C.white,
          fontSize: 11,
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ИП
      </span>
    </div>
  );
}

function CaseCardView({
  card,
  dragging,
  onOpen,
  onToggleFav,
  onDragStart,
}: {
  card: CaseCard;
  dragging: boolean;
  onOpen: () => void;
  onToggleFav: () => void;
  onDragStart: () => void;
}) {
  const g = GROUPS.find((x) => x.id === card.group)!;
  return (
    <div
      draggable
      onDragStart={(e: { dataTransfer: { setData: (a: string, b: string) => void; effectAllowed: string } }) => {
        e.dataTransfer.setData("text/plain", card.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onClick={onOpen}
      style={{
        background: C.white,
        borderRadius: 6,
        border: `1px solid ${C.borderLight}`,
        borderLeft: `3px solid ${g.color}`,
        padding: "10px 12px 10px 10px",
        cursor: "grab",
        marginBottom: 8,
        opacity: dragging ? 0.45 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.25 }}>
          {card.name}
        </div>
        <button
          type="button"
          title="В избранное"
          onClick={(e: { stopPropagation?: () => void }) => {
            e.stopPropagation?.();
            onToggleFav();
          }}
          style={{
            border: "none",
            background: "transparent",
            color: card.favorite ? C.starOn : C.star,
            cursor: "pointer",
            fontSize: 15,
            lineHeight: 1,
            padding: 0,
          }}
        >
          {card.favorite ? "★" : "☆"}
        </button>
      </div>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>
        ЛС {card.ls} · {card.address}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 8,
          fontSize: 12,
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            background: stageColor(card.stage),
            color: C.white,
            fontSize: 10,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {card.stage}
        </span>
        <span style={{ color: C.textLabel }}>{card.stageLabel}</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        {card.debt} р.{" "}
        <span style={{ fontWeight: 500, color: C.textMuted, fontSize: 12 }}>
          + пеня {card.penalty} р.
        </span>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", gap: 4 }}>
          {card.channels.map((ch) => (
            <span
              key={ch}
              style={{
                fontSize: 10,
                color: C.textMuted,
                border: `1px solid ${C.borderLight}`,
                borderRadius: 3,
                padding: "1px 4px",
                background: C.barBg,
              }}
            >
              {ch === "phone" ? "тел" : ch === "mail" ? "mail" : "док"}
            </span>
          ))}
        </div>
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            background: card.assigneeColor,
            color: C.white,
            fontSize: 10,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {card.assignee}
        </span>
      </div>
    </div>
  );
}

function NotifColumn({
  notifs,
  filter,
  setFilter,
  onClose,
  onOpen,
  selectedId,
}: {
  notifs: Notif[];
  filter: "all" | "unread";
  setFilter: (f: "all" | "unread") => void;
  onClose: () => void;
  onOpen: (id: string) => void;
  selectedId: string | null;
}) {
  const visible = notifs.filter((n) => (filter === "all" ? true : n.unread));
  const unread = notifs.filter((n) => n.unread).length;

  return (
    <div
      style={{
        width: 248,
        flexShrink: 0,
        background: C.white,
        borderRight: `1px solid ${C.border}`,
        display: "flex",
        flexDirection: "column",
        maxHeight: "calc(100vh - 100px)",
      }}
    >
      <div
        style={{
          background: C.notifHeader,
          padding: "8px 10px",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>
          Уведомления
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onClose}
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: 13,
            color: C.textLabel,
            padding: "0 2px",
          }}
        >
          «
        </button>
      </div>
      <div
        style={{
          padding: "6px 10px",
          borderBottom: `1px solid ${C.borderLight}`,
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        <button
          type="button"
          onClick={() => setFilter(filter === "all" ? "unread" : "all")}
          style={{
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            background: filter === "all" ? C.navy : C.white,
            color: filter === "all" ? C.white : C.textMuted,
            fontSize: 10,
            padding: "2px 8px",
            cursor: "pointer",
          }}
        >
          {filter === "all" ? "Все" : "Непрочит."}
        </button>
        <span style={{ fontSize: 10, color: C.textMuted }}>{unread} новых</span>
      </div>
      <div style={{ padding: 8, overflowY: "auto", flex: 1 }}>
        {(["today", "week"] as const).map((sec) => {
          const list = visible.filter((n) => n.section === sec);
          if (!list.length) return null;
          return (
            <div key={sec} style={{ marginBottom: 8 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: C.textMuted,
                  margin: "2px 0 6px",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                {sec === "today" ? "Сегодня" : "Ранее"}
              </div>
              {list.map((n) => (
                <div
                  key={n.id}
                  onClick={() => onOpen(n.id)}
                  style={{
                    background: n.unread ? "#FFFCF0" : C.white,
                    border:
                      selectedId === n.id
                        ? `1px solid ${C.navy}`
                        : `1px solid ${C.borderLight}`,
                    borderRadius: 5,
                    padding: "7px 8px",
                    marginBottom: 6,
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                      marginBottom: 3,
                    }}
                  >
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        background: n.avatarColor,
                        color: C.white,
                        fontSize: 9,
                        fontWeight: 700,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {n.initials}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {n.who}
                    </span>
                    <span style={{ fontSize: 10, color: C.textMuted }}>
                      {n.time}
                    </span>
                    {n.extra > 0 ? (
                      <span
                        style={{
                          background: "#E85D04",
                          color: C.white,
                          fontSize: 9,
                          fontWeight: 700,
                          borderRadius: 6,
                          padding: "0 4px",
                        }}
                      >
                        +{n.extra}
                      </span>
                    ) : null}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: C.link,
                      lineHeight: 1.25,
                      marginBottom: 2,
                    }}
                  >
                    {n.title}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: C.textMuted,
                      lineHeight: 1.3,
                    }}
                  >
                    {n.snippet}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CaseDetailPage({
  card,
  tab,
  setTab,
  onBack,
}: {
  card: CaseCard;
  tab: string;
  setTab: (t: string) => void;
  onBack: () => void;
}) {
  const g = GROUPS.find((x) => x.id === card.group)!;
  const stages =
    card.group <= 2
      ? [
          "Автообзвон",
          "Уведомление направлено",
          "Предупреждение вручено",
          "Подготовка к отключению",
          "Переход в Группу 3",
        ]
      : [
          "Отключение услуг",
          "Исполнительная надпись",
          "ОПИ",
          "Суд / списание",
        ];

  const tabs = [
    "Чек-лист этапа",
    "Работа с задолженностью",
    "Мероприятия (7)",
    "Договоры",
    "История изменений",
    "Документы (3)",
  ];

  return (
    <div style={{ background: C.pageBg, minHeight: "100%" }}>
      <div
        style={{
          background: C.white,
          borderBottom: `1px solid ${C.border}`,
          padding: "8px 20px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            border: "none",
            background: "transparent",
            color: C.link,
            fontSize: 13,
            cursor: "pointer",
            padding: 0,
          }}
        >
          ← Дела
        </button>
        <span style={{ color: C.textMuted, fontSize: 13 }}>›</span>
        <span style={{ color: C.textMuted, fontSize: 13 }}>{g.title}</span>
        <span style={{ color: C.textMuted, fontSize: 13 }}>›</span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{card.name}</span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 0 }}>
          {stages.map((s, i) => (
            <span
              key={s}
              style={{
                fontSize: 11,
                padding: "6px 12px",
                background: i === 0 ? C.navy : C.barBg,
                color: i === 0 ? C.white : C.textMuted,
                fontWeight: i === 0 ? 700 : 400,
              }}
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      <div
        style={{
          background: C.white,
          margin: "16px 20px",
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          padding: "20px 24px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{card.name}</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>
              ЛС {card.ls} · {card.address} · РСЦ Минска · частная собственность
              · {card.area}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 8px",
                borderRadius: 3,
                background: `${g.color}22`,
                color: g.color,
              }}
            >
              {g.title} · {g.subtitle.replace("просрочка ", "")}
            </span>
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                background: stageColor(card.stage),
                color: C.white,
                fontSize: 12,
                fontWeight: 800,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {card.stage}
            </span>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "14px 40px",
            marginTop: 18,
          }}
        >
          {(
            [
              ["Плательщик", card.name],
              ["Сумма долга по услугам", `${card.debt} р.`],
              ["Солидарные должники", card.solidary],
              ["Пеня", `${card.penalty} р.`],
              ["Дата возникновения долга", card.debtDate],
              [
                "Итого к взысканию",
                `${(parseMoney(card.debt) + parseMoney(card.penalty)).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} р.`,
              ],
              ["Закреплённый специалист", `Ответственный ${card.assignee}`],
              ["Сценарий мероприятий", `${g.title} · Базовый`],
            ] as const
          ).map(([lab, val]) => (
            <div key={lab}>
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 3 }}>
                {lab}
              </div>
              <div
                style={{
                  fontSize: lab.startsWith("Итого") ? 15 : 13,
                  fontWeight: lab.includes("долг") || lab.includes("Пеня") || lab.startsWith("Итого") ? 700 : 500,
                  color: lab === "Пеня" ? C.g4 : C.textLabel,
                }}
              >
                {val}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            gap: 22,
            marginTop: 22,
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                border: "none",
                background: "transparent",
                padding: "9px 2px",
                fontSize: 12.5,
                color: tab === t ? C.text : C.textMuted,
                fontWeight: tab === t ? 700 : 400,
                borderBottom:
                  tab === t ? `2px solid ${C.navy}` : "2px solid transparent",
                cursor: "pointer",
                marginBottom: -1,
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "Чек-лист этапа" ? (
          <div style={{ marginTop: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 10,
              }}
            >
              <span style={{ fontSize: 11.5, color: C.textMuted, fontWeight: 600 }}>
                Готово к переходу: 2 / 4
              </span>
              <div
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 4,
                  background: C.border,
                  overflow: "hidden",
                }}
              >
                <div style={{ width: "50%", height: "100%", background: C.g3 }} />
              </div>
            </div>
            {(
              [
                [
                  true,
                  "Выполнен автообзвон должнику (не менее 1 попытки)",
                  "Автоматически · сервис автообзвона",
                ],
                [
                  true,
                  "Оплата не поступила на дату проверки",
                  "Синхронизация с АИС «Расчёт-ЖКУ»",
                ],
                [
                  false,
                  "Сформирован документ «Уведомление о задолженности»",
                  "Требуется действие специалиста",
                ],
                [
                  false,
                  "Указаны способ и дата направления уведомления",
                  "Требуется действие специалиста",
                ],
              ] as const
            ).map(([done, t1, t2]) => (
              <div
                key={t1}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "10px 2px",
                  borderBottom: `1px solid ${C.borderLight}`,
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    background: done ? C.g1 : C.white,
                    border: done ? "none" : `1.5px solid ${C.border}`,
                    color: C.white,
                    fontSize: 11,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {done ? "✓" : ""}
                </span>
                <div>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: done ? C.textMuted : C.text,
                      textDecoration: done ? "line-through" : "none",
                    }}
                  >
                    {t1}
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                    {t2}
                  </div>
                </div>
              </div>
            ))}
            <div
              style={{
                marginTop: 12,
                padding: "12px 14px",
                background: C.warnBg,
                border: `1px solid ${C.warnBorder}`,
                borderRadius: 6,
                fontSize: 12,
                color: C.warnText,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 14,
              }}
            >
              <span>
                Переход на следующий этап недоступен до выполнения всех
                обязательных пунктов чек-листа
              </span>
              <span
                style={{
                  background: "#E4E7EA",
                  color: "#9AA4AC",
                  padding: "7px 14px",
                  borderRadius: 5,
                  fontSize: 12,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                Перейти на след. этап →
              </span>
            </div>
          </div>
        ) : (
          <div
            style={{
              marginTop: 16,
              fontSize: 13,
              color: C.textLabel,
              lineHeight: 1.45,
            }}
          >
            Раздел «{tab}» — содержимое по макету карточки дела (мероприятия
            сценария, договоры, история, документы).
          </div>
        )}

        <div
          style={{
            marginTop: 18,
            borderTop: `1px solid ${C.border}`,
            paddingTop: 14,
          }}
        >
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {["Отправить сообщение", "Добавить заметку", "Мероприятия", "Документы"].map(
              (b, i) => (
                <button
                  key={b}
                  type="button"
                  style={{
                    fontSize: 12,
                    padding: "6px 12px",
                    borderRadius: 5,
                    border: i === 0 ? "none" : `1px solid ${C.border}`,
                    background: i === 0 ? C.navy : C.white,
                    color: i === 0 ? C.white : C.text,
                    cursor: "pointer",
                  }}
                >
                  {b}
                </button>
              ),
            )}
          </div>
          <div
            style={{
              background: "#F3F8EF",
              border: "1px solid #D8ECD0",
              borderRadius: 6,
              padding: "10px 14px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 12.5,
              marginBottom: 12,
            }}
          >
            <span>
              Ближайшее: <b style={{ color: C.g1 }}>{card.stageLabel}</b> —
              ответственный {card.assignee}
            </span>
            <span style={{ display: "flex", gap: 14, color: C.link, fontSize: 11.5 }}>
              <span style={{ cursor: "pointer" }}>Выполнить</span>
              <span style={{ cursor: "pointer" }}>Изменить</span>
            </span>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                background: C.navy,
                color: C.white,
                fontSize: 10,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {card.assignee}
            </span>
            <div style={{ fontSize: 12 }}>
              <b>Специалист</b>{" "}
              <span style={{ color: C.textMuted }}>сегодня</span>
              <div style={{ color: C.textMuted, marginTop: 2 }}>
                Дело в {g.title}, этап «{card.stageLabel}»
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CalendarView({
  onOpenCase,
}: {
  onOpenCase: (id: string) => void;
}) {
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  return (
    <div
      style={{
        background: C.white,
        borderRadius: 6,
        border: `1px solid ${C.borderLight}`,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
        Календарь мероприятий · июль 2026
      </div>
      <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 14 }}>
        Клик по событию открывает карточку дела
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 6,
        }}
      >
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
          <div
            key={d}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: C.textMuted,
              textAlign: "center",
              paddingBottom: 4,
            }}
          >
            {d}
          </div>
        ))}
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {days.map((day) => {
          const evs = CAL_EVENTS.filter((e) => e.day === day);
          return (
            <div
              key={day}
              style={{
                minHeight: 72,
                border: `1px solid ${C.borderLight}`,
                borderRadius: 4,
                padding: 4,
                background: C.white,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: C.textMuted,
                  marginBottom: 2,
                }}
              >
                {day}
              </div>
              {evs.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onOpenCase(e.caseId)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    borderLeft: `2px solid ${e.tone}`,
                    background: C.barBg,
                    fontSize: 10,
                    padding: "2px 4px",
                    marginBottom: 2,
                    cursor: "pointer",
                    color: C.textLabel,
                    borderRadius: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {e.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChartsView({
  cases,
  onFilterGroup,
  onOpenCase,
}: {
  cases: CaseCard[];
  onFilterGroup: (g: GroupId) => void;
  onOpenCase: (id: string) => void;
}) {
  const counts = GROUPS.map(
    (g) => cases.filter((c) => c.group === g.id).length,
  );
  const sums = GROUPS.map((g) =>
    Math.round(
      cases
        .filter((c) => c.group === g.id)
        .reduce((a, c) => a + c.debtNum + parseMoney(c.penalty), 0),
    ),
  );
  const top = [...cases].sort((a, b) => b.debtNum - a.debtNum).slice(0, 5);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 0.8fr",
          gap: 14,
        }}
      >
        <div
          style={{
            background: C.white,
            borderRadius: 6,
            border: `1px solid ${C.borderLight}`,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
            Число дел по группам
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10 }}>
            Нажмите столбец или легенду — фильтр канбана по группе
          </div>
          <BarChart
            categories={GROUPS.map((g) => g.title)}
            series={[{ name: "Дела", data: counts, tone: "info" }]}
            height={220}
            valueSuffix=" дел"
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {GROUPS.map((g, i) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onFilterGroup(g.id)}
                style={{
                  border: `1px solid ${g.color}`,
                  background: `${g.color}18`,
                  color: g.color,
                  borderRadius: 4,
                  padding: "6px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {g.title}: {counts[i]} →
              </button>
            ))}
          </div>
        </div>
        <div
          style={{
            background: C.white,
            borderRadius: 6,
            border: `1px solid ${C.borderLight}`,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
            Сумма долга
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10 }}>
            Клик по сегменту легенды — к группе
          </div>
          <PieChart
            donut
            size={200}
            data={GROUPS.map((g, i) => ({
              label: g.title,
              value: sums[i] || 1,
              tone: g.tone,
            }))}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {GROUPS.map((g, i) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onFilterGroup(g.id)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  border: `1px solid ${C.borderLight}`,
                  background: C.white,
                  borderRadius: 4,
                  padding: "6px 8px",
                  fontSize: 12,
                  cursor: "pointer",
                  color: C.textLabel,
                }}
              >
                <span style={{ color: g.color, fontWeight: 700 }}>{g.title}</span>
                <span>{sums[i].toLocaleString("ru-RU")} р.</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div
        style={{
          background: C.white,
          borderRadius: 6,
          border: `1px solid ${C.borderLight}`,
          padding: 16,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
          Топ дел по сумме (клик → карточка)
        </div>
        {top.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onOpenCase(c.id)}
            style={{
              display: "flex",
              width: "100%",
              justifyContent: "space-between",
              alignItems: "center",
              border: "none",
              borderBottom: `1px solid ${C.borderLight}`,
              background: "transparent",
              padding: "10px 4px",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span>
              <b>{c.name}</b>
              <span style={{ color: C.textMuted, fontSize: 12 }}>
                {" "}
                · Группа {c.group} · ЛС {c.ls}
              </span>
            </span>
            <span style={{ fontWeight: 700 }}>{c.debt} р.</span>
          </button>
        ))}
      </div>
    </div>
  );
}


const MAP_IMG_Z12 = "data:image/png;base64,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";
const MAP_IMG_Z13 = "data:image/png;base64,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";
const MAP_CENTER_LAT = 53.902;
const MAP_CENTER_LON = 27.55;
const MAP_IMG_W = 650;
const MAP_IMG_H = 450;

function lonToWorldX(lon: number, z: number) {
  return ((lon + 180) / 360) * Math.pow(2, z) * 256;
}

function latToWorldY(lat: number, z: number) {
  const rad = (lat * Math.PI) / 180;
  return (
    ((1 -
      Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) /
      2) *
    Math.pow(2, z) *
    256
  );
}



function MapView({
  cases,
  onOpenCase,
  zoom,
  setZoom,
  selectedId,
}: {
  cases: CaseCard[];
  onOpenCase: (id: string) => void;
  zoom: number;
  setZoom: (z: number) => void;
  selectedId: string | null;
}) {
  const [pan, setPan] = useCanvasState<{ x: number; y: number }>("kb4-mapPan", {
    x: 40,
    y: 20,
  });
  const [drag, setDrag] = useCanvasState<null | {
    mx: number;
    my: number;
    px: number;
    py: number;
    moved: boolean;
  }>("kb4-mapDrag", null);
  const [hoverId, setHoverId] = useCanvasState<string | null>("kb4-mapHover", null);
  const [suppressClick, setSuppressClick] = useCanvasState(
    "kb4-mapSuppress",
    false,
  );

  const list = cases;
  const z = zoom >= 13 ? 13 : 12;
  const mapSrc = z >= 13 ? MAP_IMG_Z13 : MAP_IMG_Z12;
  const scale = z >= 13 ? 1.55 : 1.35;
  const layerW = MAP_IMG_W * scale;
  const layerH = MAP_IMG_H * scale;

  const centerX = lonToWorldX(MAP_CENTER_LON, z);
  const centerY = latToWorldY(MAP_CENTER_LAT, z);

  const markerXY = (lat: number, lon: number) => {
    const px = (lonToWorldX(lon, z) - centerX + MAP_IMG_W / 2) * scale;
    const py = (latToWorldY(lat, z) - centerY + MAP_IMG_H / 2) * scale;
    return { x: px, y: py };
  };

  const endDrag = () => {
    if (drag?.moved) setSuppressClick(true);
    setDrag(null);
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 300px",
        gap: 12,
      }}
    >
      <div
        style={{
          background: C.white,
          borderRadius: 6,
          border: `1px solid ${C.borderLight}`,
          padding: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              Карта Минска · {list.length} дел на карте
            </div>
            <div style={{ fontSize: 12, color: C.textMuted }}>
              Зажмите и тяните карту · клик по карточке на точке — открыть дело
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => {
                setPan({ x: 40, y: 20 });
                setZoom(12);
              }}
              style={{
                height: 28,
                padding: "0 10px",
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                background: C.white,
                color: C.textLabel,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Сбросить вид
            </button>
            <button
              type="button"
              onClick={() => setZoom(12)}
              style={{
                width: 28,
                height: 28,
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                background: z === 12 ? C.navy : C.white,
                color: z === 12 ? C.white : C.textMuted,
                cursor: "pointer",
                fontSize: 16,
              }}
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setZoom(13)}
              style={{
                width: 28,
                height: 28,
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                background: z === 13 ? C.navy : C.white,
                color: z === 13 ? C.white : C.textMuted,
                cursor: "pointer",
                fontSize: 16,
              }}
            >
              +
            </button>
          </div>
        </div>

        <div
          onMouseMove={(e: {
            clientX: number;
            clientY: number;
          }) => {
            if (!drag) return;
            const dx = e.clientX - drag.mx;
            const dy = e.clientY - drag.my;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
              setDrag({ ...drag, moved: true });
            }
            setPan({ x: drag.px + dx, y: drag.py + dy });
          }}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          onMouseDown={(e: {
            clientX: number;
            clientY: number;
            button: number;
          }) => {
            if (e.button !== 0) return;
            setDrag({
              mx: e.clientX,
              my: e.clientY,
              px: pan.x,
              py: pan.y,
              moved: false,
            });
          }}
          style={{
            position: "relative",
            width: "100%",
            height: 520,
            borderRadius: 8,
            overflow: "hidden",
            border: `1px solid ${C.border}`,
            background: "#c5d4de",
            cursor: drag ? "grabbing" : "grab",
            userSelect: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: layerW,
              height: layerH,
              transform: `translate(${pan.x}px, ${pan.y}px)`,
              willChange: "transform",
            }}
          >
            <img
              src={mapSrc}
              alt="Карта Минска"
              draggable={false}
              style={{
                width: layerW,
                height: layerH,
                display: "block",
                pointerEvents: "none",
                userSelect: "none",
              }}
            />
            {list.map((c, i) => {
              const g = GROUPS.find((x) => x.id === c.group)!;
              const { x, y } = markerXY(c.lat, c.lon);
              const sel = selectedId === c.id;
              const hot = hoverId === c.id || sel;
              const sideRight = i % 2 === 0;
              const shortName =
                c.name.length > 28 ? c.name.slice(0, 26) + "…" : c.name;

              return (
                <div
                  key={c.id}
                  style={{
                    position: "absolute",
                    left: x,
                    top: y,
                    transform: "translate(-50%, -100%)",
                    zIndex: hot ? 20 : 5 + (i % 5),
                    pointerEvents: "auto",
                  }}
                >
                  <button
                    type="button"
                    title={c.address}
                    onMouseDown={(e: { stopPropagation?: () => void }) => {
                      e.stopPropagation?.();
                    }}
                    onMouseEnter={() => setHoverId(c.id)}
                    onMouseLeave={() => setHoverId(null)}
                    onClick={() => {
                      if (suppressClick) {
                        setSuppressClick(false);
                        return;
                      }
                      onOpenCase(c.id);
                    }}
                    style={{
                      display: "flex",
                      flexDirection: sideRight ? "row" : "row-reverse",
                      alignItems: "flex-end",
                      gap: 4,
                      border: "none",
                      background: "transparent",
                      padding: 0,
                      cursor: "pointer",
                      textAlign: sideRight ? "left" : "right",
                    }}
                  >
                    <span
                      style={{
                        width: hot ? 16 : 12,
                        height: hot ? 16 : 12,
                        borderRadius: 8,
                        background: g.color,
                        border: `2px solid ${C.white}`,
                        boxShadow: hot
                          ? `0 0 0 3px ${g.color}55`
                          : "0 1px 3px rgba(0,0,0,0.35)",
                        flexShrink: 0,
                        marginBottom: 0,
                      }}
                    />
                    <span
                      style={{
                        display: "block",
                        minWidth: 148,
                        maxWidth: 190,
                        background: hot ? C.white : "rgba(255,255,255,0.94)",
                        border: sel
                          ? `1.5px solid ${C.navy}`
                          : `1px solid ${C.border}`,
                        borderLeft: sideRight
                          ? `3px solid ${g.color}`
                          : undefined,
                        borderRight: !sideRight
                          ? `3px solid ${g.color}`
                          : undefined,
                        borderRadius: 6,
                        padding: "6px 8px",
                        boxShadow: "0 2px 8px rgba(26,48,68,0.14)",
                        marginBottom: 6,
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          fontSize: 11,
                          fontWeight: 700,
                          color: C.text,
                          lineHeight: 1.25,
                          marginBottom: 2,
                        }}
                      >
                        {shortName}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: 10,
                          color: C.textMuted,
                          marginBottom: 3,
                          lineHeight: 1.2,
                        }}
                      >
                        ЛС {c.ls} · {c.district}
                      </span>
                      <span
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: C.text,
                          }}
                        >
                          {c.debt} р.
                        </span>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: "1px 5px",
                            borderRadius: 3,
                            background: `${g.color}22`,
                            color: g.color,
                            whiteSpace: "nowrap",
                          }}
                        >
                          Г{c.group} · {c.stage}
                        </span>
                      </span>
                      {hot ? (
                        <span
                          style={{
                            display: "block",
                            fontSize: 10,
                            color: C.textMuted,
                            marginTop: 3,
                            lineHeight: 1.2,
                          }}
                        >
                          {c.stageLabel}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          <div
            style={{
              position: "absolute",
              left: 10,
              bottom: 10,
              fontSize: 11,
              color: C.textMuted,
              background: "rgba(255,255,255,0.9)",
              padding: "4px 8px",
              borderRadius: 4,
              pointerEvents: "none",
            }}
          >
            Перетащите карту мышью
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          {GROUPS.map((g) => (
            <span
              key={g.id}
              style={{
                fontSize: 11,
                color: C.textMuted,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  background: g.color,
                }}
              />
              {g.title}
            </span>
          ))}
        </div>
      </div>

      <div
        style={{
          background: C.white,
          borderRadius: 6,
          border: `1px solid ${C.borderLight}`,
          padding: 12,
          overflowY: "auto",
          maxHeight: 580,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
          Все дела на карте ({list.length})
        </div>
        {list.map((c) => {
          const g = GROUPS.find((x) => x.id === c.group)!;
          return (
            <button
              key={c.id}
              type="button"
              onMouseEnter={() => setHoverId(c.id)}
              onMouseLeave={() => setHoverId(null)}
              onClick={() => onOpenCase(c.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                border: "none",
                borderBottom: `1px solid ${C.borderLight}`,
                background:
                  selectedId === c.id || hoverId === c.id
                    ? "#E8F1F8"
                    : "transparent",
                padding: "9px 6px",
                cursor: "pointer",
                borderRadius: 4,
                borderLeft: `3px solid ${g.color}`,
                marginBottom: 2,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600 }}>{c.name}</div>
              <div style={{ fontSize: 11, color: C.textMuted }}>
                {c.address}
              </div>
              <div
                style={{
                  fontSize: 11,
                  marginTop: 2,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontWeight: 700 }}>{c.debt} р.</span>
                <span style={{ color: g.color, fontWeight: 600 }}>
                  Группа {c.group}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function CasesKanbanCanvas() {
  useHostTheme();

  const [cases, setCases] = useCanvasState<CaseCard[]>("kb3-cases", CASES0);
  const [notifs, setNotifs] = useCanvasState<Notif[]>("kb2-notifs", NOTIFS0);
  const [nav, setNav] = useCanvasState<NavId>("kb2-nav", "cases");
  const [view, setView] = useCanvasState<ViewMode>("kb2-view", "kanban");
  const [page, setPage] = useCanvasState<Page>("kb2-page", { kind: "board" });
  const [notifOpen, setNotifOpen] = useCanvasState("kb2-notifOpen", true);
  const [notifFilter, setNotifFilter] = useCanvasState<"all" | "unread">(
    "kb2-notifFilter",
    "all",
  );
  const [search, setSearch] = useCanvasState("kb2-search", "");
  const [orgFilter, setOrgFilter] = useCanvasState("kb2-org", true);
  const [groupFilter, setGroupFilter] = useCanvasState<GroupId | null>(
    "kb2-gfilter",
    null,
  );
  const [dragId, setDragId] = useCanvasState<string | null>("kb2-drag", null);
  const [dropGroup, setDropGroup] = useCanvasState<GroupId | null>(
    "kb2-drop",
    null,
  );
  const [toast, setToast] = useCanvasState("kb2-toast", "");
  const [mapZoom, setMapZoom] = useCanvasState("kb3-mapZoom", 12);

  const q = search.trim().toLowerCase();
  const filtered = cases.filter((c) => {
    if (groupFilter && c.group !== groupFilter) return false;
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.ls.includes(q) ||
      c.address.toLowerCase().includes(q)
    );
  });

  const unreadCount = notifs.filter((n) => n.unread).length;

  const openCase = (id: string) => {
    setPage({ kind: "case", id, tab: "Чек-лист этапа" });
    setNav("cases");
  };

  const moveToGroup = (caseId: string, group: GroupId) => {
    setCases((prev) =>
      prev.map((c) =>
        c.id === caseId
          ? {
              ...c,
              group,
              stageLabel:
                group === 1
                  ? "Новый должник"
                  : group === 2
                    ? c.stageLabel
                    : group === 3
                      ? "Отключение услуг"
                      : "Исполнительная надпись",
            }
          : c,
      ),
    );
    setToast(`Карточка перенесена в Группу ${group}`);
  };

  const openNotif = (id: string) => {
    setNotifs((prev) =>
      prev.map((n) => (n.id === id ? { ...n, unread: false } : n)),
    );
    const n = notifs.find((x) => x.id === id);
    if (n?.caseId) openCase(n.caseId);
    else setPage({ kind: "notif", id });
  };

  if (page.kind === "case") {
    const card = cases.find((c) => c.id === page.id);
    if (card) {
      return (
        <div
          style={{
            width: "100%",
            minWidth: 1100,
            minHeight: "100%",
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            color: C.text,
          }}
        >
          <TopBar
            nav={nav}
            setNav={setNav}
            unreadCount={unreadCount}
            notifOpen={notifOpen}
            setNotifOpen={setNotifOpen}
            setToast={setToast}
          />
          <CaseDetailPage
            card={card}
            tab={page.tab}
            setTab={(tab) => setPage({ kind: "case", id: page.id, tab })}
            onBack={() => setPage({ kind: "board" })}
          />
        </div>
      );
    }
  }

  return (
    <div
      style={{
        width: "100%",
        minWidth: 1280,
        minHeight: "100%",
        boxSizing: "border-box",
        background: C.pageBg,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        color: C.text,
      }}
    >
      <TopBar
        nav={nav}
        setNav={(n) => {
          setNav(n);
          setPage({ kind: "board" });
        }}
        unreadCount={unreadCount}
        notifOpen={notifOpen}
        setNotifOpen={setNotifOpen}
        setToast={setToast}
      />

      <div
        style={{
          height: 52,
          background: C.barBg,
          borderBottom: `1px solid ${C.borderLight}`,
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          gap: 12,
        }}
      >
        <button
          type="button"
          onClick={() => setPage({ kind: "new-case" })}
          style={{
            height: 32,
            padding: "0 14px",
            border: "none",
            borderRadius: 4,
            background: C.navyBtn,
            color: C.white,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          + Новое дело
        </button>
        <span style={{ color: C.textMuted, fontSize: 12, whiteSpace: "nowrap" }}>
          Дела /{" "}
          {groupFilter ? `Группа ${groupFilter}` : "Все группы"}
          {groupFilter ? (
            <button
              type="button"
              onClick={() => setGroupFilter(null)}
              style={{
                marginLeft: 6,
                border: "none",
                background: "transparent",
                color: C.link,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              сбросить
            </button>
          ) : null}
        </span>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 34,
            background: C.white,
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            padding: "0 10px",
            colorScheme: "light",
          }}
        >
          {orgFilter ? (
            <button
              type="button"
              onClick={() => setOrgFilter(false)}
              style={{
                border: "none",
                background: "#E8F1F8",
                color: C.navy,
                fontSize: 12,
                borderRadius: 3,
                padding: "2px 8px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Организация: РСЦ Минска ×
            </button>
          ) : null}
          <input
            value={search}
            onChange={(e: { target: { value: string } }) =>
              setSearch(e.target.value)
            }
            placeholder="Поиск по ФИО, организации, ЛС, адресу..."
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: 13,
              background: C.white,
              color: C.textLabel,
              minWidth: 0,
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(
            [
              ["kanban", "▦", "Канбан"],
              ["list", "≡", "Список"],
              ["calendar", "▤", "Календарь"],
              ["charts", "▨", "Диаграммы"],
              ["map", "◎", "Карта"],
            ] as const
          ).map(([id, icon, label]) => (
            <button
              key={id}
              type="button"
              title={label}
              onClick={() => {
                setView(id);
                setPage({ kind: "board" });
              }}
              style={{
                width: 32,
                height: 32,
                border:
                  view === id ? `1px solid ${C.navy}` : `1px solid ${C.border}`,
                borderRadius: 4,
                background: view === id ? C.navy : C.white,
                color: view === id ? C.white : C.textMuted,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>

      {toast ? (
        <div
          style={{
            background: "#E8F1F8",
            borderBottom: `1px solid ${C.borderLight}`,
            padding: "7px 16px",
            fontSize: 12,
            color: C.navy,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => setToast("")}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: C.textMuted,
            }}
          >
            ×
          </button>
        </div>
      ) : null}

      {page.kind === "new-case" ? (
        <div style={{ padding: 24, maxWidth: 520 }}>
          <div
            style={{
              background: C.white,
              borderRadius: 6,
              border: `1px solid ${C.border}`,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
              Новое дело
            </div>
            <div style={{ fontSize: 13, color: C.textLabel, marginBottom: 14 }}>
              В рабочей системе — форма выбора организации, ЛС и начальной
              группы.
            </div>
            <button
              type="button"
              onClick={() => setPage({ kind: "board" })}
              style={{
                height: 32,
                padding: "0 14px",
                border: "none",
                borderRadius: 4,
                background: C.navyBtn,
                color: C.white,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Закрыть
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "stretch", minHeight: 640 }}>
          {notifOpen ? (
            <NotifColumn
              notifs={notifs}
              filter={notifFilter}
              setFilter={setNotifFilter}
              onClose={() => setNotifOpen(false)}
              onOpen={openNotif}
              selectedId={page.kind === "notif" ? page.id : null}
            />
          ) : (
            <button
              type="button"
              onClick={() => setNotifOpen(true)}
              style={{
                width: 24,
                flexShrink: 0,
                border: "none",
                borderRight: `1px solid ${C.border}`,
                background: C.notifHeader,
                cursor: "pointer",
                writingMode: "vertical-rl",
                fontSize: 10,
                fontWeight: 700,
                color: C.text,
                letterSpacing: "0.05em",
              }}
            >
              Увед.{unreadCount ? ` ${unreadCount}` : ""}
            </button>
          )}

          <div style={{ flex: 1, minWidth: 0, padding: 12, overflowX: "auto" }}>
            {nav !== "cases" ? (
              <div
                style={{
                  background: C.white,
                  padding: 24,
                  borderRadius: 6,
                  fontSize: 14,
                }}
              >
                Раздел выбран в навигации.{" "}
                <button
                  type="button"
                  onClick={() => setNav("cases")}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: C.link,
                    cursor: "pointer",
                    fontSize: 14,
                  }}
                >
                  К делам →
                </button>
              </div>
            ) : view === "list" ? (
              <div
                style={{
                  background: C.white,
                  borderRadius: 6,
                  border: `1px solid ${C.borderLight}`,
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 13,
                  }}
                >
                  <thead>
                    <tr style={{ background: C.barBg, textAlign: "left" }}>
                      {["Должник", "ЛС", "Группа", "Этап", "Сумма", ""].map(
                        (h) => (
                          <th
                            key={h || "x"}
                            style={{
                              padding: "10px 12px",
                              fontSize: 11,
                              color: C.textMuted,
                              borderBottom: `1px solid ${C.borderLight}`,
                            }}
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => (
                      <tr
                        key={c.id}
                        onClick={() => openCase(c.id)}
                        style={{
                          cursor: "pointer",
                          borderBottom: `1px solid ${C.borderLight}`,
                        }}
                      >
                        <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                          {c.name}
                        </td>
                        <td style={{ padding: "10px 12px", color: C.textMuted }}>
                          {c.ls}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          Группа {c.group}
                        </td>
                        <td style={{ padding: "10px 12px" }}>{c.stageLabel}</td>
                        <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                          {c.debt} р.
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            color: C.link,
                            fontSize: 12,
                          }}
                        >
                          Открыть
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : view === "calendar" ? (
              <CalendarView onOpenCase={openCase} />
            ) : view === "charts" ? (
              <ChartsView
                cases={cases}
                onFilterGroup={(g) => {
                  setGroupFilter(g);
                  setView("kanban");
                  setToast(`Фильтр: Группа ${g}`);
                }}
                onOpenCase={openCase}
              />
            ) : view === "map" ? (
              <MapView
                cases={cases}
                onOpenCase={openCase}
                zoom={mapZoom}
                setZoom={setMapZoom}
                selectedId={page.kind === "case" ? page.id : null}
              />
            ) : (
              <div>
                <div
                  style={{
                    fontSize: 12,
                    color: C.textMuted,
                    marginBottom: 8,
                  }}
                >
                  Перетащите карточку в другую колонку, чтобы сменить группу
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, minmax(220px, 1fr))",
                    gap: 10,
                    alignItems: "start",
                  }}
                >
                  {GROUPS.map((g) => {
                    const cols = filtered.filter((c) => c.group === g.id);
                    const total = cases.filter((c) => c.group === g.id).length;
                    const activeDrop = dropGroup === g.id;
                    return (
                      <div
                        key={g.id}
                        onDragOver={(e: {
                          preventDefault: () => void;
                          dataTransfer: { dropEffect: string };
                        }) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setDropGroup(g.id);
                        }}
                        onDragLeave={() => {
                          if (dropGroup === g.id) setDropGroup(null);
                        }}
                        onDrop={(e: {
                          preventDefault: () => void;
                          dataTransfer: { getData: (t: string) => string };
                        }) => {
                          e.preventDefault();
                          const id =
                            e.dataTransfer.getData("text/plain") || dragId;
                          if (id) moveToGroup(id, g.id);
                          setDragId(null);
                          setDropGroup(null);
                        }}
                        style={{
                          minHeight: 120,
                          borderRadius: 6,
                          outline: activeDrop
                            ? `2px dashed ${g.color}`
                            : "none",
                          background: activeDrop ? `${g.color}10` : "transparent",
                          padding: activeDrop ? 4 : 0,
                        }}
                      >
                        <div
                          style={{
                            background: C.white,
                            borderRadius: 6,
                            border: `1px solid ${C.borderLight}`,
                            borderTop: `3px solid ${g.color}`,
                            padding: "10px 12px",
                            marginBottom: 8,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                            }}
                          >
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 700 }}>
                                {g.title}
                              </div>
                              <div
                                style={{ fontSize: 11, color: C.textMuted }}
                              >
                                {g.subtitle}
                              </div>
                            </div>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: C.textMuted,
                              }}
                            >
                              {q || groupFilter
                                ? `${cols.length}/${total}`
                                : total}
                            </span>
                          </div>
                        </div>
                        {cols.map((card) => (
                          <span key={card.id}>
                            <CaseCardView
                              card={card}
                              dragging={dragId === card.id}
                              onOpen={() => openCase(card.id)}
                              onDragStart={() => setDragId(card.id)}
                              onToggleFav={() =>
                                setCases((prev) =>
                                  prev.map((c) =>
                                    c.id === card.id
                                      ? { ...c, favorite: !c.favorite }
                                      : c,
                                  ),
                                )
                              }
                            />
                          </span>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
