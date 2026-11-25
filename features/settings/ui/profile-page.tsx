import { SchoolAuth } from "@smw/auth";
import Link from "next/link";
import { getSession, requireCtx } from "@smw/runtime";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { Inset, Panel } from "@smw/ui/kit/Panel";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import { PageHeader, PanelGrid } from "@smw/ui/shell/PageHeader";
import { dateTime, shortDate } from "@smw/ui/format";
import { ProfileService, alertsNewDevice } from "../service";
import { SignInService } from "../signin-service";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { changeMyPassword, confirmMyEmailCode, sendMyVerifyCode, setMyPhoto, setNewDeviceAlert, updateMyDetails, verifyMyEmailCode } from "./profile-actions";
import { METHOD_LABELS, OUTCOME_LABELS, OUTCOME_TONES, ROLE_LABELS } from "./labels";
import { detailFields, passwordFields, photoFields } from "./profile-fields";
import { deviceLabel } from "./profile-device";
import { ProfileSessions } from "./profile-sessions";
import { EmailCodeBox } from "./profile-email-code";

export const metadata = { title: "My profile" };

/** Every role: my details, my password and the devices signed in as me. `record` is the school record (student or staff) the route adds. */
export default async function ProfilePage({ record }: { record?: React.ReactNode } = {}) {
  const ctx = await requireCtx();
  const session = (await getSession())!;
  const [me, sessions, signIns] = await Promise.all([new ProfileService(ctx).me(), new SchoolAuth(ctx.schoolId).listSessions(ctx.userId, session.sessionId), new SignInService(ctx).history(ctx.userId, 10)]);
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
          <Panel title="Your preferences">
            <ul className="flex flex-col">
              {([["/app/notifications/preferences", "Notification settings", "What reaches your phone and email, quiet hours, when you are away"], ["/app/profile/data", "My data", "See what the school holds about you; correct it, delete it or get a copy"]] as const).map(([href, t, hint]) => (
                <li key={href}><Link href={href} className="block min-h-11 rounded-xl px-3 py-2 transition-colors hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]"><span className="block text-sm text-[var(--ds-on-surface)]">{t}</span><span className="block text-xs text-[var(--ds-on-surface-muted)]">{hint}</span></Link></li>
              ))}
            </ul>
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
        <div className="lg:col-span-12">
          <Panel title="Your recent sign-ins" action={me.email ? (
            <ActionButton label={alertsNewDevice(me) ? "Stop new-device emails" : "Email me about new devices"} action={setNewDeviceAlert} values={{ on: alertsNewDevice(me) ? "0" : "1" }} />
          ) : null}>
            {signIns.length ? (
              <ul className="flex flex-col">
                {signIns.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-2 py-2 text-sm">
                    <ToneBadge label={OUTCOME_LABELS[h.outcome] ?? h.outcome} tone={OUTCOME_TONES[h.outcome]} />
                    <span className="text-[var(--ds-on-surface)]">{h.device}{h.newDevice ? " (new device)" : ""}</span>
                    <span className="text-xs text-[var(--ds-on-surface-muted)]">{METHOD_LABELS[h.method]} · {h.ip ?? "unknown address"} · {dateTime(h.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-[var(--ds-on-surface-muted)]">Nothing recorded yet. Your sign-ins show here from now on. If one is not you, change your password.</p>}
          </Panel>
        </div>
      </PanelGrid>
    </>
  );
}
