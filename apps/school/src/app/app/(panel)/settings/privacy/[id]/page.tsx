import PrivacyDetailPage, { metadata } from "@smw/feature-settings/ui/privacy-detail-page";
import { ErasureCard } from "./erase-card";

export { metadata };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PrivacyDetailPage id={(await params).id} erasure={(r) => <ErasureCard studentId={r.subjectType === "student" ? r.subjectId : null} requestId={r.id} />} />;
}
