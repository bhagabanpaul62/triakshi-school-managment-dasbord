import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { HolidayService } from "../service";
import { createHoliday, deleteHoliday, updateHoliday } from "./actions";
import { holidayFields as fields } from "./fields";
import { AttendanceNav } from "./nav";
import { attendanceNavFor } from "./pages";

export const metadata = { title: "Holidays" };

const columns: Column[] = [{ key: "date", label: "Date", type: "date" }, { key: "name", label: "Holiday" }];

/** /app/attendance/holidays: days the school is closed; nobody can be marked on them. */
export default async function HolidaysPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new HolidayService(ctx);
  const page = await svc.list(listQueryFrom(await searchParams));
  const canWrite = svc.can("manage");
  const create = <FormModal title="Add holiday" icon="calendar" fields={fields} action={createHoliday} submitLabel="Add" />;

  return (
    <>
      <PageHeader eyebrow="Academics" title="Holidays" description="Closed days cannot be marked for students or staff."
        actions={<span className="inline-flex items-center gap-3"><AttendanceNav items={attendanceNavFor(ctx)} active="/app/attendance/holidays" />{canWrite ? create : null}</span>} />
      <DataTable columns={columns} rows={page.rows} total={page.total} page={page.page} pageCount={page.pageCount} searchPlaceholder="Search holidays"
        empty={{ title: "No holidays yet.", description: "Add the days the school is closed.", action: canWrite ? create : undefined }}
        rowActions={canWrite ? Object.fromEntries(page.rows.map((r) => [r.id, (
          <span key={r.id} className="inline-flex items-center gap-1">
            <FormModal title="Edit holiday" icon="calendar" fields={fields} values={r} hidden={{ id: r.id }} action={updateHoliday} trigger={{ label: "Edit", variant: "ghost", size: "sm" }} />
            <ActionButton variant="icon-delete" label="Delete holiday" action={deleteHoliday} values={{ id: r.id }}
              confirm={{ title: "Remove this holiday?", body: `${r.name} will open for attendance again.`, confirmLabel: "Remove", danger: true }} />
          </span>
        )])) : undefined} />
    </>
  );
}
