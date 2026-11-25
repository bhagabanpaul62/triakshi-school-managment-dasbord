import RolePage, { metadata } from "@smw/feature-settings/ui/role-page";
import { FEATURES } from "@/generated/features";
import { copyRole, createRole, deleteRole, updateRole } from "../../role-actions";

export { metadata };

export default function Page(props: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <RolePage {...props} catalogue={FEATURES} actions={{ create: createRole, update: updateRole, copy: copyRole, remove: deleteRole }} />;
}
