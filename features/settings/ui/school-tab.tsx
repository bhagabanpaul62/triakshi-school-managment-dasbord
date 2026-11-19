import type { Ctx } from "@smw/feature-kit";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { Inset, Panel } from "@smw/ui/kit/Panel";
import { TickBar } from "@smw/ui/kit/TickBar";
import { PanelGrid } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { initials } from "@smw/ui/format";
import { SchoolProfileService } from "../service";
import { updateSchoolProfile, uploadLogo } from "./actions";
import { logoFields, monthName, schoolFields, timezoneName } from "./fields";

/** Settings tab 1: the school's details and logo. */
export async function SchoolTab({ ctx }: { ctx: Ctx }) {
  const p = await new SchoolProfileService(ctx).get();
  const place = [p.city, p.state].filter(Boolean).join(", ");
  const checks: [string, unknown][] = [["school name", p.name], ["board", p.board], ["city", p.city], ["state", p.state], ["address", p.address], ["phone", p.phone], ["email", p.email], ["UDISE+ code", p.udiseCode]];
  const missing = checks.filter(([, v]) => !v).map(([k]) => k);
  const filled = checks.length - missing.length;
  return (
    <PanelGrid>
      <div className="lg:col-span-8">
        <Panel title="School details" className="h-full" action={
          <FormModal title="Edit school details" icon="settings" fields={schoolFields} values={{ ...p, academicYearStartMonth: String(p.academicYearStartMonth) }}
            action={updateSchoolProfile} trigger={{ label: "Edit", variant: "secondary", size: "sm" }} />}>
          <FactList>
            <Fact label="Name">{p.name}</Fact>
            <Fact label="Board">{p.board}</Fact>
            <Fact label="UDISE+ code" copy={p.udiseCode ?? undefined}>{p.udiseCode}</Fact>
            <Fact label="Location">{place}</Fact>
            <Fact label="Address">{p.address}</Fact>
            <Fact label="Phone" copy={p.phone ?? undefined}>{p.phone}</Fact>
            <Fact label="Email" copy={p.email ?? undefined}>{p.email}</Fact>
            <Fact label="GSTIN" copy={p.gstin ?? undefined}>{p.gstin}</Fact>
            <Fact label="Timezone">{timezoneName(p.timezone)}</Fact>
            <Fact label="Academic year starts">{monthName(p.academicYearStartMonth)}</Fact>
          </FactList>
        </Panel>
      </div>
      <div className="flex flex-col gap-3 lg:col-span-4">
        <Panel title="Logo" action={
          <FormModal title="Change logo" icon="upload" fields={logoFields} action={uploadLogo} submitLabel="Upload"
            trigger={{ label: p.logoUrl ? "Change" : "Upload", variant: "secondary", size: "sm" }} />}>
          {p.logoUrl ? (
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- served through our own file route, so next/image cannot optimise it */}
              <img src={p.logoUrl} alt={`${p.name} logo`} className="h-24 w-24 shrink-0 rounded-2xl bg-white/[0.05] object-contain p-2" />
              <p className="text-xs text-[var(--ds-on-surface-muted)]">Shows in the sidebar for everyone who signs in, and on your sign-in page.</p>
            </div>
          ) : (
            <Inset>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--ds-color-primary-500)] text-sm font-medium text-white" aria-hidden>{initials(p.name)}</span>
                <p className="text-sm text-[var(--ds-on-surface)]">Your sidebar shows your initials for now.</p>
              </div>
              <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">Upload a logo and it replaces them in the sidebar and on the sign-in page.</p>
            </Inset>
          )}
        </Panel>
        <Panel title="Profile completeness">
          <p className="text-[26px] font-medium leading-none tabular-nums tracking-tight">{filled}<span className="text-base text-[var(--ds-on-surface-muted)]"> of {checks.length} filled</span></p>
          <TickBar className="mt-3" value={(filled / checks.length) * 100} tone={missing.length ? "info" : "success"} />
          <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">
            {missing.length ? `Still to add: ${missing.join(", ")}. Click Edit to fill them in.` : "Everything is filled in. Receipts and report cards use these details."}
          </p>
        </Panel>
      </div>
    </PanelGrid>
  );
}
