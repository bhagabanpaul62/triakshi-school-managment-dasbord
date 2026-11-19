// Every request: delete any incoming copy of our internal headers and tag a request id.
// The school itself is resolved on the server from the Host header (getSchool), never from a header a client can send.
import { NextResponse, type NextRequest } from "next/server";

const INTERNAL = ["x-smw-school-id", "x-smw-school-status", "x-smw-request-id"];

export function proxy(req: NextRequest) {
  const headers = new Headers(req.headers);
  for (const h of INTERNAL) headers.delete(h);
  headers.set("x-smw-request-id", crypto.randomUUID());
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
