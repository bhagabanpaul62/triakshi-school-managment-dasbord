// CBSE-style report card layout. Pure drawing on a PdfBuilder: the service gathers the data.
import { PdfBuilder } from "@smw/integrations";
import { CBSE_BANDS, legendFor, type StudentResult, type SubjectStatus } from "./grading";
import type { FinalBlock, TermBlock } from "./term-card";

export interface CardSchool { name: string; address: string | null; city: string | null; state: string | null; board: string | null; phone: string | null; udiseCode: string | null }
export interface ReportCard {
  school: CardSchool;
  yearName: string;
  /** "Half Yearly Exam" or "Term 1: Unit Test 1 + Half Yearly". */
  title: string;
  result: StudentResult;
  co: { subject: string; grade: string; description?: string }[];
  /** From the class band's template; omitted means "show everything, CBSE legend". */
  opts?: CardOptions;
  /** The class teacher's written remark, printed instead of the automatic one. */
  teacherRemark?: string | null;
  attendance?: { working: number; present: number } | null;
}
export interface CardOptions { showGrade: boolean; showRank: boolean; legend: string; coLegend?: string }
const DEFAULT_OPTS: CardOptions = { showGrade: true, showRank: true, legend: legendFor(CBSE_BANDS) };
const GREY: [number, number, number] = [0.4, 0.4, 0.45];
const attendanceText = (a: { working: number; present: number }) => `Attendance: ${a.present} of ${a.working} days${a.working ? ` (${Math.round((a.present / a.working) * 100)}%)` : ""}`;

