import type { Ctx, FeatureSeed } from "@smw/feature-kit";
import { AssignmentService, SubmissionService } from "./service";

interface SeedStudent { id: string; name: string; sectionId: string; userId: string | null }

/** [title, instructions] pairs per subject; other subjects get a generic chapter exercise. */
const TOPICS: Record<string, [string, string][]> = {
  English: [
    ["Unseen passage and vocabulary", "Read the passage on page 42 and answer the questions in your notebook. Underline five new words and use each in a sentence."],
    ["Letter to the Principal", "Write a formal letter to the Principal asking for a longer library hour. Follow the format we practised in class."],
    ["My favourite story: a short review", "Write 10 lines on a story you enjoyed this term. Say who the main character is and what you learnt."],
  ],
  Hindi: [
    ["Vyakaran abhyas", "Pathyapustak ke prishth 38 par diye gaye sangya aur sarvanam ke prashn hal karein."],
    ["Anuched lekhan: Mera vidyalaya", "Apne vidyalaya par 8 se 10 panktiyon ka anuched likhiye."],
    ["Kavita kanthastha", "Is hafte ki kavita yaad karke likhiye aur uska bhavarth apne shabdon mein samjhaiye."],
  ],
  Mathematics: [
    ["Fractions worksheet", "Solve all 15 questions on the worksheet. Show every step; answers without working carry no marks."],
    ["Chapter 5 exercise 5.2", "Complete questions 1 to 12 from exercise 5.2 in your maths notebook and attach a clear photo or scan."],
    ["Word problems: speed and time", "Solve the 8 word problems on the sheet. Draw a small diagram wherever it helps."],
  ],
  Science: [
    ["Plant parts: label and explain", "Draw a plant, label its parts and write one line on the work of each part."],
    ["Experiment report: states of matter", "Write the aim, materials, steps and what you observed in the class experiment."],
    ["Chapter 6 short answers", "Answer the in-text questions of chapter 6 in complete sentences."],
  ],
  "Social Science": [
    ["Map work: rivers of India", "Mark and name the major rivers on the outline map and list the states each one crosses."],
    ["Our Constitution: short notes", "Write short notes on the Preamble and any three Fundamental Rights."],
    ["Local market survey", "Visit a local market with a parent and note five things sold, with their prices."],
  ],
  EVS: [
    ["My neighbourhood", "Draw your neighbourhood and mark the places you visit often."],
    ["Water around us", "List five ways you can save water at home and draw any two."],
    ["Plants at home", "Collect leaves of three plants at home, paste them and write their names."],
  ],
  "Computer Science": [
    ["Parts of a computer", "Draw a computer and label the input, output and storage devices."],
    ["Typing practice sheet", "Type the paragraph given in class in a word processor and attach a printout or PDF."],
    ["Algorithm for making tea", "Write the steps for making tea as a numbered algorithm and draw its flowchart."],
  ],
};
const ANSWERS = [
  "Completed all the questions. Please check.",
  "Done in my notebook. I found question 4 a little difficult.",
  "All answers written neatly. I have also added a diagram for the last one.",
  "Finished with the help of the textbook examples.",
];
const FEEDBACK = ["Good work, keep it up.", "Neat presentation. Check question 3 again.", "Well explained.", "Needs more detail in the answers."];

/** 17:00 India time, `days` from today. */
const dueIso = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 11, 30)).toISOString();
};

/** Hands in work "at" a chosen time, so the demo has on-time and late submissions for past due dates. */
class BackdatedSubmissions extends SubmissionService {
  constructor(ctx: Ctx, private readonly at: Date) { super(ctx); }
  protected override now() { return this.at; }
}

const asUser = (ctx: Ctx, userId: string, role: Ctx["role"], name: string): Ctx => ({ ...ctx, userId, role, name });

/**
 * Three assignments per section (one closed, one past due, one still open), each handed in by about 70% of the
 * section, half of the past-due work graded and a few sent back. Teachers create and grade; students hand in.
 */
const seed: FeatureSeed = async (ctx, state) => {
  const sections = (state.sections ?? []) as { id: string }[];
  const subjects = new Map(((state.subjects ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  const teachers = new Map(((state.teachers ?? []) as { userId: string; name: string }[]).map((t) => [t.userId, t.name]));
  const kids = (state.students ?? []) as SeedStudent[];
  if (sections.length === 0) return;

  const pairs = await new AssignmentService(ctx).assignable();
  const created: { id: string; sectionId: string; subjectId: string; title: string }[] = [];

  for (const [n, sec] of sections.entries()) {
    let mine = pairs.filter((p) => p.sectionId === sec.id);
    if (mine.length === 0) mine = [...subjects.keys()].slice(0, 3).map((subjectId) => ({ sectionId: sec.id, subjectId, teacherId: ctx.userId }));
    if (mine.length === 0) continue;
    const roster = kids.filter((k) => k.sectionId === sec.id && k.userId);

    for (let k = 0; k < 3; k++) {
      const pair = mine[(n * 2 + k) % mine.length]!;
      const subject = subjects.get(pair.subjectId) ?? "Practice";
      const topics = TOPICS[subject];
      const [title, instructions] = topics ? topics[(n + k) % topics.length]! : [`${subject}: chapter practice ${k + 1}`, `Complete the exercise given in class for ${subject} and keep your notebook ready for checking.`];
      const days = [-12, -3, 5][k]!;
      const maxMarks = [20, 10, null][k];
      const teacher = asUser(ctx, pair.teacherId, pair.teacherId === ctx.userId ? "admin" : "teacher", teachers.get(pair.teacherId) ?? "Teacher");
      const svc = new AssignmentService(teacher);
      const fields = { sectionId: sec.id, subjectId: pair.subjectId, title, instructions, dueAt: dueIso(days), maxMarks: maxMarks ?? "" };
      const a = await svc.create({ ...fields, status: "published" });
      created.push({ id: a.id, sectionId: sec.id, subjectId: pair.subjectId, title });

      for (const [i, kid] of roster.entries()) {
        const bucket = (i * 7 + k * 3 + n) % 10;
        if (bucket >= 7) continue; // about 30% never hand in
        const late = days < 0 && bucket === 6;
        const at = new Date(a.dueAt.getTime() + (late ? 20 : -(6 + (i % 5) * 5)) * 3_600_000);
        const handedAt = at.getTime() > Date.now() ? new Date(Date.now() - (1 + (i % 6)) * 3_600_000) : at;
        const sub = await new BackdatedSubmissions(asUser(ctx, kid.userId!, "student", kid.name), handedAt)
          .submit({ assignmentId: a.id, text: ANSWERS[(i + k) % ANSWERS.length] });

        if (days >= 0) continue; // nothing is graded before it is due
        const grader = new BackdatedSubmissions(teacher, new Date(a.dueAt.getTime() + (2 + (i % 3)) * 86_400_000));
        if (i % 12 === 5) await grader.grade(sub.id, { returnForRework: "true", feedback: "Please show your working for each question and hand it in again." });
        else if (i % 2 === 0) {
          const marks = maxMarks ? Math.min(maxMarks, Math.round(maxMarks * (0.5 + ((i * 13 + k) % 6) / 12))) : undefined;
          await grader.grade(sub.id, { marks: marks ?? "", feedback: FEEDBACK[(i + n) % FEEDBACK.length] });
        }
      }
      if (k === 0) await svc.update(a.id, { ...fields, status: "closed" });
    }
  }
  state.assignments = created;
};
export default seed;
