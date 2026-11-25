/** Skeleton with the shape of the holidays page: title row, nav, working days, two month lists, then the tools. */
export default function HolidaysLoading() {
  const bar = "animate-pulse rounded-full bg-white/[0.05] motion-reduce:animate-none";
  const panel = "animate-pulse rounded-3xl bg-[var(--ds-surface-container-low)] motion-reduce:animate-none";
  return (
    <div role="status" aria-busy="true" aria-label="Loading holidays" className="flex flex-col gap-3">
      <div className="flex items-center justify-between pb-4 pt-2"><div className="h-9 w-48 animate-pulse rounded-xl bg-white/[0.05] motion-reduce:animate-none" /><div className={`${bar} h-10 w-36`} /></div>
      <div className={`${bar} h-11 w-full max-w-lg`} />
      <div className={`${panel} h-40`} />
      {[0, 1].map((m) => (
        <div key={m} className={`${panel} flex flex-col gap-4 p-5`}>
          <div className="h-5 w-32 rounded-full bg-white/[0.06]" />
          {[0, 1, 2].map((r) => <div key={r} className="h-12 rounded-2xl bg-white/[0.04]" />)}
        </div>
      ))}
      <div className="grid gap-3 lg:grid-cols-2"><div className={`${panel} h-48`} /><div className={`${panel} h-48`} /></div>
    </div>
  );
}
