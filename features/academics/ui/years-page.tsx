import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { Panel } from "@smw/ui/kit/Panel";
import { shortDate } from "@smw/ui/format";
import { nextYearName } from "../presets";
import { AcademicYearService, TermService } from "../service";
import { createTerm, createYear, deleteTerm, deleteYear, rollForward, setCurrentYear, updateTerm, updateYear } from "./actions";
import { termCreateFields, termFields, yearFields } from "./fields";
import { MiniList } from "./mini-list";
import { RowActions } from "./row-actions";

export const metadata = { title: "Academic years" };

const columns: Column[] = [
  { key: "name", label: "Year" },
  { key: "startsOn", label: "Starts", type: "date" },
  { key: "endsOn", label: "Ends", type: "date" },
  { key: "status", label: "Status", type: "badge", tones: { Current: "success", Upcoming: "info" } },
];

export default async function YearsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const years = new AcademicYearService(ctx);
  const [page, current, yearOptions, termPage] = await Promise.all([
    years.list({ ...listQueryFrom(await searchParams), sort: "startsOn", dir: "desc" }),
    years.current(),
    years.options(),
    new TermService(ctx).list({ pageSize: 100, sort: "startsOn", dir: "asc" }),
  ]);
  const canWrite = years.can("manage");
  const today = new Date().toISOString().slice(0, 10);
  const rows = page.rows.map((y) => ({ ...y, status: y.isCurrent ? "Current" : y.startsOn > today ? "Upcoming" : "Past" }));
  const yearName = new Map(yearOptions.map((y) => [y.value, y.label]));
  const next = current ? nextYearName(current.name) : null;
  const addYear = <FormModal title="New academic year" icon="calendar" fields={yearFields} action={createYear} />;

  return (
    <>
      <PageHeader eyebrow="Admin" title="Academic years" description="One year is current. At year end, roll forward to create the next year with its sections, then make it current."
        actions={canWrite ? <>
          {next ? <ActionButton action={rollForward} values={{ name: next }} label={`Roll forward to ${next}`} successMessage={`${next} created`}
            confirm={{ title: `Roll forward to ${next}?`, body: `Creates ${next} with Term 1 and Term 2 and copies every section of ${current!.name} into it (same class, name and seats). Class teachers and subject teachers are not copied. ${current!.name} stays current until you change it.`, confirmLabel: "Roll forward" }} /> : null}
          {addYear}
        </> : null} />
      <div className="flex flex-col gap-3">
        <DataTable
          columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} searchPlaceholder="Search years"
          empty={{ title: "No academic year yet.", description: "Add the first one. It becomes the current year.", action: canWrite ? addYear : undefined }}
          rowActions={canWrite ? Object.fromEntries(rows.map((r) => [r.id,
            <span key={r.id} className="inline-flex items-center gap-1">
              {r.isCurrent ? null : <ActionButton action={setCurrentYear} values={{ id: r.id }} variant="ghost" label={`Make ${r.name} current`} successMessage={`${r.name} is now current`}>Make current</ActionButton>}
              <RowActions what="year" icon="calendar" fields={yearFields} values={r} id={r.id} update={updateYear} remove={deleteYear}
                consequence={`${r.name} and its terms and sections will be removed, with everything that hangs off those sections.`} />
            </span>])) : undefined}
        />
        <Panel title="Terms" action={canWrite && yearOptions.length ? <FormModal title="New term" icon="calendar" fields={termCreateFields(yearOptions)} action={createTerm} /> : null}>
          <MiniList
            empty={{ title: "No terms yet.", description: "Terms split a year for exams and reports." }}
            items={termPage.rows.map((t) => ({
              id: t.id,
              title: `${t.name} · ${yearName.get(t.yearId) ?? ""}`,
              meta: `${shortDate(t.startsOn)} to ${shortDate(t.endsOn)}`,
              actions: canWrite ? <RowActions what="term" icon="calendar" fields={termFields} values={t} id={t.id} update={updateTerm} remove={deleteTerm}
                consequence={`${t.name} will be removed from the year.`} /> : null,
            }))} />
        </Panel>
      </div>
    </>
  );
}
