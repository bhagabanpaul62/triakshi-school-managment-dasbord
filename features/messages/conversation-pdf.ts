// One conversation as a PDF, with Hindi and other scripts printed. Used for a participant's own copy and for a reviewer's logged export.
import { PdfBuilder } from "@smw/integrations";
import type { ThreadData } from "./core";

const stamp = (d: Date) => d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export async function conversationPdf(data: ThreadData, o: { school: string; exportedBy: string; reason?: string }): Promise<Uint8Array> {
  const lines = data.messages.filter((m) => m.kind !== "system" || m.body).map((m) => ({
    head: `${m.sender}${m.kind === "note" ? " (internal note)" : ""}, ${stamp(m.at)}${m.removed ? " (removed by the sender)" : ""}`,
    body: [m.body, ...m.files.map((f) => `Attached: ${f.name}`)].filter(Boolean).join("\n"),
  }));
  const pdf = await PdfBuilder.create({ unicode: true });
  await pdf.need([o.school, data.thread.subject, o.exportedBy, o.reason ?? "", ...data.members.map((m) => m.name), ...lines.flatMap((l) => [l.head, l.body])]);
  pdf.header({ title: "Conversation", orgName: o.school, rightLines: [`Exported ${stamp(new Date())}`, `By ${o.exportedBy}`] });
  pdf.facts([["Subject", data.thread.subject], ["People", data.members.map((m) => m.name).join(", ")], ...(data.thread.studentName ? [["Student", data.thread.studentName] as [string, string]] : []), ...(o.reason ? [["Reason", o.reason] as [string, string]] : [])]);
  for (const l of lines) {
    pdf.text(l.head, { size: 9, bold: true, gap: 2 });
    for (const para of l.body.split("\n")) for (const row of pdf.wrap(para, PdfBuilder.W - 2 * PdfBuilder.M, 10)) pdf.text(row, { size: 10, gap: 2 });
    pdf.space(8);
  }
  return pdf.save();
}