const STATUS: Record<SubjectStatus, string> = { pass: "Pass", fail: "Fail", absent: "Absent", pending: "Pending" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const humanDate = (iso: string | null) => (iso ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "-");
const num = (n: number) => String(Math.round(n * 100) / 100);

export class ReportCardLayout {
  /** One PDF; several cards are separated by page breaks. */
  static async render(cards: ReportCard[]): Promise<Uint8Array> {
    const b = await PdfBuilder.create();
    cards.forEach((card, i) => {
      // PdfBuilder starts a page when the next line does not fit, so pushing y off the page forces one.
      if (i > 0) b.space(PdfBuilder.H).text(" ", { size: 1, gap: 0 });
      ReportCardLayout.draw(b, card);
    });
    return b.save();
  }

  private static draw(b: PdfBuilder, { school, yearName, title, result: r, co, opts = DEFAULT_OPTS, teacherRemark, attendance }: ReportCard) {
    const s = r.student;
    b.header({
      title: "REPORT CARD",
      orgName: school.name,
      orgLines: [
        [school.address, school.city, school.state].filter(Boolean).join(", "),
        [school.board && `Board: ${school.board}`, school.udiseCode && `UDISE: ${school.udiseCode}`, school.phone && `Phone: ${school.phone}`].filter(Boolean).join("   "),
      ].filter(Boolean),
      rightLines: [title, `Session ${yearName}`],
    });
    b.facts([
      ["Student", s.name], ["Admission no", s.admissionNo],
      ["Class", `${s.className}-${s.sectionName}`], ["Roll no", s.rollNo == null ? "-" : String(s.rollNo)],
      ["Date of birth", humanDate(s.dob)],
    ]);

    b.text("Scholastic areas", { size: 11, bold: true, gap: 6 });
    b.table({
      columns: [
        { label: "Subject", width: opts.showGrade ? 170 : 224 }, { label: "Max", width: 55, align: "right" }, { label: "Marks", width: 60, align: "right" },
        { label: "Percent", width: 60, align: "right" }, ...(opts.showGrade ? [{ label: "Grade", width: 54 }] : []), { label: "Result", width: 100 },
      ],
      rows: r.subjects.map((x) => [
        x.subject, num(x.maxMarks), x.status === "absent" ? "AB" : x.marks == null ? "-" : num(x.marks),
        x.percent == null || x.status === "absent" ? "-" : `${x.percent}%`, ...(opts.showGrade ? [x.grade ?? "-"] : []), STATUS[x.status],
      ]),
    });

    const lines: [string, string, boolean?][] = [["Total marks", `${num(r.total)} / ${num(r.maxTotal)}`]];
    if (r.percent !== null) lines.push(["Percentage", `${r.percent}%`]);
    if (opts.showGrade && r.grade) lines.push(["Overall grade", r.grade, true]);
    if (opts.showRank && r.rank) lines.push(["Rank in section", `${r.rank} of ${r.sectionSize}`]);
    lines.push(["Result", r.result === "pass" ? "PASS" : r.result === "fail" ? "FAIL" : "PENDING", true]);
    b.totals(lines).space(10);

    if (co.length) {
      b.text("Co-scholastic areas", { size: 11, bold: true, gap: 6 });
      b.table({ columns: [{ label: "Area", width: 220 }, { label: "Grade", width: 60 }, { label: "Meaning", width: 219 }], rows: co.map((c) => [c.subject, c.grade, c.description ?? ""]) });
    }

    if (attendance) b.text(attendanceText(attendance), { size: 10 });
    const auto = r.result === "pending" ? "Marks for some subjects are not in yet." : opts.showGrade && r.remark ? `${r.remark}.` : "";
    b.text(`Remarks: ${teacherRemark || auto}`, { size: 10 });
    b.text(opts.showGrade ? opts.legend : "AB = absent.", { size: 8, color: GREY });
    if (co.length && opts.coLegend) b.text(opts.coLegend, { size: 8, color: GREY });
    b.space(34).table({ columns: [{ label: "Class teacher", width: 166 }, { label: "Parent", width: 166 }, { label: "Principal", width: 167 }], rows: [] });
  }
}

// ---------- term report card ----------

export interface TermCard {
  school: CardSchool;
  yearName: string;
  student: StudentResult["student"];
  blocks: TermBlock[];
  /** Present when there are two or more terms. */
  final: FinalBlock | null;
  rank: { rank: number; of: number } | null;
  co: ReportCard["co"];
  opts: CardOptions;
  teacherRemark: string | null;
}

export class TermCardLayout {
  static async render(cards: TermCard[]): Promise<Uint8Array> {
    const b = await PdfBuilder.create();
    cards.forEach((card, i) => {
      if (i > 0) b.space(PdfBuilder.H).text(" ", { size: 1, gap: 0 });
      TermCardLayout.draw(b, card);
    });
    return b.save();
  }

  private static draw(b: PdfBuilder, { school, yearName, student: s, blocks, final, rank, co, opts, teacherRemark }: TermCard) {
    b.header({
      title: "REPORT CARD",
      orgName: school.name,
      orgLines: [
        [school.address, school.city, school.state].filter(Boolean).join(", "),
        [school.board && `Board: ${school.board}`, school.udiseCode && `UDISE: ${school.udiseCode}`, school.phone && `Phone: ${school.phone}`].filter(Boolean).join("   "),
      ].filter(Boolean),
      rightLines: [blocks.map((x) => x.name).join(" + "), `Session ${yearName}`],
    });
    b.facts([
      ["Student", s.name], ["Admission no", s.admissionNo],
      ["Class", `${s.className}-${s.sectionName}`], ["Roll no", s.rollNo == null ? "-" : String(s.rollNo)],
      ["Date of birth", humanDate(s.dob)],
    ]);
    for (const t of blocks) b.text(`${t.name}: ${t.exams.map((e) => `${e.name} ${e.weight}%`).join(", ")}`, { size: 8, color: GREY });
    b.space(4).text("Scholastic areas", { size: 11, bold: true, gap: 6 });

    const grade = opts.showGrade;
    const termW = grade ? [64, 34] : [64];
    const finalW = grade ? [56, 34] : [56];
    const subjectW = 499 - blocks.length * termW.reduce((a, c) => a + c, 0) - (final ? finalW.reduce((a, c) => a + c, 0) : 0);
    const columns = [
      { label: "Subject", width: subjectW },
      ...blocks.flatMap((t) => [{ label: `${t.name} /${Math.max(0, ...t.subjects.map((x) => x.outOf))}`, width: termW[0]!, align: "right" as const }, ...(grade ? [{ label: "Gr", width: termW[1]! }] : [])]),
      ...(final ? [{ label: "Final %", width: finalW[0]!, align: "right" as const }, ...(grade ? [{ label: "Gr", width: finalW[1]! }] : [])] : []),
    ];
    const names = [...new Map([...blocks.flatMap((t) => t.subjects), ...(final?.subjects ?? [])].map((x) => [x.subjectId, x.subject])).entries()].sort((a, c) => a[1].localeCompare(c[1]));
    b.table({
      columns,
      rows: names.map(([id, name]) => [
        name,
        ...blocks.flatMap((t) => {
          const x = t.subjects.find((y) => y.subjectId === id);
          return [!x || x.status === "pending" ? "-" : x.status === "absent" ? "AB" : num(x.score), ...(grade ? [x?.grade ?? "-"] : [])];
        }),
        ...(final ? (() => { const x = final.subjects.find((y) => y.subjectId === id); return [x?.percent == null ? "-" : `${x.percent}%`, ...(grade ? [x?.grade ?? "-"] : [])]; })() : []),
      ]),
    });

    const lines: [string, string, boolean?][] = [];
    for (const t of blocks) lines.push([`${t.name} total`, t.outOf ? `${num(t.total)} / ${t.outOf}${t.percent === null ? "" : ` (${t.percent}%)`}` : "-"]);
    const overall = final ?? { percent: blocks[0]?.percent ?? null, grade: blocks[0]?.grade ?? null, result: blocks[0]?.result ?? "pending" };
    if (final && overall.percent !== null) lines.push(["Final percentage", `${overall.percent}%`]);
    if (grade && overall.grade) lines.push(["Overall grade", overall.grade, true]);
    if (opts.showRank && rank) lines.push(["Rank in section", `${rank.rank} of ${rank.of}`]);
    lines.push(["Result", overall.result === "pass" ? "PASS" : overall.result === "fail" ? "FAIL" : "PENDING", true]);
    b.totals(lines).space(10);

    if (co.length) {
      b.text("Co-scholastic areas", { size: 11, bold: true, gap: 6 });
      b.table({ columns: [{ label: "Area", width: 220 }, { label: "Grade", width: 60 }, { label: "Meaning", width: 219 }], rows: co.map((c) => [c.subject, c.grade, c.description ?? ""]) });
    }
    for (const t of blocks) if (t.attendance) b.text(`${t.name} ${attendanceText(t.attendance)}`, { size: 10 });
    b.text(`Remarks: ${teacherRemark || (overall.result === "pending" ? "Marks for some subjects are not in yet." : "")}`, { size: 10 });
    b.text(grade ? opts.legend : "AB = absent.", { size: 8, color: GREY });
    if (co.length && opts.coLegend) b.text(opts.coLegend, { size: 8, color: GREY });
    b.space(34).table({ columns: [{ label: "Class teacher", width: 166 }, { label: "Parent", width: 166 }, { label: "Principal", width: 167 }], rows: [] });
  }
}
