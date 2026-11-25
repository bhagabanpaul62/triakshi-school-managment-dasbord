import { SchoolAuth } from "@smw/auth";
import Link from "next/link";
import { getSession, requireCtx } from "@smw/runtime";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { Inset, Panel } from "@smw/ui/kit/Panel";
import { FormModal } from "@smw/ui/shell/FormModal";
import { PageHeader, PanelGrid } from "@smw/ui/shell/PageHeader";
import { dateTime, shortDate } from "@smw/ui/format";
import { ProfileService } from "../service";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { changeMyPassword, confirmMyEmailCode, sendMyVerifyCode, setMyPhoto, updateMyDetails, verifyMyEmailCode } from "./profile-actions";
import { ROLE_LABELS } from "./labels";
import { detailFields, passwordFields, photoFields } from "./profile-fields";
import { deviceLabel } from "./profile-device";
import { ProfileSessions } from "./profile-sessions";
import { EmailCodeBox } from "./profile-email-code";

export const metadata = { title: "My profile" };

/** Every role: my details, my password and the devices signed in as me. `record` is the school record (student or staff) the route adds. */
export default async function ProfilePage({ record }: { record?: React.ReactNode } = {}) {
  const ctx = await requireCtx();
  const session = (await getSession())!;
  const [me, sessions] = await Promise.all([new ProfileService(ctx).me(), new SchoolAuth(ctx.schoolId).listSessions(ctx.userId, session.sessionId)]);
  const role = session.user.roleName ?? ROLE_LABELS[me.role] ?? me.role;
  return (
    <>
      <PageHeader eyebrow={role} title={me.name} description="Your account on this school's dashboard."
        actions={<>
          <FormModal title="Change photo" icon="user" fields={photoFields} action={setMyPhoto} size="sm" trigger={{ label: "Change photo", variant: "secondary" }} />
          <FormModal title="Edit my details" icon="user" fields={detailFields(me.role === "student")} values={{ ...me }} action={updateMyDetails} size="sm" trigger={{ label: "Edit details", variant: "secondary" }} />
        </>} />
      <PanelGrid>
        <div className="lg:col-span-7">
          <Panel title="Details">
            <FactList>
              <Fact label="Name">{me.name}</Fact>
              <Fact label="Role">{role}</Fact>
              <Fact label="Sign in with" copy={me.loginId}>{me.loginId}</Fact>
              <Fact label="Email" copy={me.email ?? undefined}>
                {me.email ? <span className="inline-flex flex-wrap items-center gap-2">{me.email}<ToneBadge label={me.emailVerifiedAt ? "Verified" : "Not verified"} tone={me.emailVerifiedAt ? "success" : "warning"} /></span> : null}
              </Fact>
              <Fact label="Mobile" copy={me.phone ?? undefined}>{me.phone}</Fact>
              <Fact label="Last sign-in">{me.lastLoginAt ? dateTime(me.lastLoginAt) : null}</Fact>
              <Fact label="Account created">{shortDate(me.createdAt)}</Fact>
            </FactList>
            {me.email && !me.emailVerifiedAt ? (
              <EmailCodeBox action={verifyMyEmailCode} send={sendMyVerifyCode} openLabel="Verify my email" label={`Code sent to ${me.email}`} submitLabel="Verify" />
            ) : null}
            <EmailCodeBox action={confirmMyEmailCode} />
          </Panel>
        </div>
        <div className="flex flex-col gap-4 lg:col-span-5">
          <Panel title="Notifications">
            <p className="text-sm text-[var(--ds-on-surface)]">Choose what reaches your phone and email, your quiet hours and when you are away.</p>
            <div className="mt-4">
              <Link href="/app/notifications/preferences" className="inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm text-[var(--ds-on-surface)] transition-colors hover:bg-white/[0.14] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">Notification settings</Link>
            </div>
          </Panel>
          <Panel title="Password">
            <Inset>
              <p className="text-sm text-[var(--ds-on-surface)]">Use a password only you know, at least 8 characters.</p>
              <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">
                {me.email ? `Forgot it? Use "Forgot password" on the sign-in page and we email a code and a link to ${me.email}.` : "You have no email on file, so a reset link cannot reach you. Add one with Edit details, or ask your school office."}
              </p>
            </Inset>
            <div className="mt-4">
              <FormModal title="Change password" icon="shield" fields={passwordFields} action={changeMyPassword} submitLabel="Change password" size="sm"
                trigger={{ label: "Change password", variant: "secondary" }} />
            </div>
          </Panel>
        </div>
        {record ? <div className="flex min-w-0 flex-col gap-4 lg:col-span-12">{record}</div> : null}
        <div className="lg:col-span-12">
          <Panel title="Devices">
            <ProfileSessions sessions={sessions.map((s) => ({ id: s.id, device: deviceLabel(s.userAgent), ip: s.ip, lastSeenAt: s.lastSeenAt, createdAt: s.createdAt, current: s.current }))} />
          </Panel>
        </div>
      </PanelGrid>
    </>
  );
}
