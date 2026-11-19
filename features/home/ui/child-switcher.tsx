"use client";

import { useRouter } from "next/navigation";
import { SegmentedControl } from "@smw/ui/kit/SegmentedControl";

/** Parents with more than one child pick whose home they see. The choice lives in the URL (?child=), so it survives a reload. */
export function ChildSwitcher({ kids, value }: { kids: { id: string; name: string }[]; value: string }) {
  const router = useRouter();
  return (
    <SegmentedControl
      label="Child"
      value={value}
      onChange={(id) => router.push(`/app?child=${id}`)}
      options={kids.map((c) => ({ value: c.id, label: c.name.split(" ")[0] ?? c.name }))}
    />
  );
}
