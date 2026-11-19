import type { FeatureSeed } from "@smw/feature-kit";
import { ConsentService, GuardianService, StudentService } from "./service";

interface ClassRef { id: string; name: string; grade: number }
interface SectionRef { id: string; classId: string; name: string }
interface Person { name: string; phone: string; relation: "father" | "mother" | "guardian" }

const BOYS = ["Aarav", "Vivaan", "Aditya", "Arjun", "Ishaan", "Kabir", "Reyansh", "Rohan", "Dev", "Krish", "Yash", "Ayaan", "Siddharth", "Harsh", "Pranav", "Tanmay", "Rahul", "Nikhil"];
const GIRLS = ["Diya", "Ananya", "Aadhya", "Saanvi", "Myra", "Isha", "Kavya", "Riya", "Meera", "Navya", "Priya", "Tanvi", "Sneha", "Pooja", "Anika", "Ira", "Kiara", "Nisha"];
const SURNAMES = ["Sharma", "Verma", "Gupta", "Singh", "Patel", "Reddy", "Iyer", "Nair", "Das", "Banerjee", "Mehta", "Joshi", "Kulkarni", "Chopra", "Malhotra", "Bose", "Pillai", "Yadav", "Khan", "Agarwal"];
const FATHERS = ["Rajesh", "Suresh", "Amit", "Sanjay", "Vikram", "Anil", "Manoj", "Deepak", "Ramesh", "Prakash", "Sunil", "Rakesh", "Mukesh", "Naveen", "Ashok"];
const MOTHERS = ["Sunita", "Anita", "Pooja", "Neha", "Kavita", "Rekha", "Sangeeta", "Meena", "Seema", "Anjali", "Priya", "Rashmi", "Shweta", "Geeta", "Lata"];
const ELDERS = ["Mohan Lal", "Kishore Chand", "Hari Prasad", "Radha Devi"];
const BLOOD = ["A+", "B+", "O+", "AB+", "O-", "B-"];
const CATEGORY = ["General", "General", "General", "OBC", "OBC", "SC", "EWS"];
const LOCALITIES = ["MG Road", "Gandhi Nagar", "Nehru Colony", "Lake View", "Station Road", "Civil Lines", "Model Town"];
const pick = <T,>(list: T[], i: number) => list[i % list.length]!;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Demo students: about a dozen per section in Green Valley, a handful in other schools. Each has a father and mother,
 * or one guardian; every ninth section's third student is a sibling sharing the previous section's parents.
 * Parent phones are unique 98xxxxxxxx numbers. Deterministic, so a re-seed gives the same school.
 */
const seed: FeatureSeed = async (ctx, state) => {
  const classes = (state.classes ?? []) as ClassRef[];
  const sections = (state.sections ?? []) as SectionRef[];
  const gradeOf = new Map(classes.map((c) => [c.id, c.grade]));
  const students = new StudentService(ctx);
  const guardians = new GuardianService(ctx);
  const consent = new ConsentService(ctx);

  const big = (await students.schoolSlug()) === "greenvalley";
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

  const out: { id: string; name: string; classId: string; sectionId: string; userId: string; guardianUserId: string }[] = [];
  let n = 0, phoneN = 0, lastFamily: { surname: string; people: Person[] } | null = null;
  const phone = () => `98${20_000_000 + ++phoneN * 131_071}`;

  for (const [si, section] of sections.entries()) {
    const count = big ? 10 + ((si * 3) % 5) : 4 + (si % 3);
    const grade = gradeOf.get(section.classId) ?? 1;
    const firstOfSection: { surname: string; people: Person[] }[] = [];

    for (let i = 0; i < count; i++, n++) {
      const girl = n % 2 === 1;
      const sibling = i === 2 && lastFamily;
      const surname = sibling ? lastFamily!.surname : pick(SURNAMES, n * 7 + si);
      const people: Person[] = sibling ? lastFamily!.people
        : n % 11 === 0 ? [{ name: `${pick(ELDERS, n)} ${surname}`, phone: phone(), relation: "guardian" }]
          : n % 5 === 0 ? [{ name: `${pick(MOTHERS, n)} ${surname}`, phone: phone(), relation: "mother" }]
            : [{ name: `${pick(FATHERS, n)} ${surname}`, phone: phone(), relation: "father" }, { name: `${pick(MOTHERS, n + 3)} ${surname}`, phone: phone(), relation: "mother" }];
      if (i === 0) firstOfSection.push({ surname, people });

      const dob = `${startYear - grade - 5}-${pad((n * 5) % 12 + 1)}-${pad((n * 11) % 28 + 1)}`;
      const name = `${pick(girl ? GIRLS : BOYS, n * 3 + si)} ${surname}`;
      const student = await students.create({
        name, dob, gender: girl ? "female" : "male", sectionId: section.id,
        bloodGroup: n % 3 === 0 ? pick(BLOOD, n) : undefined, category: pick(CATEGORY, n),
        address: `${10 + (n % 90)}, ${pick(LOCALITIES, n)}`,
        guardianName: people[0]!.name, guardianPhone: people[0]!.phone, guardianRelation: people[0]!.relation,
      });
      for (const extra of people.slice(1)) await guardians.add({ studentId: student.id, name: extra.name, relation: extra.relation, phone: extra.phone });

      const linked = await guardians.forStudent(student.id);
      await consent.record({ studentId: student.id, guardianId: linked[0]?.id, purpose: "data_processing", granted: "true", method: "paper_form" });
      if (n % 4 === 0) await consent.record({ studentId: student.id, guardianId: linked[0]?.id, purpose: "photo_on_website", granted: n % 8 === 0 ? "true" : "false", method: "paper_form" });

      if (out.length === 0) {
        state.demoStudentLogin = student.admissionNo;
        state.demoParentLogin = people[0]!.phone;
      }
      out.push({ id: student.id, name: student.name, classId: section.classId, sectionId: section.id, userId: student.userId!, guardianUserId: linked[0]?.userId ?? "" });
    }
    // The next section's third student is a younger or older sibling of this section's first student.
    lastFamily = firstOfSection[0] ?? null;
  }
  state.students = out;
};
export default seed;
