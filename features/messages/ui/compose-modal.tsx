"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalField, ModalFooter, ModalSection } from "@smw/ui/kit/Modal";
import { Button } from "@smw/ui/ui/button";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { cn } from "@smw/ui/utils";
import type { Contact } from "../contact-rules";
import { ROLE_LABELS } from "./labels";

type Action = (fd: FormData) => Promise<FormResult>;

/** New conversation: pick people from the contacts the rules allow, add a subject and the first message. */
export function ComposeModal({ search, start }: { search: Action; start: Action }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Contact[] | null>(null);
  const [chosen, setChosen] = useState<Contact[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, run] = useTransition();
  const router = useRouter();
  const formId = useId();
  const latest = useRef(0);

  // Search as you type; a slow answer to an older query never replaces a newer one.
  useEffect(() => {
    if (!open) return;
    const n = ++latest.current;
    const t = setTimeout(async () => {
      const fd = new FormData();
      fd.set("q", q);
      const r = await search(fd);
      if (n === latest.current && r.ok) setFound(r.data as Contact[]);
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [open, q, search]);

  const openIt = () => { setQ(""); setFound(null); setChosen([]); setErrors({}); setOpen(true); };
  const pick = (c: Contact) => setChosen((cur) => (cur.some((x) => x.id === c.id) ? cur : [...cur, c]));
  const options = (found ?? []).filter((c) => !chosen.some((x) => x.id === c.id));

  const submit = (fd: FormData) => run(async () => {
    for (const c of chosen) fd.append("recipientIds", c.id);
    const r = await start(fd);
    if (!r.ok) { setErrors(r.fieldErrors ?? {}); return toast(r.error, "danger"); }
    setOpen(false);
    toast("Message sent");
    router.push(`/app/messages?t=${(r.data as { id: string }).id}`);
  });

  return (
    <>
      <Button className="rounded-full" onClick={openIt}>New message</Button>
      <Modal open={open} onOpenChange={setOpen} size="md" title="New message" description="Only people you are allowed to message are listed." dismissOnOutsideClick={false}
        footer={<ModalFooter summary={chosen.length ? `${chosen.length} ${chosen.length === 1 ? "person" : "people"} selected` : undefined}
          secondary={{ onClick: () => setOpen(false) }} primary={{ label: "Send", type: "submit", form: formId, loading: pending }} />}>
        <form id={formId} action={submit} className="pt-2" noValidate>
          <ModalSection>
            <div className="flex flex-col gap-4">
              <ModalField label="To" htmlFor={`${formId}-q`} required error={errors.recipientIds}>
                <div className="flex flex-col gap-2">
                  {chosen.length ? (
                    <ul className="flex flex-wrap gap-2" aria-label="Selected people">
                      {chosen.map((c) => (
                        <li key={c.id}>
                          <button type="button" onClick={() => setChosen((cur) => cur.filter((x) => x.id !== c.id))} aria-label={`Remove ${c.name}`} title={`Remove ${c.name}`}
                            className="rounded-full bg-[var(--ds-color-primary-500)]/20 px-3 py-1 text-sm transition-colors hover:bg-[var(--ds-color-primary-500)]/30">{c.name} <span aria-hidden>×</span></button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <input id={`${formId}-q`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" autoComplete="off" className={INPUT} />
                  <ul className="custom-scrollbar max-h-44 overflow-y-auto rounded-2xl bg-white/[0.035] p-1" aria-label="People you can message">
                    {found === null ? <li className="px-3 py-2 text-sm text-[var(--ds-on-surface-muted)]">Searching…</li> : null}
                    {found && options.length === 0 ? <li className="px-3 py-2 text-sm text-[var(--ds-on-surface-muted)]">{q ? `No one named "${q}" that you can message.` : "No one left to add."}</li> : null}
                    {options.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => pick(c)} className={cn("flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.06]")}>
                          <span className="truncate">{c.name}</span>
                          <span className="shrink-0 text-xs text-[var(--ds-on-surface-muted)]">{ROLE_LABELS[c.role] ?? c.role}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </ModalField>
              <ModalField label="Subject" htmlFor={`${formId}-subject`} required error={errors.subject}>
                <input id={`${formId}-subject`} name="subject" required maxLength={120} className={INPUT} aria-invalid={!!errors.subject || undefined} />
              </ModalField>
              <ModalField label="Message" htmlFor={`${formId}-body`} required error={errors.body}>
                <textarea id={`${formId}-body`} name="body" required rows={4} maxLength={4000} className={cn(INPUT, "h-auto py-2")} aria-invalid={!!errors.body || undefined} />
              </ModalField>
            </div>
          </ModalSection>
        </form>
      </Modal>
    </>
  );
}
