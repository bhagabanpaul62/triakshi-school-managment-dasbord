import type { FeatureSeed } from "@smw/feature-kit";
import { BookService, LoanService } from "./service";
import { addDays, todayIST } from "./rules";

// [title, author, category, language, publisher]
const BOOKS: [string, string, string, string, string][] = [
  ["Wings of Fire", "A. P. J. Abdul Kalam", "Biography", "English", "Universities Press"],
  ["Malgudi Days", "R. K. Narayan", "Fiction", "English", "Indian Thought Publications"],
  ["Swami and Friends", "R. K. Narayan", "Fiction", "English", "Indian Thought Publications"],
  ["The Guide", "R. K. Narayan", "Fiction", "English", "Indian Thought Publications"],
  ["Discovery of India", "Jawaharlal Nehru", "History", "English", "Oxford University Press"],
  ["Gitanjali", "Rabindranath Tagore", "Poetry", "English", "Macmillan"],
  ["The Postmaster and Other Stories", "Rabindranath Tagore", "Fiction", "English", "Macmillan"],
  ["Godan", "Munshi Premchand", "Classics", "Hindi", "Rajpal and Sons"],
  ["Idgah aur Anya Kahaniyan", "Munshi Premchand", "Classics", "Hindi", "Rajpal and Sons"],
  ["Madhushala", "Harivansh Rai Bachchan", "Poetry", "Hindi", "Hind Pocket Books"],
  ["Panchatantra Stories", "Vishnu Sharma", "Children", "English", "Amar Chitra Katha"],
  ["Tales of Tenali Raman", "Traditional", "Children", "English", "Amar Chitra Katha"],
  ["Akbar and Birbal", "Traditional", "Children", "English", "Amar Chitra Katha"],
  ["The Room on the Roof", "Ruskin Bond", "Fiction", "English", "Penguin India"],
  ["The Blue Umbrella", "Ruskin Bond", "Children", "English", "Rupa Publications"],
  ["Rusty the Boy from the Hills", "Ruskin Bond", "Children", "English", "Penguin India"],
  ["The Jungle Book", "Rudyard Kipling", "Classics", "English", "Puffin Classics"],
  ["Gulliver's Travels", "Jonathan Swift", "Classics", "English", "Penguin Classics"],
  ["Treasure Island", "Robert Louis Stevenson", "Classics", "English", "Puffin Classics"],
  ["Oliver Twist", "Charles Dickens", "Classics", "English", "Penguin Classics"],
  ["Alice's Adventures in Wonderland", "Lewis Carroll", "Classics", "English", "Puffin Classics"],
  ["Pride and Prejudice", "Jane Austen", "Classics", "English", "Penguin Classics"],
  ["Julius Caesar", "William Shakespeare", "Classics", "English", "Oxford School Shakespeare"],
  ["Karvalo", "K. P. Poornachandra Tejaswi", "Fiction", "Kannada", "Pustaka Prakashana"],
  ["Chomana Dudi", "K. Shivarama Karanth", "Classics", "Kannada", "Sahitya Akademi"],
  ["Shyamchi Aai", "Sane Guruji", "Classics", "Marathi", "Sadhana Prakashan"],
  ["Batatyachi Chal", "P. L. Deshpande", "Fiction", "Marathi", "Mouj Prakashan"],
  ["Pather Panchali", "Bibhutibhushan Bandyopadhyay", "Classics", "Bengali", "Mitra and Ghosh"],
  ["Mathematics Textbook for Class 6", "NCERT", "Textbook", "English", "NCERT"],
  ["Mathematics Textbook for Class 7", "NCERT", "Textbook", "English", "NCERT"],
  ["Mathematics Textbook for Class 8", "NCERT", "Textbook", "English", "NCERT"],
  ["Mathematics Textbook for Class 9", "NCERT", "Textbook", "English", "NCERT"],
  ["Mathematics Textbook for Class 10", "NCERT", "Textbook", "English", "NCERT"],
  ["Science Textbook for Class 6", "NCERT", "Textbook", "English", "NCERT"],
  ["Science Textbook for Class 8", "NCERT", "Textbook", "English", "NCERT"],
  ["Science Textbook for Class 9", "NCERT", "Textbook", "English", "NCERT"],
  ["Science Textbook for Class 10", "NCERT", "Textbook", "English", "NCERT"],
  ["Our Pasts I (History, Class 6)", "NCERT", "History", "English", "NCERT"],
  ["India and the Contemporary World I", "NCERT", "History", "English", "NCERT"],
  ["Contemporary India I (Geography, Class 9)", "NCERT", "Textbook", "English", "NCERT"],
  ["Democratic Politics I", "NCERT", "Textbook", "English", "NCERT"],
  ["Beehive (English, Class 9)", "NCERT", "Language", "English", "NCERT"],
  ["Vasant Bhag 1 (Hindi, Class 6)", "NCERT", "Language", "Hindi", "NCERT"],
  ["Malhar (Hindi, Class 7)", "NCERT", "Language", "Hindi", "NCERT"],
  ["Concepts of Physics Part 1", "H. C. Verma", "Science", "English", "Bharati Bhawan"],
  ["Concepts of Physics Part 2", "H. C. Verma", "Science", "English", "Bharati Bhawan"],
  ["Selina Concise Mathematics Class 10", "R. K. Bansal", "Mathematics", "English", "Selina Publishers"],
  ["Mathematical Olympiad Primer", "V. Krishnamurthy", "Mathematics", "English", "Universities Press"],
  ["Surely You're Joking, Mr. Feynman", "Richard P. Feynman", "Science", "English", "Penguin"],
  ["A Brief History of Time", "Stephen Hawking", "Science", "English", "Bantam Books"],
  ["Oxford Student Atlas for India", "Oxford University Press", "Reference", "English", "Oxford University Press"],
  ["Oxford Advanced Learner's Dictionary", "A. S. Hornby", "Reference", "English", "Oxford University Press"],
  ["Hindi-English Shabdkosh", "Bhargava", "Reference", "Hindi", "Bhargava Book Depot"],
  ["Children's Encyclopedia", "DK Publishing", "Reference", "English", "Dorling Kindersley"],
  ["Mahatma Gandhi: My Experiments with Truth", "M. K. Gandhi", "Biography", "English", "Navajivan Trust"],
  ["Ignited Minds", "A. P. J. Abdul Kalam", "General", "English", "Penguin India"],
  ["The Story of My Life", "Helen Keller", "Biography", "English", "Puffin Classics"],
  ["Ramayana for Children", "C. Rajagopalachari", "General", "English", "Bharatiya Vidya Bhavan"],
  ["Mahabharata for Children", "C. Rajagopalachari", "General", "English", "Bharatiya Vidya Bhavan"],
  ["Chacha Chaudhary Comics Collection", "Pran Kumar Sharma", "Children", "Hindi", "Diamond Comics"],
];

