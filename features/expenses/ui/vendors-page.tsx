import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { buttonVariants } from "@smw/ui/ui/button";
import type { Column } from "@smw/ui/shell/DataTable";
import { DataTable } from "@smw/ui/shell/DataTable";
import { LookupService, VendorService } from "../service";
import { saveVendor } from "./actions";
import { vendorFields } from "./vendor-fields";
import { NoAccess, Notice, SectionNav, can, one, safeNext, type Search } from "./shared";

export const metadata = { title: "Vendors" };

const columns: Column[] = [
  { key: "name", label: "Vendor", type: "person", metaKey: "meta" }, { key: "gstin", label: "GSTIN", type: "mono", hideOnMobile: true }, { key: "tds", label: "TDS", type: "number", hideOnMobile: true },
  { key: "bank", label: "Pay by", hideOnMobile: true }, { key: "owedPaise", label: "Owed", type: "money" }, { key: "state", label: "State", type: "state" },
];

export default async function VendorsPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "read")) return <NoAccess ctx={ctx} what="Vendors" who="accountants and admins" />;
  const sp = await searchParams, manage = can(ctx, "manage"), next = safeNext(one(sp.next));
  const [page, accounts] = await Promise.all([new VendorService(ctx).list(listQueryFrom(sp)), new LookupService(ctx).accounts()]);
  const rows = page.rows.map((v) => ({ ...v, meta: [v.phone, v.panLast4 ? `PAN ends ${v.panLast4}` : null].filter(Boolean).join(" · "), tds: v.tdsBasisPoints ? v.tdsBasisPoints / 100 : null, bank: v.hasBank ? (v.upiId ? "Bank or UPI" : "Bank") : "No details yet", state: v.isActive ? "open" : "closed" }));
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && k !== "page" ? [[k, v]] : []))).toString();
  const add = manage ? <FormModal title="New vendor" icon="users" size="lg" fields={vendorFields(accounts)} action={saveVendor} submitLabel="Save vendor" trigger={{ label: "New vendor", plus: true }} redirectTo={next} successMessage="Vendor saved" /> : null;

  return (
    <>
      <PageHeader eyebrow="Expenses" title="Vendors" description="Who the school buys from, with how to pay them and what is owed."
        actions={<><Link href={`/app/expenses/vendors/csv${qs ? `?${qs}` : ""}`} prefetch={false} className={buttonVariants({ variant: "ghost", className: "rounded-full" })}>Download CSV</Link>{add}</>} />
      <SectionNav ctx={ctx} current="/app/expenses/vendors" />
      {next ? <Notice tone="info" action={{ href: next, label: "Back without adding" }}>Add the vendor with "New vendor" above. You will go straight back to what you were doing.</Notice> : null}
      <DataTable columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/app/expenses/vendors/{id}" searchPlaceholder="Search name, GSTIN or phone"
        filters={[{ key: "active", label: "State", options: [{ value: "1", label: "In use" }, { value: "0", label: "Switched off" }] }]}
        empty={{ title: "No vendors yet", description: "Add the shops and services the school pays: stationery, repairs, rent, internet. Bills and payments hang off them.", action: add ?? undefined }} />
    </>
  );
}
