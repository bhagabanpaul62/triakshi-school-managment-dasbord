import type { Timetable } from "../service";

/** The numbers behind the KPI row of a timetable page, derived from the grid itself. */
export function summarize(tt: Timetable, days = 6) {
  const cells = Object.values(tt.cells);
  const total = tt.periods.filter((p) => !p.isBreak).length * days;
  const count = (pick: (c: Timetable["cells"][string]) => string | null) => new Set(cells.map(pick).filter(Boolean)).size;
  return {
    filled: cells.length,
    total,
    free: Math.max(0, total - cells.length),
    subjects: count((c) => c.subjectId),
    teachers: count((c) => c.teacherId),
    sections: count((c) => c.sectionId),
  };
}
