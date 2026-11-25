import Link from "next/link";
import { getSchool } from "@smw/runtime";
import { EnquiryThanks } from "@smw/site-templates/Thanks";

/** Only codes travel in the address; the words are here. */
const ERRORS: Record<string, string> = {
  validation: "Some of what you entered needs another look. Please go back and check the form.",
  rate_limited: "We have received several enquiries from you. Please try again in an hour, or call the school office.",
  too_fast: "That was very quick. Please go back and press Send again.",
  conflict: "The school is not taking online enquiries right now. Please call the school office.",
  internal: "Something went wrong on our side. Please try again, or call the school office.",
};

export const metadata = { title: "Enquiry", robots: { index: false } };

/** Where the enquiry form lands when JavaScript is off: the thank-you, or what went wrong with a way back. Nothing about the family is in the address except the reference. */
export default async function EnquirySent({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [school, q] = await Promise.all([getSchool(), searchParams]);
  const back = q.back && q.back.startsWith("/") && !q.back.startsWith("//") ? q.back : "/";
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: 26, margin: "0 0 12px" }}>{school.name}</h1>
        {q.error ? (
          <div role="alert"><p style={{ color: "#991b1b", fontWeight: 600 }}>We could not send your enquiry.</p><p>{ERRORS[q.error] ?? ERRORS.internal}</p>
            <p><Link href={back} style={{ fontWeight: 600 }}>Go back to the form</Link></p></div>
        ) : (
          <div role="status" style={{ background: "var(--site-secondary-light)", padding: 20, borderRadius: 12 }}><EnquiryThanks />
            <p style={{ marginTop: 16 }}><Link href="/" style={{ fontWeight: 600 }}>Back to the website</Link></p></div>
        )}
      </div>
    </main>
  );
}
