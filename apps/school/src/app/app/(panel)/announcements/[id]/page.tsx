import { withSchool } from "@smw/db";
import NoticePage, { metadata } from "@smw/feature-announcements/ui/detail-page";
import { eventsForConsent } from "@smw/feature-events/consent";
import { requireCtx } from "@smw/runtime";

export { metadata };

/** The notice page, with the trips whose consent it is: announcements and events never import each other, so the route joins them. */
export default async function Page(props: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [ctx, { id }] = await Promise.all([requireCtx(), props.params]);
  const related = ctx.features.has("events") && !ctx.supportStaffId ? await withSchool(ctx.schoolId, (tx) => eventsForConsent(tx, `/app/announcements/${id}`)).catch(() => []) : [];
  return <NoticePage {...props} related={related} />;
}
