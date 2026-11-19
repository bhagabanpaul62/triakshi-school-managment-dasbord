import { describe, expect, it } from "vitest";
import { CBSE_BANDS, GradeScale, ResultCalculator, spreadDates, type PaperInfo, type StudentInfo } from "./grading";

describe("GradeScale (CBSE 9-point)", () => {
  const scale = GradeScale.cbse();
  it.each([
    [100, "A1"], [91, "A1"], [90.5, "A1"], [90, "A2"], [81, "A2"], [80, "B1"], [71, "B1"], [70, "B2"], [61, "B2"], [60, "C1"], [51, "C1"],
    [50, "C2"], [41, "C2"], [40, "D"], [33, "D"], [32, "E1"], [21, "E1"], [20, "E2"], [0, "E2"], [-5, "E2"], [140, "A1"],
  ])("%s%% is %s", (percent, grade) => { expect(scale.gradeFor(percent).grade).toBe(grade); });

  it("the built-in bands cover 0-100 exactly once", () => { expect(GradeScale.problem(CBSE_BANDS)).toBeNull(); });
  it("names gaps and overlaps", () => {
    expect(GradeScale.problem([{ grade: "A", minPercent: 50, maxPercent: 100 }])).toMatch(/start at 0/);
    expect(GradeScale.problem([{ grade: "A", minPercent: 0, maxPercent: 40 }, { grade: "B", minPercent: 60, maxPercent: 100 }])).toMatch(/41% to 59%/);
    expect(GradeScale.problem([{ grade: "A", minPercent: 0, maxPercent: 60 }, { grade: "B", minPercent: 50, maxPercent: 100 }])).toMatch(/overlap/);
  });
});

describe("spreadDates", () => {
  it("skips Sundays and wraps", () => {
    // 2026-09-20 is a Sunday.
    expect(spreadDates("2026-09-20", "2026-09-22", 3)).toEqual(["2026-09-21", "2026-09-22", "2026-09-21"]);
    expect(spreadDates("2026-09-22", "2026-09-22", 2)).toEqual(["2026-09-22", "2026-09-22"]);
  });
});

describe("ResultCalculator", () => {
  const stu = (id: string): StudentInfo => ({ id, name: id, admissionNo: id, rollNo: null, dob: null, sectionId: "s", sectionName: "A", classId: "c", className: "Class 6" });
  const papers: PaperInfo[] = [
    { id: "m", subjectId: "m", subject: "Maths", date: "2026-09-22", maxMarks: 80, passMarks: 27 },
    { id: "s", subjectId: "s", subject: "Science", date: "2026-09-23", maxMarks: 80, passMarks: 27 },
  ];
  const calc = new ResultCalculator(GradeScale.cbse());
  const data: Record<string, { marks: number | null; absent: boolean }> = {
    "a:m": { marks: 72, absent: false }, "a:s": { marks: 60, absent: false },
    "b:m": { marks: 70, absent: false }, "b:s": { marks: 60, absent: false },
    "f:m": { marks: 70, absent: false }, "f:s": { marks: 60, absent: false },
    "c:m": { marks: 26, absent: false }, "c:s": { marks: 80, absent: false },
    "d:m": { marks: null, absent: true }, "d:s": { marks: 40, absent: false },
    "e:m": { marks: 50, absent: false },
  };
  const results = calc.section(["a", "b", "c", "d", "e", "f"].map(stu), papers, (s, p) => data[`${s}:${p}`]);
  const by = (id: string) => results.find((r) => r.student.id === id)!;

  it("totals, percent and grade", () => {
    expect(by("a")).toMatchObject({ total: 132, maxTotal: 160, percent: 82.5, grade: "A2", result: "pass" });
  });
  it("fails below the pass mark in any subject, even with a high total", () => {
    expect(by("c")).toMatchObject({ total: 106, percent: 66.3, result: "fail" });
    expect(by("c").subjects[0]!.status).toBe("fail");
  });
  it("absent counts as zero and fails", () => {
    expect(by("d")).toMatchObject({ total: 40, percent: 25, result: "fail", grade: "E1" });
    expect(by("d").subjects[0]).toMatchObject({ status: "absent", marks: null, percent: 0 });
  });
  it("missing marks make the result pending and stay out of the total", () => {
    expect(by("e")).toMatchObject({ total: 50, maxTotal: 80, result: "pending" });
  });
  it("ranks by percent with ties sharing a rank", () => {
    expect([by("a").rank, by("b").rank, by("f").rank, by("c").rank, by("d").rank]).toEqual([1, 2, 2, 4, 5]);
    expect(by("e").rank).toBeNull(); // pending results are not ranked
    expect(by("a").sectionSize).toBe(6);
  });
  it("summarises subjects and pass percent", () => {
    const sum = calc.summary(results, papers);
    expect(sum.count).toBe(6);
    expect(sum.passPercent).toBe(60); // a, b, f pass; c, d fail; e pending
    expect(sum.subjects[0]).toMatchObject({ subject: "Maths" });
  });
  it("combines several exams of a term per subject", () => {
    const one = calc.student(stu("a"), papers, (p) => data[`a:${p}`]);
    const two = calc.student(stu("a"), papers, (p) => ({ m: { marks: 40, absent: false }, s: { marks: 20, absent: false } })[p as "m" | "s"]);
    const term = calc.combine([one, two]);
    expect(term).toMatchObject({ total: 192, maxTotal: 320, percent: 60, grade: "C1", result: "pass", rank: null });
    expect(term.subjects.find((s) => s.subject === "Science")).toMatchObject({ marks: 80, maxMarks: 160, passMarks: 54, status: "pass" });
  });
});
