import { redirect } from "next/navigation";
import { DONE_HREF, stepHref } from "../steps";
import { loadWizard } from "./frame";

export const metadata = { title: "Set up your school" };

/** /app/setup: send the admin to the first step still to do (required ones first), or to the review page. */
export default async function SetupIndexPage() {
  const { progress } = await loadWizard();
  if (progress.completedAt) redirect("/app");
  redirect(progress.next ? stepHref(progress.next) : DONE_HREF);
}
