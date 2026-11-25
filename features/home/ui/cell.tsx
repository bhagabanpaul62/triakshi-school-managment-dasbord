import { Suspense, type CSSProperties } from "react";
import { Panel } from "@smw/ui/kit/Panel";
import { PANELS, type PanelDef, type PanelKey } from "../panels";
import { homeFor } from "./request";
import { PanelBoundary } from "./panel-boundary";
import { PanelError } from "./panel-error";
import { VIEWS } from "./views";

// Width of a panel on a wide screen: its columns of 12 less its share of the 12px gaps (and half a pixel so rounding never wraps a row).
const BASIS: Record<PanelDef["size"], string> = {
  4: "lg:basis-[calc(33.3333%-8.5px)]", 5: "lg:basis-[calc(41.6667%-7.5px)]", 6: "lg:basis-[calc(50%-6.5px)]", 7: "lg:basis-[calc(58.3333%-5.5px)]", 12: "lg:basis-full",
};

/** The grey block shown while a panel loads: as tall as the panel will be (one line for panels that are usually a line), on a phone and on a wide screen, so nothing moves when it arrives. Hidden from screen readers: the page has one "Loading" status. */
export function Skeleton({ height, phone }: { height: number; phone?: number }) {
  return <div aria-hidden style={{ "--h": height, "--hm": phone ?? height } as CSSProperties} className="h-full min-h-[calc(var(--hm)*1px)] animate-pulse rounded-3xl bg-[var(--ds-surface-container-low)] motion-reduce:animate-none lg:min-h-[calc(var(--h)*1px)]" />;
}

/** Loads one panel. Nothing at all when it is off or not for this person; its own error and Retry when it failed. */
async function PanelHost({ k }: { k: PanelKey }) {
  const slot = await (await homeFor()).panel(k);
  if (slot.state === "off") return null;
  if (slot.state === "error") return <Panel title={PANELS[k].title}><PanelError message={slot.message} /></Panel>;
  return (VIEWS[k] as (d: unknown) => React.ReactNode)(slot.data);
}

// Cells in a wrapped row stretch to the tallest, and what is inside fills the cell (Panel, Line and Skeleton are all h-full). A resolved one-liner (data-line) goes after every real panel and takes a whole row, so a quiet line is never beside a tall panel.
const CELL = (def: PanelDef) => `flex min-w-0 grow basis-full flex-col empty:hidden has-[[data-line]]:order-last ${BASIS[def.size]} lg:has-[[data-line]]:basis-full`;

/** One panel on the grid, in its own Suspense and its own error boundary: the page does not wait for the slowest one, and one that breaks does not take the rest down. A panel that renders nothing leaves no gap (`empty:hidden`). */
export function PanelCell({ def }: { def: PanelDef }) {
  return (
    <div className={CELL(def)}>
      <PanelBoundary title={def.title}>
        <Suspense fallback={<Skeleton height={def.height} phone={def.phone} />}>
          <PanelHost k={def.key} />
        </Suspense>
      </PanelBoundary>
    </div>
  );
}

/** The same cell with only the grey block, for the page's own loading state. */
export function SkeletonCell({ def }: { def: PanelDef }) {
  return <div className={CELL(def)}><Skeleton height={def.height} phone={def.phone} /></div>;
}
