import { notFound } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { SelfDetail } from "./self-detail";
import { TeacherDetail } from "./teacher-detail";

export const metadata = { title: "Assignment" };

/** /app/assignments/[id]: the brief and grading for staff, the brief and hand-in for students and parents. */
export default async function AssignmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [ctx, { id }] = await Promise.all([requireCtx(), params]);
  if (ctx.role === "student" || ctx.role === "parent") return <SelfDetail ctx={ctx} id={id} />;
  if (ctx.role === "admin" || ctx.role === "teacher") return <TeacherDetail ctx={ctx} id={id} searchParams={await searchParams} />;
  notFound();
}
