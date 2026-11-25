import { AppError, listQueryFrom } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { SignInService } from "./signin-service";
import { UserAdminService } from "./service";

const csv = (body: string, name: string) => new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "private, no-store" } });
const refuse = (err: unknown) => { if (err instanceof AppError) return Response.json({ error: err.message }, { status: err.status }); throw err; };

/** GET /app/settings/users/export: the Users list as it is filtered on screen. The service checks the permission. */
export async function usersCsv(req: Request) {
  try { return csv(await new UserAdminService(await actionCtx()).csv(listQueryFrom(Object.fromEntries(new URL(req.url).searchParams))), "users"); } catch (e) { return refuse(e); }
}

/** GET /app/settings/sign-ins/export: the sign-in list as it is filtered on screen. */
export async function signInsCsv(req: Request) {
  try { return csv(await new SignInService(await actionCtx()).csv(listQueryFrom(Object.fromEntries(new URL(req.url).searchParams))), "sign-ins"); } catch (e) { return refuse(e); }
}
