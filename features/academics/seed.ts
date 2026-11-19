import type { FeatureSeed } from "@smw/feature-kit";
import { eq, schools, withConsole } from "@smw/db";
import { CLASS_PRESETS, SUBJECT_PRESETS } from "./presets";
import { AcademicYearService, ClassService, ClassSubjectService, SectionService, SubjectService, TermService } from "./service";

const PRE_PRIMARY = ["English", "Hindi", "Mathematics", "Art", "Physical Education"];
const PRIMARY = ["English", "Hindi", "Mathematics", "EVS", "Art", "Physical Education"];
const MIDDLE = ["English", "Hindi", "Mathematics", "Science", "Social Science", "Sanskrit", "Computer Science", "Art", "Physical Education"];
const subjectsFor = (grade: number) => (grade <= 0 ? PRE_PRIMARY : grade <= 5 ? PRIMARY : MIDDLE);

/** Greenvalley runs Nursery to Class 10, Sunrise runs LKG to Class 8. Teachers are not seeded yet (staff comes later), so class and subject teachers stay empty. */
const seed: FeatureSeed = async (ctx, state) => {
  const [school] = await withConsole((tx) => tx.select({ slug: schools.slug }).from(schools).where(eq(schools.id, ctx.schoolId)));
  const [low, high] = school?.slug === "sunrise" ? [-1, 8] : [-2, 10];

  const years = new AcademicYearService(ctx);
  const year = await years.create({ name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: "true" });
  const terms = await new TermService(ctx).addDefaults(year.id);

  const classSvc = new ClassService(ctx);
  const classes = [];
  for (const c of CLASS_PRESETS.filter((p) => p.grade >= low && p.grade <= high)) classes.push(await classSvc.create(c));

  const subjectSvc = new SubjectService(ctx);
  await subjectSvc.addPreset({ board: "CBSE" });
  const subjects = (await subjectSvc.list({ pageSize: 100, sort: "name", dir: "asc" })).rows
    .filter((s) => SUBJECT_PRESETS.CBSE.some((p) => p.name === s.name));
  const byName = new Map(subjects.map((s) => [s.name, s.id]));

  const sectionSvc = new SectionService(ctx);
  const classSubjects = new ClassSubjectService(ctx);
  const sections = [];
  for (const c of classes) {
    for (const name of c.grade >= 1 && c.grade <= 5 ? ["A", "B"] : ["A"]) {
      sections.push(await sectionSvc.create({ classId: c.id, name, capacity: c.grade <= 0 ? 25 : 40, room: `${100 + c.grade * 10 + (name === "A" ? 1 : 2)}` }));
    }
    await classSubjects.assign({ classId: c.id, subjectIds: subjectsFor(c.grade).map((n) => byName.get(n)!) });
  }

  state.yearId = year.id;
  state.termIds = terms.map((t) => t.id);
  state.classes = classes.map((c) => ({ id: c.id, name: c.name, grade: c.grade }));
  state.sections = sections.map((s) => ({ id: s.id, classId: s.classId, name: s.name }));
  state.subjects = subjects.map((s) => ({ id: s.id, name: s.name }));
};
export default seed;
