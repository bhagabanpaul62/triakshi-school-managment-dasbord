// CBSE-style report card layout. Pure drawing on a PdfBuilder: the service gathers the data.
import { PdfBuilder } from "@smw/integrations";
import type { StudentResult, SubjectStatus } from "./grading";

export interface CardSchool { name: string; address: string | null; city: string | null; state: string | null; board: string | null; phone: string | null; udiseCode: string | null }
export interface ReportCard {
  school: CardSchool;
  yearName: string;
  /** "Half Yearly Exam" or "Term 1: Unit Test 1 + Half Yearly". */
  title: string;
  result: StudentResult;
  co: { subject: string; grade: string }[];
}

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

  private static draw(b: PdfBuilder, { school, yearName, title, result: r, co }: ReportCard) {
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
        { label: "Subject", width: 170 }, { label: "Max", width: 55, align: "right" }, { label: "Marks", width: 60, align: "right" },
        { label: "Percent", width: 60, align: "right" }, { label: "Grade", width: 54 }, { label: "Result", width: 100 },
      ],
      rows: r.subjects.map((x) => [
        x.subject, num(x.maxMarks), x.status === "absent" ? "AB" : x.marks == null ? "-" : num(x.marks),
        x.percent == null || x.status === "absent" ? "-" : `${x.percent}%`, x.grade ?? "-", STATUS[x.status],
      ]),
    });

    const lines: [string, string, boolean?][] = [["Total marks", `${num(r.total)} / ${num(r.maxTotal)}`]];
    if (r.percent !== null) lines.push(["Percentage", `${r.percent}%`]);
    if (r.grade) lines.push(["Overall grade", r.grade, true]);
    if (r.rank) lines.push(["Rank in section", `${r.rank} of ${r.sectionSize}`]);
    lines.push(["Result", r.result === "pass" ? "PASS" : r.result === "fail" ? "FAIL" : "PENDING", true]);
    b.totals(lines).space(10);

    if (co.length) {
      b.text("Co-scholastic areas", { size: 11, bold: true, gap: 6 });
      b.table({ columns: [{ label: "Area", width: 300 }, { label: "Grade", width: 199 }], rows: co.map((c) => [c.subject, c.grade]) });
    }

    const remark = r.result === "pending" ? "Marks for some subjects are not in yet." : r.remark ? `${r.remark}.` : "";
    b.text(`Remarks: ${remark}`, { size: 10 });
    b.text("Grading: A1 91-100, A2 81-90, B1 71-80, B2 61-70, C1 51-60, C2 41-50, D 33-40, E1 21-32, E2 0-20. AB = absent.", { size: 8, color: [0.4, 0.4, 0.45] });
    b.space(34).table({ columns: [{ label: "Class teacher", width: 166 }, { label: "Parent", width: 166 }, { label: "Principal", width: 167 }], rows: [] });
  }
}
