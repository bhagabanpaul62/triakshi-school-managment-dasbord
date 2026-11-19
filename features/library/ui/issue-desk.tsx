"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconX } from "@tabler/icons-react";
import { Panel } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { shortDate } from "@smw/ui/format";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { FINE_PER_DAY_PAISE, LOAN_DAYS, addDays, todayIST } from "../rules";
import { findBooks, findBorrowers, issueBook } from "./actions";

type BookHit = { bookId: string; title: string; author: string; copyId: string; accessionLabel: string; available: number };
type Borrower = { kind: "student" | "staff"; id: string; name: string; admissionNo: string | null; meta: string; held: number; limit: number };

/** Debounced server search. `idle` until something is typed (or always, when `eager`). */
function useSearch<T>(q: string, run: (q: string) => Promise<{ ok: true; data: T[] } | { ok: false; error: string }>, eager: boolean) {
  const [state, setState] = useState<{ rows: T[]; loading: boolean; error: string | null }>({ rows: [], loading: false, error: null });
  const seq = useRef(0);
  useEffect(() => {
    if (!eager && !q.trim()) { setState({ rows: [], loading: false, error: null }); return; }
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    const t = setTimeout(async () => {
      const r = await run(q);
      if (mine !== seq.current) return;
      setState(r.ok ? { rows: r.data, loading: false, error: null } : { rows: [], loading: false, error: r.error });
    }, 220);
    return () => clearTimeout(t);
  }, [q, eager]); // eslint-disable-line react-hooks/exhaustive-deps -- `run` is a stable server action
  return state;
}

const ROW = "flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

function Picker<T>({ label, placeholder, hint, picked, onClear, q, onQ, search, empty, renderHit, renderPicked, onPick }: {
  label: string; placeholder: string; hint?: string; picked: T | null; onClear: () => void; q: string; onQ: (v: string) => void;
  search: { rows: T[]; loading: boolean; error: string | null }; empty: string;
  renderHit: (r: T) => { key: string; title: string; meta: string; badge?: { label: string; tone: "success" | "warning" | "danger" | "info" }; disabled?: boolean };
  renderPicked: (r: T) => { title: string; meta: string }; onPick: (r: T) => void;
}) {
  const id = useId();
  const shown = picked ? renderPicked(picked) : null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-sm text-[var(--ds-on-surface-variant)]">{label}</label>
      {shown ? (
        <div className="flex min-h-12 items-center gap-3 rounded-2xl bg-white/[0.05] px-4 py-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{shown.title}</span>
            <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{shown.meta}</span>
          </span>
          <button type="button" onClick={onClear} aria-label={`Change ${label.toLowerCase()}`} title="Change"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--ds-on-surface-muted)] hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]"><IconX className="h-4 w-4" aria-hidden /></button>
        </div>
      ) : (
        <>
          <input id={id} value={q} onChange={(e) => onQ(e.target.value)} placeholder={placeholder} autoComplete="off" className={INPUT} aria-describedby={hint ? `${id}-hint` : undefined} />
          <div className="flex min-h-[132px] flex-col" aria-live="polite">
            {search.error ? <p className="px-3 py-2 text-sm text-[var(--ds-color-danger-400)]">{search.error}</p>
              : search.loading && !search.rows.length ? <p className="px-3 py-2 text-sm text-[var(--ds-on-surface-muted)]">Searching…</p>
              : search.rows.length === 0 ? <p className="px-3 py-2 text-sm text-[var(--ds-on-surface-muted)]">{q.trim() || hint === undefined ? empty : hint}</p>
              : (
                <ul className="flex flex-col" aria-label={`${label} results`}>
                  {search.rows.map((r) => {
                    const h = renderHit(r);
                    return (
                      <li key={h.key}>
                        <button type="button" className={ROW} disabled={h.disabled} onClick={() => onPick(r)}>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{h.title}</span>
                            <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{h.meta}</span>
                          </span>
                          {h.badge ? <ToneBadge label={h.badge.label} tone={h.badge.tone} /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
          </div>
        </>
      )}
    </div>
  );
}

/** The librarian's desk: find the book, find the student, issue. One panel, no page changes. */
export function IssueDesk() {
  const router = useRouter();
  const [bookQ, setBookQ] = useState("");
  const [who, setWho] = useState("");
  const [book, setBook] = useState<BookHit | null>(null);
  const [borrower, setBorrower] = useState<Borrower | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const books = useSearch<BookHit>(bookQ, findBooks as never, true);
  const people = useSearch<Borrower>(who, findBorrowers as never, false);
  const due = shortDate(addDays(todayIST(), LOAN_DAYS));

  const issue = () => start(async () => {
    if (!book || !borrower) return;
    const fd = new FormData();
    fd.set("copyId", book.copyId);
    if (borrower.kind === "student") fd.set("admissionNo", borrower.admissionNo ?? ""); else fd.set("userId", borrower.id);
    const r = await issueBook(fd);
    if (!r.ok) { setError(r.error); toast(r.error, "danger"); return; }
    toast(`${book.title} issued to ${borrower.name}. Due ${due}.`);
    setBook(null); setBorrower(null); setBookQ(""); setWho(""); setError(null);
    router.refresh();
  });

  return (
    <Panel title="Issue a book">
      <div className="flex flex-col gap-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <Picker<BookHit> label="Book" placeholder="Search title, author or ISBN" picked={book} onClear={() => { setBook(null); setError(null); }} q={bookQ} onQ={setBookQ}
            search={books} empty="No book with a free copy matches. Check the spelling or open Books."
            renderHit={(b) => ({ key: b.bookId, title: b.title, meta: `${b.author} · ${b.accessionLabel}`, badge: { label: `${b.available} on shelf`, tone: "success" } })}
            renderPicked={(b) => ({ title: b.title, meta: `${b.author} · copy ${b.accessionLabel}` })} onPick={(b) => { setBook(b); setError(null); }} />
          <Picker<Borrower> label="Student or staff" placeholder="Search name or admission number" hint="Type a name or admission number." picked={borrower} onClear={() => { setBorrower(null); setError(null); }} q={who} onQ={setWho}
            search={people} empty="Nobody active matches. Check the spelling or admission number."
            renderHit={(b) => ({ key: b.id, title: b.name, meta: b.meta, disabled: b.held >= b.limit, badge: { label: b.held >= b.limit ? `Has ${b.held} of ${b.limit}` : `${b.held} of ${b.limit} books`, tone: b.held >= b.limit ? "danger" : b.held > 0 ? "info" : "success" } })}
            renderPicked={(b) => ({ title: b.name, meta: `${b.meta} · holds ${b.held} of ${b.limit}` })} onPick={(b) => { setBorrower(b); setError(null); }} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={`text-sm ${error ? "text-[var(--ds-color-danger-400)]" : "text-[var(--ds-on-surface-muted)]"}`} role={error ? "alert" : undefined}>
            {error ?? `Due ${due} (${LOAN_DAYS} days). Late fine ₹${FINE_PER_DAY_PAISE / 100} a day.`}
          </p>
          <Button type="button" className="rounded-full" disabled={!book || !borrower} isLoading={pending} onClick={issue}>
            {book && borrower ? `Issue to ${borrower.name.split(" ")[0]}` : "Issue book"}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
