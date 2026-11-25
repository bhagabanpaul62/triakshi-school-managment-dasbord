import UserPage, { metadata } from "@smw/feature-settings/ui/user-page";
import { FEATURES } from "@/generated/features";

export { metadata };

export default function Page(props: { params: Promise<{ id: string }> }) {
  return <UserPage {...props} catalogue={FEATURES} />;
}
