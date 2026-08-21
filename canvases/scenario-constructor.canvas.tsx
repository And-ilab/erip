import { useCanvasState, useHostTheme } from "cursor/canvas";

/** Brand tokens from PNG mockup — navy + white */
const C = {
  navy: "#1A3044",
  navyBtn: "#1B3A4F",
  white: "#FFFFFF",
  pageBg: "#F5F6F8",
  barBg: "#EEF0F2",
  border: "#D8DCE0",
  borderLight: "#E6E8EB",
  text: "#1F2933",
  textMuted: "#6B7280",
  textLabel: "#374151",
  section: "#9CA3AF",
  link: "#2563EB",
  selectedBg: "#E8F1F8",
  selectedBorder: "#1A3044",
  autoBg: "#F3E8F5",
  autoFg: "#9D4EDD",
  manBg: "#E3F0FA",
  manFg: "#3B82C4",
  inputBg: "#FFFFFF",
  avatar: "#9AA3AD",
  groupBox: "#F0F7FC",
  groupBorder: "#B6D0E4",
};

type LogicOp = "AND" | "OR";
type Mode = "auto" | "manual";
type TimeMode =
  | "after_prev"
  | "on_group"
  | "from_receipt"
  | "after_inscription"
  | "on_package"
  | "after_doc";

type CondKind =
  | "after_finish"
  | "not_paid"
  | "approval_done"
  | "manual";

type Cond = { id: string; kind: CondKind; ref: string };
type Step = {
  id: string;
  name: string;
  days: number;
  mode: Mode;
  prev: string;
  timeMode: TimeMode;
  timeDays: number;
  selectedGroups: string[];
  excludeIf: string;
  actionType: string;
  templateId: string;
  assignee: string;
  blockerText: string;
  statusAfter: string;
  /** joinOps[i] — оператор между conditions[i] и conditions[i+1] */
  joinOps: LogicOp[];
  conditions: Cond[];
  autoComplete: boolean;
  allowManual: boolean;
};

type TplGroupId = "email" | "voice" | "print" | "sms";
type Tpl = {
  id: string;
  name: string;
  channel: string;
  body: string;
  group: TplGroupId;
};

type LibItem = { id: string; name: string; description: string };

const TPL_GROUPS: { id: TplGroupId; name: string; desc: string }[] = [
  { id: "email", name: "Шаблоны e-mail", desc: "Письма по SMTP" },
  { id: "voice", name: "Голосовые шаблоны", desc: "TTS / автообзвон Asterisk" },
  { id: "print", name: "Печатные формы", desc: "PDF / предупреждения / пакеты" },
  { id: "sms", name: "SMS / мессенджеры", desc: "Короткие уведомления" },
];

const BLOCKER_OPTIONS = [
  "не блокирует переход на следующий этап",
  "обязателен для перехода к следующему этапу",
  "обязателен для перехода к отключению",
  "обязателен для перехода к исполнительной надписи",
  "обязателен для перехода в ОПИ",
  "обязателен для перехода к списанию",
  "блокер: предшествующее мероприятие должно быть выполнено",
  "блокер: E-mail напоминание должно быть выполнено",
  "блокер: вручение + согласование руководителя",
  "блокер: пакет документов сформирован",
  "блокер: согласование завершено со статусом «Согласовано»",
  "блокер: исполнительная надпись получена",
];

const LIB_CONDS0: LibItem[] = [
  {
    id: "lc1",
    name: "После завершения действия",
    description: "Предыдущее действие получило статус «Выполнено»",
  },
  {
    id: "lc2",
    name: "Оплата не поступила",
    description: "Остаток задолженности > 0 на контрольную дату",
  },
  {
    id: "lc3",
    name: "Согласование завершено",
    description: "Маршрут согласования = «Согласовано»",
  },
  {
    id: "lc4",
    name: "Ручной запуск",
    description: "Специалист запускает действие вручную",
  },
];

const LIB_ACTS0: LibItem[] = [
  {
    id: "la1",
    name: "Автообзвон",
    description: "Asterisk + голосовой шаблон",
  },
  {
    id: "la2",
    name: "E-mail (SMTP)",
    description: "Письмо по шаблону",
  },
  {
    id: "la3",
    name: "Смена статуса канбана",
    description: "Перевод карточки на стадию / в архив",
  },
  {
    id: "la4",
    name: "Отключение услуг",
    description: "Согласование → поставщик → факт",
  },
  {
    id: "la5",
    name: "Пакет документов",
    description: "Загрузка файлов в карточку дела",
  },
];

const ALL_GROUPS = [
  "Группа 1",
  "Группа 2",
  "Группа 3",
  "Группа 4",
];

const TIME_OPTIONS: { value: TimeMode; label: string; needsDays: boolean }[] = [
  {
    value: "after_prev",
    label: "После предшествующего действия",
    needsDays: true,
  },
  {
    value: "on_group",
    label: "Сразу при попадании в группу",
    needsDays: false,
  },
  {
    value: "from_receipt",
    label: "С даты вручения",
    needsDays: true,
  },
  {
    value: "after_inscription",
    label: "После исполнительной надписи",
    needsDays: true,
  },
  {
    value: "on_package",
    label: "По готовности пакета",
    needsDays: false,
  },
  {
    value: "after_doc",
    label: "Сразу после формирования документа",
    needsDays: false,
  },
];

const COND_KINDS: { value: CondKind; label: string; refLabel: string | null }[] =
  [
    {
      value: "after_finish",
      label: "После завершения действия",
      refLabel: "Какое действие",
    },
    {
      value: "not_paid",
      label: "Оплата не поступила",
      refLabel: null,
    },
    {
      value: "approval_done",
      label: "Согласование завершено",
      refLabel: "Какое согласование",
    },
    {
      value: "manual",
      label: "Ручной запуск специалистом",
      refLabel: null,
    },
  ];

