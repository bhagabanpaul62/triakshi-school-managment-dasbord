"use client";

/** Public site: shown while a page loads and when it fails. Uses the school's colours from the layout. */
export function SiteLoading() {
  return <main aria-busy="true" aria-label="Loading" style={{ minHeight: "100dvh", background: "var(--site-background)" }} />;
}

export function SiteError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, textAlign: "center", background: "var(--site-background)", color: "var(--site-text)", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 440 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>This page did not load</h1>
        <p style={{ color: "var(--site-muted-text)", margin: "10px 0 20px" }}>Something went wrong on our side. Please try again.</p>
        <button type="button" onClick={reset} style={{ minHeight: 44, padding: "0 24px", borderRadius: 999, border: 0, background: "var(--site-fill)", color: "var(--site-on-primary)", fontWeight: 600, cursor: "pointer" }}>Try again</button>
      </div>
    </main>
  );
}
