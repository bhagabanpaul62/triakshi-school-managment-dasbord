import type { Ctx } from "@smw/feature-kit";
import { HeadService, PlanService } from "../service";
import { FeesLookup } from "./lookups";

/** What the plan builder needs: the year, the fees and classes to pick from, and what each class's plan came to last year. */
export async function planEditorBase(ctx: Ctx) {
  const lookup = new FeesLookup(ctx);
  const [years, classes, heads] = await Promise.all([lookup.years(), lookup.classes(), new HeadService(ctx).options()]);
  const year = years.find((y) => y.isCurrent) ?? years[0];
  const prev = year ? years[years.indexOf(year) + 1] : undefined;
  const compare = year && prev ? await new PlanService(ctx).compareYears(prev.id, year.id).catch(() => []) : [];
  return {
    years: years.map((y) => ({ id: y.id, name: y.name, startsOn: y.startsOn, endsOn: y.endsOn })),
    year: year ? { id: year.id, name: year.name, startsOn: year.startsOn, endsOn: year.endsOn } : null,
    classes: classes.map((c) => ({ id: c.id, name: c.name })),
    heads: heads.filter((h) => h.isActive).map((h) => ({ id: h.id, name: h.name })),
    lastYear: compare.map((c) => ({ classId: c.classId, name: c.name, fromPaise: c.fromPaise })),
  };
}
