import type { ReactNode } from "react";
import { ModuleGate } from "@/lib/module-gate";

/** The tab bar sits under each page's title (WebsiteNav), so the title comes first. */
export default function Layout({ children }: { children: ReactNode }) {
  return <ModuleGate feature="website" name="Website">{children}</ModuleGate>;
}
