import ApprovalsPage from "@smw/feature-finance/ui/approvals-page";
import { APPROVAL_HANDLERS } from "@/lib/approval-handlers";
import { approve, reject, withdraw } from "./actions";

export const metadata = { title: "Approvals" };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ApprovalsPage searchParams={searchParams} handlers={APPROVAL_HANDLERS} approve={approve} reject={reject} withdraw={withdraw} />;
}
