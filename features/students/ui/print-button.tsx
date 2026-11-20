"use client";

import { Button } from "@smw/ui/ui/button";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return <Button type="button" className="rounded-full" onClick={() => window.print()}>{label}</Button>;
}
