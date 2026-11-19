import type { ReactNode } from "react";
import { listQueryFrom } from "@smw/feature-kit";
import { DESIGN_FLOW, DesignRequestService, type DesignStatus } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { DESIGN_LABELS, DESIGN_TONES, statusOptions } from "@/lib/tones";
import { moveDesignRequest } from "../actions";

export const metadata = { title: "Design requests" };

const columns: Column[] = [
  { key: "schoolName", label: "School" },
  { key: "kindLabel", label: "Kind", hideOnMobile: true },
  { key: "brief", label: "Brief", hideOnMobile: true },
  { key: "status", label: "Stage", type: "badge", tones: DESIGN_TONES, labels: DESIGN_LABELS },
  { key: "quotePaise", label: "Quote", type: "money" },
  { key: "createdAt", label: "Asked", type: "date", hideOnMobile: true },
];

const VERB: Partial<Record<DesignStatus, string>> = { paid: "Mark paid", in_progress: "Start work", in_review: "Send for review", delivered: "Mark delivered" };

export default async function DesignRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requireStaff();
  const page = await new DesignRequestService(staff).list(listQueryFrom(await searchParams));
  const canMove = staff.role !== "support";
  const rows = page.rows.map((r) => ({ ...r, kindLabel: r.kind === "custom_template" ? "Custom template" : "Custom styling" }));
  const actions: Record<string, ReactNode> = canMove ? Object.fromEntries(page.rows.map((r) => [r.id, (
    <span key={r.id} className="inline-flex items-center gap-1">
      {DESIGN_FLOW[r.status].map((to) => to === "quoted" ? (
        <FormModal key={to} title={r.status === "quoted" ? "Revise quote" : "Send quote"} icon="money" fields={[{ name: "quotePaise", label: "Quote", type: "money", required: true, hint: "Rupees, before GST." }]}
          values={{ quotePaise: r.quotePaise }} hidden={{ id: r.id, to }} action={moveDesignRequest} submitLabel="Save quote" trigger={{ label: r.status === "quoted" ? "Revise quote" : "Quote", variant: "ghost", size: "sm" }} />
      ) : to === "cancelled" ? (
        <ActionButton key={to} variant="ghost" action={moveDesignRequest} values={{ id: r.id, to }} label="Cancel"
          confirm={{ title: "Cancel this request?", body: `The request from ${r.schoolName} is closed. This cannot be undone.`, confirmLabel: "Cancel request", danger: true }} />
      ) : (
        <ActionButton key={to} variant="ghost" action={moveDesignRequest} values={{ id: r.id, to }} label={VERB[to] ?? DESIGN_LABELS[to]!} />
      ))}
    </span>
  )])) : {};

  return (
    <>
      <PageHeader eyebrow="Business" title="Design requests" description="Custom styling and templates, from the brief to delivery." />
      {/* relative + clip: the table's sr-only "Actions" header is absolutely positioned and would widen the page on phones */}
      <DataTable columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/schools/{schoolId}"
        filters={[{ key: "status", label: "Stage", options: statusOptions(DESIGN_LABELS) }]} rowActions={canMove ? actions : undefined}
        empty={{ title: "No design requests.", description: "Schools ask for custom work from their panel." }} />
    </>
  );
}
