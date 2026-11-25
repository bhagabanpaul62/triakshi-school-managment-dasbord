import RolesPage, { metadata } from "@smw/feature-settings/ui/roles-page";
import { FEATURES } from "@/generated/features";
import { copyRole, createRole, deleteRole, updateRole } from "../role-actions";

export { metadata };

export default function Page() {
  return <RolesPage catalogue={FEATURES} actions={{ create: createRole, update: updateRole, copy: copyRole, remove: deleteRole }} />;
}
