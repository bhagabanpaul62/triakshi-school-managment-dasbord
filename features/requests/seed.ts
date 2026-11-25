import { eq, withSchool } from "@smw/db";
import type { Ctx, FeatureSeed } from "@smw/feature-kit";
import { requests } from "./schema";
import { RequestService } from "./service";
import { CategoryService } from "./categories";

type Person = { userId?: string | null; name: string };

/** Requests in every state, played through the real service so the demo obeys the same rules as production. */
const seed: FeatureSeed = async (admin, state) => {
  const teachers = (state.teachers as Person[] | undefined) ?? [];
  const families = ((state.students as Person[] | undefined) ?? []).filter((s) => s.userId);
  if (!families.length) return;
  const as = (p: Person, role: Ctx["role"]): Ctx => ({ ...admin, userId: p.userId!, name: p.name, role });
  const family = (i: number) => as(families[i % families.length]!, "student");
  const cats = new Map((await new CategoryService(admin).options()).map((c) => [c.name, c.id]));
  const raise = async (who: Ctx, category: string, subject: string, details: string, extra: object = {}) =>
    (await new RequestService(who).raise({ categoryId: cats.get(category), subject, details, ...extra })).id;
  const office = new RequestService(admin);
  const late = (id: string) => withSchool(admin.schoolId, (tx) => tx.update(requests).set({ dueAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(requests.id, id)));

  await raise(family(0), "Fees", "Fee receipt not received", "We paid the second instalment last week but have no receipt yet.");

  const answered = await raise(family(1), "Academics", "Extra help in Maths", "Could he get some extra help for the unit test next week?");
  await office.answer(answered, "Yes. The Maths teacher will give an extra class on Thursday after school.");

  const waiting = await raise(family(0), "Transport", "Bus stop change", "We have moved house. Can the bus stop near the new address be added?");
  await office.askFamily(waiting, "Please send the new address and the nearest landmark.");

  await late(await raise(family(1), "Library", "Book not returned to the shelf", "The library says a book is still with us, but we returned it on Monday."));

  const escalated = await raise(family(0), "Academics", "Marks of the last test are wrong", "The marks on the report do not match the answer sheet.");
  await late(escalated);
  await office.clock();

  const resolved = await raise(family(1), "Certificate", "Bonafide certificate", "We need a bonafide certificate for a bank form.", { values: { kind: "Bonafide" } });
  await office.resolve(resolved, "The certificate is ready. Please collect it from the office.");

  const closed = await raise(family(0), "Suggestion", "Water cooler on the first floor", "A water cooler near the first floor classrooms would help in summer.");
  await office.resolve(closed, "Thank you. We have asked the maintenance team to put one in.");
  await new RequestService(family(0)).feedback({ id: closed, solved: true });

  // A complaint about a teacher: that teacher never sees it, and neither do the admins named in it.
  if (teachers[0]) await raise(family(1), "Complaint", "Too much homework", "The homework is more than he can finish in an evening.", { aboutUserIds: [teachers[0].userId] });
};
export default seed;
