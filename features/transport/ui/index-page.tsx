import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader, KpiRow } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { MenuIconView } from "@smw/ui/shell/icons";
import { StatCard } from "@smw/ui/kit/StatCard";
import { TickBar } from "@smw/ui/kit/TickBar";
import { ArrowButton, Panel } from "@smw/ui/kit/Panel";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { buttonVariants } from "@smw/ui/ui/button";
import { clock12, occupancyTone } from "../rules";
import { RouteService, StudentTransportService, VehicleService } from "../service";
import { createRoute } from "./actions";
import { routeFields } from "./fields";
import { MyTransport } from "./my-transport";

export const metadata = { title: "Transport" };

export default async function TransportPage() {
  const ctx = await requireCtx();
  const routesSvc = new RouteService(ctx);

  if (!routesSvc.can("read")) {
    return (
      <>
        <PageHeader eyebrow="People" title="School transport" description="Your route, stop and timings." />
        <MyTransport rows={await new StudentTransportService(ctx).mine()} />
      </>
    );
  }

  const [overview, vehicles] = await Promise.all([routesSvc.overview(), new VehicleService(ctx).options()]);
  const canManage = routesSvc.can("manage");
  const riders = overview.reduce((a, r) => a + r.riders, 0);
  const seats = overview.reduce((a, r) => a + (r.vehicle?.capacity ?? 0), 0);
  const addRoute = canManage ? <FormModal title="New route" icon="bus" fields={routeFields(vehicles)} action={createRoute} submitLabel="Add route" /> : null;

  return (
    <>
      <PageHeader eyebrow="People" title="Transport" description="Routes, vehicles and who rides where."
        actions={<>
          <Link href="/app/transport/vehicles" className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Vehicles</Link>
          {addRoute}
        </>} />
      <KpiRow>
        <StatCard label="Routes" value={String(overview.length)} icon={<MenuIconView name="bus" />} />
        <StatCard label="Vehicles" value={String(vehicles.length)} icon={<MenuIconView name="bus" />} href="/app/transport/vehicles" />
        <StatCard label="Students riding" value={riders.toLocaleString("en-IN")} icon={<MenuIconView name="users" />} />
        <StatCard label="Seats free" value={String(Math.max(0, seats - riders))} icon={<MenuIconView name="check" />} meta={`of ${seats} on routes with a vehicle`} />
      </KpiRow>
      {overview.length === 0 ? (
        <WidgetEmptyState title="No routes yet." description={canManage ? "Use New route above, then add its stops and the students who ride." : "The school office has not set up routes yet."} />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {overview.map(({ route, vehicle, riders: n, stops, pct }) => (
            <Panel key={route.id} title={route.name} action={<ArrowButton href={`/app/transport/routes/${route.id}`} label={`Open ${route.name}`} />}>
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--ds-on-surface-variant)]">
                  {vehicle ? <ToneBadge label={`${vehicle.registrationNo} · ${vehicle.kind}`} /> : <ToneBadge label="No vehicle yet" tone="warning" />}
                  <span>{stops} stops</span><span aria-hidden>·</span>
                  <span>{clock12(route.morningStart)} / {clock12(route.eveningStart)}</span>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[26px] font-medium tabular-nums tracking-tight">{n}</span>
                    <span className="text-xs text-[var(--ds-on-surface-muted)]">{vehicle ? `of ${vehicle.capacity} seats · ${Math.max(0, vehicle.capacity - n)} free` : n === 1 ? "student" : "students"}</span>
                  </div>
                  {vehicle ? <TickBar value={pct} tone={occupancyTone(pct)} /> : null}
                </div>
                {vehicle && pct >= 85 ? <ToneBadge label={pct >= 100 ? "Full: no more students" : "Nearly full"} tone={occupancyTone(pct)} /> : null}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
