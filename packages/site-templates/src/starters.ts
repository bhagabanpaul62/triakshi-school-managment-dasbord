/**
 * Starter sites: the default inner pages plus a long home page written for each design.
 * Pure (no React). Copy is plain English for Indian schools; photos are sample Unsplash links.
 */
import { HOME_SLUG, mk, type Section, type SchoolInfo, type SiteContent, type TemplateKey } from "./content";
import { defaultSite } from "./pages";

const photo = (id: string) => `https://images.unsplash.com/photo-${id}?w=1400&q=70`;
const PHOTO = {
  classroom: photo("1580582932707-520aed937b7b"), childWriting: photo("1503676260728-1c00da094a0b"), teacherClass: photo("1509062522246-3755977927d7"),
  books: photo("1497633762265-9d179a990aa6"), pupils: photo("1546410531-bb4caa6b424d"), teacherHelping: photo("1577896851231-70ef18881754"),
  childStudying: photo("1588072432836-e10032774350"), hall: photo("1427504494785-3a9ca7044f45"), group: photo("1571260899304-425eee4c7efc"),
  campus: photo("1562774053-701939374585"), library: photo("1481627834876-b7833e8f5570"), track: photo("1461896836934-ffe607ba8211"),
  lab: photo("1532094349884-543bc11b234d"), art: photo("1513364776144-60967b0f800f"), children: photo("1519452575417-564c1401ecc0"),
};

/** A gallery photo. Every caption starts with "Sample photo." so the school replaces it. */
const sample = (url: string, note: string) => ({ url, caption: `Sample photo. ${note}` });
/** " in Pune", or "" when the city is not known. */
const town = (s: SchoolInfo) => (s.city ? ` in ${s.city}` : "");
/** A line about the curriculum, or "" when the board is not known. */
const curriculum = (s: SchoolInfo) => (s.board ? ` We follow the ${s.board} curriculum.` : "");

