import { requireCtx } from "@smw/runtime";
import { Feed } from "./feed";
import { StaffList } from "./staff-list";
import type { Query } from "./shared";

export const metadata = { title: "Notices" };

/** /app/announcements: staff get the table with saved views, families get the feed. */
export default async function NoticesPage({ searchParams }: { searchParams: Promise<Query> }) {
  const [ctx, sp] = await Promise.all([requireCtx(), searchParams]);
  return ctx.role === "student" ? <Feed ctx={ctx} sp={sp} /> : <StaffList ctx={ctx} sp={sp} />;
}
