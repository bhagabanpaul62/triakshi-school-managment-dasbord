export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="wrap max-w-3xl py-14 md:py-20 [&_h2]:h-display [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:text-2xl [&_p]:leading-relaxed [&_p]:text-mute [&_p+p]:mt-4">
      <p className="inline-flex rounded-full bg-t-cream px-3 py-1 text-[12px] font-semibold text-warn">{updated}</p>
      <h1 className="h-display mb-8 mt-4 text-[clamp(2.2rem,5vw,3.6rem)]">{title}</h1>
      {children}
    </article>
  );
}
