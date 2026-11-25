// How a report's numbers become the bar. Pure, so the page and the live counter say the same thing.
import type { FunnelPart } from "@smw/ui/comm/ResponseFunnel";
import type { Funnel } from "../report-service";

/** A notice that asks something shows the answers; one that does not shows who opened it. */
export function funnelParts(f: Funnel, asks: boolean, consent: boolean): FunnelPart[] {
  if (!asks) return [
    { label: "Opened", value: f.seen, tone: "success" },
    { label: "Reached, not opened", value: Math.max(0, f.reached - f.seen), tone: "info" },
    { label: "Not reached", value: Math.max(0, f.recipients - f.reached), tone: "warning" },
  ];
  return [
    ...(consent ? [{ label: "Yes", value: f.yes, tone: "success" as const }, { label: "No", value: f.no, tone: "danger" as const }] : [{ label: "Answered", value: f.answered, tone: "success" as const }]),
    ...(consent && f.other ? [{ label: "Other", value: f.other, tone: "info" as const }] : []),
    { label: "Not answered", value: f.notAnswered, tone: "default" },
  ];
}
