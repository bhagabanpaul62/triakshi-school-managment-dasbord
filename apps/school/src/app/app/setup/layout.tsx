import Link from "next/link";
import { redirect } from "next/navigation";
import { getSchool } from "@smw/runtime";
import { panelCss } from "@smw/themes";
import { Button } from "@smw/ui/ui/button";
import { logout } from "@/lib/auth-actions";

/** The wizard sits outside the panel: dark, no sidebar. A school the platform has not approved yet sees the waiting screen at /app instead. */
export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const school = await getSchool();
  if (school.status === "pending" || school.status === "rejected") redirect("/app");
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: panelCss(school.theme) }} />
      <div className="min-h-dvh bg-[var(--ds-color-background)] text-[var(--ds-on-surface)]">
        {/* Always there: a way out of the wizard to Billing, and Sign out. */}
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-end gap-x-4 gap-y-1 px-4 pt-4 text-sm sm:px-6">
          {school.readOnly ? <p role="status" className="mr-auto text-[var(--ds-color-warning-400)]">Your school is read-only, so nothing here can be saved. Renew the plan in Billing; exports still work.</p> : null}
          <Link href="/app/billing" className="flex min-h-10 items-center text-[var(--ds-on-surface-variant)] hover:text-[var(--ds-on-surface)]">Billing</Link>
          <form action={logout}><Button type="submit" variant="ghost" className="rounded-full">Sign out</Button></form>
        </div>
        {children}
      </div>
    </>
  );
}