const TPL: Tpl[] = [
  {
    id: "tpl1",
    name: "Напоминание о задолженности — стандарт",
    channel: "E-mail",
    body: "Уважаемый(ая) {{fio}}!\n\nПо лицевому счёту {{ls}} имеется задолженность {{sum}} руб. Просим погасить до {{date}}.\n\n{{org_name}}",
    group: "email",
  },
  {
    id: "tpl2",
    name: "Автообзвон — группа 1–2",
    channel: "Голос / TTS",
    body: "Здравствуйте, {{fio}}. Напоминаем о задолженности {{sum}} рублей.",
    group: "voice",
  },
  {
    id: "tpl3",
    name: "Предупреждение о задолженности (печать)",
    channel: "Печатная форма",
    body: "ПРЕДУПРЕЖДЕНИЕ\n{{fio}}, {{address}}\nЗадолженность: {{sum}}",
    group: "print",
  },
  {
    id: "tpl4",
    name: "SMS — краткое напоминание",
    channel: "SMS",
    body: "{{fio}}, задолженность {{sum}} руб. по ЛС {{ls}}. Погасите до {{date}}.",
    group: "sms",
  },
  {
    id: "tpl5",
    name: "E-mail — предупреждение перед отключением",
    channel: "E-mail",
    body: "Уважаемый(ая) {{fio}}!\n\nПри непогашении задолженности {{sum}} руб. услуги по ЛС {{ls}} могут быть ограничены.\n\n{{org_name}}",
    group: "email",
  },
];

const STEPS0: Step[] = [
  {
    id: "s1",
    name: "Автообзвон",
    days: 0,
    mode: "auto",
    prev: "— (старт сценария)",
    timeMode: "on_group",
    timeDays: 0,
    selectedGroups: ["Группа 1", "Группа 2"],
    excludeIf: "Нет телефона",
    actionType: "Автообзвон (Asterisk)",
    templateId: "tpl2",
    assignee: "Система / Asterisk",
    blockerText: "не блокирует переход на следующий этап",
    statusAfter: "→ Автообзвон",
    joinOps: [],
    conditions: [],
    autoComplete: true,
    allowManual: true,
  },
  {
    id: "s2",
    name: "E-mail напоминание",
    days: 2,
    mode: "auto",
    prev: "Автообзвон",
    timeMode: "after_prev",
    timeDays: 2,
    selectedGroups: ["Группа 1", "Группа 2"],
    excludeIf: "Оплата поступила / долг погашен",
    actionType: "Отправить e-mail (SMTP)",
    templateId: "tpl1",
    assignee: "Роль: Специалист (по ЛС)",
    blockerText: "не блокирует переход на следующий этап",
    statusAfter: "Не менять",
    joinOps: ["AND"],
    conditions: [
      { id: "c1", kind: "after_finish", ref: "Автообзвон" },
      { id: "c2", kind: "not_paid", ref: "" },
    ],
    autoComplete: true,
    allowManual: true,
  },
  {
    id: "s3",
    name: "Ручной звонок",
    days: 3,
    mode: "manual",
    prev: "E-mail напоминание",
    timeMode: "after_prev",
    timeDays: 3,
    selectedGroups: ["Группа 2"],
    excludeIf: "Должник перезвонил сам",
    actionType: "Ручной звонок",
    templateId: "tpl2",
    assignee: "Роль: Специалист (по ЛС)",
    blockerText: "не блокирует переход на следующий этап",
    statusAfter: "Не менять",
    joinOps: ["OR"],
    conditions: [
      { id: "c3", kind: "after_finish", ref: "E-mail напоминание" },
      { id: "c4", kind: "manual", ref: "" },
    ],
    autoComplete: false,
    allowManual: true,
  },
  {
    id: "s4",
    name: "Предупреждение (печать)",
    days: 5,
    mode: "auto",
    prev: "Ручной звонок",
    timeMode: "after_prev",
    timeDays: 5,
    selectedGroups: ["Группа 2", "Группа 3"],
    excludeIf: "Оплата поступила",
    actionType: "Сформировать предупреждение (PDF)",
    templateId: "tpl3",
    assignee: "Роль: Специалист",
    blockerText: "блокер: E-mail напоминание должно быть выполнено",
    statusAfter: "→ Предупреждение",
    joinOps: [],
    conditions: [],
    autoComplete: true,
    allowManual: false,
  },
  {
    id: "s5",
    name: "Вручение предупреждения",
    days: 0,
    mode: "manual",
    prev: "Предупреждение (печать)",
    timeMode: "after_doc",
    timeDays: 0,
    selectedGroups: ["Группа 2", "Группа 3"],
    excludeIf: "—",
    actionType: "Вручение предупреждения",
    templateId: "tpl3",
    assignee: "Роль: Специалист / поставщик",
    blockerText: "обязателен для перехода к отключению",
    statusAfter: "→ Предупреждение",
    joinOps: [],
    conditions: [],
    autoComplete: false,
    allowManual: true,
  },
  {
    id: "s6",
    name: "Отключение услуг",
    days: 5,
    mode: "auto",
    prev: "Вручение предупреждения",
    timeMode: "from_receipt",
    timeDays: 5,
    selectedGroups: ["Группа 2", "Группа 3", "Группа 4"],
    excludeIf: "Оплата до отключения",
    actionType: "Инициировать отключение услуг",
    templateId: "tpl3",
    assignee: "Согласующий → поставщик",
    blockerText: "блокер: вручение + согласование руководителя",
    statusAfter: "→ Отключение услуг",
    joinOps: ["AND", "OR"],
    conditions: [
      { id: "c5", kind: "after_finish", ref: "Вручение предупреждения" },
      { id: "c6", kind: "approval_done", ref: "Согласование отключения" },
      { id: "c7", kind: "not_paid", ref: "" },
    ],
    autoComplete: false,
    allowManual: false,
  },
  {
    id: "s7",
    name: "Запрос согласования списания",
    days: 0,
    mode: "manual",
    prev: "Отключение услуг",
    timeMode: "on_package",
    timeDays: 0,
    selectedGroups: ["Группа 3", "Группа 4"],
    excludeIf: "—",
    actionType: "Запрос согласования",
    templateId: "tpl1",
    assignee: "Роль: с правом согласования",
    blockerText: "обязателен для перехода к списанию",
    statusAfter: "Не менять",
    joinOps: [],
    conditions: [],
    autoComplete: false,
    allowManual: true,
  },
  {
    id: "s8",
    name: "Исполнительная надпись",
    days: 0,
    mode: "manual",
    prev: "Запрос согласования списания",
    timeMode: "on_package",
    timeDays: 0,
    selectedGroups: ["Группа 3", "Группа 4"],
    excludeIf: "—",
    actionType: "Пакет на исполнительную надпись",
    templateId: "tpl3",
    assignee: "Специалист ЮС",
    blockerText: "не блокирует переход на следующий этап",
    statusAfter: "→ Исполнительная надпись",
    joinOps: [],
    conditions: [],
    autoComplete: false,
    allowManual: true,
  },
  {
    id: "s9",
    name: "Направление в ОПИ",
    days: 15,
    mode: "auto",
    prev: "Исполнительная надпись",
    timeMode: "after_inscription",
    timeDays: 15,
    selectedGroups: ["Группа 3", "Группа 4"],
    excludeIf: "—",
    actionType: "Направление в ОПИ",
    templateId: "tpl1",
    assignee: "Специалист ЮС",
    blockerText: "блокер: исполнительная надпись получена",
    statusAfter: "→ ОПИ",
    joinOps: [],
    conditions: [],
    autoComplete: true,
    allowManual: false,
  },
];

