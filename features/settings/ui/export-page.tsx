import { requireCtx } from "@smw/runtime";
import { ExportService } from "../export-service";
import { ExportTab } from "./export-tab";
import { AdminOnly } from "./states";

export const metadata = { title: "Export your data" };

export default async function ExportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  if (!new ExportService(ctx).can("export")) return <AdminOnly title="Export your data" />;
  const { error } = await searchParams;
  return <ExportTab ctx={ctx} error={typeof error === "string" ? error.slice(0, 200) : undefined} />;
}
