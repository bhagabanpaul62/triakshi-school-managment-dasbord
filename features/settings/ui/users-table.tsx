"use client";

import { useRouter } from "next/navigation";
import { SelectableTable } from "@smw/ui/finance/SelectableTable";
import { DataTable, type DataTableProps } from "@smw/ui/shell/DataTable";
import { toast } from "@smw/ui/shell/toast";
import type { FormResult } from "@smw/ui/shell/FormModal";

/** The users list with a checkbox on every row and the bulk bar: resend invites, sign out, disable. Each person is checked on their own and the ones that could not be done are named. */
export function UsersTable({ bulk, canAct, ...table }: Omit<DataTableProps, "rowActions" | "leading" | "toolbar"> & { bulk: (fd: FormData) => Promise<FormResult>; canAct: boolean; toolbar?: React.ReactNode }) {
  const router = useRouter();
  const run = (action: "resend" | "disable" | "signout", past: string) => async (ids: string[]) => {
    const fd = new FormData();
    fd.set("action", action);
    for (const id of ids) fd.append("ids", id);
    const r = await bulk(fd);
    if (!r.ok) { toast(r.error, "danger"); return; }
    const { done, skipped } = r.data as { done: number; skipped: { name: string; why: string }[] };
    toast(`${done} ${past}.${skipped.length ? ` Not done: ${skipped.slice(0, 3).map((s) => `${s.name} (${s.why})`).join("; ")}${skipped.length > 3 ? ` and ${skipped.length - 3} more` : ""}.` : ""}`, skipped.length && !done ? "danger" : "default");
    router.refresh();
  };
  if (!canAct) return <DataTable {...table} />;
  return (
    <SelectableTable {...table} noun="person" bulkActions={[
      { label: "Send invite again", run: run("resend", "invited again") },
      { label: "Sign out", run: run("signout", "signed out") },
      { label: "Disable", tone: "danger", run: run("disable", "disabled") },
    ]} />
  );
}
