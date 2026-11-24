"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SidePeek } from "@smw/ui/finance/SidePeek";

/** A side panel that is open while `?item=` is in the address; closing it takes the parameter away. */
export function PeekByUrl({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const router = useRouter(), path = usePathname(), params = useSearchParams();
  const close = () => { const next = new URLSearchParams(params.toString()); next.delete("item"); router.replace(`${path}${next.size ? `?${next}` : ""}`, { scroll: false }); };
  return <SidePeek open onOpenChange={(o) => { if (!o) close(); }} title={title} description={description} size="lg">{children}</SidePeek>;
}
