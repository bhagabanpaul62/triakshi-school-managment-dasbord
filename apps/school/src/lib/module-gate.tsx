import Link from "next/link";
import type { ReactNode } from "react";
import { requireCtx } from "@smw/runtime";
import { EmptyLine } from "@smw/ui/finance/States";

/** A module outside the school's plan says so and where to go, instead of a refusal that blames the person. */
export async function ModuleGate({ feature, name, children }: { feature: string; name: string; children: ReactNode }) {
  const ctx = await requireCtx();
  if (ctx.features.has(feature)) return children;
  const admin = ctx.role === "admin";
  return <EmptyLine title={`${name} is not in your school's plan.`} hint={admin ? "Change the plan to switch it on. Nothing you have entered elsewhere is affected." : "Ask your admin if the school needs it."}
    action={<Link href={admin ? "/app/billing" : "/app"} className="inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm hover:bg-white/[0.12]">{admin ? "See plans" : "Back to home"}</Link>} />;
}
