import YearClosePage from "@smw/feature-finance/ui/year-close-page";
import { CLOSE_BLOCKERS, FINANCE_CHECKS } from "@/lib/finance-checks";
import { closeYear, requestReopen } from "./actions";

export const metadata = { title: "Year close" };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <YearClosePage searchParams={searchParams} options={{ checks: FINANCE_CHECKS, blockers: CLOSE_BLOCKERS }} run={closeYear} reopen={requestReopen} />;
}
