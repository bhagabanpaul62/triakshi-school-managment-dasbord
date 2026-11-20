// The month register as an A4 landscape PDF grid and as CSV. Pure: callers pass plain rows.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { AttendanceStatus } from "./constants";
import { attendancePercent, tally } from "./stats";

export interface RegisterDay { date: string; day: number; sunday: boolean; holiday: string | null }
export interface RegisterPerson { name: string; sub?: string; marks: Record<string, string> }
export interface RegisterInput { school: string; title: string; subtitle: string; days: RegisterDay[]; people: RegisterPerson[] }

/** P present, A absent, L late, LV leave, HD half day; H marks a holiday or Sunday. */
const LETTER: Record<AttendanceStatus, string> = { present: "P", absent: "A", late: "L", leave: "LV", half_day: "HD" };

export interface RegisterRow { name: string; sub: string; cells: string[]; present: number; absent: number; late: number; leave: number; pct: number | null }

export function registerRows(input: RegisterInput): RegisterRow[] {
  return input.people.map((p) => {
    const c = tally(input.days.flatMap((d) => (p.marks[d.date] ? [p.marks[d.date]!] : [])));
    return {
      name: p.name, sub: p.sub ?? "",
      cells: input.days.map((d) => { const s = p.marks[d.date] as AttendanceStatus | undefined; return s ? LETTER[s] : d.holiday || d.sunday ? "H" : ""; }),
      present: c.present + c.half_day, absent: c.absent, late: c.late, leave: c.leave, pct: attendancePercent(c),
    };
  });
}

export const csvCell = (v: string | number | null) => { const s = v === null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function registerCsv(input: RegisterInput): string {
  const head = [input.title.includes("Staff") ? "Roll/Role" : "Roll", "Name", ...input.days.map((d) => String(d.day)), "Present", "Absent", "Late", "Leave", "%"];
  const lines = registerRows(input).map((r) => [r.sub, r.name, ...r.cells, r.present, r.absent, r.late, r.leave, r.pct]);
  return [head, ...lines].map((l) => l.map(csvCell).join(",")).join("\n") + "\n";
}

/** Subject-wise attendance of a section: per student, per subject, the % of periods attended (present and late over present, late and absent). */
export interface SubjectReport {
  section: { id: string; label: string }; from: string; to: string;
  subjects: { id: string; name: string }[];
  rows: { studentId: string; name: string; rollNo: number | null; bySubject: Record<string, { attended: number; total: number; pct: number | null }>; overall: number | null }[];
}

export function subjectCsv(rep: SubjectReport): string {
  const head = ["Roll", "Name", ...rep.subjects.flatMap((s) => [`${s.name} attended`, `${s.name} periods`, `${s.name} %`]), "Overall %"];
  const lines = rep.rows.map((r) => [r.rollNo, r.name, ...rep.subjects.flatMap((s) => { const c = r.bySubject[s.id]; return [c?.attended ?? 0, c?.total ?? 0, c?.pct ?? null]; }), r.overall]);
  return [head, ...lines].map((l) => l.map(csvCell).join(",")).join("\n") + "\n";
}

const W = 841.89, H = 595.28, M = 24, ROW = 15, TOT = 30, NAME = 120, SUB = 36;

export async function registerPdf(input: RegisterInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, "?");
  const n = input.days.length, dayW = (W - 2 * M - SUB - NAME - 5 * TOT) / n;
  const rows = registerRows(input);
  const perPage = Math.floor((H - 2 * M - 62 - ROW * 2) / ROW);
  const pages = Math.max(1, Math.ceil(rows.length / perPage));

  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([W, H]);
    const text = (s: string, x: number, y: number, size = 8, f = font, w = 0, right = false) => {
      const t = clean(s); page.drawText(t, { x: right || w ? x + (w - f.widthOfTextAtSize(t, size)) / (right ? 1 : 2) : x, y, size, font: f, color: rgb(0.1, 0.1, 0.12) });
    };
    text(input.school, M, H - M - 12, 14, bold);
    text(input.title, W - M - 300, H - M - 12, 12, bold, 300, true);
    text(input.subtitle, W - M - 300, H - M - 26, 9, font, 300, true);
    text(`Page ${p + 1} of ${pages}`, M, H - M - 26, 8);
    let y = H - M - 48;
    const heads = ["Roll", "Name", ...input.days.map((d) => String(d.day)), "P", "A", "L", "LV", "%"];
    const xs: number[] = []; let x = M;
    for (let i = 0; i < heads.length; i++) { xs.push(x); x += i === 0 ? SUB : i === 1 ? NAME : i < 2 + n ? dayW : TOT; }
    const rule = (yy: number) => page.drawLine({ start: { x: M, y: yy }, end: { x: W - M, y: yy }, thickness: 0.4, color: rgb(0.6, 0.6, 0.65) });
    rule(y + ROW - 3);
    heads.forEach((h, i) => (i < 2 ? text(h, xs[i]! + 2, y, 8, bold) : text(h, xs[i]!, y, 7.5, bold, i < 2 + n ? dayW : TOT)));
    rule(y - 4); y -= ROW;
    for (const r of rows.slice(p * perPage, (p + 1) * perPage)) {
      const cells = [r.sub, r.name, ...r.cells, String(r.present), String(r.absent), String(r.late), String(r.leave), r.pct === null ? "-" : `${r.pct}`];
      cells.forEach((c, i) => {
        if (i < 2) text(c.slice(0, i === 1 ? 26 : 8), xs[i]! + 2, y, 8);
        else text(c, xs[i]!, y, 7, c === "A" ? bold : font, i < 2 + n ? dayW : TOT);
      });
      y -= ROW;
    }
    rule(y + ROW - 4);
    text("P present   A absent   L late   LV leave   HD half day   H holiday or Sunday.  Present counts half days; leave is excused and left out of the %.", M, M, 7);
  }
  return doc.save();
}
