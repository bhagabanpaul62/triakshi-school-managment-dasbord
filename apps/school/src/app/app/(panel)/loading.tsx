// Shown instantly while a panel page loads: same rhythm as a real page (header, KPI row, panels), so nothing jumps.
export default function Loading() {
  const block = "animate-pulse rounded-3xl bg-[var(--ds-surface-container-low)] motion-reduce:animate-none";
  return (
    <div aria-busy="true" aria-label="Loading" className="pt-2">
      <div className="pb-8">
        <div className="h-3 w-24 animate-pulse rounded-full bg-white/[0.06] motion-reduce:animate-none" />
        <div className="mt-3 h-8 w-64 animate-pulse rounded-full bg-white/[0.06] motion-reduce:animate-none" />
      </div>
      <div className="grid grid-cols-2 gap-3 pb-8 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`${block} h-32`} />)}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className={`${block} h-80 lg:col-span-8`} />
        <div className={`${block} h-80 lg:col-span-4`} />
      </div>
    </div>
  );
}
