"use client";

import { IconPrinter } from "@tabler/icons-react";
import { PILL } from "./styles";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return <button type="button" onClick={() => window.print()} className={`${PILL} gap-2 print:hidden`}><IconPrinter className="h-4 w-4" aria-hidden />{label}</button>;
}
