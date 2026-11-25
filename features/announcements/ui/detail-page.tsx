import { notFound } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { FamilyRecord } from "./family-record";
import { StaffRecord } from "./record";
import { one, type Query } from "./shared";

export const metadata = { title: "Notice" };

/** /app/announcements/[id]: families (and staff it was sent to) read and answer; the author, approvers and admins manage. */
export default async function NoticePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const [ctx, { id }, sp] = await Promise.all([requireCtx(), params, searchParams]);
  if (ctx.role === "parent") notFound();
  return ctx.role === "student" ? <FamilyRecord ctx={ctx} id={id} lang={one(sp.lang)} /> : <StaffRecord ctx={ctx} id={id} sp={sp} />;
}
