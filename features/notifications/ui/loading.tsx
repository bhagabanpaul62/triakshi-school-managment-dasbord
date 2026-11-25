import { TOPIC_GROUPS } from "../topics";

// Skeletons with the shape of the finished pages, so nothing jumps when the real page arrives.
const bar = "animate-pulse rounded-full bg-white/[0.06] motion-reduce:animate-none";
const card = "animate-pulse rounded-3xl bg-[var(--ds-surface-container-low)] motion-reduce:animate-none";

function Header() {
  return <div className="pb-6 pt-2"><div className={`${bar} mb-3 h-3 w-24`} /><div className={`${bar} h-9 w-56 rounded-xl`} /><div className={`${bar} mt-3 h-4 w-72 max-w-full`} /></div>;
}
const Shell = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div role="status" aria-busy="true" aria-label={label} className="flex flex-col gap-3"><Header />{children}</div>
);
const PanelBox = ({ rows, className }: { rows: number; className?: string }) => (
  <div className={`${card} flex flex-col gap-3 p-5 ${className ?? ""}`}><div className={`${bar} h-4 w-40`} />{Array.from({ length: rows }, (_, i) => <div key={i} className={`${bar} h-8 w-full rounded-xl`} />)}</div>
);

/** The list: tabs, filters, one day label and rows with a dot, two lines and a time. */
export function NotificationsLoading() {
  return (
    <Shell label="Loading notifications">
      <div className="flex gap-2"><div className={`${bar} h-10 w-36`} /><div className={`${bar} h-10 w-28`} /></div>
      <div className="mb-1 flex gap-2"><div className={`${bar} h-10 w-40`} /><div className={`${bar} h-10 w-32`} /></div>
      <div className={`${bar} h-3 w-16`} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className={`${card} flex items-center gap-3 p-4`}>
          <div className={`${bar} h-3 w-3 shrink-0`} />
          <div className="flex flex-1 flex-col gap-2"><div className={`${bar} h-4 w-3/5`} /><div className={`${bar} h-3 w-4/5`} /></div>
          <div className={`${bar} h-3 w-12`} />
        </div>
      ))}
    </Shell>
  );
}

/** What reaches you (one row per group), then the four small panels. */
export function PreferencesLoading() {
  return (
    <Shell label="Loading notification settings">
      <PanelBox rows={Object.keys(TOPIC_GROUPS).length} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{[2, 2, 2, 1].map((n, i) => <PanelBox key={i} rows={n} />)}</div>
    </Shell>
  );
}

/** Allowance number, two rows of five tiles, then two lists. */
export function DeliveryLoading() {
  return (
    <Shell label="Loading delivery">
      <div className={`${card} p-5`}><div className={`${bar} mb-3 h-4 w-40`} /><div className={`${bar} h-9 w-48 rounded-xl`} /><div className={`${bar} mt-3 h-3 w-3/4`} /></div>
      <div className={`${card} flex flex-col gap-4 p-5`}>
        <div className={`${bar} h-4 w-32`} />
        {[0, 1].map((r) => <div key={r} className="grid grid-cols-2 gap-2 sm:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-white/[0.035] motion-reduce:animate-none" />)}</div>)}
      </div>
      <PanelBox rows={3} />
      <PanelBox rows={2} />
    </Shell>
  );
}
