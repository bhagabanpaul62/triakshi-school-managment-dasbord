/** Skeleton with the same geometry as the pages: a title row, then a table or list. */
export default function Loading() {
  const block = "animate-pulse rounded-3xl bg-[var(--ds-surface-container-low)] motion-reduce:animate-none";
  return (
    <div aria-busy="true" aria-label="Loading meetings" className="flex flex-col gap-3">
      <div className="pb-6 pt-2"><div className="h-9 w-56 animate-pulse rounded-xl bg-white/[0.05] motion-reduce:animate-none" /></div>
      <div className={`${block} h-14`} />
      {[0, 1, 2].map((i) => <div key={i} className={`${block} h-24`} />)}
    </div>
  );
}
