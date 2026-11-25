import { headers } from "next/headers";
import { getSchool } from "@smw/runtime";

/** The address visitors use: the main domain when it is healthy, otherwise the one this page was opened on. */
export async function liveOrigin(): Promise<string> {
  const school = await getSchool();
  const h = await headers();
  const host = school.primaryHost ?? h.get("host") ?? "localhost";
  const proto = /^(localhost|127\.|.*\.localhost)/.test(host) ? "http" : "https";
  return `${proto}://${host}`;
}
