import { headers } from "next/headers";
import { RateLimiter } from "@smw/auth";
import VerifyPage, { verifyMetadata } from "@smw/feature-finance/templates/ui/verify-page";
import { VERIFY_LOOKUPS } from "@/lib/verify-lookups";

export const metadata = verifyMetadata;

/** 30 checks per 10 minutes per address: enough for a parent scanning a stack of receipts, too few to guess tokens. */
const limiter = new RateLimiter(30, 10 * 60_000);

export default async function Page(props: { params: Promise<{ kind: string; token: string }> }) {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return <VerifyPage {...props} lookups={VERIFY_LOOKUPS} limited={!limiter.take(ip)} />;
}
