"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalFooter } from "@smw/ui/kit/Modal";
import { Button } from "@smw/ui/ui/button";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";

interface Template { key: string; label: string; text: string }

/**
 * A message to the family from the school's templates. WhatsApp opens the app with the text ready (we do not send it, and the timeline
 * records that it was opened); email goes out through the school's daily mail budget. `{child}` and the other words are filled in on the server.
 */
export function EnquiryMessage({ id, channel, templates, action, disabledReason }: { id: string; channel: "whatsapp" | "email"; templates: Template[]; action: (fd: FormData) => Promise<FormResult>; disabledReason?: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(templates[0]?.key ?? "");
  const [text, setText] = useState(templates[0]?.text ?? "");
  const [subject, setSubject] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const uid = useId();
  const word = channel === "whatsapp" ? "WhatsApp" : "Email";

  const send = () => start(async () => {
    const fd = new FormData();
    fd.set("id", id); fd.set("text", text);
    if (key) fd.set("template", key);
    if (subject) fd.set("subject", subject);
    const r = await action(fd);
    if (!r.ok) { setError(r.fieldErrors?.email ?? r.fieldErrors?._ ?? r.error); return; }
    setError(null);
    if (channel === "whatsapp") {
      const url = (r.data as { url: string }).url;
      setLink(url);
      if (!window.open(url, "_blank", "noopener")) toast("Your browser blocked the new window. Use the link below.", "danger");
    } else { toast("Email sent"); setOpen(false); }
    router.refresh();
  });

  if (disabledReason) return <Button variant="ghost" className="rounded-full" disabled title={disabledReason}>{word}</Button>;
  return (
    <>
      <Button variant="secondary" className="rounded-full" onClick={() => { setOpen(true); setLink(null); setError(null); }}>{word}</Button>
      <Modal open={open} onOpenChange={setOpen} size="md" title={`${word} the family`} description={channel === "whatsapp" ? "Opens WhatsApp with this text ready. You press send there." : "Goes from the school's email."} dismissOnOutsideClick={false}
        footer={<ModalFooter secondary={{ onClick: () => setOpen(false) }} primary={{ label: channel === "whatsapp" ? "Open WhatsApp" : "Send email", onClick: send, loading: pending }} />}>
        <div className="flex flex-col gap-4 pt-2 text-sm">
          {templates.length ? (
            <label className="flex flex-col gap-1.5"><span className="text-[var(--ds-on-surface-variant)]">Message</span>
              <select value={key} onChange={(e) => { setKey(e.target.value); setText(templates.find((t) => t.key === e.target.value)?.text ?? ""); }} className={INPUT}>
                {templates.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}<option value="">Write my own</option></select></label>
          ) : null}
          {channel === "email" ? <label className="flex flex-col gap-1.5"><span className="text-[var(--ds-on-surface-variant)]">Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="About your admission enquiry" className={INPUT} /></label> : null}
          <label className="flex flex-col gap-1.5" htmlFor={`${uid}-t`}><span className="text-[var(--ds-on-surface-variant)]">Text</span>
            <textarea id={`${uid}-t`} value={text} onChange={(e) => setText(e.target.value)} rows={6} className={`${INPUT} h-auto py-2`} /></label>
          <p className="text-xs text-[var(--ds-on-surface-muted)]">Words in braces, like {"{child}"} and {"{parent}"}, are filled in for you.</p>
          {error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
          {link ? <a href={link} target="_blank" rel="noopener noreferrer" className="text-[var(--ds-primary-text)] underline">WhatsApp did not open? Use this link.</a> : null}
        </div>
      </Modal>
    </>
  );
}
