import { IconAlertTriangle, IconBell, IconCheck, IconFileText, IconReceipt } from "@tabler/icons-react";
import { GrowBar } from "./reveal";

// Static sample-data illustrations of the real panel screens. No images; every number is illustrative.

export const Frame = ({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) => (
  <figure className={`overflow-hidden rounded-3xl border border-line bg-white shadow-soft ${className}`} aria-label={`${title}, sample data`}>
    <div className="flex items-center gap-1.5 border-b border-line px-5 py-3" aria-hidden>
      <span className="size-2.5 rounded-full bg-line-strong" /><span className="size-2.5 rounded-full bg-line-strong" /><span className="size-2.5 rounded-full bg-line-strong" />
      <span className="ml-3 truncate text-[12px] font-medium text-mute">{title}</span>
    </div>
    {children}
    <figcaption className="px-5 pb-3 text-[11px] text-mute">Sample data</figcaption>
  </figure>
);

const ROWS = [
  { name: "Aarav Sharma", roll: 1, days: "PPPPAP" }, { name: "Ananya Iyer", roll: 2, days: "PPPPPP" }, { name: "Dev Patel", roll: 3, days: "PAPPPL" },
  { name: "Ishita Das", roll: 4, days: "PPPPPP" }, { name: "Kabir Singh", roll: 5, days: "APPLPP" }, { name: "Meera Nair", roll: 6, days: "PPPPPP" },
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function AttendanceMock() {
  return (
    <Frame title="Class 8-B · Attendance">
      <div className="p-5">
        <div className="mb-4 flex items-end justify-between gap-3">
          <p className="text-3xl font-semibold tabular-nums tracking-tight">96.4<span className="text-lg text-mute">%</span></p>
          <p className="text-right text-xs text-mute">This week · 3 absent, 2 on leave</p>
        </div>
        <div className="grid grid-cols-[1fr_repeat(6,26px)] items-center gap-x-1.5 gap-y-2.5 text-sm sm:grid-cols-[1fr_repeat(6,28px)] sm:gap-x-2">
          <span />{DAYS.map((d) => <span key={d} className="text-center text-[10px] font-semibold uppercase tracking-wide text-mute">{d}</span>)}
          {ROWS.map((r) => (
            <div key={r.roll} className="contents">
              <span className="truncate text-[13px]"><span className="mr-2 tabular-nums text-mute">{r.roll}</span>{r.name}</span>
              {[...r.days].map((c, i) => (
                <span key={i} className={`mx-auto grid size-6 place-items-center rounded-full text-[10px] font-semibold ${c === "P" ? "bg-t-green text-green" : c === "A" ? "bg-t-rose text-danger" : "bg-gold-soft text-warn"}`}>{c}</span>
              ))}
            </div>
          ))}
        </div>
        <p className="mt-4 rounded-2xl bg-paper px-4 py-2.5 text-xs text-mute">Present is the default. Tap only the exceptions, then save.</p>
      </div>
    </Frame>
  );
}

export function ReceiptMock() {
  const lines = [["Tuition · Term 2", "₹12,500"], ["Transport · Route 4", "₹2,400"], ["Lab fee", "₹600"]];
  return (
    <Frame title="Fee receipt">
      <div className="p-5">
        <div className="rounded-2xl bg-paper p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[15px] font-semibold">Sunrise Public School</p>
              <p className="mt-0.5 text-xs text-mute">Receipt RCP/2026-27/0412 · 14 Sep 2026</p>
            </div>
            <span className="rounded-full bg-t-green px-2.5 py-1 text-[11px] font-semibold text-ok">Paid by UPI</span>
          </div>
          <p className="mt-4 text-[13px] text-mute">Aarav Sharma · Class 8-B · Adm. 2291</p>
          <dl className="mt-2 divide-y divide-line text-sm">
            {lines.map(([k, v]) => <div key={k} className="flex justify-between py-2"><dt className="text-mute">{k}</dt><dd className="tabular-nums">{v}</dd></div>)}
          </dl>
          <div className="mt-1 flex items-baseline justify-between border-t border-line-strong pt-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-mute">Received</span>
            <span className="text-3xl font-semibold tabular-nums tracking-tight">₹15,500</span>
          </div>
          <p className="mt-2 text-xs text-mute">Balance for the year: ₹0. Receipt numbers run in order, no gaps.</p>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-2xl bg-t-rose px-4 py-3 text-[13px]">
          <span className="flex items-center gap-2"><IconAlertTriangle size={16} aria-hidden className="text-danger" />86 parents have dues past 15 days</span>
          <span className="font-semibold text-green">Send reminders</span>
        </div>
      </div>
    </Frame>
  );
}

/** The admin's home: KPIs and a week of collections. */
export function DashboardMock({ className = "" }: { className?: string }) {
  const week = [42, 58, 35, 80, 100, 64, 22];
  return (
    <Frame title="Today · Sunrise Public School" className={className}>
      <div className="grid grid-cols-3 gap-2 p-4 sm:gap-3 sm:p-5">
        {[["Present today", "1,214", "of 1,268 students"], ["Collected this month", "₹18.4L", "of ₹21.5L billed"], ["Parents to remind", "86", "dues past 15 days"]].map(([k, v, s]) => (
          <div key={k} className="rounded-2xl bg-paper p-3 sm:p-4">
            <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-mute sm:text-[11px]">{k}</p>
            <p className="mt-2 text-[21px] font-semibold leading-none tabular-nums tracking-tight sm:text-[30px]">{v}</p>
            <p className="mt-2 text-[11px] leading-tight text-mute sm:text-xs">{s}</p>
          </div>
        ))}
      </div>
      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        <div className="rounded-2xl bg-paper p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-mute">Fee collection, last 7 days</p>
          <div className="mt-4 flex h-24 items-end gap-2 sm:h-28">
            {week.map((v, i) => (
              <div key={i} className="flex h-full flex-1 items-end overflow-hidden rounded-lg">
                <GrowBar value={v} delay={0.2 + i * 0.05} className={`rounded-lg ${v === 100 ? "bg-green" : "bg-line-strong"}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
}

/** What a parent sees: updates in order. */
export function ParentUpdatesMock() {
  const items = [
    { icon: IconAlertTriangle, tint: "bg-t-rose text-danger", t: "Aarav was marked absent today", s: "Class 8-B · 9:05 am" },
    { icon: IconReceipt, tint: "bg-t-green text-green", t: "Receipt for ₹15,500 is ready", s: "Term 2 fees · 14 Sep" },
    { icon: IconFileText, tint: "bg-t-sky text-green", t: "Science homework: hand in by Friday", s: "Chapter 6 worksheet" },
    { icon: IconBell, tint: "bg-gold-soft text-warn", t: "Parent-teacher meeting on Saturday", s: "Announcement · whole school" },
  ];
  return (
    <Frame title="Parent view · Updates">
      <ul className="flex flex-col gap-2.5 p-5">
        {items.map((i) => (
          <li key={i.t} className="flex items-center gap-3 rounded-2xl bg-paper p-3.5">
            <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${i.tint}`}><i.icon size={18} aria-hidden /></span>
            <span className="min-w-0"><span className="block truncate text-[14px] font-semibold">{i.t}</span><span className="text-xs text-mute">{i.s}</span></span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

/** What a student sees: today's periods and homework. */
export function StudentMock() {
  const periods = [["8:30", "Mathematics", "t-sky"], ["9:15", "English", "t-cream"], ["10:00", "Science", "t-green"], ["11:00", "Hindi", "t-lilac"]] as const;
  const bg: Record<string, string> = { "t-sky": "bg-t-sky", "t-cream": "bg-t-cream", "t-green": "bg-t-green", "t-lilac": "bg-t-lilac" };
  return (
    <Frame title="Student view · Today">
      <div className="grid gap-3 p-5 sm:grid-cols-2">
        <div className="rounded-2xl bg-paper p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-mute">Timetable · Class 8-B</p>
          <ul className="mt-3 flex flex-col gap-2">
            {periods.map(([t, s, c]) => <li key={s} className={`flex items-center justify-between rounded-xl px-3 py-2 text-[13px] ${bg[c]}`}><span className="font-semibold">{s}</span><span className="tabular-nums text-mute">{t}</span></li>)}
          </ul>
        </div>
        <div className="rounded-2xl bg-paper p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-mute">Homework</p>
          <ul className="mt-3 flex flex-col gap-2 text-[13px]">
            {[["Science worksheet", "Due Fri", false], ["Maths exercise 7.2", "Handed in", true], ["Hindi essay", "Marked 18/20", true]].map(([k, v, done]) => (
              <li key={String(k)} className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2">
                <span className="truncate">{k}</span>
                <span className={`flex shrink-0 items-center gap-1 text-xs font-semibold ${done ? "text-ok" : "text-warn"}`}>{done ? <IconCheck size={14} aria-hidden /> : null}{v}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Frame>
  );
}
