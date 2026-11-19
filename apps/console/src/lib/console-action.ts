import { runAction } from "@smw/runtime";
import { staffActionCtx } from "@smw/runtime/console";
import type { StaffCtx } from "@smw/feature-kit";

/**
 * The body of every console server action: build the service for the signed-in staff member, run one method, return an ActionResult.
 *   export async function suspendSchool(fd: FormData) { return consoleAction(SchoolAdminService, (s) => s.suspend(id(fd)), "School suspended"); }
 */
export async function consoleAction<S, T>(Service: new (ctx: StaffCtx) => S, fn: (svc: S) => Promise<T>, message?: string) {
  return runAction(async () => fn(new Service(await staffActionCtx())), message);
}

/** Read one text field from a form. */
export const field = (fd: FormData, name: string) => String(fd.get(name) ?? "");
