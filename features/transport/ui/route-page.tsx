import { requireCtx } from "@smw/runtime";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { TickBar } from "@smw/ui/kit/TickBar";
import { KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { MenuIconView } from "@smw/ui/shell/icons";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { ROW_HOVER } from "@smw/ui/tone";
import { paise } from "@smw/ui/format";
import { buttonVariants } from "@smw/ui/ui/button";
import { clock12, occupancyTone } from "../rules";
import { RouteService, StudentTransportService, VehicleService } from "../service";
import { addStop, assignStudent, deleteRoute, removeStop, sendRouteNotice, unassignStudent, updateRoute, updateStop } from "./actions";
import { assignFields, noticeFields, routeFields, stopFields } from "./fields";

export const metadata = { title: "Route" };

export default async function RoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const routes = new RouteService(ctx);
  const [detail, roster, vehicles] = await Promise.all([routes.detail(id), new StudentTransportService(ctx).roster(id), new VehicleService(ctx).options()]);
  const canManage = routes.can("manage");
  const { route, vehicle, stops } = detail;
  const unassigned = canManage && stops.length ? await new StudentTransportService(ctx).unassigned() : [];
  const full = vehicle ? detail.riders >= vehicle.capacity : false;

  return (
    <>
      <EntityHeader
        back={{ href: "/app/transport", label: "Transport" }}
        leading={<span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.06]"><MenuIconView name="bus" className="h-6 w-6" /></span>}
        title={route.name}
        chips={vehicle ? <ToneBadge label={`${vehicle.registrationNo} · ${vehicle.kind}`} /> : <ToneBadge label="No vehicle yet" tone="warning" />}
        meta={[`Morning ${clock12(route.morningStart)}`, `Evening ${clock12(route.eveningStart)}`, vehicle ? `${vehicle.driverName}, ${vehicle.driverPhone}` : null]}
        actions={<>
          <a href={`/app/transport/routes/${route.id}/roster`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Print route list</a>
          {canManage ? <>
            <FormModal title="Send notice" icon="bus" description={`Goes to the ${detail.riders} students on this route, in the app and by email.`} fields={noticeFields} hidden={{ routeId: route.id }} action={sendRouteNotice} submitLabel="Send notice" trigger={{ label: "Send notice", variant: "secondary" }} />
            <FormModal title="Edit route" icon="bus" fields={routeFields(vehicles)} values={route} hidden={{ id: route.id }} action={updateRoute} trigger={{ label: "Edit", variant: "secondary" }} />
            <ActionButton variant="icon-delete" label="Delete route" action={deleteRoute} values={{ id: route.id }} redirectTo="/app/transport"
              confirm={{ title: "Delete this route?", body: `${route.name} and its ${stops.length} stops will be removed. This cannot be undone.`, confirmLabel: "Delete", danger: true }} />
          </> : null}
        </>}
      />
      <div className="h-8" />
      <KpiRow>
        <StatCard label="Students" value={String(detail.riders)} icon={<MenuIconView name="users" />} />
        <StatCard label="Seats" value={vehicle ? String(vehicle.capacity) : "-"} icon={<MenuIconView name="bus" />}
          meta={vehicle ? undefined : "Choose a vehicle to track seats"}
          viz={vehicle ? <div className="w-24"><TickBar value={detail.pct} tone={occupancyTone(detail.pct)} /></div> : undefined} />
        <StatCard label="Seats free" value={vehicle ? String(Math.max(0, vehicle.capacity - detail.riders)) : "-"} icon={<MenuIconView name="check" />} />
        <StatCard label="Stops" value={String(stops.length)} icon={<MenuIconView name="class" />} />
      </KpiRow>

      <PanelGrid>
        <div className="lg:col-span-5">
          <Panel title="Stops" action={canManage ? <FormModal title="Add stop" icon="bus" fields={stopFields(true)} hidden={{ routeId: route.id }} action={addStop} submitLabel="Add stop" trigger={{ label: "Add stop", variant: "secondary", size: "sm", plus: true }} /> : null}>
            {stops.length === 0 ? <WidgetEmptyState title="No stops yet." description="Add the stops in the order the vehicle visits them." /> : (
              <ol className="flex flex-col">
                {stops.map((s) => (
                  <li key={s.id} className={`flex items-center gap-3 rounded-2xl px-2 py-3 ${ROW_HOVER}`}>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-xs tabular-nums">{s.sequence}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm" title={s.name}>{s.name}</span>
                      <span className="block text-xs text-[var(--ds-on-surface-muted)]">{clock12(s.morningTime)} morning · {clock12(s.eveningTime)} evening · {paise(s.monthlyFeePaise)}/mo · {s.riders} riding</span>
                    </span>
                    {canManage ? (
                      <span className="inline-flex items-center gap-1">
                        <FormModal title="Edit stop" icon="bus" fields={stopFields(false)} values={s} hidden={{ id: s.id }} action={updateStop} trigger={{ label: "Edit", variant: "ghost", size: "sm" }} />
                        <ActionButton variant="icon-delete" label={`Remove ${s.name}`} action={removeStop} values={{ id: s.id }}
                          confirm={{ title: "Remove this stop?", body: `${s.name} will be taken off the route.`, confirmLabel: "Remove", danger: true }} />
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="lg:col-span-7">
          <Panel title={`Students (${roster.length})`} action={canManage && stops.length ? (
            full ? <ToneBadge label={`Full: ${detail.riders} of ${vehicle!.capacity} seats`} tone="warning" /> :
            unassigned.length === 0 ? <ToneBadge label="Every student has a seat" tone="success" /> :
            <FormModal title="Add student" icon="users" fields={assignFields(unassigned, stops)} hidden={{ routeId: route.id }} values={{ pickup: true, drop: true }} action={assignStudent} submitLabel="Add to route"
              summary={vehicle ? `${vehicle.capacity - detail.riders} of ${vehicle.capacity} seats free on ${vehicle.registrationNo}` : "No vehicle yet, so seats are not limited"}
              trigger={{ label: "Add student", variant: "secondary", size: "sm", plus: true }} />
          ) : null}>
            {roster.length === 0 ? <WidgetEmptyState title="Nobody rides this route yet." description={!stops.length ? "Add the stops first, then the students." : canManage ? "Use Add student and pick where they board." : "Nobody has been added yet."} /> : (
              <ul className="flex flex-col">
                {roster.map((r) => (
                  <li key={r.assignmentId} className={`flex items-center gap-3 rounded-2xl px-2 py-3 ${ROW_HOVER}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm" title={r.name}>{r.name}</span>
                      <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{[r.classLabel, r.stopName].filter(Boolean).join(" · ")}</span>
                      {r.parentPhone ? <a href={`tel:${r.parentPhone}`} className="inline-flex min-h-6 items-center text-xs text-[var(--ds-on-surface-variant)] underline-offset-2 hover:underline">Parent: {r.parentPhone}</a> : null}
                    </span>
                    <ToneBadge label={r.trip} tone={r.pickup && r.drop ? "default" : "info"} />
                    {canManage ? (
                      <ActionButton variant="icon-delete" label={`Remove ${r.name} from transport`} action={unassignStudent} values={{ studentId: r.studentId }}
                        confirm={{ title: "Remove from transport?", body: `${r.name} will no longer ride ${route.name}.`, confirmLabel: "Remove", danger: true }} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </PanelGrid>
    </>
  );
}
