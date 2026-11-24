import FinanceDashboardPage from "@smw/feature-finance/ui/dashboard-page";
import { FINANCE_CHECKS } from "@/lib/finance-checks";

export const metadata = { title: "Finance" };

export default function Page() {
  return <FinanceDashboardPage checks={FINANCE_CHECKS} />;
}
