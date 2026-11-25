import type { Tone } from "@smw/ui/tone";
import { shortDate } from "@smw/ui/format";
import { COULD_NOT_CHECK, TXT_RELEASE_MS, type SchoolDomain } from "./monitor";

export interface DomainState {
  label: string;
  tone: Tone;
  /** One plain sentence for the top of the page. */
  sentence: string;
  /** What the person should do next. */
  next: "finish" | "fix" | "retry" | "main" | "none";
}

type StateInput = Pick<SchoolDomain, "status" | "health" | "verifiedAt" | "checkError" | "isPrimary" | "certExpiresAt" | "records" | "txtMissingSince">;
const certWorks = (d: Pick<SchoolDomain, "certExpiresAt" | "records">, now = new Date()) => !!d.certExpiresAt && d.certExpiresAt > now && d.records.some((r) => r.key === "https" && r.ok);

/** How a domain reads to the school. Pure. */
export function domainState(d: StateInput, now = new Date()): DomainState {
  if (d.status === "pending") return { label: "Waiting for DNS", tone: "warning", sentence: "Add the records below where you manage the domain. We check every 10 minutes.", next: "finish" };
  if (d.status === "failed") {
    return d.verifiedAt
      ? { label: "Stopped", tone: "danger", sentence: `${d.checkError ?? "The domain stopped working."} It no longer opens your school. Fix the records and press Check now to bring it back.`, next: "retry" }
      : { label: "Not verified", tone: "danger", sentence: `${d.checkError ?? "We could not verify it."} Press Check now after you fix it.`, next: "retry" };
  }
  const unsure = d.checkError === COULD_NOT_CHECK ? ` ${COULD_NOT_CHECK}` : "";
  if (d.health === "broken") return { label: "Not reaching your school", tone: "danger", sentence: `${d.checkError && !unsure ? d.checkError : "The domain does not point to us any more."} Visitors may not reach your school on this address. Fix the record below.${unsure}`, next: "fix" };
  if (d.txtMissingSince) return { label: "Live, needs a look", tone: "warning", sentence: `The ownership record is missing. The domain will be released on ${shortDate(new Date(d.txtMissingSince.getTime() + TXT_RELEASE_MS))} unless you add it back.${unsure}`, next: "fix" };
  if (!certWorks(d, now)) return { label: "Getting the secure certificate", tone: "warning", sentence: `The address points to us. The secure certificate is issued on the first visit: open the address once, then press Check again. It can be your main domain when the certificate works.${unsure}`, next: "retry" };
  if (d.health === "warning") return { label: "Live, needs a look", tone: "warning", sentence: `${d.checkError && !unsure ? d.checkError : "The site opens, but a record or the certificate needs attention."} See which one below.${unsure}`, next: "fix" };
  return { label: "Live", tone: "success", sentence: `${d.isPrimary ? "Your school opens on this address, and it is your main domain." : "Your school opens on this address."}${unsure}`, next: d.isPrimary ? "none" : "main" };
}

/** The reason of a release by Triakshi staff that has not been lifted, from the domain's events (newest first); null otherwise. */
export function staffReleaseReason(events: { kind: string; byName: string | null; detail: string | null }[]): string | null {
  const last = events.find((e) => e.kind === "released" || e.kind === "recovered");
  return last?.kind === "released" && last.byName ? (last.detail ?? "No reason was given.") : null;
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** The redirect rule in words, for the top of the page. Pure. */
export function redirectSentence(o: { free: string; main: SchoolDomain | null; others: string[]; on: boolean }): string {
  if (!o.main) return `Your school opens on ${o.free}. When a domain is Live, make it your main domain: the other addresses then send visitors to it.`;
  if (o.main.health === "broken") return `${o.main.hostname} is your main domain but is not reaching your school, so visitors stay on ${o.free} until it is fixed.`;
  if (!o.on) return `Sending visitors to the main domain is off: ${list([o.main.hostname, ...o.others])} all show your website.`;
  return o.others.length
    ? `${list(o.others)} send visitors to ${o.main.hostname}. The panel and sign-in stay where they are.`
    : `${o.main.hostname} is the only address of your website. The panel and sign-in work on every address.`;
}

export const EVENT_TEXT: Record<string, { title: string; tone: Tone }> = {
  added: { title: "Domain added", tone: "default" },
  checked: { title: "Checked", tone: "default" },
  verified: { title: "Went live", tone: "success" },
  failing: { title: "A record stopped working", tone: "danger" },
  recovered: { title: "Working again", tone: "success" },
  failed: { title: "Could not be verified", tone: "danger" },
  released: { title: "Stopped serving", tone: "danger" },
  primary: { title: "Made the main domain", tone: "info" },
  removed: { title: "Removed", tone: "default" },
  lost: { title: "Another school proved it first", tone: "danger" },
};
