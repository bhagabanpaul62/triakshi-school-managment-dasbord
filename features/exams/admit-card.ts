// Admit card (hall ticket): school header, student facts, the date sheet and signature boxes. Pure drawing.
import { PdfBuilder, services } from "@smw/integrations";
import type { CardSchool } from "./report-card";

export interface AdmitCard {
  school: CardSchool;
  examName: string;
  yearName: string;
  student: { name: string; admissionNo: string; rollNo: number | null; className: string; sectionName: string; dob: string | null; photoKey: string | null; /** Filled by `loadPhotos`. */ photo?: Uint8Array | null };
  papers: { date: string; subject: string; startTime: string | null; endTime: string | null }[];
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayName = (iso: string) => DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]!;
export const dateText = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
export const timeText = (a: string | null, c: string | null) => (a && c ? `${a} - ${c}` : "To be announced");

const PHOTO = { w: 70, h: 84 };

export class AdmitCardLayout {
  /** Fetch each student's photo, 6 at a time. A missing or unreadable photo leaves the placeholder box; it never fails the PDF. */
  static async loadPhotos(cards: AdmitCard[], limit = 6) {
    const todo = cards.filter((c) => c.student.photoKey);
    let next = 0;
    const worker = async () => {
      for (let c = todo[next++]; c; c = todo[next++]) c.student.photo = await services().storage.get(c.student.photoKey!).catch(() => null);
    };
    await Promise.all(Array.from({ length: Math.min(limit, todo.length) }, worker));
    return cards;
  }

  static async render(cards: AdmitCard[]): Promise<Uint8Array> {
    await AdmitCardLayout.loadPhotos(cards);
    const b = await PdfBuilder.create();
    for (const [i, c] of cards.entries()) {
      if (i > 0) b.space(PdfBuilder.H).text(" ", { size: 1, gap: 0 });
      await AdmitCardLayout.draw(b, c);
    }
    return b.save();
  }

  private static async draw(b: PdfBuilder, { school, examName, yearName, student: s, papers }: AdmitCard) {
    b.header({
      title: "ADMIT CARD",
      orgName: school.name,
      orgLines: [[school.address, school.city, school.state].filter(Boolean).join(", "), school.phone ? `Phone: ${school.phone}` : ""].filter(Boolean),
      rightLines: [examName, `Session ${yearName}`],
    });
    const top = b.cursor;
    const frame = { x: PdfBuilder.W - PdfBuilder.M - PHOTO.w, top, ...PHOTO };
    if (!(s.photo && (await b.image(s.photo, frame)))) b.box(frame, "Paste photo here");
    b.facts([
      ["Student", s.name], ["Admission no", s.admissionNo],
      ["Class", `${s.className}-${s.sectionName}`], ["Roll no", s.rollNo == null ? "-" : String(s.rollNo)],
      ["Date of birth", s.dob ? dateText(s.dob) : "-"],
    ]);
    b.space(Math.max(0, b.cursor - (top - PHOTO.h - 8)));
    b.text("Date sheet", { size: 11, bold: true, gap: 6 });
    b.table({
      columns: [{ label: "Date", width: 100 }, { label: "Day", width: 50 }, { label: "Subject", width: 200 }, { label: "Time", width: 149 }],
      rows: papers.map((p) => [dateText(p.date), dayName(p.date), p.subject, timeText(p.startTime, p.endTime)]),
    });
    b.text("Bring this card to every paper. Mobile phones are not allowed in the exam hall.", { size: 8, color: [0.4, 0.4, 0.45] });
    b.space(34).table({ columns: [{ label: "Student", width: 166 }, { label: "Class teacher", width: 166 }, { label: "Principal", width: 167 }], rows: [] });
  }
}
