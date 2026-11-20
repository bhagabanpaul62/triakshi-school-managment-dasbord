import { requireCtx } from "@smw/runtime";
import ProfilePage from "@smw/feature-settings/ui/profile-page";
import StudentRecord from "@smw/feature-students/ui/my-record";
import StaffRecord from "@smw/feature-staff/ui/my-record";
import { MyHouse } from "@smw/feature-academics/ui/my-house";

export { metadata } from "@smw/feature-settings/ui/profile-page";

/** My profile = the account (settings) plus the person's school record, composed here so no feature imports another. */
export default async function Page() {
  const ctx = await requireCtx();
  return <ProfilePage record={ctx.role === "student" ? <><StudentRecord ctx={ctx} />{ctx.features.has("academics") ? <MyHouse /> : null}</> : <StaffRecord ctx={ctx} />} />;
}
