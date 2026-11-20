import { notFound } from "next/navigation";
import { ForbiddenError, NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { PanelGrid } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { MenuIconView } from "@smw/ui/shell/icons";
import { ToneBadge, WidgetEmptyState, ROW_HOVER } from "@smw/ui/widgets/WidgetPrimitives";
import { shortDate } from "@smw/ui/format";
import { DOCUMENT_KINDS } from "../schema";
import { DOCUMENT_LABEL } from "../rules";
import { VehicleCareService } from "../vehicle-care";
import { addChecklistItem, addDocument, removeChecklistItem, removeDocument, toggleChecklistItem, updateDocument } from "./actions";
import { checklistItemFields, documentFields } from "./fields";

export const metadata = { title: "Vehicle" };

const KINDS = DOCUMENT_KINDS.map((k) => ({ value: k, label: DOCUMENT_LABEL[k] }));
const STATE = {
  expired: { label: "Expired", tone: "danger" },
  soon: { label: "Expires soon", tone: "warning" },
  valid: { label: "Valid", tone: "success" },
} as const;

export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const svc = new VehicleCareService(await requireCtx());
  const d = await svc.detail(id).catch((e) => { if (e instanceof NotFoundError || e instanceof ForbiddenError) notFound(); throw e; });
  const canManage = svc.can("manage");
  const { vehicle: v } = d;
  const done = d.checklist.filter((i) => i.ok).length;

  return (
    <>
      <EntityHeader
        back={{ href: "/app/transport/vehicles", label: "Vehicles" }}
        leading={<span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.06]"><MenuIconView name="bus" className="h-6 w-6" /></span>}
        title={v.registrationNo}
        chips={d.expired ? <ToneBadge label={`${d.expired} ${d.expired === 1 ? "paper" : "papers"} expired`} tone="danger" /> : <ToneBadge label="Papers in order" tone="success" />}
        meta={[v.kind === "bus" ? "Bus" : "Van", `${v.capacity} seats`, `${v.driverName}, ${v.driverPhone}`]}
      />
      <div className="h-8" />
      <PanelGrid>
        <div className="lg:col-span-7">
          <Panel title="Papers" action={canManage ? <FormModal title="Add paper" icon="bus" fields={documentFields(KINDS)} hidden={{ vehicleId: v.id }} values={{ kind: "fitness" }} action={addDocument} submitLabel="Add paper" trigger={{ label: "Add paper", variant: "secondary", size: "sm", plus: true }} /> : null}>
            {d.documents.length === 0 ? <WidgetEmptyState title="No papers recorded." description="Add the fitness certificate, insurance, permit and pollution papers. Admins are told 30 days and 7 days before each one expires." /> : (
              <ul className="flex flex-col">
                {d.documents.map((x) => (
                  <li key={x.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl px-2 py-3 ${ROW_HOVER}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{DOCUMENT_LABEL[x.kind]}{x.number ? ` · ${x.number}` : ""}</span>
                      <span className="block text-xs text-[var(--ds-on-surface-muted)]">
                        {x.state === "expired" ? `Expired ${shortDate(x.expiresOn)}` : `Valid until ${shortDate(x.expiresOn)}${x.days <= 30 ? ` (${x.days} ${x.days === 1 ? "day" : "days"} left)` : ""}`}
                      </span>
                    </span>
                    <ToneBadge label={STATE[x.state].label} tone={STATE[x.state].tone} />
                    {x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer" aria-label={`Open the ${DOCUMENT_LABEL[x.kind]} copy`} className="inline-flex h-10 items-center rounded-full bg-white/[0.06] px-3 text-xs hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">Copy</a> : null}
                    {canManage ? (
                      <span className="inline-flex items-center gap-1">
                        <FormModal title="Renew or edit paper" icon="bus" fields={documentFields(KINDS)} values={x} hidden={{ id: x.id, vehicleId: v.id }} action={updateDocument} trigger={{ label: "Renew", variant: "ghost", size: "sm" }} />
                        <ActionButton variant="icon-delete" label={`Remove the ${DOCUMENT_LABEL[x.kind]} paper`} action={removeDocument} values={{ id: x.id }}
                          confirm={{ title: "Remove this paper?", body: "The record and its uploaded copy are deleted.", confirmLabel: "Remove", danger: true }} />
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="lg:col-span-5">
          <Panel title="Safety checklist" action={<ToneBadge label={`${done} of ${d.checklist.length} · ${d.checklistPct}%`} tone={d.checklistPct === 100 ? "success" : d.checklistPct >= 60 ? "warning" : "danger"} />}>
            <ul className="flex flex-col">
              {d.checklist.map((i) => (
                <li key={i.label} className={`flex items-center gap-3 rounded-2xl px-2 py-2 ${ROW_HOVER}`}>
                  <span className="min-w-0 flex-1 truncate text-sm">{i.label}</span>
                  {canManage ? (
                    <>
                      <ActionButton variant={i.ok ? "default" : "secondary"} label={`${i.label}: ${i.ok ? "fitted, tap to undo" : "not fitted, tap to mark fitted"}`} action={toggleChecklistItem} values={{ vehicleId: v.id, label: i.label }}>{i.ok ? "Yes" : "No"}</ActionButton>
                      <ActionButton variant="icon-delete" label={`Remove ${i.label} from the checklist`} action={removeChecklistItem} values={{ vehicleId: v.id, label: i.label }}
                        confirm={{ title: "Remove this item?", body: `${i.label} will no longer be checked on this vehicle.`, confirmLabel: "Remove", danger: true }} />
                    </>
                  ) : <ToneBadge label={i.ok ? "Yes" : "No"} tone={i.ok ? "success" : "default"} />}
                </li>
              ))}
            </ul>
            {canManage ? <div className="pt-3"><FormModal title="Add checklist item" icon="bus" fields={checklistItemFields} hidden={{ vehicleId: v.id }} action={addChecklistItem} submitLabel="Add" trigger={{ label: "Add item", variant: "ghost", size: "sm", plus: true }} /></div> : null}
          </Panel>
        </div>

        <div className="lg:col-span-12">
          <Panel title="Details">
            <FactList>
              <Fact label="Driver">{`${v.driverName}, ${v.driverPhone}`}</Fact>
              <Fact label="Attendant">{v.attendantName}</Fact>
              <Fact label="GPS device">{v.gpsDeviceId}</Fact>
              <Fact label="Tracking link">{v.trackingUrl ? <a href={v.trackingUrl} target="_blank" rel="noopener noreferrer" className="break-all underline-offset-2 hover:underline">{v.trackingUrl}</a> : null}</Fact>
              <Fact label="Runs on">{d.routes.map((r) => r.name).join(", ") || null}</Fact>
            </FactList>
          </Panel>
        </div>
      </PanelGrid>
    </>
  );
}