const HOMES: Record<TemplateKey, (s: SchoolInfo) => Section[]> = {
  classic: (s) => [
    mk("hero", { eyebrow: "Values, learning, care", heading: `Welcome to ${s.name}`, subheading: `A school${town(s)} that puts values first. Our children learn to be honest and kind, and they work hard for what they want.`, ctaLabel: "Apply for admission", ctaHref: "/admissions", cta2Label: "Visit the school", cta2Href: "/contact", imageUrl: PHOTO.classroom }),
    mk("rich_text", { heading: "A tradition of learning", body: `${s.name} is a school${town(s)}.${curriculum(s)} Our one clear aim is to help every child grow into a thoughtful and responsible adult.\n\nOur teaching rests on the basics. Children read well, write clearly and count with confidence before they move on.` }),
    mk("features", { heading: "Our values", intro: "Four values guide every class, every assembly and every game.", items: [
      { title: "Respect", text: "We listen to each other, teachers and students alike, and we keep our word." },
      { title: "Honesty", text: "We own our mistakes, and we are proud of the work we do when no one is watching." },
      { title: "Hard work", text: "Effort counts for more than talent. We praise the child who keeps trying." },
      { title: "Service", text: "Every child takes a turn to help the class, the school and the neighbourhood." },
    ] }),
    mk("image_text", { heading: "A message from our principal", body: "Dear parents,\n\nThank you for considering our school. Every child who joins us brings a different story. We listen first, then we teach.\n\nI invite you to visit, sit in a class and see for yourself how our children learn.", imageUrl: PHOTO.teacherHelping, role: "Principal", side: "right" }),
    mk("stats", { items: [{ value: "1,200", label: "Students" }, { value: "60", label: "Teachers" }, { value: "4", label: "Labs and studios" }] }),
    mk("gallery", { heading: "Life at school", images: [
      sample(PHOTO.pupils, "Replace with your own classroom."), sample(PHOTO.group, "Replace with your own assembly."), sample(PHOTO.books, "Replace with your own library."),
    ] }),
    mk("staff", { heading: "Meet our teachers", limit: 8 }),
    mk("news", { heading: "News and notices", limit: 3 }),
    mk("events", { heading: "Upcoming events", limit: 3 }),
    mk("testimonials", { heading: "What parents say", items: [
      { name: "Kavita Rao", role: "Parent of a Class 6 student", quote: "The teachers here know my daughter well. They noticed she was tired of maths and gave her extra help before she fell behind." },
      { name: "Vikram Singh", role: "Parent of a Class 2 student", quote: "Our son learns to respect his elders and his friends. That is the first thing we noticed, long before his marks." },
      { name: "Lakshmi Iyer", role: "Parent of a Class 9 student", quote: "Clear reports, fair teachers and a principal who answers the phone. We have not asked for more." },
    ] }),
    mk("faq", { heading: "Questions parents ask", items: [
      { q: "What do you expect from families?", a: "Regular attendance, a few minutes of reading each day and a warm word about school at home." },
      { q: "How do parents hear about progress?", a: "Two report cards a year, term meetings with the class teacher, and a note whenever a child needs help." },
      { q: "Are there scholarships?", a: "We offer a small number of fee concessions each year. Ask the office for the current details." },
    ] }),
    mk("cta", { heading: "Come and see the school for yourself", text: "Book a visit. Walk the corridors, meet the teachers and ask us anything.", ctaLabel: "Apply for admission", ctaHref: "/admissions" }),
  ],

  modern: (s) => [
    mk("hero", { eyebrow: "New age learning", heading: "Learning that looks ahead", subheading: `${s.name}${town(s)} builds the skills children need next. Short classes. Real projects. Teachers who coach.`, ctaLabel: "Apply for admission", ctaHref: "/admissions", cta2Label: "Book a visit", cta2Href: "/contact", imageUrl: PHOTO.lab }),
    mk("stats", { items: [{ value: "20", label: "Students per class" }, { value: "4", label: "Science and computer labs" }, { value: "30", label: "Clubs to join" }, { value: "100%", label: "Classrooms with digital boards" }] }),
    mk("features", { heading: "Skills for life", intro: "Every class builds the skills that colleges and employers ask for.", items: [
      { title: "Coding from Class 3", text: "Block coding first, then real code. Every child builds a small game." },
      { title: "Public speaking", text: "A short talk every week, in front of friends. Confidence grows fast." },
      { title: "Problem solving", text: "Puzzles and projects that have no single right answer." },
      { title: "Digital safety", text: "Safe habits online, taught early and repeated often." },
      { title: "Teamwork", text: "Group tasks with clear roles, so every child has a part to play." },
    ] }),
    mk("image_text", { heading: "Learn by doing", body: "In our labs, children test their own ideas. They build, break and build again.\n\nNothing is copied from the board. Every experiment starts with a question a child has asked.", imageUrl: PHOTO.childStudying, side: "left" }),
    mk("steps", { heading: "How a project works", intro: "Each project runs for four weeks, in teams of four to six.", items: [
      { title: "Find a problem", text: "Children pick a real problem in school or at home." },
      { title: "Research and plan", text: "They read, ask experts and draw up a plan." },
      { title: "Build a prototype", text: "Using the labs, the art room and the tools." },
      { title: "Present to the class", text: "Every team shows what worked and what did not." },
    ] }),
    mk("table", { heading: "Clubs this term", intro: "Clubs meet after school. Join as many as you like.", columns: ["Club", "Day", "Time"], rows: [
      ["Robotics", "Tuesday", "3.30 pm"], ["Debate", "Wednesday", "3.30 pm"], ["Young coders", "Thursday", "3.30 pm"], ["Eco warriors", "Friday", "3.30 pm"],
    ], note: "Sample timings. Replace them with your own." }),
    mk("gallery", { heading: "In the labs and clubs", images: [
      sample(PHOTO.art, "Replace with your own art club."), sample(PHOTO.teacherClass, "Replace with your own robotics club."), sample(PHOTO.childWriting, "Replace with your own debate."),
    ] }),
    mk("events", { heading: "What is happening", limit: 4 }),
    mk("news", { heading: "Latest from campus", limit: 4 }),
    mk("testimonials", { heading: "Parents on the new way", items: [
      { name: "Deepa Krishnan", role: "Parent of a Class 5 student", quote: "My daughter builds small robots at home now. She explains the code to her grandfather." },
      { name: "Sameer Khan", role: "Parent of a Class 8 student", quote: "The project work made him ask better questions. He stopped copying and started testing ideas." },
    ] }),
    mk("staff", { heading: "Our mentors", limit: 6 }),
    mk("faq", { heading: "Quick answers", items: [
      { q: "Do you teach coding?", a: "Yes, from Class 3. Children start with blocks and move on to a real language." },
      { q: "Is there homework?", a: "Yes, but it is short and tied to the project in hand." },
      { q: "Can my child join mid-year?", a: "That depends on seats. Send an enquiry and the office will tell you." },
    ] }),
    mk("cta", { heading: "Come and try a class", text: "Book a visit. Sit in on a lab session and see the work for yourself.", ctaLabel: "Apply for admission", ctaHref: "/admissions" }),
  ],

  minimal: (s) => [
    mk("hero", { heading: "A quiet place to learn.", subheading: `A small school${town(s)} with calm classrooms and kind teachers. Come and see it.`, ctaLabel: "Apply for admission", ctaHref: "/admissions", cta2Label: "Contact us", cta2Href: "/contact", imageUrl: PHOTO.library }),
    mk("rich_text", { heading: "Our approach", body: "We keep classes small.\n\nWe teach slowly and clearly.\n\nWe give children time to think." }),
    mk("features", { heading: "What we keep", items: [
      { title: "Small classes", text: "Twenty students at most, so each child is seen." },
      { title: "Clear feedback", text: "Notes that tell you what your child can do next." },
      { title: "Time to play", text: "Real breaks, outdoors, every day." },
    ] }),
    mk("image_text", { heading: "A word from the principal", body: "Children learn best when they feel safe.\n\nWe keep our days simple. Our doors are open to you.", imageUrl: PHOTO.teacherHelping, role: "Principal", side: "right" }),
    mk("stats", { items: [{ value: "800", label: "Students" }, { value: "45", label: "Teachers" }, { value: "1:15", label: "Teacher to student ratio" }] }),
    mk("gallery", { heading: "Inside the school", images: [
      sample(PHOTO.classroom, "Replace with your own classroom."), sample(PHOTO.childStudying, "Replace with your own reading corner."), sample(PHOTO.art, "Replace with your own art room."),
    ] }),
    mk("staff", { heading: "Our teachers", limit: 6 }),
    mk("events", { heading: "Coming up", limit: 2 }),
    mk("testimonials", { heading: "Parents", items: [
      { name: "Anita Joshi", role: "Parent of a Class 3 student", quote: "A calm school with kind teachers. Our son is happy to go." },
      { name: "Rohan Das", role: "Parent of a Class 6 student", quote: "Clear reports and no fuss. We know exactly how she is doing." },
    ] }),
    mk("faq", { heading: "Good to know", items: [
      { q: "Do you have a bus?", a: "Yes. Ask the office for the routes near you." },
      { q: "Can I visit before I apply?", a: "Yes. Send a short note and we will fix a time." },
    ] }),
    mk("cta", { heading: "Visit us. Then decide.", text: "Come for a short visit. There is no pressure.", ctaLabel: "Apply for admission", ctaHref: "/admissions" }),
  ],

  campus: (s) => {
    const exams = s.board ? `${s.board} board exams` : "board exams";
    return [
      mk("hero", { eyebrow: "Senior secondary school", heading: "A large campus with a clear path to college", subheading: `${s.name}${town(s)} offers Science, Commerce and Humanities. Labs, sports fields, a library and transport on every route.`, ctaLabel: "Apply for admission", ctaHref: "/admissions", cta2Label: "See our results", cta2Href: "/academics", imageUrl: PHOTO.campus }),
      mk("stats", { items: [{ value: "2,000", label: "Students" }, { value: "90", label: "Teachers" }, { value: "3", label: "Streams" }, { value: "40", label: "Clubs and teams" }] }),
      mk("table", { heading: "Streams we offer", intro: "Pick one stream in Class 11. Each stream has its own labs, teachers and career guidance.", columns: ["Stream", "Main subjects", "Common paths after Class 12"], rows: [
        ["Science", "Physics, Chemistry, Maths, Biology", "Engineering, medicine, research"],
        ["Commerce", "Accountancy, Economics, Business Studies", "Chartered accountancy, management, banking"],
        ["Humanities", "History, Political Science, Psychology", "Law, civil services, design, teaching"],
      ], note: "Subjects may change. Ask the office for the current list." }),
      mk("features", { heading: "Results that come from steady work", intro: "We test often, so every child knows where they stand before the board exams.", items: [
        { title: "Weekly tests", text: "Short tests every week, with feedback within two days." },
        { title: "Mock board exams", text: "Full-length papers, checked and returned with notes." },
        { title: "Doubt classes", text: "Extra sessions after school for any subject." },
        { title: "Career guidance", text: "Counsellors help students choose a stream and a college path." },
      ] }),
      mk("rich_text", { heading: "Board results", body: `Our students sit the ${exams} each year. Results for the last three years are published on our mandatory disclosure page.\n\nThe figures on this page are sample numbers. Replace them with your own before you publish.` }),
      mk("features", { heading: "Sports and campus life", items: [
        { title: "Sports ground", text: "A full size football ground and an athletics track." },
        { title: "Courts", text: "Basketball, badminton and table tennis, with trained coaches." },
        { title: "Music and drama", text: "A hall for concerts, plays and the annual day." },
        { title: "Clubs", text: "Debate, robotics, photography and model United Nations." },
      ] }),
      mk("gallery", { heading: "Sports, labs and the library", images: [
        sample(PHOTO.track, "Replace with your own track."), sample(PHOTO.lab, "Replace with your own science lab."),
        sample(PHOTO.library, "Replace with your own library."), sample(PHOTO.hall, "Replace with your own hall."),
      ] }),
      mk("image_text", { heading: "Hostel and transport", body: "Our hostel has supervised rooms, a warm mess and a study hour every evening. Buses run on fixed routes with GPS tracking and a lady attendant.\n\nFamilies can ask the office for the hostel rules and bus routes.", imageUrl: PHOTO.group, side: "left" }),
      mk("events", { heading: "Events and competitions", limit: 4 }),
      mk("news", { heading: "Notices and circulars", limit: 4 }),
      mk("faq", { heading: "Questions from families", items: [
        { q: "Do you have a hostel for boys and girls?", a: "Yes, with separate blocks, a warden and a night guard." },
        { q: "How are fees paid?", a: "Online or at the office, in monthly or quarterly instalments." },
        { q: "Can a student take coaching outside school?", a: "Yes. Tell the office, so that the class timetable can be planned around it." },
      ] }),
      mk("cta", { heading: "Plan the next two years with us", text: "Book a visit, meet the stream heads and see the labs.", ctaLabel: "Apply for admission", ctaHref: "/admissions" }),
    ];
  },

  playful: (s) => [
    mk("hero", { eyebrow: "For little ones", heading: "Where little ones love to learn", subheading: `${s.name}${town(s)} is a happy place for play, stories and new friends. Safe, warm and full of fun.`, ctaLabel: "Apply for admission", ctaHref: "/admissions", cta2Label: "Visit us", cta2Href: "/contact", imageUrl: PHOTO.children }),
    mk("features", { heading: "Play is how children learn", intro: "Every day has time to play, sing, paint and dance.", items: [
      { title: "Story time", text: "A new story every day, with pictures and funny voices." },
      { title: "Art and colours", text: "Paint, crayons and clay, with no wrong way to do it." },
      { title: "Music and movement", text: "Songs, rhymes and dance for every class." },
      { title: "Outdoor play", text: "Slides, sand and swings in the fresh air, every day." },
      { title: "New friends", text: "Group games that help children share and take turns." },
    ] }),
    mk("image_text", { heading: "Hello, parents", body: "Your child is in good hands. Our teachers know every child by name, and they keep a note of each small win.\n\nIf your child is unsure on the first day, we will call you. You are always welcome to visit.", imageUrl: PHOTO.teacherHelping, role: "Head of the early years", side: "right" }),
    mk("steps", { heading: "A happy day", intro: "The day follows a gentle rhythm, so children feel safe.", items: [
      { title: "Hello circle", text: "Songs and a hello to every friend." },
      { title: "Play and learn", text: "Blocks, letters and numbers, all through play." },
      { title: "Lunch together", text: "A simple, healthy meal, eaten at a small table." },
      { title: "Rest and story", text: "A quiet time, then a story before going home." },
    ] }),
    mk("stats", { items: [{ value: "12", label: "Children in each class" }, { value: "1:6", label: "Teacher for every six children" }, { value: "4", label: "Meals and snacks a day" }] }),
    mk("features", { heading: "Safety first", items: [
      { title: "Gated entry", text: "Every gate has a guard and a visitor log." },
      { title: "Pick up by name", text: "Children go home only with the adults on the list." },
      { title: "First aid", text: "Trained staff and a first-aid room on campus." },
      { title: "CCTV", text: "Cameras cover the playground, the corridors and the gates." },
    ] }),
    mk("gallery", { heading: "Happy moments", images: [
      sample(PHOTO.children, "Replace with your own photo."), sample(PHOTO.childWriting, "Replace with your own photo."),
      sample(PHOTO.art, "Replace with your own photo."), sample(PHOTO.pupils, "Replace with your own photo."),
    ] }),
    mk("faq", { heading: "Questions parents ask", items: [
      { q: "Do you have day care?", a: "Yes. Day care runs after school hours. Ask the office for the timings." },
      { q: "What do you serve for lunch?", a: "A simple, home style meal. The menu changes each week and is shared with parents." },
      { q: "Can my child start mid-year?", a: "Yes, if there is a seat. Send an enquiry and we will let you know." },
    ] }),
    mk("testimonials", { heading: "What parents say", items: [
      { name: "Meena Iyer", role: "Parent of a Nursery child", quote: "My son used to cry at the gate. Now he runs in before I can say goodbye." },
      { name: "Rahul Kapoor", role: "Parent of an LKG child", quote: "She sings the rhymes at dinner. The teachers clearly enjoy their work, and it shows." },
      { name: "Priya Nair", role: "Parent of a UKG child", quote: "The daily notes tell me what she did. I feel close to her day." },
    ] }),
    mk("events", { heading: "Fun days coming up", limit: 3 }),
    mk("news", { heading: "Notes for parents", limit: 3 }),
    mk("cta", { heading: "Come and play with us", text: "Book a visit. Your child can meet the teachers and see the playground.", ctaLabel: "Apply for admission", ctaHref: "/admissions" }),
  ],
};

/** A complete starter site for one design: the default inner pages plus a home page written for that design. */
export function starterSite(template: TemplateKey, school: SchoolInfo, now = new Date()): SiteContent {
  const site = defaultSite(school, now);
  site.pages = site.pages.map((p) => (p.slug === HOME_SLUG ? { ...p, sections: HOMES[template](school) } : p));
  return site;
}
