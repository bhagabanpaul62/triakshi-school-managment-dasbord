import { Panel } from "@smw/ui/kit/Panel";
import { BigStat, StatGroup } from "@smw/ui/kit/BigStat";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { buttonVariants } from "@smw/ui/ui/button";
import { paise } from "@smw/ui/format";
import { clock12 } from "../rules";
import type { StudentTransportService } from "../service";

type Mine = Awaited<ReturnType<StudentTransportService["mine"]>>;

/** Student and parent view: when and where the bus comes, who drives it, and one tap to call. Built for a phone. */
export function MyTransport({ rows }: { rows: Mine }) {
  if (!rows.length) return <WidgetEmptyState title="No school transport yet." description="If your child needs the school bus, ask the school office to add them to a route and stop." />;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {rows.map((r) => (
        <Panel key={r.studentId} title={r.studentName} action={<ToneBadge label={r.trip} tone="info" />}>
          <div className="flex flex-col gap-5">
            <StatGroup columns={2}>
              <BigStat label="Morning pickup" value={r.pickup ? clock12(r.morningTime) : "-"} hint={r.pickup ? `at ${r.stopName}` : "Not on this trip"} size="lg" />
              <BigStat label="Evening drop" value={r.drop ? clock12(r.eveningTime) : "-"} hint={r.drop ? `at ${r.stopName}` : "Not on this trip"} size="lg" />
            </StatGroup>
            <FactList>
              <Fact label="Route">{r.routeName}</Fact>
              <Fact label="Boarding stop">{r.stopName}</Fact>
              <Fact label="Vehicle">{r.vehicle ?? "Not decided yet"}</Fact>
              <Fact label="Driver">{r.driverName ?? "Not decided yet"}</Fact>
              <Fact label="Monthly fee">{r.feePaise ? `${paise(r.feePaise)} a month` : "-"}</Fact>
            </FactList>
            {r.driverPhone ? <a href={`tel:${r.driverPhone}`} className={buttonVariants({ variant: "secondary", className: "h-11 w-full rounded-full sm:w-fit" })}>Call driver, {r.driverPhone}</a> : null}
          </div>
        </Panel>
      ))}
    </div>
  );
}
