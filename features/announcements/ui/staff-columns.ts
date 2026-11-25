// The staff list as plain data: what each column shows, so the page and its test say the same thing. Pure.
import { dateTime } from "@smw/ui/format";
import type { Column } from "@smw/ui/shell/DataTable";
import { TYPE_LABEL } from "../constants";
import type { NoticeRow } from "../notice-service";

/** Five columns fit a 1366 px screen without clipping. The kind and number sit under the title; the author sits under the date. */
export const LIST_COLUMNS: Column[] = [
  { key: "title", label: "Notice", type: "text", metaKey: "meta" },
  { key: "audience", label: "For" },
  { key: "state", label: "State", type: "badge" },
  { key: "answers", label: "Answered" },
  { key: "when", label: "When" },
];

/** "12 of 40", or nothing when the notice asks for no answer. Never a number the table would try to format. */
export const answeredText = (n: Pick<NoticeRow, "responseKind" | "recipients" | "answered">): string | null =>
  n.responseKind !== "none" && n.recipients > 0 ? `${n.answered} of ${n.recipients}` : null;

const whenOf = (n: NoticeRow) => n.state === "scheduled" ? n.scheduledAt : n.state === "draft" || n.state === "waiting" ? n.updatedAt : n.publishedAt;

export function listRow(n: NoticeRow) {
  const when = whenOf(n);
  return {
    id: n.id, title: n.state === "withdrawn" ? `${n.title} (withdrawn)` : n.title || "Untitled draft",
    meta: [TYPE_LABEL[n.type], n.number ?? (n.type === "circular" && n.state !== "published" && n.state !== "expired" && n.state !== "withdrawn" ? "number given when it goes out" : null)].filter(Boolean).join(" · "),
    audience: n.audienceLabel || null, state: n.state, answers: answeredText(n),
    when: [when ? dateTime(when) : null, n.authorName].filter(Boolean).join(" · ") || null,
  };
}

/** The one next step a row offers, only where the writer or reviewer has something to do. Everything else opens by clicking the row. */
export const rowStep = (state: NoticeRow["state"]): { label: string; to: "edit" | "open"; primary: boolean } | null =>
  state === "draft" ? { label: "Keep writing", to: "edit", primary: true } : state === "waiting" ? { label: "Review", to: "open", primary: false } : null;
