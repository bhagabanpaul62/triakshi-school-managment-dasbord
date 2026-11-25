import type { ReactNode } from "react";
import { AppError } from "@smw/feature-kit";
import { NoAccess } from "@smw/ui/shell/NoAccess";

/** Run a server page. A refusal (no permission, module off, support session) shows a plain NoAccess page; any other error goes on to error.tsx. */
export async function refusalOr(render: () => Promise<ReactNode>): Promise<ReactNode> {
  try {
    return await render();
  } catch (e) {
    if (e instanceof AppError && (e.code === "forbidden" || e.code === "feature_off")) {
      return <NoAccess title={e.code === "feature_off" ? "This is not in your school's plan." : "You cannot open this page."} />;
    }
    throw e;
  }
}
