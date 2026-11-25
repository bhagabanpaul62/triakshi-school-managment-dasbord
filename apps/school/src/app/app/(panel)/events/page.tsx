import { allows } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { refusalOr } from "@smw/runtime/refusal";
import attendanceFeature from "@smw/feature-attendance/feature";
import { LAYERS, type LayerKey } from "@smw/feature-events/constants";
import { istDay, parseIst, viewRange, type CalendarView } from "@smw/feature-events/dates";
import { CalendarFeedService } from "@smw/feature-events/feed";
import { EventService } from "@smw/feature-events/service";
import { CalendarPage } from "@smw/feature-events/ui/calendar-page";
import { calendarItems, defaultLayers, layersFor } from "@/lib/calendar-layers";

export const metadata = { title: "Calendar" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const when = (d: Date) => d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const VIEWS: CalendarView[] = ["agenda", "month", "week", "year"];

/** The view, the day and the layers are in the address, so a link shows exactly what the sender saw. */
async function CalendarRoute({ searchParams }: { searchParams: SearchParams }) {
  const p = await searchParams;
  const ctx = await requireCtx();
  const today = istDay(new Date());
  const view = VIEWS.find((v) => v === one(p.view)) ?? "agenda";
  const asked = one(p.date);
  const anchor = asked && parseIst(asked) ? asked : today;
  const layers = layersFor(ctx);
  const layerParam = one(p.layers);
  const chosen = layerParam ? layerParam.split(",").filter((l: string): l is LayerKey => l in LAYERS && layers.includes(l as LayerKey)) : defaultLayers(ctx);
  const { from, to } = viewRange(view, anchor);
  const events = new EventService(ctx);
  const [items, phone] = await Promise.all([calendarItems(ctx, from, to, chosen), new CalendarFeedService(ctx).mine()]);
  return (
    <CalendarPage items={items} view={view} anchor={anchor} today={today} layers={layers} chosen={chosen} defaults={defaultLayers(ctx)} canAdd={events.can("write")}
      holidays={allows(ctx, attendanceFeature, "manage") ? "add" : ctx.features.has("attendance") && allows(ctx, attendanceFeature, "read") ? "view" : null}
      phone={{ active: phone.active, made: phone.madeAt ? when(phone.madeAt) : null, lastUsed: phone.lastUsedAt ? when(phone.lastUsedAt) : null }} />
  );
}

export default function Page(props: Parameters<typeof CalendarRoute>[0]) { return refusalOr(() => CalendarRoute(props)); }
