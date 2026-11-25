/** Skeleton with the same shape as the pages: a title row, the view tabs, then rows. */
export default function Loading() {
  const block = "animate-pulse rounded-3xl bg-[var(--ds-surface-container-low)] motion-reduce:animate-none";
  return (
    <div role="status" aria-busy="true" aria-label="Loading notices" className="flex flex-col gap-3">
      <div className="pb-6 pt-2"><div className="h-9 w-56 animate-pulse rounded-xl bg-white/[0.05] motion-reduce:animate-none" /></div>
      <div className="h-11 w-full max-w-md animate-pulse rounded-full bg-white/[0.04] motion-reduce:animate-none" />
      {[0, 1, 2, 3].map((i) => <div key={i} className={`${block} h-20`} />)}
    </div>
  );
}
