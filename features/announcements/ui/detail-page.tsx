import { notFound } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { PushPrompt } from "@smw/feature-notifications/ui/push-prompt";
import { FamilyRecord } from "./family-record";
import { StaffRecord } from "./record";
import { one, type Query, type Related } from "./shared";

export const metadata = { title: "Notice" };

/**
 * /app/announcements/[id]: families (and staff it was sent to) read and answer; the author, approvers and admins manage.
 * `related` is what the app found that points back at this notice (a trip it is the consent for): features do not import each other, the route joins them.
 */
export default async function NoticePage({ params, searchParams, related = [] }: { params: Promise<{ id: string }>; searchParams: Promise<Query>; related?: Related[] }) {
  const [ctx, { id }, sp] = await Promise.all([requireCtx(), params, searchParams]);
  if (ctx.role === "parent") notFound();
  return (
    <>
      {ctx.role === "student" ? <FamilyRecord ctx={ctx} id={id} lang={one(sp.lang)} related={related} /> : <StaffRecord ctx={ctx} id={id} sp={sp} related={related} />}
      {ctx.supportStaffId ? null : <div className="max-w-3xl pt-4"><PushPrompt /></div>}
    </>
  );
}
