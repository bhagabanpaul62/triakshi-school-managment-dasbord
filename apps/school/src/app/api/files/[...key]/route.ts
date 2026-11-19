import { NextResponse } from "next/server";
import { FilePolicy } from "@smw/feature-settings/service";
import { services } from "@smw/integrations";
import { getSchool, getSession } from "@smw/runtime";

/**
 * Files live in private storage under `<schoolId>/<area>/...`. This route checks who is asking, then redirects to a
 * 5-minute signed URL. Public files (the logo) need no sign-in; everything else needs a session in this school;
 * data exports need an admin. The rule itself is FilePolicy, so it is tested with the other services.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const [school, session, { key }] = await Promise.all([getSchool(), getSession(), params]);
  const path = key.join("/");
  if (!FilePolicy.canRead(path, { schoolId: school.id, role: session?.user.role ?? null })) {
    return new NextResponse("Not found", { status: 404 });
  }
  const res = NextResponse.redirect(await services().storage.signedUrl(path, 300), 302);
  res.headers.set("Cache-Control", "private, max-age=60");
  return res;
}
