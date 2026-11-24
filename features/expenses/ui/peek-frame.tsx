"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SidePeek } from "@smw/ui/finance/SidePeek";

/** Opens a record beside its list while `?<param>=` is in the address; closing removes it and keeps the filters. */
export function PeekFrame({ param, title, description, children }: { param: string; title: string; description?: string; children: ReactNode }) {
  const router = useRouter(), path = usePathname(), params = useSearchParams();
  const close = () => { const n = new URLSearchParams(params.toString()); n.delete(param); router.replace(`${path}${n.size ? `?${n}` : ""}`, { scroll: false }); };
  return <SidePeek open onOpenChange={(o) => { if (!o) close(); }} title={title} description={description} size="lg">{children}</SidePeek>;
}
