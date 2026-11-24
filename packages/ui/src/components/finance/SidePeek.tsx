"use client";

import { useState, type ReactNode } from "react";
import { SidePanel, type SidePanelProps } from "../dashboard/kit/Modal";
import { cn } from "../../lib/utils";
import { FOCUS } from "./ui";

export interface SidePeekProps extends Omit<SidePanelProps, "open" | "onOpenChange" | "children"> {
  /** What the person presses to open it: a row's name, a receipt number. Rendered inside a button. */
  trigger?: ReactNode;
  /** Names the trigger button for screen readers, for example "Open receipt R-1042". */
  triggerLabel?: string;
  /** Pass both to control it from outside (open from a table row click). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerClassName?: string;
  children: ReactNode;
}

/** A record's detail beside its list, without leaving the page. Wraps the kit SidePanel; works with its own trigger or controlled. */
export function SidePeek({ trigger, triggerLabel, open, onOpenChange, triggerClassName, children, ...panel }: SidePeekProps) {
  const [inner, setInner] = useState(false);
  const controlled = open !== undefined;
  const isOpen = controlled ? open : inner;
  const set = (v: boolean) => { if (!controlled) setInner(v); onOpenChange?.(v); };
  return (
    <>
      {trigger ? (
        <button type="button" aria-haspopup="dialog" aria-label={triggerLabel} onClick={() => set(true)} className={cn("min-h-10 rounded-lg px-1 text-left transition-colors hover:bg-white/[0.05]", FOCUS, triggerClassName)}>{trigger}</button>
      ) : null}
      <SidePanel {...panel} open={isOpen} onOpenChange={set}>{children}</SidePanel>
    </>
  );
}
