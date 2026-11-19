import { ConflictError, type FeatureSeed } from "@smw/feature-kit";
import { PeriodService, TimetableService } from "./service";

/** Standard bell schedule, then a full week for every section from its subject teachers (sections with no teachers assigned are skipped). */
const seed: FeatureSeed = async (ctx, state) => {
  const bell = new PeriodService(ctx);
  await bell.applyPreset();
  state.periods = (await bell.all()).map((p) => p.id);

  const timetable = new TimetableService(ctx);
  for (const s of (state.sections ?? []) as { id: string }[]) {
    try {
      await timetable.autoFill(s.id);
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err;
    }
  }
};
export default seed;
