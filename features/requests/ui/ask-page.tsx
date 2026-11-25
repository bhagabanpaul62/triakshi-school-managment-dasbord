import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { CategoryService } from "../categories";
import { linkFromQuery } from "../inputs";
import { RequestService } from "../service";
import { AskForm } from "./ask-form";
import { BackLink, Notice, NoAccess, canWriteFor, isFamilyRole, one, type Search } from "./shared";
import { askContext, findStudents, raiseRequest } from "./actions";

export const metadata = { title: "Ask the school" };

/** `about` (what it is about) and `href` (where it lives, an in-app path) come from an "Ask about this" button on a notice, receipt or result. */
export default async function AskPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const family = isFamilyRole(ctx);
  if (!family && !canWriteFor(ctx)) return <NoAccess what="Writing a request for a family" who="the school office" />;
  const [categories, context] = await Promise.all([new CategoryService(ctx).options(), new RequestService(ctx).askContext()]);
  const link = linkFromQuery(one(sp.about), one(sp.href));
  return (
    <>
      <BackLink href="/app/requests">{family ? "My requests" : "Queue"}</BackLink>
      <PageHeader eyebrow="Communication" title={family ? "Ask the school" : "Write down a request"} description={family ? "Choose what it is about, then tell us. We will reply here, and tell you when we do." : "For a family who asked by phone or in person. They are told and can follow it from their login."} />
      {family && !context.child ? <Notice tone="warning">Your login is not linked to a student yet, so we cannot take a request. Please call the school office.</Notice> : null}
      <AskForm categories={categories} child={context.child} office={context.office} initialPeople={context.people} link={link} defaultCategory={one(sp.category)} action={raiseRequest} students={findStudents} context={askContext} />
    </>
  );
}
