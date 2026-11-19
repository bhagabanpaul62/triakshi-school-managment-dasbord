import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { HomeService } from "../home-service";
import { AccountantHomeView } from "./accountant-home";
import { AdminHomeView } from "./admin-home";
import { ChildSwitcher } from "./child-switcher";
import { ParentHomeView } from "./parent-home";
import { StudentHomeView } from "./student-home";
import { TeacherHomeView } from "./teacher-home";

export const metadata = { title: "Home" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** /app: the home page of whoever is signed in. Every panel loads on its own and fails on its own. */
export default async function HomePage({ searchParams }: { searchParams?: SearchParams }) {
  const ctx = await requireCtx();
  const child = (await searchParams)?.child;
  const home = await new HomeService(ctx).forRole({ childId: Array.isArray(child) ? child[0] : child });
  const header = home.data.header;
  const switcher = home.role === "parent" && home.data.children.length > 1 && home.data.child
    ? <ChildSwitcher value={home.data.child.id} kids={home.data.children} /> : undefined;

  return (
    <>
      <PageHeader eyebrow="Home" title={header.greeting} description={header.line} actions={switcher} />
      {home.role === "admin" ? <AdminHomeView d={home.data} />
        : home.role === "accountant" ? <AccountantHomeView d={home.data} />
        : home.role === "teacher" ? <TeacherHomeView d={home.data} />
        : home.role === "student" ? <StudentHomeView d={home.data} />
        : <ParentHomeView d={home.data} />}
    </>
  );
}
