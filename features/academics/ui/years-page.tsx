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
import { addDefaultTerms, createTerm, createYear, deleteTerm, deleteYear, rollForward, setCurrentYear, updateTerm, updateYear } from "./actions";
import { STATUS_LABELS, rolloverFields, termCreateFields, termFields, yearFields } from "./fields";
import { MiniList } from "./mini-list";
import { RowActions } from "./row-actions";

export const metadata = { title: "Academic years" };

const columns: Column[] = [
  { key: "name", label: "Year" },
  { key: "startsOn", label: "Starts", type: "date" },
  { key: "endsOn", label: "Ends", type: "date" },
  { key: "phase", label: "Status", type: "badge", tones: { Current: "success", Upcoming: "info", Planning: "info", Closed: "warning" } },
];

export default async function YearsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const years = new AcademicYearService(ctx);
  const [page, current, yearOptions, termPage] = await Promise.all([
    years.list({ ...listQueryFrom(await searchParams), sort: "startsOn", dir: "desc" }),
    years.current(),
    years.options(),
    new TermService(ctx).list({ pageSize: 100, sort: "sortOrder", dir: "asc" }),
  ]);
  const canWrite = years.can("manage");
  const today = new Date().toISOString().slice(0, 10);
  const rows = page.rows.map((y) => ({ ...y, phase: y.status === "closed" ? "Closed" : y.isCurrent ? "Current" : y.status === "planning" ? "Planning" : y.startsOn > today ? "Upcoming" : "Past" }));
  const yearName = new Map(yearOptions.map((y) => [y.value, y.label]));
  const next = current ? nextYearName(current.name) : null;
  const addYear = <FormModal title="New academic year" icon="calendar" fields={yearFields} action={createYear} />;

  return (
    <>
      <PageHeader eyebrow="Admin" title="Academic years" description="One year is current. At year end, roll forward to create the next year with its sections, then make it current."
        actions={canWrite ? <>
          {next ? <FormModal title={`Roll forward to ${next}`} icon="calendar" fields={rolloverFields(next)} action={rollForward} values={{ name: next, copyTeachers: true }} submitLabel="Roll forward"
            trigger={{ label: `Roll forward to ${next}`, variant: "secondary", plus: false }} successMessage={`${next} created`}
            description={`Creates the new year with Term 1 and Term 2 and copies every section of ${current!.name} (same class, name and seats). ${current!.name} stays current until you change it.`} /> : null}
          {addYear}
        </> : null} />
      <div className="flex flex-col gap-3">
        <DataTable
          columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} searchPlaceholder="Search years"
          filters={[{ key: "status", label: "Status", options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })) }]}
          empty={{ title: "No academic year yet.", description: "Add the first one. It becomes the current year.", action: canWrite ? addYear : undefined }}
          rowActions={canWrite ? Object.fromEntries(rows.map((r) => [r.id,
            <span key={r.id} className="inline-flex items-center gap-1">
              {r.isCurrent || r.status === "closed" ? null : <ActionButton action={setCurrentYear} values={{ id: r.id }} variant="ghost" label={`Make ${r.name} current`} successMessage={`${r.name} is now current`}>Make current</ActionButton>}
              <RowActions what="year" icon="calendar" fields={yearFields} values={r} id={r.id} update={updateYear} remove={deleteYear}
                consequence={`${r.name} with its terms and sections will be removed. A year with exams, fees, enrolments or attendance can't be deleted: close it instead.`} />
            </span>])) : undefined}
        />
        <Panel title="Terms" action={canWrite && yearOptions.length ? <span className="inline-flex items-center gap-2">
          {current ? <ActionButton action={addDefaultTerms} values={{ id: current.id }} label={`Add default terms to ${current.name}`} successMessage="Default terms added">Add default terms</ActionButton> : null}
          <FormModal title="New term" icon="calendar" fields={termCreateFields(yearOptions)} action={createTerm} />
        </span> : null}>
          <MiniList
            empty={{ title: "No terms yet.", description: "Terms split a year for exams and reports." }}
            items={termPage.rows.map((t) => ({
              id: t.id,
              title: `${t.name} · ${yearName.get(t.yearId) ?? ""}`,
              meta: `${shortDate(t.startsOn)} to ${shortDate(t.endsOn)}`,
              actions: canWrite ? <RowActions what="term" icon="calendar" fields={termFields} values={t} id={t.id} update={updateTerm} remove={deleteTerm}
                consequence={`${t.name} will be removed from the year. A term with exam results can't be deleted.`} /> : null,
            }))} />
        </Panel>
      </div>
    </>
  );
}
