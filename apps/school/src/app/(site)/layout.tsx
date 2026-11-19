import { getSchool } from "@smw/runtime";
import { siteCss } from "@smw/themes";
import { siteFontClasses } from "./fonts";

/** Wraps every public page: light colour scheme, the school's fonts, and the "paused" page for a suspended or cancelled school. */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const school = await getSchool();
  const paused = school.status === "suspended" || school.status === "cancelled";
  return (
    <div className={siteFontClasses}>
      <style dangerouslySetInnerHTML={{ __html: `${siteCss(school.theme)}html{color-scheme:light}body{background:var(--site-background);color:var(--site-text)}` }} />
      {paused ? (
        <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
          <div style={{ maxWidth: 440 }}>
            <h1 style={{ fontSize: 30, margin: 0 }}>This website is paused</h1>
            <p style={{ color: "var(--site-muted-text)", margin: "10px 0 0" }}>{school.name} is not showing its website right now. Please contact the school office directly.</p>
          </div>
        </main>
      ) : children}
    </div>
  );
}
