"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@smw/ui/utils";
import { INPUT } from "@smw/ui/tone";
import { FilesField } from "@smw/ui/comm/FilesField";
import { PRIMARY_BTN } from "@smw/ui/finance/ui";
import { toast } from "@smw/ui/shell/toast";
import type { FormResult } from "@smw/ui/shell/FormModal";
import type { RequestField } from "../constants";

interface Category { id: string; name: string; nature: string; fields: RequestField[] }
interface Person { id: string; name: string; role: string }
type Context = { child: { id: string; name: string } | null; people: Person[]; office: boolean };

const label = "text-sm font-medium text-[var(--ds-on-surface)]";
const err = "text-xs text-[var(--ds-color-danger-400)]";

/** Category first, then only the fields that category needs. The child is already chosen for a family. */
export function AskForm({ categories, child, office, link, defaultCategory, initialPeople, action, students, context }: {
  categories: Category[]; child: { id: string; name: string } | null; office: boolean; initialPeople: Person[]; link: { label: string; href: string } | null; defaultCategory?: string;
  action: (fd: FormData) => Promise<FormResult>;
  students: (q: string) => Promise<{ ok: true; data: { id: string; name: string; admissionNo: string }[] } | { ok: false; error: string }>;
  context: (studentId: string) => Promise<{ ok: true; data: Context } | { ok: false; error: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [catId, setCatId] = useState(categories.find((c) => c.id === defaultCategory)?.id ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [picked, setPicked] = useState(child);
  const [people, setPeople] = useState<Person[]>(initialPeople);
  const [found, setFound] = useState<{ id: string; name: string; admissionNo: string }[]>([]);
  const cat = categories.find((c) => c.id === catId);

  const search = async (q: string) => { if (q.trim().length < 2) return setFound([]); const r = await students(q); setFound(r.ok ? r.data : []); };
  const choose = async (s: { id: string; name: string }) => { setPicked(s); setFound([]); const r = await context(s.id); setPeople(r.ok ? r.data.people : []); };

  const submit = (fd: FormData) => start(async () => {
    setMessage(""); setErrors({});
    if (picked) fd.set("studentId", picked.id);
    const r = await action(fd);
    if (r.ok) { toast("Sent. We will reply here."); router.push(`/app/requests/${(r.data as { id: string }).id}`); return; }
    setErrors(r.fieldErrors ?? {}); setMessage(r.error);
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }} className="mx-auto flex max-w-2xl flex-col gap-6 pb-24" noValidate>
      <fieldset className="flex flex-col gap-2">
        <legend className={label}>What is it about?</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Category">
          {categories.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={c.id === catId} onClick={() => setCatId(c.id)}
              className={cn("min-h-11 rounded-full px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]", c.id === catId ? "bg-[var(--ds-on-surface)] font-medium text-[var(--ds-surface)]" : "bg-white/[0.06] text-[var(--ds-on-surface-variant)] hover:bg-white/[0.1]")}>{c.name}</button>
          ))}
        </div>
        <input type="hidden" name="categoryId" value={catId} />
        {errors.categoryId ? <p role="alert" className={err}>{errors.categoryId}</p> : null}
      </fieldset>

      {cat ? (
        <>
          {office ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="student-search" className={label}>Student</label>
              {picked ? <p className="flex items-center gap-3 text-sm">{picked.name}<button type="button" onClick={() => { setPicked(null); setPeople([]); }} className="underline underline-offset-4">Change</button></p> : (
                <>
                  <input id="student-search" onChange={(e) => void search(e.target.value)} placeholder="Type a name or admission number" className={INPUT} autoComplete="off" />
                  {found.length ? <ul className="flex flex-col gap-1 rounded-2xl bg-white/[0.05] p-1">{found.map((s) => <li key={s.id}><button type="button" onClick={() => void choose(s)} className="min-h-11 w-full rounded-xl px-3 text-left text-sm hover:bg-white/[0.08]">{s.name} <span className="text-[var(--ds-on-surface-muted)]">{s.admissionNo}</span></button></li>)}</ul> : null}
                </>
              )}
              {errors.studentId ? <p role="alert" className={err}>{errors.studentId}</p> : null}
            </div>
          ) : child ? <p className="text-sm text-[var(--ds-on-surface-variant)]">This is about <strong className="font-medium text-[var(--ds-on-surface)]">{child.name}</strong>.</p> : null}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="subject" className={label}>Short title</label>
            <input id="subject" name="subject" maxLength={120} className={INPUT} placeholder="For example: Bus stop change" aria-invalid={!!errors.subject || undefined} />
            {errors.subject ? <p role="alert" className={err}>{errors.subject}</p> : null}
          </div>

          {cat.fields.map((f) => (
            <div key={f.id} className="flex flex-col gap-1.5">
              <label htmlFor={`v_${f.id}`} className={label}>{f.label}{f.required ? "" : " (optional)"}</label>
              {f.kind === "choice" ? (
                <select id={`v_${f.id}`} name={`v_${f.id}`} className={INPUT} defaultValue=""><option value="">Choose…</option>{f.options?.map((o) => <option key={o}>{o}</option>)}</select>
              ) : <input id={`v_${f.id}`} name={`v_${f.id}`} type={f.kind === "date" ? "date" : "text"} maxLength={500} className={INPUT} />}
              {errors[`values.${f.id}`] ? <p role="alert" className={err}>{errors[`values.${f.id}`]}</p> : null}
            </div>
          ))}

          {cat.nature === "complaint" && people.length ? <ComplaintAbout people={people} /> : null}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="details" className={label}>Tell us what you need</label>
            <textarea id="details" name="details" rows={6} maxLength={4000} className={cn(INPUT, "h-auto py-2.5 leading-6")} aria-invalid={!!errors.details || undefined} />
            {errors.details ? <p role="alert" className={err}>{errors.details}</p> : null}
          </div>

          {link ? <><input type="hidden" name="linkLabel" value={link.label} /><input type="hidden" name="linkHref" value={link.href} /><p className="text-sm text-[var(--ds-on-surface-variant)]">About: {link.label}</p></> : null}
          <FilesField accept={["application/pdf", "image/*"]} maxCount={5} maxMb={15} label="Photos or PDFs (optional)" />

          {cat.nature === "safety" ? <p className="rounded-2xl bg-white/[0.05] p-3 text-sm">This goes straight to the people at school who look after safety. If a child is in danger right now, please also call the helpline or the police.</p> : null}
          {message && !Object.keys(errors).length ? <p role="alert" className={err}>{message}</p> : null}
          <div className="sticky bottom-3 flex justify-end"><button type="submit" disabled={pending} className={cn(PRIMARY_BTN, "shadow-lg")}>{pending ? "Sending…" : "Send to the school"}</button></div>
        </>
      ) : <p className="text-sm text-[var(--ds-on-surface-muted)]">Choose a category above to continue.</p>}
    </form>
  );
}

/** For a complaint about a person: the teachers of the child, to choose from. That person never sees the request. */
function ComplaintAbout({ people }: { people: Person[] }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={label}>Is it about a person? (optional)</legend>
      <p className="text-xs text-[var(--ds-on-surface-muted)]">The person you choose will not see this request, and is not told about it.</p>
      <div className="flex flex-wrap gap-2">
        {people.map((p) => (
          <label key={p.id} className="flex min-h-11 items-center gap-2 rounded-full bg-white/[0.05] px-4 text-sm has-[:checked]:bg-white/[0.14]">
            <input type="checkbox" name="aboutUserIds" value={p.id} className="accent-[var(--ds-primary)]" />{p.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
