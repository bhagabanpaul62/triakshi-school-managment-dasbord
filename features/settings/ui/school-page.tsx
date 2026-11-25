import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { Inset, Panel } from "@smw/ui/kit/Panel";
import { TickBar } from "@smw/ui/kit/TickBar";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { FormModal } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { initials } from "@smw/ui/format";
import { SchoolProfileService } from "../service";
import { GROUP_LABELS, PROFILE_FIELDS, completeness, profileWarnings, type ProfileGroup } from "../profile-meta";
import { updateSchoolProfile, uploadLogo } from "./actions";
import { logoFields, monthName, schoolGroupFields, timezoneName } from "./fields";
import { AdminOnly } from "./states";

export const metadata = { title: "School profile" };

const GROUPS = Object.keys(GROUP_LABELS) as ProfileGroup[];

/** Settings, School profile: each group is saved on its own, every detail says where it is used, and what is missing is linked. */
export default async function SchoolPage() {
  const ctx = await requireCtx();
  const svc = new SchoolProfileService(ctx);
  if (!svc.can("manage")) return <AdminOnly title="School profile" />;
  const p = await svc.get();
  const row = p as Record<string, unknown>;
  const { filled, total, missing } = completeness(row);
  const warnings = profileWarnings(row);
  const value = (key: string) => {
    const v = row[key];
    if (v === null || v === undefined || v === "") return null;
    return key === "timezone" ? timezoneName(String(v)) : key === "academicYearStartMonth" ? monthName(Number(v)) : String(v);
  };
  return (
    <>
      <PageHeader eyebrow="School" title="School profile" description="Printed on receipts and report cards, shown on the website and in the disclosure page." />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="flex flex-col gap-3 lg:col-span-8">
          {GROUPS.map((g) => {
            const own = new Set(schoolGroupFields(g, p).map((f) => f.name));
            const others = Object.fromEntries(PROFILE_FIELDS.filter((f) => !own.has(f.key)).map((f) => [f.key, String(row[f.key] ?? "")]));
            return (
              <div key={g} id={g} className="scroll-mt-20">
                <Panel title={GROUP_LABELS[g]} action={
                  <FormModal title={`Edit ${GROUP_LABELS[g].toLowerCase()}`} icon="settings" fields={schoolGroupFields(g, p)} hidden={others} action={updateSchoolProfile}
                    values={{ ...row, establishedYear: row.establishedYear == null ? "" : String(row.establishedYear), academicYearStartMonth: String(p.academicYearStartMonth) }}
                    trigger={{ label: "Edit", variant: "secondary", size: "sm" }} />}>
                  <dl className="flex flex-col">
                    {PROFILE_FIELDS.filter((f) => f.group === g).map((f) => {
                      const v = value(f.key);
                      const warn = warnings.filter((w) => w.field === f.key);
                      return (
                        <div key={f.key} className="grid grid-cols-1 gap-x-3 rounded-xl px-2 py-2 sm:grid-cols-[minmax(0,160px)_minmax(0,1fr)]">
                          <dt className="text-[13px] text-[var(--ds-on-surface-muted)]">{f.label}</dt>
                          <dd className="min-w-0 text-sm text-[var(--ds-on-surface)]">
                            {v ? <span className="break-words">{v}</span> : <span className="text-[var(--ds-on-surface-muted)]">{f.needed ? "Not added yet" : "-"}</span>}
                            <span className="block text-xs text-[var(--ds-on-surface-muted)]">Used in: {f.usedIn}</span>
                            {warn.map((w) => <span key={w.text} className="mt-1 block text-xs text-[var(--ds-color-warning-400)]">{w.text}</span>)}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </Panel>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-3 lg:col-span-4">
          <Panel title="Profile completeness">
            <p className="text-[26px] font-medium leading-none tabular-nums tracking-tight">{filled}<span className="text-base text-[var(--ds-on-surface-muted)]"> of {total} filled</span></p>
            <TickBar label="Profile filled in" className="mt-3" value={(filled / total) * 100} tone={missing.length ? "info" : "success"} />
            {missing.length ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {missing.map((m) => <li key={m.key}><Link href={`#${m.group}`} className="inline-flex min-h-8 items-center rounded-full bg-white/[0.06] px-3 text-xs text-[var(--ds-on-surface)] hover:bg-white/[0.1]">{m.label}</Link></li>)}
              </ul>
            ) : <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">Everything is filled in.</p>}
            {warnings.length ? <div className="mt-3"><ToneBadge label={`${warnings.length} to check`} tone="warning" /></div> : null}
          </Panel>
          <Panel title="Logo" action={
            <FormModal title="Change logo" icon="upload" fields={logoFields} action={uploadLogo} submitLabel="Upload" trigger={{ label: p.logoUrl ? "Change" : "Upload", variant: "secondary", size: "sm" }} />}>
            {p.logoUrl ? (
              <div className="flex items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element -- served through our own file route, so next/image cannot optimise it */}
                <img src={p.logoUrl} alt={`${p.name} logo`} className="h-24 w-24 shrink-0 rounded-2xl bg-white/[0.05] object-contain p-2" />
                <p className="text-xs text-[var(--ds-on-surface-muted)]">Shows in the sidebar for everyone who signs in, and on your sign-in page.</p>
              </div>
            ) : (
              <Inset>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--ds-primary)] text-sm font-medium text-white" aria-hidden>{initials(p.name)}</span>
                  <p className="text-sm text-[var(--ds-on-surface)]">Your sidebar shows your initials for now.</p>
                </div>
                <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">Upload a logo and it replaces them in the sidebar and on the sign-in page.</p>
              </Inset>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