function uid(p: string) {
  return `${p}-${Math.random().toString(36).slice(2, 7)}`;
}

function opLabel(op: LogicOp) {
  return op === "AND" ? "и" : "или";
}

/** Группы подряд идущих условий с одинаковым оператором между ними */
function buildGroups(n: number, ops: LogicOp[]): { start: number; end: number; op: LogicOp }[] {
  if (n <= 1) return [];
  const groups: { start: number; end: number; op: LogicOp }[] = [];
  let start = 0;
  let cur = ops[0] ?? "AND";
  for (let i = 1; i < n - 1; i++) {
    if (ops[i] !== cur) {
      groups.push({ start, end: i, op: cur });
      start = i;
      cur = ops[i];
    }
  }
  groups.push({ start, end: n - 1, op: cur });
  return groups;
}

function Tag({ mode }: { mode: Mode }) {
  const auto = mode === "auto";
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        background: auto ? C.autoBg : C.manBg,
        color: auto ? C.autoFg : C.manFg,
        whiteSpace: "nowrap",
      }}
    >
      {auto ? "Авто" : "Ручное"}
    </span>
  );
}

function FieldRow({ label, children }: { label: string; children: any }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "220px minmax(0, 1fr)",
        gap: 16,
        alignItems: "start",
        marginBottom: 12,
      }}
    >
      <div
        style={{
          fontSize: 13,
          color: C.textLabel,
          textAlign: "right",
          lineHeight: 1.2,
          paddingTop: 8,
          letterSpacing: "-0.01em",
        }}
      >
        {label}
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

const areaStyle: Record<string, string | number> = {
  width: "100%",
  padding: 10,
  border: `1px solid ${C.border}`,
  borderRadius: 4,
  fontSize: 13,
  fontFamily: "inherit",
  boxSizing: "border-box",
  resize: "vertical",
  background: C.white,
  color: C.textLabel,
  colorScheme: "light",
};

function SelectBox({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const opts = Array.from(new Set([value, ...options].filter(Boolean)));
  return (
    <select
      value={value}
      onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
      style={{
        width: "100%",
        height: 34,
        padding: "0 28px 0 10px",
        border: `1px solid ${C.border}`,
        borderRadius: 4,
        background: C.white,
        color: C.textLabel,
        fontSize: 13,
        appearance: "none",
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%236B7280' d='M1 1l5 5 5-5'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 10px center",
        boxSizing: "border-box",
        colorScheme: "light",
      }}
    >
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function TextBox({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
      style={{
        width: "100%",
        height: 34,
        padding: "0 10px",
        border: `1px solid ${C.border}`,
        borderRadius: 4,
        background: C.white,
        color: C.textLabel,
        fontSize: 13,
        boxSizing: "border-box",
        colorScheme: "light",
      }}
    />
  );
}

function Section({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        color: C.section,
        margin: "20px 0 12px",
        textTransform: "uppercase",
      }}
    >
      {title}
    </div>
  );
}

function PrimaryBtn({ children, onClick }: { children: any; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
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
      }}
    >
      {children}
    </button>
  );
}

function GhostBtn({ children, onClick }: { children: any; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 32,
        padding: "0 14px",
        border: `1px solid ${C.border}`,
        borderRadius: 4,
        background: C.white,
        color: C.text,
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function OpChip({
  op,
  onChange,
  locked,
}: {
  op: LogicOp;
  onChange: (op: LogicOp) => void;
  locked?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 6,
        padding: "6px 0",
      }}
    >
      <div
        style={{
          width: 1,
          height: 10,
          background: C.border,
        }}
      />
      <select
        value={op}
        disabled={locked}
        onChange={(e: { target: { value: string } }) =>
          onChange(e.target.value as LogicOp)
        }
        style={{
          height: 26,
          padding: "0 22px 0 10px",
          border: `1px solid ${C.navy}`,
          borderRadius: 12,
          background: C.white,
          color: C.navy,
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          appearance: "none",
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 12 8'%3E%3Cpath fill='%231A3044' d='M1 1l5 5 5-5'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 8px center",
          cursor: locked ? "not-allowed" : "pointer",
          opacity: locked ? 0.7 : 1,
        }}
      >
        <option value="AND">и</option>
        <option value="OR">или</option>
      </select>
      <div
        style={{
          width: 1,
          height: 10,
          background: C.border,
        }}
      />
    </div>
  );
}

