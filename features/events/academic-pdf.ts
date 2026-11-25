// The academic calendar as a printable PDF: month by month, one line per item. Hindi and other scripts print (the unicode builder).
import { PdfBuilder } from "@smw/integrations";
import { LAYERS, type CalendarItem } from "./constants";
import { daysOf } from "./dates";
import { clock } from "@smw/feature-kit/words";

const month = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const short = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export interface AcademicPdfInput { school: string; year: string; from: string; to: string; items: CalendarItem[] }

/** Items run over the days they cover, grouped by month. Cancelled events are listed as cancelled, so the printed page is not wrong. */
export async function academicCalendarPdf(i: AcademicPdfInput): Promise<Uint8Array> {
  const rows: { day: string; span: string; title: string; what: string }[] = [];
  for (const it of i.items) {
    const days = daysOf(it.startsAt, it.endsAt).filter((d) => d >= i.from && d <= i.to);
    if (!days.length) continue;
    const first = days[0]!, last = days.at(-1)!;
    // A run of days is one line, written on the day it starts.
    rows.push({ day: first, span: first === last ? short(first) : `${short(first)} to ${short(last)}`, title: it.cancelled ? `${it.title} (cancelled)` : it.title,
      what: [LAYERS[it.layer], it.allDay || first !== last ? "" : clock(it.startsAt), it.meta ?? ""].filter(Boolean).join(", ") });
  }
  rows.sort((a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title));

  const pdf = await PdfBuilder.create({ unicode: true });
  await pdf.need([i.school, i.year, ...rows.flatMap((r) => [r.span, r.title, r.what]), "Academic calendar", "Nothing is planned yet."]);
  pdf.header({ orgName: i.school, title: "Academic calendar", rightLines: [`Year ${i.year}`] });
  const cols = [{ label: "Date", width: 150 }, { label: "What", width: 230 }, { label: "Kind", width: PdfBuilder.W - PdfBuilder.M * 2 - 380 }];
  const fit = (s: string, width: number) => {
    let out = s;
    while (out.length > 1 && pdf.measure(out, 9) > width - 10) out = out.slice(0, -1);
    return out === s ? s : `${out.trimEnd()}...`;
  };
  if (!rows.length) pdf.text("Nothing is planned yet.", { size: 10 });
  const months = [...new Set(rows.map((r) => r.day.slice(0, 7)))];
  for (const m of months) {
    pdf.space(6);
    pdf.ensure(60);
    pdf.text(month(m), { size: 12, bold: true });
    pdf.table({ columns: cols, rows: rows.filter((r) => r.day.startsWith(m)).map((r) => [fit(r.span, cols[0]!.width), fit(r.title, cols[1]!.width), fit(r.what, cols[2]!.width)]) });
  }
  return pdf.save();
}
