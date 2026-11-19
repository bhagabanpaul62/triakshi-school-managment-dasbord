import { listQueryFrom } from "@smw/feature-kit";
import { PlanAdminService, SchoolAdminService } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { createSchool } from "../actions";
import { SCHOOL_LABELS, SCHOOL_TONES, statusOptions } from "@/lib/tones";
import { createSchoolFields } from "./fields";

export const metadata = { title: "Schools" };

const columns: Column[] = [
  { key: "name", label: "School", type: "person", metaKey: "where" },
  { key: "status", label: "Status", type: "badge", tones: SCHOOL_TONES, labels: SCHOOL_LABELS },
  { key: "planName", label: "Plan", hideOnMobile: true },
  { key: "students", label: "Students" },
  { key: "trialEndsAt", label: "Trial ends", type: "date", hideOnMobile: true },
  { key: "createdAt", label: "Joined", type: "date", hideOnMobile: true },
];

export default async function SchoolsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requireStaff();
  const [page, plans] = await Promise.all([new SchoolAdminService(staff).list(listQueryFrom(await searchParams)), new PlanAdminService(staff).list()]);
  const latest = plans.filter((p) => p.isLatest);
  const rows = page.rows.map((s) => ({ ...s, where: [s.slug, s.city].filter(Boolean).join(" · "), students: `${s.studentCount} / ${s.studentCap}` }));
  const create = <FormModal title="New school" icon="class" fields={createSchoolFields(latest.filter((p) => p.isActive).map((p) => ({ id: p.id, label: `${p.name} (up to ${p.studentCap})` })))}
    action={createSchool} submitLabel="Create school" summary="Starts a trial and emails the administrator." />;

  return (
    <>
      <PageHeader eyebrow="Platform" title="Schools" description="Every school on Triakshi." actions={staff.role === "support" ? null : create} />
      <DataTable columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/schools/{id}"
        searchPlaceholder="Search by name, address or city"
        filters={[
          { key: "status", label: "Status", options: statusOptions(SCHOOL_LABELS) },
          { key: "plan", label: "Plan", options: latest.map((p) => ({ value: p.key, label: p.name })) },
        ]}
        empty={{ title: "No schools match.", description: "Clear the filters or create a school.", action: staff.role === "support" ? undefined : create }} />
    </>
  );
}
