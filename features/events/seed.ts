import type { Ctx, FeatureSeed } from "@smw/feature-kit";
import { EVERYONE } from "@smw/feature-notifications/audience-rules";
import { addDays, istDay } from "./dates";
import { RsvpService } from "./rsvp";
import { EventService } from "./service";

type Kid = { id: string; name: string; userId: string };
const families = JSON.stringify({ include: [{ type: "families" }], exclude: [] });
const everyone = JSON.stringify(EVERYONE);
const staff = JSON.stringify({ include: [{ type: "staff" }], exclude: [] });

/** A school year of realistic events: a few past, many coming, a weekly series with one rained-off day, a trip, answers and a waiting list. */
const seed: FeatureSeed = async (ctx, state) => {
  const svc = new EventService(ctx);
  const today = istDay(new Date());
  const at = (days: number, hm = "10:00") => `${addDays(today, days)}T${hm}`;
  const one = (o: Record<string, unknown>) => svc.create({ audience: families, notify: "false", ...o });

  // Past: they are on the calendar and in "Earlier".
  await one({ title: "Orientation day for new families", startsAt: at(-95, "09:00"), endsAt: at(-95, "12:00"), location: "Auditorium", audience: everyone, isPublic: "true" });
  await one({ title: "Inter-house quiz", startsAt: at(-40, "11:00"), endsAt: at(-40, "13:00"), type: "competition", location: "Main hall" });
  await one({ title: "Children's Day celebration", description: "Games, fun stalls and a special assembly by the teachers.", startsAt: at(-11, "09:00"), endsAt: at(-11, "13:00"), type: "cultural", location: "School ground", audience: everyone, isPublic: "true" });

  // Coming up, with answers.
  const exhibition = await one({
    title: "Science Exhibition", description: "Working models by Classes 6 to 10. **Visitors are welcome.**\n\n- Doors open at 10 am\n- Tea and snacks are free", startsAt: at(3), endsAt: at(3, "15:00"), type: "event", location: "Main hall",
    audience: everyone, isPublic: "true", rsvpOn: "true", guests: 2, bring: "Your school ID card", reminders: ["1440", "120"],
  });
  const annual = await one({
    title: "Annual Day", description: "Prize distribution and performances. Parents are invited.", startsAt: at(25, "17:00"), endsAt: at(25, "20:00"), type: "cultural", location: "Auditorium",
    audience: everyone, isPublic: "true", rsvpOn: "true", capacity: 12, guests: 1, closesAt: at(20, "18:00"),
  });
  const trip = await one({
    title: "Class 5 trip to the science park", description: "A day out with worksheets. The bus leaves at 8 am sharp and is back by 5 pm.", startsAt: at(18, "08:00"), endsAt: at(18, "17:00"), type: "trip", location: "Regional Science Park",
    mapUrl: "https://maps.google.com/?q=science+park", bring: "Water bottle, cap, packed lunch", rsvpOn: "true", capacity: 40, closesAt: at(12, "18:00"),
  });
  await one({ title: "Staff development workshop", description: "Planning the second term together.", startsAt: at(9, "14:00"), endsAt: at(9, "16:00"), type: "meeting", location: "Staff room", audience: staff });
  await one({ title: "Republic Day rehearsal", startsAt: at(60, "07:30"), endsAt: at(60, "09:00"), type: "cultural", location: "School ground" });
  await one({ title: "Sports Day", description: "Track and field, relay races and the house trophy.", startsAt: at(75, "08:00"), endsAt: at(75, "16:00"), type: "sports", location: "Sports ground", audience: everyone, isPublic: "true" });
  await one({ title: "Inter-school athletics meet", startsAt: at(120), endsAt: at(121), allDay: "true", type: "competition", location: "District stadium" });
  await one({ title: "Art and craft fair", startsAt: at(150, "10:00"), endsAt: at(150, "16:00"), type: "cultural", location: "Corridor and courtyard", audience: everyone, isPublic: "true" });

  // A weekly series; one day was rained off.
  const nextWed = (() => { let d = addDays(today, 1); while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 3) d = addDays(d, 1); return d; })();
  const football = await one({ title: "Football practice", description: "Bring your shoes and shin guards.", startsAt: `${nextWed}T15:30`, endsAt: `${nextWed}T17:00`, type: "sports", location: "Sports ground", repeat: "weekly", repeatUntil: addDays(nextWed, 77), skipClosed: "true" });
  const rained = (await svc.range(new Date(football.startsAt.getTime() + 6 * 864e5), new Date(football.startsAt.getTime() + 8 * 864e5))).find((e) => e.seriesId === football.seriesId);
  if (rained) await svc.cancel(rained.id, { reason: "The ground is waterlogged", scope: "this" });

  await one({ title: "Inter-school debate", startsAt: at(12, "10:00"), endsAt: at(12, "13:00"), type: "competition", location: "Host school" }).then((e) => svc.cancel(e.id, { reason: "The host school changed the date", scope: "this" }));
  await one({ title: "Founders' Day plan", description: "Ideas for the programme. Not announced yet.", startsAt: at(90, "10:00"), type: "event", draft: "true" });

  // Families answer: most say yes, a few maybe or no; the Annual Day fills up and the rest wait.
  const kids = (state.students ?? []) as Kid[];
  const answer = async (id: string, kid: Kid, a: "yes" | "maybe" | "no", guests = 0) => {
    const family: Ctx = { ...ctx, userId: kid.userId, role: "student", name: kid.name };
    await new RsvpService(family).answer(id, { answer: a, guests }).catch(() => undefined);
  };
  for (const [i, kid] of kids.slice(0, 40).entries()) {
    await answer(exhibition.id, kid, i % 7 === 3 ? "no" : i % 5 === 2 ? "maybe" : "yes", i % 4 === 0 ? 2 : 0);
    await answer(annual.id, kid, i % 9 === 4 ? "no" : "yes", i % 3 === 0 ? 1 : 0);
    if (i < 25) await answer(trip.id, kid, i % 6 === 5 ? "no" : "yes");
  }
};
export default seed;
