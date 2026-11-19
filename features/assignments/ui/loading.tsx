/** Skeleton with the same geometry as the pages: a title row, four KPI tiles, then the panels. */
export default function Loading() {
  const block = "animate-pulse rounded-3xl bg-[var(--ds-surface-container-low)] motion-reduce:animate-none";
  return (
    <div aria-busy="true" aria-label="Loading assignments" className="flex flex-col gap-3">
      <div className="pb-6 pt-2"><div className="h-9 w-56 animate-pulse rounded-xl bg-white/[0.05] motion-reduce:animate-none" /></div>
      <div className="grid grid-cols-2 gap-3 pb-5 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`${block} h-[136px]`} />)}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className={`${block} h-72 lg:col-span-4`} />
        <div className={`${block} h-72 lg:col-span-8`} />
      </div>
    </div>
  );
}
