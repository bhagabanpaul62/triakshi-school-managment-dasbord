import Link from "next/link";
import { redirect } from "next/navigation";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { GuardianService } from "../service";

export const metadata = { title: "Parents" };

const columns: Column[] = [
  { key: "name", label: "Parent", type: "person", metaKey: "phone" },
  { key: "relation", label: "Relation", type: "badge", hideOnMobile: true },
  { key: "childCount", label: "Children", type: "number" },
];

export default async function ParentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new GuardianService(ctx);
  if (!svc.can("read")) redirect("/app/students");
  const page = await svc.listParents(listQueryFrom(await searchParams));
  const rows = page.rows.map((r) => ({ ...r, childCount: r.children.length }));

  return (
    <>
      <PageHeader eyebrow="People" title="Parents" description="Parent logins and the children linked to each. Add a guardian from a student's record." />
      <DataTable
        columns={columns}
        rows={rows}
        total={page.total}
        page={page.page}
        pageCount={page.pageCount}
        searchPlaceholder="Search by name or phone"
        empty={{ title: "No parents yet.", description: "Parents appear here when you add a guardian to a student or import a CSV." }}
        rowActions={Object.fromEntries(rows.map((r) => [r.id, (
          <span key={r.id} className="inline-flex max-w-[22rem] flex-wrap justify-end gap-1.5" aria-label={`Children of ${r.name}`}>
            {r.children.map((c) => (
              <Link key={c.id} href={`/app/students/${c.id}`} className="inline-flex min-h-10 items-center rounded-full bg-white/[0.07] px-4 text-xs text-[var(--ds-on-surface)] transition-colors hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
                {c.name}{c.classSection ? ` · ${c.classSection}` : ""}
              </Link>
            ))}
          </span>
        )]))}
      />
    </>
  );
}
