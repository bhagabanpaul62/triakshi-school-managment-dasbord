import { notFound } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { SelfList } from "./self-list";
import { TeacherList } from "./teacher-list";

export const metadata = { title: "Assignments" };

/** /app/assignments: staff manage, students follow. The role decides the view; the services decide what is allowed. */
export default async function AssignmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  if (ctx.role === "student") return <SelfList ctx={ctx} />;
  if (ctx.role === "admin" || ctx.role === "teacher") return <TeacherList ctx={ctx} searchParams={await searchParams} />;
  notFound();
}
