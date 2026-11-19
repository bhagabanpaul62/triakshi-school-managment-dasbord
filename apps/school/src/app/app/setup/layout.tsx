import { redirect } from "next/navigation";
import { getSchool } from "@smw/runtime";
import { panelCss } from "@smw/themes";

/** The wizard sits outside the panel: dark, no sidebar. A school the platform has not approved yet sees the waiting screen at /app instead. */
export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const school = await getSchool();
  if (school.status === "pending" || school.status === "rejected") redirect("/app");
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: panelCss(school.theme) }} />
      <div className="min-h-dvh bg-[var(--ds-color-background)] text-[var(--ds-on-surface)]">{children}</div>
    </>
  );
}
