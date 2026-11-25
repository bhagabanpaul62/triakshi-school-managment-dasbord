"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { Modal, ModalFooter } from "@smw/ui/kit/Modal";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { shortDate } from "@smw/ui/format";
import { toast } from "@smw/ui/shell/toast";
import { cn } from "@smw/ui/utils";

export interface Card { id: string; ref: string | null; studentName: string; parentName: string; classApplying: string | null; ownerName: string | null; nextAt: string | null; overdue: boolean; priority: boolean }
export interface Column { stage: string; label: string; count: number; cards: Card[] }
type Undo = { id: string; name: string; from: string; to: string; label: string };

/**
 * Stages as columns. Drag a card to move it, or use the stage list on the card (the way on a phone, where one stage shows at a time). The stage the person saw is
 * sent along, so two people never overwrite each other; an undo bar stays for 8 seconds.
 */
export function EnquiryBoard({ columns, reasons, action }: { columns: Column[]; reasons: string[]; action: (fd: FormData) => Promise<FormResult> }) {
  const [cols, setCols] = useState(columns);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [closing, setClosing] = useState<{ card: Card; from: string } | null>(null);
  const [reason, setReason] = useState(reasons[0] ?? "");
  const [over, setOver] = useState<string | null>(null);
  // Phone: one stage at a time. The first stage that has a card is shown first.
  const [stage, setStage] = useState(() => columns.find((c) => c.cards.length)?.stage ?? columns[0]?.stage ?? "");
  const [pending, start] = useTransition();
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const label = (s: string) => columns.find((c) => c.stage === s)?.label ?? s;

  const place = (cs: Column[], card: Card, from: string, to: string) => cs.map((c) => c.stage === from ? { ...c, count: c.count - 1, cards: c.cards.filter((x) => x.id !== card.id) } : c.stage === to ? { ...c, count: c.count + 1, cards: [card, ...c.cards] } : c);

  const move = (card: Card, from: string, to: string, why?: string, isUndo = false) => {
    if (from === to) return;
    if (to === "admitted") { toast("A child becomes admitted from the Admit button on the enquiry.", "danger"); return; }
    if (to === "closed" && !why) { setClosing({ card, from }); return; }
    const before = cols;
    setCols((cs) => place(cs, card, from, to));
    start(async () => {
      const fd = new FormData();
      fd.set("id", card.id); fd.set("to", to); fd.set("from", from);
      if (why) fd.set("reason", why);
      const r = await action(fd);
      if (!r.ok) { setCols(before); toast(r.error, "danger"); router.refresh(); return; }
      if (timer.current) clearTimeout(timer.current);
      if (isUndo) { setUndo(null); router.refresh(); return; }
      setUndo({ id: card.id, name: card.studentName, from, to, label: `${card.studentName} moved to ${label(to)}` });
      timer.current = setTimeout(() => setUndo(null), 8000);
      router.refresh();
    });
  };
  const back = () => { if (!undo) return; const c = cols.flatMap((x) => x.cards).find((x) => x.id === undo.id); if (c) move(c, undo.to, undo.from, undefined, true); };

  return (
    <>
      <div role="tablist" aria-label="Stage" className="custom-scrollbar -mx-1 flex gap-1 relative overflow-x-auto px-1 pb-1 sm:hidden">
        {cols.map((c) => (
          <button key={c.stage} type="button" role="tab" aria-selected={stage === c.stage} onClick={() => setStage(c.stage)}
            className={cn("inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]", stage === c.stage ? "bg-white/[0.12] text-[var(--ds-on-surface)]" : "bg-white/[0.05] text-[var(--ds-on-surface-variant)]")}>
            {c.label}<span className="text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{c.count}</span>
          </button>
        ))}
      </div>
      <div className="custom-scrollbar flex w-full max-w-full min-w-0 gap-3 relative overflow-x-auto pb-4" role="list" aria-label="Enquiries by stage">
        {cols.map((c) => (
          <section key={c.stage} role="listitem" aria-label={`${c.label}, ${c.count}`} onDragOver={(e) => { e.preventDefault(); setOver(c.stage); }} onDragLeave={() => setOver((o) => (o === c.stage ? null : o))}
            onDrop={(e) => { e.preventDefault(); setOver(null); const raw = e.dataTransfer.getData("text/plain"); const [id, from] = raw.split("|"); const card = cols.flatMap((x) => x.cards).find((x) => x.id === id); if (card && from) move(card, from, c.stage); }}
            className={cn(c.stage === stage ? "flex" : "hidden sm:flex", "w-full flex-col gap-2 rounded-3xl sm:w-72 sm:shrink-0 bg-[var(--ds-surface-container-low)] p-3 transition-colors", over === c.stage && "bg-white/[0.08]")}>
            <h3 className="hidden items-center justify-between px-2 sm:flex pt-1 text-[13px] font-medium text-[var(--ds-on-surface)]">{c.label}<span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] tabular-nums text-[var(--ds-on-surface-variant)]">{c.count}</span></h3>
            {c.cards.length === 0 ? <p className="px-2 py-3 text-xs text-[var(--ds-on-surface-muted)]">{c.stage === "closed" || c.stage === "admitted" ? "None yet." : "Drop an enquiry here."}</p> : null}
            {c.cards.map((card) => (
              <article key={card.id} draggable={c.stage !== "admitted"} onDragStart={(e) => e.dataTransfer.setData("text/plain", `${card.id}|${c.stage}`)}
                className="flex cursor-grab flex-col gap-1.5 rounded-2xl bg-white/[0.05] p-3 active:cursor-grabbing">
                <Link href={`/app/enquiries/${card.id}`} className="min-w-0 rounded-md text-sm font-medium text-[var(--ds-on-surface)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]"><span className="block truncate">{card.studentName}</span></Link>
                <p className="truncate text-xs text-[var(--ds-on-surface-muted)]">{[card.parentName, card.classApplying].filter(Boolean).join(" · ")}</p>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {card.priority ? <ToneBadge label="Priority" tone="warning" /> : null}
                  {c.stage === "admitted" || c.stage === "closed" ? null : card.nextAt ? <ToneBadge label={`${card.overdue ? "Late " : "Next "}${shortDate(card.nextAt)}`} tone={card.overdue ? "danger" : "default"} /> : <ToneBadge label="No next step" tone="warning" />}
                  {card.ownerName ? <span className="text-[var(--ds-on-surface-muted)]">{card.ownerName}</span> : null}
                </div>
                {c.stage === "admitted" ? null : (
                  <label className="text-xs text-[var(--ds-on-surface-muted)]"><span className="sr-only">Move {card.studentName} to</span>
                    <select value={c.stage} disabled={pending} onChange={(e) => move(card, c.stage, e.target.value)} className="mt-1 h-9 w-full rounded-full bg-white/[0.06] px-3 text-xs text-[var(--ds-on-surface)]">
                      {cols.filter((x) => x.stage !== "admitted").map((x) => <option key={x.stage} value={x.stage}>{x.label}</option>)}
                    </select></label>
                )}
              </article>
            ))}
            {c.count > c.cards.length ? <Link href={`/app/enquiries?view=list&stage=${c.stage}`} className="px-2 pb-1 text-xs text-[var(--ds-primary-text)] hover:underline">See all {c.count}</Link> : null}
          </section>
        ))}
      </div>
      {undo ? (
        <div role="status" className="fixed inset-x-0 bottom-0 z-[90] flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex w-full max-w-xl items-center gap-3 rounded-3xl bg-[var(--ds-surface-container-highest)] p-3 pl-5 shadow-lg">
            <p className="min-w-0 flex-1 truncate text-sm">{undo.label}</p>
            <button type="button" onClick={back} className="inline-flex h-10 items-center rounded-full bg-white/[0.07] px-4 text-sm font-medium hover:bg-white/[0.12]">Undo</button>
          </div>
        </div>
      ) : null}
      <Modal open={!!closing} onOpenChange={(o) => !o && setClosing(null)} size="sm" title="Close this enquiry" description={closing?.card.studentName}
        footer={<ModalFooter secondary={{ onClick: () => setClosing(null) }} primary={{ label: "Close it", onClick: () => { const c = closing!; setClosing(null); move(c.card, c.from, "closed", reason); } }} />}>
        <label className="flex flex-col gap-1.5 pt-2 text-sm"><span className="text-[var(--ds-on-surface-variant)]">Why</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT}>{reasons.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
      </Modal>
    </>
  );
}
