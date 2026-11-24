"use client";

import { useRouter } from "next/navigation";
import { RecordPicker } from "@smw/ui/finance/RecordPicker";
import { findVendors } from "./actions";

/** Pick a vendor to start a payment: the page reloads with that vendor's open bills. */
export function VendorGo() {
  const router = useRouter();
  return <RecordPicker action={findVendors} name="vendorGo" label="Who are you paying?" onChange={(p) => { if (p[0]) router.push(`/app/expenses/payments/new?vendor=${p[0].id}`); }} />;
}
