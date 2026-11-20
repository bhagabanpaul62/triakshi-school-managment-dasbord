import SettingsPage, { metadata } from "@smw/feature-settings/ui/settings-page";
import { FEATURES } from "@/generated/features";
import { copyRole, createRole, deleteRole, updateRole } from "./role-actions";

export { metadata };

export default function Page(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SettingsPage {...props} catalogue={FEATURES} roleActions={{ create: createRole, update: updateRole, copy: copyRole, remove: deleteRole }} />;
}
