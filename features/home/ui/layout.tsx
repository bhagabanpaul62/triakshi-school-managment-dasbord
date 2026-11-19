import type { ReactNode } from "react";
import { Panel } from "@smw/ui/kit/Panel";
import { PanelGrid } from "@smw/ui/shell/PageHeader";
import { PanelError } from "./panel-error";
import type { Slot } from "../home-service";

const COL: Record<number, string> = { 3: "lg:col-span-3", 12: "lg:col-span-12", 8: "lg:col-span-8", 7: "lg:col-span-7", 6: "lg:col-span-6", 5: "lg:col-span-5", 4: "lg:col-span-4" };

/** One panel on the grid. Nothing at all when its module is off; an error state (not a broken page) when it failed. */
export function SlotPanel<T>({ slot, title, action, children }: { slot: Slot<T>; title: string; action?: ReactNode; children: (data: T) => ReactNode }) {
  if (slot.state === "off") return null;
  return (
    <Panel title={title} action={action}>
      {slot.state === "error" ? <PanelError message={slot.message} /> : children(slot.data)}
    </Panel>
  );
}

export interface Cell { slot: Slot<unknown>; size: 4 | 5 | 6 | 7 | 8 | 12; node: ReactNode }

/**
 * A row of panels on the 12-column grid. Panels whose module is off drop out and the rest share the row, so a school
 * without a module never sees a hole. Sizes apply when every cell is present.
 */
export function PanelRow({ cells }: { cells: Cell[] }) {
  const live = cells.filter((c) => c.slot.state !== "off");
  if (live.length === 0) return null;
  const even = live.length === cells.length;
  return (
    <PanelGrid>
      {live.map((c, i) => (
        <div key={i} className={`min-w-0 ${COL[even ? c.size : 12 / live.length]}`}>{c.node}</div>
      ))}
    </PanelGrid>
  );
}

/** Vertical rhythm of the page: KPI row, then panel rows 12px apart. */
export function Rows({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 pb-8">{children}</div>;
}
