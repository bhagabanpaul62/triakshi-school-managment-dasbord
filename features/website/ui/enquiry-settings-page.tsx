import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { Panel } from "@smw/ui/kit/Panel";
import { INPUT } from "@smw/ui/tone";
import { Button } from "@smw/ui/ui/button";
import { EnquirySettingsService, EnquiryService, TEMPLATE_WORDS } from "../service";
import { EnquiryClock } from "../enquiry-jobs";
import { saveEnquirySeats, saveEnquirySettings } from "./enquiry-actions";
import { SaveForm } from "./enquiry-save-form";

export const metadata = { title: "Enquiry settings" };
const area = `${INPUT} h-auto py-2`;
const Label = ({ text, hint, children }: { text: string; hint?: string; children: React.ReactNode }) => (
  <label className="flex flex-col gap-1.5 text-sm"><span className="text-[var(--ds-on-surface-variant)]">{text}</span>{children}{hint ? <span className="text-xs text-[var(--ds-on-surface-muted)]">{hint}</span> : null}</label>
);

export default async function EnquirySettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  const enq = new EnquiryService(ctx);
  if (!enq.can("enquiries")) return <NoAccess title="Enquiry settings are for the office admin." hint="Ask your school admin." />;
  if (!enq.can("pipeline")) return <NoAccess title="Only the office admin changes enquiry settings." hint="You can still work the enquiries." />;
  const opts = await enq.options();
  const s = opts.settings;
  const session = (await searchParams).session ?? opts.session;
  const doomed = await new EnquiryClock(ctx).wouldDelete(s.keepMonths);
  const seats = await new EnquirySettingsService(ctx).seats(session);
  const seatOf = new Map(seats.map((x) => [x.className, x.seats]));
  const classes = [...new Set([...opts.classes, ...seats.map((x) => x.className)])];
  const templates = [...s.templates, ...Array.from({ length: 2 }, () => null)];
  return (
    <>
      <PageHeader eyebrow="Enquiries" title="Enquiry settings" description="The rules your office works by." actions={<Button asChild variant="secondary" className="rounded-full"><Link href="/app/enquiries">Back to enquiries</Link></Button>} />
      <div className="flex max-w-3xl flex-col gap-3">
        <Panel title="Rules">
          <SaveForm action={saveEnquirySettings}>
            <Label text="Who gets a new enquiry" hint="They are told, and the first call is theirs.">
              <select name="ownerMode" defaultValue={s.owner.mode} className={INPUT}>
                <option value="none">Nobody: everyone in the office is told</option><option value="one">The first person chosen below</option><option value="turn">Each person below in turn</option></select></Label>
            <fieldset className="flex flex-wrap gap-2"><legend className="mb-1.5 text-sm text-[var(--ds-on-surface-variant)]">People</legend>
              {opts.people.map((p) => <label key={p.id} className="flex items-center gap-2 rounded-full bg-white/[0.05] px-3 py-1.5 text-sm"><input type="checkbox" name="ownerIds" value={p.id} defaultChecked={s.owner.userIds.includes(p.id)} className="accent-[var(--ds-primary)]" />{p.name}</label>)}</fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Label text="First call within (office hours)" hint="Office hours are 9 to 6, Monday to Saturday. After this the owner and the admins are told once."><input name="firstCallHours" type="number" min={1} max={72} defaultValue={s.firstCallHours} className={INPUT} /></Label>
              <Label text="Keep enquiries for (months)" hint={`Untouched enquiries are deleted after this; waitlisted and offered ones after twice as long. Admitted children are kept. ${doomed ? `${doomed} would be deleted at the next daily run.` : "None would be deleted at the next daily run."}`}><input name="keepMonths" type="number" min={6} max={120} defaultValue={s.keepMonths} className={INPUT} />
                <span className="flex items-center gap-2 pt-1 text-xs"><input type="checkbox" name="confirmRetention" value="true" className="accent-[var(--ds-primary)]" />I understand a shorter time deletes older enquiries at the next run</span></Label>
            </div>
            <Label text="Thank-you mail text" hint="Sent to a family that gave an email. The reference number is added."><textarea name="ackText" defaultValue={s.ackText} rows={3} className={area} /></Label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Label text="Sources (one per line)"><textarea name="sources" defaultValue={s.sources.join("\n")} rows={8} className={area} /></Label>
              <Label text="Reasons for closing (one per line)"><textarea name="closeReasons" defaultValue={s.closeReasons.join("\n")} rows={8} className={area} /></Label>
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-[var(--ds-on-surface-variant)]">Messages. Words you can use: <span className="font-mono text-xs">{TEMPLATE_WORDS.join(" ")}</span>. Clear the name to remove one.</p>
              {templates.map((t, i) => (
                <div key={i} className="grid gap-2 rounded-2xl bg-white/[0.035] p-3 sm:grid-cols-[1fr_9rem]">
                  <input type="hidden" name={`t${i}_key`} defaultValue={t?.key ?? ""} />
                  <input name={`t${i}_label`} defaultValue={t?.label ?? ""} placeholder="Name of the message" aria-label="Name of the message" className={INPUT} />
                  <select name={`t${i}_channel`} defaultValue={t?.channel ?? "whatsapp"} aria-label="Sent by" className={INPUT}><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select>
                  <textarea name={`t${i}_text`} defaultValue={t?.text ?? ""} rows={3} placeholder="The text" aria-label="The text" className={`${area} sm:col-span-2`} />
                </div>))}
            </div>
          </SaveForm>
        </Panel>
        <Panel title={`Seats for ${session}`} action={<form className="flex items-center gap-2" action="/app/enquiries/settings"><label className="sr-only" htmlFor="seat-session">Session</label>
          <select id="seat-session" name="session" defaultValue={session} className={`${INPUT} w-auto`}>{[...new Set([...opts.sessions, session])].map((x) => <option key={x}>{x}</option>)}</select>
          <Button type="submit" variant="secondary" className="rounded-full">Show</Button></form>}>
          <SaveForm action={saveEnquirySeats}>
            <input type="hidden" name="session" value={session} />
            <p className="text-sm text-[var(--ds-on-surface-muted)]">How many new children each class can take. Leave a class empty to not count its seats. Offers and admissions are counted against them.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {[...classes, ""].map((c, i) => (
                <div key={`${c}${i}`} className="flex items-center gap-2"><input name="className" defaultValue={c} placeholder="Class" aria-label="Class" className={INPUT} /><input name="seats" type="number" min={0} max={5000} defaultValue={seatOf.get(c) ?? ""} aria-label={`Seats for ${c || "a new class"}`} placeholder="Seats" className={`${INPUT} w-28`} /></div>))}
            </div>
          </SaveForm>
        </Panel>
      </div>
    </>
  );
}
