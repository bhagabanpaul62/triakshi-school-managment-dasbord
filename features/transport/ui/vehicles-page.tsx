import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { VehicleService } from "../service";
import { createVehicle, deleteVehicle, updateVehicle } from "./actions";
import { vehicleFields } from "./fields";

export const metadata = { title: "Vehicles" };

const columns: Column[] = [
  { key: "registrationNo", label: "Vehicle", type: "mono" },
  { key: "kind", label: "Type", type: "badge", labels: { bus: "Bus", van: "Van" } },
  { key: "capacity", label: "Seats", type: "number" },
  { key: "driverName", label: "Driver", type: "person", metaKey: "driverPhone" },
  { key: "routeNames", label: "Runs on", hideOnMobile: true },
  { key: "papers", label: "Papers", type: "badge", tones: { OK: "success", Expired: "danger" }, hideOnMobile: true },
];

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new VehicleService(ctx);
  const page = await svc.listDetailed(listQueryFrom(await searchParams));
  const canManage = svc.can("manage");
  const add = canManage ? <FormModal title="Add vehicle" icon="bus" fields={vehicleFields} action={createVehicle} submitLabel="Add vehicle" values={{ kind: "bus" }} /> : null;

  return (
    <>
      <PageHeader eyebrow="Transport" title="Vehicles" description="Buses and vans with their drivers." actions={add} />
      <DataTable
        columns={columns} rowHref="/app/transport/vehicles/{id}" rows={page.rows} total={page.total} page={page.page} pageCount={page.pageCount}
        searchPlaceholder="Search by number or driver"
        filters={[{ key: "kind", label: "Type", options: [{ value: "bus", label: "Bus" }, { value: "van", label: "Van" }] }]}
        empty={{ title: "No vehicles yet.", description: "Add the buses and vans your school runs.", action: add ?? undefined }}
        rowActions={canManage ? Object.fromEntries(page.rows.map((r) => [r.id, (
          <span key={r.id} className="inline-flex items-center gap-1">
            <FormModal title="Edit vehicle" icon="bus" fields={vehicleFields} values={r} hidden={{ id: r.id }} action={updateVehicle} trigger={{ label: "Edit", variant: "ghost", size: "sm" }} />
            <ActionButton variant="icon-delete" label={`Delete ${r.registrationNo}`} action={deleteVehicle} values={{ id: r.id }}
              confirm={{ title: "Delete this vehicle?", body: `${r.registrationNo} will be removed. This cannot be undone.`, confirmLabel: "Delete", danger: true }} />
          </span>
        )])) : undefined}
      />
    </>
  );
}
