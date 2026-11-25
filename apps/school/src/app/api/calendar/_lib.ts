import { AppError, type Ctx } from "@smw/feature-kit";
import { buildCalendar, calendarEtag, eventItem, layerItem } from "@smw/feature-events/ics";
import { EventService } from "@smw/feature-events/service";
import { calendarItems, layersFor } from "@/lib/calendar-layers";

export const hostOf = (req: Request) => req.headers.get("host") ?? new URL(req.url).host;
const DAY = 86_400_000;

/** A secret link says only "not found" for anything wrong with it: no hint whether a token ever existed. */
export const gone = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** Errors from a signed-in route: the person sees the plain reason; anything unexpected is logged and hidden. */
export function failure(err: unknown): Response {
  if (err instanceof AppError) return new Response(err.message, { status: err.status, headers: { "Cache-Control": "no-store" } });
  console.error(JSON.stringify({ level: "error", msg: "calendar route failed", err: String(err) }));
  return new Response("Something went wrong.", { status: 500, headers: { "Cache-Control": "no-store" } });
}

/** The body with an ETag. A phone that already has these bytes gets 304 and no body. */
export function calendarResponse(req: Request, body: string, o: { cache: string; filename: string; attachment?: boolean }): Response {
  const etag = calendarEtag(body);
  const headers = { ETag: etag, "Cache-Control": o.cache, "Content-Disposition": `${o.attachment ? "attachment" : "inline"}; filename="${o.filename}"` };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers: { ...headers, "Content-Type": "text/calendar; charset=utf-8" } });
}

/** One person's calendar: every event they may see (drafts left out) and every other layer they may see, titles and times only. */
export async function personalCalendar(ctx: Ctx, host: string, name: string): Promise<string> {
  const from = new Date(Date.now() - 30 * DAY), to = new Date(Date.now() + 400 * DAY);
  const [events, layers] = await Promise.all([
    ctx.features.has("events") ? new EventService(ctx).range(from, to, { drafts: false }) : [],
    calendarItems(ctx, from, to, layersFor(ctx).filter((l) => l !== "events")),
  ]);
  return buildCalendar([...events.map((e) => eventItem(e, host)), ...layers.map((i) => layerItem(i, host, new Date(i.startsAt)))], { name: `${name} calendar` });
}
