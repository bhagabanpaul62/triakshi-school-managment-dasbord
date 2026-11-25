import type { ReactNode } from "react";
import { ModuleGate } from "@/lib/module-gate";

export default function Layout({ children }: { children: ReactNode }) {
  return <ModuleGate feature="requests" name="Requests">{children}</ModuleGate>;
}