function CondCard({
  cond,
  index,
  names,
  onChange,
  onRemove,
}: {
  cond: Cond;
  index: number;
  names: string[];
  onChange: (c: Cond) => void;
  onRemove: () => void;
}) {
  const meta = COND_KINDS.find((k) => k.value === cond.kind)!;
  return (
    <div
      style={{
        border: `1px solid ${C.borderLight}`,
        borderRadius: 6,
        padding: "10px 12px",
        background: C.white,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: C.textMuted }}>
          Условие {index + 1}
        </span>
        <button
          type="button"
          onClick={onRemove}
          style={{
            border: "none",
            background: "transparent",
            color: C.textMuted,
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
      <div style={{ marginBottom: meta.refLabel ? 8 : 0 }}>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>Когда</div>
        <SelectBox
          value={meta.label}
          options={COND_KINDS.map((k) => k.label)}
          onChange={(label) => {
            const k = COND_KINDS.find((x) => x.label === label)!;
            onChange({
              ...cond,
              kind: k.value,
              ref:
                k.value === "after_finish"
                  ? names[0] ?? ""
                  : k.value === "approval_done"
                    ? "Согласование отключения"
                    : "",
            });
          }}
        />
      </div>
      {meta.refLabel ? (
        <div>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>
            {meta.refLabel}
          </div>
          <SelectBox
            value={cond.ref}
            options={
              cond.kind === "approval_done"
                ? ["Согласование отключения", "Согласование списания"]
                : names
            }
            onChange={(ref) => onChange({ ...cond, ref })}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Рисует условия с операторами «и/или» между ними.
 * При 2 условиях — один общий оператор.
 * При 3+ — оператор между каждой парой; смена оператора рисует скобочную группу.
 */
function ConditionsBuilder({
  conditions,
  joinOps,
  names,
  onChange,
}: {
  conditions: Cond[];
  joinOps: LogicOp[];
  names: string[];
  onChange: (conditions: Cond[], joinOps: LogicOp[]) => void;
}) {
  const n = conditions.length;
  const groups = buildGroups(n, joinOps);
  const mixed = groups.length > 1;

  const setOp = (opIndex: number, op: LogicOp) => {
    if (n === 2) {
      onChange(conditions, [op]);
      return;
    }
    const next = [...joinOps];
    next[opIndex] = op;
    onChange(conditions, next);
  };

  const removeAt = (i: number) => {
    const next = conditions.filter((_, j) => j !== i);
    let nextOps: LogicOp[] = [];
    if (next.length >= 2) {
      nextOps = Array.from({ length: next.length - 1 }, (_, j) => {
        if (j < i) return joinOps[j] ?? "AND";
        return joinOps[j + 1] ?? "AND";
      });
      if (next.length === 2) nextOps = [nextOps[0] ?? "AND"];
    }
    onChange(next, nextOps);
  };

  return (
    <div>
      {n === 0 ? (
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>
          Дополнительных условий нет — достаточно предшествующего действия и времени
          запуска.
        </div>
      ) : null}

      {/* Рендер с визуальными группами */}
      {(() => {
        if (n === 0) return null;
        if (n === 1) {
          return (
            <CondCard
              cond={conditions[0]}
              index={0}
              names={names}
              onChange={(c) => onChange([c], [])}
              onRemove={() => onChange([], [])}
            />
          );
        }

        // 2 условия — один оператор
        if (n === 2) {
          return (
            <div>
              <CondCard
                cond={conditions[0]}
                index={0}
                names={names}
                onChange={(c) =>
                  onChange(
                    conditions.map((x) => (x.id === c.id ? c : x)),
                    joinOps,
                  )
                }
                onRemove={() => removeAt(0)}
              />
              <OpChip
                op={joinOps[0] ?? "AND"}
                onChange={(op) => onChange(conditions, [op])}
              />
              <CondCard
                cond={conditions[1]}
                index={1}
                names={names}
                onChange={(c) =>
                  onChange(
                    conditions.map((x) => (x.id === c.id ? c : x)),
                    joinOps,
                  )
                }
                onRemove={() => removeAt(1)}
              />
            </div>
          );
        }

        // 3+ — группы
        const nodes: any[] = [];
        let gi = 0;
        while (gi < groups.length) {
          const g = groups[gi];
          const isMulti = g.end > g.start;
          const showBox = mixed && isMulti;

          const inner: any[] = [];
          for (let i = g.start; i <= g.end; i++) {
            inner.push(
              <div key={conditions[i].id}>
                <CondCard
                  cond={conditions[i]}
                  index={i}
                  names={names}
                  onChange={(c) =>
                    onChange(
                      conditions.map((x) => (x.id === c.id ? c : x)),
                      joinOps,
                    )
                  }
                  onRemove={() => removeAt(i)}
                />
                {i < g.end ? (
                  <OpChip
                    op={joinOps[i] ?? "AND"}
                    onChange={(op) => setOp(i, op)}
                  />
                ) : null}
              </div>,
            );
          }

          nodes.push(
            <div key={`g-${g.start}`}>
              {showBox ? (
                <div
                  style={{
                    border: `1.5px solid ${C.groupBorder}`,
                    borderRadius: 8,
                    padding: 10,
                    background: C.groupBox,
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: -8,
                      left: 12,
                      background: C.groupBox,
                      padding: "0 6px",
                      fontSize: 10,
                      fontWeight: 700,
                      color: C.navy,
                      letterSpacing: "0.04em",
                    }}
                  >
                    ( {Array.from({ length: g.end - g.start + 1 }, (_, k) => g.start + k + 1).join(` ${opLabel(g.op)} `)} )
                  </div>
                  {inner}
                </div>
              ) : (
                inner
              )}
              {gi < groups.length - 1 ? (
                <OpChip
                  op={joinOps[g.end] ?? "OR"}
                  onChange={(op) => setOp(g.end, op)}
                />
              ) : null}
            </div>,
          );
          gi++;
        }
        return <div>{nodes}</div>;
      })()}

      <button
        type="button"
        onClick={() => {
          const neu: Cond = {
            id: uid("c"),
            kind: "not_paid",
            ref: "",
          };
          const next = [...conditions, neu];
          const nextOps =
            next.length <= 1
              ? []
              : [
                  ...joinOps,
                  joinOps[joinOps.length - 1] ?? ("AND" as LogicOp),
                ].slice(0, next.length - 1);
          // ensure length
          while (nextOps.length < next.length - 1) {
            nextOps.push(nextOps[nextOps.length - 1] ?? "AND");
          }
          onChange(next, nextOps);
        }}
        style={{
          border: "none",
          background: "transparent",
          color: C.link,
          fontSize: 12,
          cursor: "pointer",
          padding: 0,
          marginTop: 10,
        }}
      >
        + Добавить условие
      </button>
    </div>
  );
}

function GroupPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (g: string[]) => void;
}) {
  const toggle = (g: string) => {
    if (selected.includes(g)) onChange(selected.filter((x) => x !== g));
    else onChange([...selected, g]);
  };
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {ALL_GROUPS.map((g) => {
          const on = selected.includes(g);
          return (
            <button
              key={g}
              type="button"
              onClick={() => toggle(g)}
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: 16,
                border: on ? `1px solid ${C.navy}` : `1px solid ${C.border}`,
                background: on ? C.selectedBg : C.white,
                color: on ? C.navy : C.textMuted,
                fontSize: 12,
                fontWeight: on ? 700 : 500,
                cursor: "pointer",
              }}
            >
              {on ? "✓ " : ""}
              {g}
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 8, display: "flex", gap: 12 }}>
        <button
          type="button"
          onClick={() => onChange([...ALL_GROUPS])}
          style={{
            border: "none",
            background: "transparent",
            color: C.link,
            fontSize: 12,
            cursor: "pointer",
            padding: 0,
          }}
        >
          Выбрать все
        </button>
        <button
          type="button"
          onClick={() => onChange([])}
          style={{
            border: "none",
            background: "transparent",
            color: C.link,
            fontSize: 12,
            cursor: "pointer",
            padding: 0,
          }}
        >
          Снять все
        </button>
      </div>
    </div>
  );
}

function PencilBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      title="Изменить"
      onClick={(e: { stopPropagation?: () => void }) => {
        e.stopPropagation?.();
        onClick();
      }}
      style={{
        width: 28,
        height: 28,
        border: `1px solid ${C.border}`,
        borderRadius: 4,
        background: C.white,
        color: C.textMuted,
        cursor: "pointer",
        fontSize: 14,
        lineHeight: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      ✎
    </button>
  );
}

function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
      style={{
        width: "100%",
        height: 34,
        padding: "0 12px",
        border: `1px solid ${C.border}`,
        borderRadius: 4,
        background: C.inputBg,
        color: C.text,
        fontSize: 13,
        boxSizing: "border-box",
        marginBottom: 14,
      }}
    />
  );
}

function LibItemForm({
  title,
  name,
  description,
  onName,
  onDescription,
  onSave,
  onCancel,
}: {
  title: string;
  name: string;
  description: string;
  onName: (v: string) => void;
  onDescription: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>{title}</div>
      <FieldRow label="Название">
        <TextBox value={name} onChange={onName} placeholder="Название элемента" />
      </FieldRow>
      <FieldRow label="Описание">
        <textarea
          value={description}
          onChange={(e: { target: { value: string } }) => onDescription(e.target.value)}
          rows={4}
          placeholder="Краткое описание"
          style={areaStyle}
        />
      </FieldRow>
      <div style={{ display: "flex", gap: 8, marginTop: 16, marginLeft: 236 }}>
        <PrimaryBtn onClick={onSave}>Сохранить</PrimaryBtn>
        <GhostBtn onClick={onCancel}>Отмена</GhostBtn>
      </div>
    </div>
  );
}

function LibListPanel({
  title,
  subtitle,
  search,
  onSearch,
  searchPlaceholder,
  items,
  addLabel,
  onAdd,
  onEdit,
  onBack,
  backLabel,
}: {
  title: string;
  subtitle?: string;
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder: string;
  items: LibItem[];
  addLabel: string;
  onAdd: () => void;
  onEdit: (id: string) => void;
  onBack?: () => void;
  backLabel?: string;
}) {
  const q = search.trim().toLowerCase();
  const filtered = q
    ? items.filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          it.description.toLowerCase().includes(q),
      )
    : items;

  return (
    <div>
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          style={{
            border: "none",
            background: "transparent",
            color: C.link,
            fontSize: 12,
            cursor: "pointer",
            padding: 0,
            marginBottom: 10,
          }}
        >
          ← {backLabel ?? "Назад"}
        </button>
      ) : null}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{title}</div>
          {subtitle ? (
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>
              {subtitle}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>
              Типовые элементы для конструктора. В сценарии выбираются или дублируются
              под организацию.
            </div>
          )}
        </div>
        <PrimaryBtn onClick={onAdd}>{addLabel}</PrimaryBtn>
      </div>
      <SearchField
        value={search}
        onChange={onSearch}
        placeholder={searchPlaceholder}
      />
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.borderLight}` }}>
            <th
              style={{
                textAlign: "left",
                padding: "8px 0",
                color: C.textMuted,
                fontWeight: 600,
                fontSize: 11,
              }}
            >
              Название
            </th>
            <th
              style={{
                textAlign: "left",
                padding: "8px 0",
                color: C.textMuted,
                fontWeight: 600,
                fontSize: 11,
              }}
            >
              Описание
            </th>
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {filtered.map((it) => (
            <tr key={it.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
              <td style={{ padding: "10px 12px 10px 0", fontWeight: 600 }}>{it.name}</td>
              <td style={{ padding: "10px 12px 10px 0", color: C.textMuted }}>
                {it.description}
              </td>
              <td style={{ padding: "10px 0", textAlign: "right" }}>
                <PencilBtn onClick={() => onEdit(it.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TplGroupPicker({ onPick }: { onPick: (id: TplGroupId) => void }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
        Библиотека шаблонов
      </div>
      <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 16 }}>
        Выберите группу шаблонов, затем откройте список или создайте новый.
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        {TPL_GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => onPick(g.id)}
            style={{
              textAlign: "left",
              padding: "16px 18px",
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              background: C.white,
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, color: C.navy, marginBottom: 4 }}>
              {g.name}
            </div>
            <div style={{ fontSize: 12, color: C.textMuted }}>{g.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function TemplateEditor({
  title,
  tpl,
  onChange,
  onSave,
  onCancel,
}: {
  title: string;
  tpl: Tpl;
  onChange: (partial: Partial<Tpl>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const channelByGroup: Record<TplGroupId, string> = {
    email: "E-mail",
    voice: "Голос / TTS",
    print: "Печатная форма",
    sms: "SMS",
  };
  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>{title}</div>
      <Section title="Шаблон сообщения" />
      <FieldRow label="Название">
        <TextBox value={tpl.name} onChange={(name) => onChange({ name })} />
      </FieldRow>
      <FieldRow label="Группа">
        <SelectBox
          value={TPL_GROUPS.find((g) => g.id === tpl.group)?.name ?? ""}
          options={TPL_GROUPS.map((g) => g.name)}
          onChange={(label) => {
            const g = TPL_GROUPS.find((x) => x.name === label)!;
            onChange({ group: g.id, channel: channelByGroup[g.id] });
          }}
        />
      </FieldRow>
      <FieldRow label="Канал">
        <SelectBox
          value={tpl.channel}
          options={["E-mail", "Голос / TTS", "Печатная форма", "SMS"]}
          onChange={(channel) => onChange({ channel })}
        />
      </FieldRow>
      <FieldRow label="Текст">
        <textarea
          value={tpl.body}
          onChange={(e: { target: { value: string } }) =>
            onChange({ body: e.target.value })
          }
          rows={8}
          style={areaStyle}
        />
      </FieldRow>
      <div style={{ display: "flex", gap: 8, marginTop: 16, marginLeft: 236 }}>
        <PrimaryBtn onClick={onSave}>Сохранить</PrimaryBtn>
        <GhostBtn onClick={onCancel}>Отмена</GhostBtn>
      </div>
    </div>
  );
}

export default function ScenarioConstructorCanvas() {
  useHostTheme();

  const [steps, setSteps] = useCanvasState<Step[]>("v5-steps", STEPS0);
  const [sel, setSel] = useCanvasState("v4-sel", "s2");
  const [tpls, setTpls] = useCanvasState<Tpl[]>("v4-tpls", TPL);
  const [tab, setTab] = useCanvasState<"scen" | "cond" | "act" | "tpl">(
    "v4-tab",
    "scen",
  );
  const [libScreen, setLibScreen] = useCanvasState<"list" | "form">(
    "v4-libScreen",
    "list",
  );
  const [libEditId, setLibEditId] = useCanvasState<string | null>(
    "v4-libEditId",
    null,
  );
  const [tplGroup, setTplGroup] = useCanvasState<TplGroupId | null>(
    "v4-tplGroup",
    null,
  );
  const [searchQ, setSearchQ] = useCanvasState("v4-search", "");
  const [libConds, setLibConds] = useCanvasState<LibItem[]>(
    "v4-libConds",
    LIB_CONDS0,
  );
  const [libActs, setLibActs] = useCanvasState<LibItem[]>("v4-libActs", LIB_ACTS0);
  const [draftName, setDraftName] = useCanvasState("v4-draftName", "");
  const [draftDesc, setDraftDesc] = useCanvasState("v4-draftDesc", "");
  const [draftTpl, setDraftTpl] = useCanvasState<Tpl | null>("v4-draftTpl", null);

  const step = steps.find((s) => s.id === sel) ?? steps[0];
  const tpl = tpls.find((t) => t.id === step.templateId) ?? tpls[0];
  const names = steps.map((s) => s.name);
  const timeMeta = TIME_OPTIONS.find((t) => t.value === step.timeMode)!;

  const openTab = (id: "scen" | "cond" | "act" | "tpl") => {
    setTab(id);
    setLibScreen("list");
    setLibEditId(null);
    setSearchQ("");
    setDraftName("");
    setDraftDesc("");
    setDraftTpl(null);
    if (id === "tpl") setTplGroup(null);
  };

  const openLibCreate = () => {
    setLibEditId(null);
    setDraftName("");
    setDraftDesc("");
    setLibScreen("form");
  };

  const openLibEdit = (id: string, items: LibItem[]) => {
    const it = items.find((x) => x.id === id);
    setLibEditId(id);
    setDraftName(it?.name ?? "");
    setDraftDesc(it?.description ?? "");
    setLibScreen("form");
  };

  const saveLibItem = (
    setItems: (fn: (prev: LibItem[]) => LibItem[]) => void,
  ) => {
    if (!draftName.trim()) return;
    if (libEditId) {
      setItems((prev) =>
        prev.map((x) =>
          x.id === libEditId
            ? { ...x, name: draftName.trim(), description: draftDesc.trim() }
            : x,
        ),
      );
    } else {
      setItems((prev) => [
        ...prev,
        {
          id: uid("lib"),
          name: draftName.trim(),
          description: draftDesc.trim(),
        },
      ]);
    }
    setLibScreen("list");
    setLibEditId(null);
  };

  const openTplCreate = () => {
    const g = tplGroup ?? "email";
    const channelByGroup: Record<TplGroupId, string> = {
      email: "E-mail",
      voice: "Голос / TTS",
      print: "Печатная форма",
      sms: "SMS",
    };
    setDraftTpl({
      id: uid("tpl"),
      name: "",
      channel: channelByGroup[g],
      body: "",
      group: g,
    });
    setLibEditId(null);
    setLibScreen("form");
  };

  const openTplEdit = (id: string) => {
    const t = tpls.find((x) => x.id === id);
    if (!t) return;
    setDraftTpl({ ...t });
    setLibEditId(id);
    setLibScreen("form");
  };

  const saveTpl = () => {
    if (!draftTpl || !draftTpl.name.trim()) return;
    if (libEditId) {
      setTpls((prev) =>
        prev.map((t) => (t.id === libEditId ? { ...draftTpl, name: draftTpl.name.trim() } : t)),
      );
    } else {
      setTpls((prev) => [...prev, { ...draftTpl, name: draftTpl.name.trim() }]);
    }
    setLibScreen("list");
    setLibEditId(null);
    setDraftTpl(null);
  };

  const patch = (partial: Partial<Step>) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === step.id ? { ...s, ...partial } : s)),
    );
  };

  const duplicate = () => {
    const copy: Step = {
      ...step,
      id: uid("s"),
      name: `${step.name} (копия)`,
      timeDays: step.timeDays + 3,
      conditions: step.conditions.map((c) => ({ ...c, id: uid("c") })),
      joinOps: [...step.joinOps],
    };
    const i = steps.findIndex((s) => s.id === step.id);
    const next = [...steps];
    next.splice(i + 1, 0, copy);
    setSteps(next);
    setSel(copy.id);
    openTab("scen");
  };

  const addStep = () => {
    const neu: Step = {
      id: uid("s"),
      name: "Новое действие",
      days: 1,
      mode: "auto",
      prev: step.name,
      timeMode: "after_prev",
      timeDays: 1,
      selectedGroups: ["Группа 2"],
      excludeIf: "Оплата поступила / долг погашен",
      actionType: "Отправить e-mail (SMTP)",
      templateId: "tpl1",
      assignee: "Роль: Специалист (по ЛС)",
      blockerText: "не блокирует переход на следующий этап",
      statusAfter: "Не менять",
      joinOps: [],
      conditions: [],
      autoComplete: true,
      allowManual: true,
    };
    setSteps([...steps, neu]);
    setSel(neu.id);
    openTab("scen");
  };

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
      {/* TOP NAV */}
      <div
        style={{
          height: 48,
          background: C.navy,
          display: "flex",
          alignItems: "center",
          padding: "0 24px",
          gap: 20,
        }}
      >
        <span style={{ color: "#9FB0C0", fontSize: 16 }}>▦</span>
        <span style={{ color: C.white, fontWeight: 600, fontSize: 14 }}>
          Взыскание задолженности
        </span>
        {["Дела", "Мероприятия", "Претензионно-исковая работа", "Отчётность"].map(
          (m) => (
            <span
              key={m}
              style={{ color: "rgba(255,255,255,0.72)", fontSize: 13 }}
            >
              {m}
            </span>
          ),
        )}
        <span
          style={{
            color: C.white,
            fontSize: 13,
            fontWeight: 600,
            borderBottom: "2px solid #FFFFFF",
            paddingBottom: 12,
            marginBottom: -14,
          }}
        >
          Настройка
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ color: "rgba(255,255,255,0.9)", fontSize: 12 }}>
          Главный админ · Петров А.С.
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
          ПА
        </span>
      </div>

      {/* TOOLBAR */}
      <div
        style={{
          height: 52,
          background: C.barBg,
          borderBottom: `1px solid ${C.borderLight}`,
          display: "flex",
          alignItems: "center",
          padding: "0 24px",
          gap: 12,
        }}
      >
        <PrimaryBtn onClick={addStep}>+ Новый тип мероприятия</PrimaryBtn>
        <GhostBtn onClick={duplicate}>Дублировать</GhostBtn>
        <span style={{ color: C.textMuted, fontSize: 12 }}>
          Настройка &gt; Конструктор сценариев и шаблонов мероприятий
        </span>
        <div style={{ flex: 1 }} />
        {(
          [
            ["scen", "Сценарий"],
            ["cond", "Условия"],
            ["act", "Действия"],
            ["tpl", "Шаблоны"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => openTab(id)}
            style={{
              height: 28,
              padding: "0 10px",
              borderRadius: 4,
              border: tab === id ? `1px solid ${C.navy}` : `1px solid ${C.border}`,
              background: tab === id ? C.navy : C.white,
              color: tab === id ? C.white : C.textMuted,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* BODY */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "360px minmax(0, 1fr)",
          minHeight: 640,
          background: C.white,
          width: "100%",
        }}
      >
        {/* LEFT */}
        <div style={{ borderRight: `1px solid ${C.borderLight}` }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              padding: "16px 16px 10px",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              Типы мероприятий ({steps.length})
            </span>
            <span style={{ fontSize: 11, color: C.textMuted }}>
              Группа 2 - Базовый сценарий
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 64px 72px",
              padding: "0 16px 6px",
              fontSize: 11,
              color: C.textMuted,
              fontWeight: 600,
            }}
          >
            <span>Название</span>
            <span style={{ textAlign: "right" }}>Через, дн.</span>
            <span style={{ textAlign: "right" }}>Тип</span>
          </div>
          <div style={{ borderTop: `1px solid ${C.borderLight}` }}>
            {steps.map((s) => {
              const active = s.id === step.id && tab === "scen";
              const dayShow =
                s.timeMode === "after_prev" ||
                s.timeMode === "from_receipt" ||
                s.timeMode === "after_inscription"
                  ? s.timeDays
                  : "—";
              return (
                <div
                  key={s.id}
                  onClick={() => {
                    setSel(s.id);
                    openTab("scen");
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 64px 72px",
                    alignItems: "center",
                    padding: "11px 16px",
                    cursor: "pointer",
                    background: active ? C.selectedBg : C.white,
                    borderLeft: active
                      ? `3px solid ${C.selectedBorder}`
                      : "3px solid transparent",
                    borderBottom: `1px solid ${C.borderLight}`,
                    fontSize: 13,
                  }}
                >
                  <span
                    style={{
                      fontWeight: active ? 600 : 400,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      paddingRight: 8,
                    }}
                  >
                    {s.name}
                  </span>
                  <span style={{ textAlign: "right", color: C.textMuted }}>
                    {dayShow}
                  </span>
                  <span style={{ textAlign: "right" }}>
                    <Tag mode={s.mode} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ padding: "24px 36px 40px", background: C.white, minWidth: 0 }}>
          {tab === "cond" ? (
            libScreen === "form" ? (
              <LibItemForm
                title={libEditId ? "Изменить условие" : "Новое условие"}
                name={draftName}
                description={draftDesc}
                onName={setDraftName}
                onDescription={setDraftDesc}
                onSave={() => saveLibItem(setLibConds)}
                onCancel={() => {
                  setLibScreen("list");
                  setLibEditId(null);
                }}
              />
            ) : (
              <LibListPanel
                title="Библиотека условий"
                search={searchQ}
                onSearch={setSearchQ}
                searchPlaceholder="Поиск по названию условия…"
                items={libConds}
                addLabel="+ Добавить условие"
                onAdd={openLibCreate}
                onEdit={(id) => openLibEdit(id, libConds)}
              />
            )
          ) : null}

          {tab === "act" ? (
            libScreen === "form" ? (
              <LibItemForm
                title={libEditId ? "Изменить действие" : "Новое действие"}
                name={draftName}
                description={draftDesc}
                onName={setDraftName}
                onDescription={setDraftDesc}
                onSave={() => saveLibItem(setLibActs)}
                onCancel={() => {
                  setLibScreen("list");
                  setLibEditId(null);
                }}
              />
            ) : (
              <LibListPanel
                title="Библиотека действий"
                search={searchQ}
                onSearch={setSearchQ}
                searchPlaceholder="Поиск по названию действия…"
                items={libActs}
                addLabel="+ Добавить действие"
                onAdd={openLibCreate}
                onEdit={(id) => openLibEdit(id, libActs)}
              />
            )
          ) : null}

          {tab === "tpl" ? (
            libScreen === "form" && draftTpl ? (
              <TemplateEditor
                title={libEditId ? "Изменить шаблон" : "Новый шаблон"}
                tpl={draftTpl}
                onChange={(partial) =>
                  setDraftTpl((prev) => (prev ? { ...prev, ...partial } : prev))
                }
                onSave={saveTpl}
                onCancel={() => {
                  setLibScreen("list");
                  setLibEditId(null);
                  setDraftTpl(null);
                }}
              />
            ) : !tplGroup ? (
              <TplGroupPicker onPick={setTplGroup} />
            ) : (
              <LibListPanel
                title={TPL_GROUPS.find((g) => g.id === tplGroup)?.name ?? "Шаблоны"}
                subtitle="Шаблоны выбранной группы. Редактирование — через карандаш; выбор в мероприятии — отдельно в поле «Шаблон сообщения»."
                search={searchQ}
                onSearch={setSearchQ}
                searchPlaceholder="Поиск по названию шаблона…"
                items={tpls
                  .filter((t) => t.group === tplGroup)
                  .map((t) => ({
                    id: t.id,
                    name: t.name,
                    description: t.channel,
                  }))}
                addLabel="+ Создать новый шаблон"
                onAdd={openTplCreate}
                onEdit={openTplEdit}
                onBack={() => {
                  setTplGroup(null);
                  setSearchQ("");
                }}
                backLabel="К группам шаблонов"
              />
            )
          ) : null}

          {tab === "scen" ? (
            <div style={{ maxWidth: 820 }}>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
                {step.name}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: C.textMuted,
                  marginBottom: 8,
                  lineHeight: 1.45,
                }}
              >
                Настройка правил срабатывания мероприятия внутри сценария «Группа 2 -
                Базовый». Изменения не затрагивают уже выполненные мероприятия.
              </div>

              <Section title="Условия запуска" />
              <FieldRow label="Предшествующее мероприятие">
                <SelectBox
                  value={step.prev}
                  options={["— (старт сценария)", ...names]}
                  onChange={(prev) => patch({ prev })}
                />
              </FieldRow>

              <FieldRow label="Время запуска">
                <div>
                  <SelectBox
                    value={timeMeta.label}
                    options={TIME_OPTIONS.map((t) => t.label)}
                    onChange={(label) => {
                      const m = TIME_OPTIONS.find((t) => t.label === label)!;
                      patch({
                        timeMode: m.value,
                        timeDays: m.needsDays ? step.timeDays || 1 : 0,
                      });
                    }}
                  />
                  {timeMeta.needsDays ? (
                    <div
                      style={{
                        marginTop: 8,
                        display: "grid",
                        gridTemplateColumns: "140px 1fr",
                        gap: 10,
                        alignItems: "center",
                        padding: 10,
                        background: C.pageBg,
                        borderRadius: 4,
                        border: `1px solid ${C.borderLight}`,
                      }}
                    >
                      <span style={{ fontSize: 12, color: C.textMuted }}>
                        Через сколько дней
                      </span>
                      <TextBox
                        type="number"
                        value={String(step.timeDays)}
                        onChange={(v) => patch({ timeDays: Number(v) || 0 })}
                      />
                    </div>
                  ) : null}
                </div>
              </FieldRow>

              <FieldRow label="Доп. условия">
                <ConditionsBuilder
                  conditions={step.conditions}
                  joinOps={step.joinOps}
                  names={names}
                  onChange={(conditions, joinOps) =>
                    patch({ conditions, joinOps })
                  }
                />
              </FieldRow>

              <FieldRow label="Применимо к группам">
                <GroupPicker
                  selected={step.selectedGroups}
                  onChange={(selectedGroups) => patch({ selectedGroups })}
                />
              </FieldRow>

              <FieldRow label="Исключить, если">
                <SelectBox
                  value={step.excludeIf}
                  options={[
                    "Оплата поступила / долг погашен",
                    "Оплата поступила",
                    "Оплата до отключения",
                    "Нет телефона",
                    "Должник перезвонил сам",
                    "—",
                  ]}
                  onChange={(excludeIf) => patch({ excludeIf })}
                />
              </FieldRow>

              <Section title="Действие" />
              <FieldRow label="Действие мероприятия">
                <SelectBox
                  value={step.actionType}
                  options={[
                    "Автообзвон (Asterisk)",
                    "Отправить e-mail (SMTP)",
                    "Ручной звонок",
                    "Сформировать предупреждение (PDF)",
                    "Вручение предупреждения",
                    "Инициировать отключение услуг",
                    "Запрос согласования",
                    "Смена статуса / стадии канбана",
                    "Пакет на исполнительную надпись",
                    "Направление в ОПИ",
                  ]}
                  onChange={(actionType) => patch({ actionType })}
                />
              </FieldRow>
              <FieldRow label="Шаблон сообщения">
                <SelectBox
                  value={tpl.name}
                  options={tpls.map((t) => t.name)}
                  onChange={(name) => {
                    const t = tpls.find((x) => x.name === name);
                    if (t) patch({ templateId: t.id });
                  }}
                />
              </FieldRow>
              <FieldRow label="Смена статуса канбана">
                <SelectBox
                  value={step.statusAfter}
                  options={[
                    "Не менять",
                    "→ Автообзвон",
                    "→ Предупреждение",
                    "→ Отключение услуг",
                    "→ Исполнительная надпись",
                    "→ ОПИ",
                    "→ Архив (погашено)",
                  ]}
                  onChange={(statusAfter) => patch({ statusAfter })}
                />
              </FieldRow>
              <FieldRow label="Ответственный по умолчанию">
                <SelectBox
                  value={step.assignee}
                  options={[
                    "Роль: Специалист (по ЛС)",
                    "Роль: Специалист",
                    "Роль: с правом согласования",
                    "Согласующий → поставщик",
                    "Специалист ЮС",
                    "Система / Asterisk",
                    "Роль: Специалист / поставщик",
                  ]}
                  onChange={(assignee) => patch({ assignee })}
                />
              </FieldRow>

              <Section title="Переход к следующему этапу" />
              <FieldRow label="Обязателен для перехода">
                <SelectBox
                  value={step.blockerText}
                  options={BLOCKER_OPTIONS}
                  onChange={(blockerText) => patch({ blockerText })}
                />
              </FieldRow>
              <div style={{ marginLeft: 236, marginTop: 4 }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    fontSize: 13,
                    cursor: "pointer",
                    marginBottom: 8,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={step.autoComplete}
                    onChange={(e: { target: { checked: boolean } }) =>
                      patch({ autoComplete: e.target.checked })
                    }
                    style={{ marginTop: 2, accentColor: C.navy }}
                  />
                  <span>
                    Считать выполненным автоматически при успешной отправке (без ручного
                    подтверждения)
                  </span>
                </label>
                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={step.allowManual}
                    onChange={(e: { target: { checked: boolean } }) =>
                      patch({ allowManual: e.target.checked })
                    }
                    style={{ marginTop: 2, accentColor: C.navy }}
                  />
                  <span>
                    Разрешить ручное досрочное завершение (например, должник сам позвонил)
                  </span>
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 28, marginLeft: 236 }}>
                <PrimaryBtn>Сохранить</PrimaryBtn>
                <GhostBtn>Отмена</GhostBtn>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