/** 60 books with 1-3 copies each, and 30 loans: some out, some overdue, some already back (a few of those late, with fines). */
const seed: FeatureSeed = async (ctx, state) => {
  const books = new BookService(ctx);
  const loans = new LoanService(ctx);
  const made: string[] = [];
  for (const [i, [title, author, category, language, publisher]] of BOOKS.entries()) {
    const b = await books.create({ title, author, category, language, publisher, copies: (i % 3) + 1, shelf: `${"ABCDEF"[i % 6]}-${(i % 4) + 1}` });
    made.push(b.id);
  }

  const copyIds: string[] = [];
  for (const id of made) for (const c of (await books.detail(id)).copies) copyIds.push(c.id);

  const kids = ((state.students as { id: string }[] | undefined) ?? []).slice(0, 40);
  const teachers = ((state.teachers as { userId: string }[] | undefined) ?? []).slice(0, 4);
  const today = todayIST();
  // [days ago issued, returns?] : 8 overdue and still out, 10 out on time, 12 back (4 of them late)
  const plan: [number, boolean][] = [
    ...Array.from({ length: 8 }, (_, i) => [18 + i * 3, false] as [number, boolean]),
    ...Array.from({ length: 10 }, (_, i) => [1 + i, false] as [number, boolean]),
    ...Array.from({ length: 12 }, (_, i) => [i < 4 ? 20 + i * 2 : 3 + i, true] as [number, boolean]),
  ];
  for (const [n, [ago, back]] of plan.entries()) {
    const copyId = copyIds[(n * 7) % copyIds.length]!;
    const staff = teachers.length && n % 6 === 5 ? teachers[n % teachers.length] : null;
    const kid = kids[n % Math.max(1, kids.length)];
    if (!staff && !kid) break;
    const loan = await loans.issue({ copyId, ...(staff ? { userId: staff.userId } : { studentId: kid!.id }), issuedOn: addDays(today, -ago) });
    if (back) await loans.returnLoan(loan.id);
  }
};
export default seed;
