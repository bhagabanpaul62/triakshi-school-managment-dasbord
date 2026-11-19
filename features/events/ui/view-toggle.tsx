"use client";

import { usePathname, useRouter } from "next/navigation";
import { SegmentedControl } from "@smw/ui/kit/SegmentedControl";

/** List | Month switch. The view lives in the URL so the server page renders the right one. */
export function ViewToggle({ view }: { view: "list" | "month" }) {
  const router = useRouter();
  const path = usePathname();
  return (
    <SegmentedControl label="Events view" value={view} onChange={(v) => router.replace(v === "month" ? `${path}?view=month` : path, { scroll: false })}
      options={[{ value: "list", label: "List" }, { value: "month", label: "Month" }]} />
  );
}
