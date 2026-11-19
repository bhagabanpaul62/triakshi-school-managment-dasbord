import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { addMinutes, formatTime } from "../bell";
import { PeriodService } from "../service";
import { applyPeriodPreset, createPeriod, deletePeriod, updatePeriod } from "./actions";
import { periodFields } from "./fields";
import { LinkButton } from "./LinkButton";

export const metadata = { title: "Bell schedule" };

const columns: Column[] = [
  { key: "sortOrder", label: "#", type: "number", width: "64px" },
  { key: "name", label: "Period" },
  { key: "startLabel", label: "Starts" },
  { key: "endLabel", label: "Ends" },
  { key: "kind", label: "Type", type: "badge", labels: { period: "Class", break: "Break" }, tones: { break: "info" }, hideOnMobile: true },
];

/** /app/timetable/periods: the periods and breaks of the school day. Everyone reads it; the admin edits. */
export default async function PeriodsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new PeriodService(ctx);
  const page = await svc.list({ ...listQueryFrom(await searchParams), sort: "sortOrder", dir: "asc", pageSize: 100 });
  const canWrite = svc.can("manage");
  const rows = page.rows.map((r) => ({ ...r, startLabel: formatTime(r.startsAt), endLabel: formatTime(r.endsAt), kind: r.isBreak ? "break" : "period" }));
  const last = page.rows.at(-1);
  const add = canWrite ? (
    <FormModal title="Add period" icon="clock" fields={periodFields} action={createPeriod} submitLabel="Add"
      values={{ sortOrder: (last?.sortOrder ?? 0) + 1, startsAt: last?.endsAt ?? "08:00", endsAt: addMinutes(last?.endsAt ?? "08:00", 40) }} />
  ) : null;

  return (
    <>
      <PageHeader eyebrow="Timetable" title="Bell schedule" description="The periods and breaks of the school day. Every section's timetable uses them."
        actions={<>{add}<LinkButton href="/app/timetable">Timetable</LinkButton></>} />
      <DataTable columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} searchPlaceholder="Search periods"
        empty={{
          title: "No periods yet.", description: canWrite ? "Start from the standard day (8 periods of 40 minutes from 8:00 am, with a 20-minute break after period 4) or add your own." : "The school has not set its periods yet.",
          action: canWrite ? <ActionButton action={applyPeriodPreset} label="Use the standard schedule" variant="default" successMessage="Standard bell schedule created" /> : undefined,
        }}
        rowActions={canWrite ? Object.fromEntries(rows.map((r) => [r.id, (
          <span key={r.id} className="inline-flex items-center gap-1">
            <FormModal title="Edit period" icon="clock" fields={periodFields} values={r} hidden={{ id: r.id }} action={updatePeriod} trigger={{ label: "Edit", variant: "ghost", size: "sm" }} />
            <ActionButton variant="icon-delete" label={`Delete ${r.name}`} action={deletePeriod} values={{ id: r.id }}
              confirm={{ title: `Delete ${r.name}?`, body: `Classes planned in ${r.name} are removed from every timetable. This cannot be undone.`, confirmLabel: "Delete", danger: true }} />
          </span>
        )])) : undefined} />
    </>
  );
}
