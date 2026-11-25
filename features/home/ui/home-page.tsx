import { Suspense } from "react";
import Link from "next/link";
import { Panel } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { PANELS } from "../panels";
import { PanelCell, SkeletonCell } from "./cell";
import { homeFor } from "./request";

export const metadata = { title: "Home" };

/** A school with no students yet: what to do first, instead of a page of empty boxes. */
function EmptySchool() {
  return (
    <Panel title="Your school has no students yet">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <p className="min-w-0 flex-1 basis-64 text-sm text-[var(--ds-on-surface-variant)]">Add your students and this page fills with attendance, fees and what needs you each day.</p>
        <Button asChild className="rounded-full"><Link href="/app/students/import">Add students</Link></Button>
        <Link href="/app/getting-started" className="min-h-10 content-center text-sm text-[var(--ds-on-surface-variant)] underline-offset-4 hover:underline">Open getting started</Link>
      </div>
    </Panel>
  );
}

const SETUP_ONLY: readonly string[] = ["today", "getting-started", "notices"];

async function Header() {
  const h = await (await homeFor()).header();
  return <PageHeader eyebrow="Home" title={h.greeting} description={h.line} />;
}

function HeaderSkeleton() {
  return (
    <div aria-hidden className="pb-8">
      <p className="text-xs uppercase tracking-wide text-[var(--ds-on-surface-muted)]">Home</p>
      <div className="mt-3 h-8 w-64 animate-pulse rounded-full bg-white/[0.06] motion-reduce:animate-none" />
    </div>
  );
}

/** The panels, or just the setup when the school has no students. Only an admin's page waits for that one check, and the greeting does not wait for it. */
async function Body() {
  const home = await homeFor();
  const empty = await home.emptySchool();
  const panels = home.layout().filter((p) => !empty || SETUP_ONLY.includes(p.key));
  return (
    <>
      {empty ? <EmptySchool /> : null}
      <div className="flex flex-wrap gap-3">{panels.map((p) => <PanelCell key={p.key} def={PANELS[p.key]} />)}</div>
    </>
  );
}

/** /app: the home page of whoever is signed in. The greeting streams first; each panel streams in on its own and fails on its own. */
export default async function HomePage() {
  const home = await homeFor();
  const layout = home.layout();
  return (
    <>
      <Suspense fallback={<HeaderSkeleton />}><Header /></Suspense>
      <div className="flex flex-col gap-3 pb-8">
        <Suspense fallback={<><p role="status" className="sr-only">Loading your home page</p><div className="flex flex-wrap gap-3">{layout.map((p) => <SkeletonCell key={p.key} def={PANELS[p.key]} />)}</div></>}>
          <Body />
        </Suspense>
      </div>
    </>
  );
}
