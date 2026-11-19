import { requireCtx } from "@smw/runtime";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { Inset, Panel } from "@smw/ui/kit/Panel";
import { FormModal } from "@smw/ui/shell/FormModal";
import { PageHeader, PanelGrid } from "@smw/ui/shell/PageHeader";
import { dateTime, shortDate } from "@smw/ui/format";
import { ProfileService } from "../service";
import { changeMyPassword, updateMyProfile } from "./actions";
import { ROLE_LABELS } from "./labels";
import { passwordFields, profileFields } from "./fields";

export const metadata = { title: "My profile" };

/** Every role: my details and my password. */
export default async function ProfilePage() {
  const me = await new ProfileService(await requireCtx()).me();
  return (
    <>
      <PageHeader eyebrow={ROLE_LABELS[me.role] ?? me.role} title={me.name} description="Your account on this school's dashboard."
        actions={<FormModal title="Edit my details" icon="user" fields={profileFields} values={{ ...me }} action={updateMyProfile} trigger={{ label: "Edit details", variant: "secondary" }} />} />
      <PanelGrid>
        <div className="lg:col-span-7">
          <Panel title="Details">
            <FactList>
              <Fact label="Name">{me.name}</Fact>
              <Fact label="Role">{ROLE_LABELS[me.role] ?? me.role}</Fact>
              <Fact label="Sign in with" copy={me.loginId}>{me.loginId}</Fact>
              <Fact label="Email" copy={me.email ?? undefined}>{me.email}</Fact>
              <Fact label="Mobile" copy={me.phone ?? undefined}>{me.phone}</Fact>
              <Fact label="Last sign-in">{me.lastLoginAt ? dateTime(me.lastLoginAt) : null}</Fact>
              <Fact label="Account created">{shortDate(me.createdAt)}</Fact>
            </FactList>
          </Panel>
        </div>
        <div className="lg:col-span-5">
          <Panel title="Password">
            <Inset>
              <p className="text-sm text-[var(--ds-on-surface)]">Use a password only you know, at least 8 characters.</p>
              <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">
                {me.email ? `Forgot it? Ask your school office to email a reset link to ${me.email}.` : "You have no email on file, so a reset link cannot reach you. Add one with Edit details."}
              </p>
            </Inset>
            <div className="mt-4">
              <FormModal title="Change password" icon="shield" fields={passwordFields} action={changeMyPassword} submitLabel="Change password" size="sm"
                trigger={{ label: "Change password", variant: "secondary" }} />
            </div>
          </Panel>
        </div>
      </PanelGrid>
    </>
  );
}
