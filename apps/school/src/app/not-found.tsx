import { headers } from "next/headers";
import { requestHost, resolveSchoolByHost } from "@smw/runtime/host";
import { StatusPage } from "@/lib/status-page";

export default async function NotFound() {
  const school = await resolveSchoolByHost(requestHost(await headers()));
  return school
    ? <StatusPage title="Page not found" body="This page does not exist or was moved." action={{ label: "Go home", href: "/" }} />
    : <StatusPage title="School not found" body="No school uses this address. Check the link, or ask your school for the right one." />;
}
