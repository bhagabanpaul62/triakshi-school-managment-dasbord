import JournalPage from "@smw/feature-finance/ui/journal-page";
import { sourceHref } from "@/lib/finance-links";

export const metadata = { title: "Journal entry" };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <JournalPage params={params} sourceHref={sourceHref} />;
}
