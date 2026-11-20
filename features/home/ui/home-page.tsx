import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { HomeService } from "../home-service";
import { AccountantHomeView } from "./accountant-home";
import { AdminHomeView } from "./admin-home";
import { StaffHomeView } from "./staff-home";
import { StudentHomeView } from "./student-home";
import { TeacherHomeView } from "./teacher-home";

export const metadata = { title: "Home" };

/** /app: the home page of whoever is signed in. Every panel loads on its own and fails on its own. */
export default async function HomePage() {
  const ctx = await requireCtx();
  const home = await new HomeService(ctx).forRole();
  const header = home.data.header;

  return (
    <>
      <PageHeader eyebrow="Home" title={header.greeting} description={header.line} />
      {home.role === "admin" ? <AdminHomeView d={home.data} />
        : home.role === "accountant" ? <AccountantHomeView d={home.data} />
        : home.role === "teacher" ? <TeacherHomeView d={home.data} />
        : home.role === "student" ? <StudentHomeView d={home.data} />
        : <StaffHomeView d={home.data} />}
    </>
  );
}
