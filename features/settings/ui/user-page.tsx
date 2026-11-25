import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { Inset, Panel } from "@smw/ui/kit/Panel";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import { PanelGrid } from "@smw/ui/shell/PageHeader";
import { buttonVariants } from "@smw/ui/ui/button";
import { dateTime, initials, relative, shortDate } from "@smw/ui/format";
import type { Catalogue } from "../catalogue";
import { STAFF_ROLES } from "../inputs";
import { SignInService } from "../signin-service";
import { UserAdminService } from "../service";
import { changeUserRole, disableUser, enableUser, endUserSession, makeAccessLink, resendInvite, sendPasswordReset, signOutUser } from "./actions";
import { roleFields } from "./fields";
import { METHOD_LABELS, OUTCOME_LABELS, OUTCOME_TONES, ROLE_LABELS, ROLE_TONES, STATUS_LABELS, STATUS_TONES } from "./labels";
import { deviceLabel } from "./profile-device";
import { RevealButton } from "./reveal-button";
import { AdminOnly } from "./states";

export const metadata = { title: "User" };

/** One line of the account panel: what it does, and the control. */
function Line({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/[0.04] px-4 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm text-[var(--ds-on-surface)]">{title}</p>
        <p className="mt-0.5 text-xs text-[var(--ds-on-surface-muted)]">{hint}</p>
      </div>
      {children}
    </div>
  );
}

/** Settings, one login: who they are, what they can do in words, how they sign in, their devices and history, and every action on the account. */
export default async function UserPage({ params, catalogue }: { params: Promise<{ id: string }>; catalogue: Catalogue }) {
  const [ctx, { id }] = await Promise.all([requireCtx(), params]);
  const svc = new UserAdminService(ctx);
  if (!svc.can("manage")) return <AdminOnly title="User" />;
  const [d, roleOptions] = await Promise.all([svc.detail(id, catalogue).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; }), svc.roleOptions()]);
  const history = await new SignInService(ctx).history(id, 15);
  const u = d.user;
  const canAct = !ctx.readOnly && !ctx.supportStaffId;
  const mine = u.id === ctx.userId;
  const staff = (STAFF_ROLES as readonly string[]).includes(u.role);
  const role = u.roleName ?? ROLE_LABELS[u.role] ?? u.role;
  const adminTarget = u.role === "admin" && ctx.role !== "admin";
  const act = canAct && !adminTarget;
  return (
    <>
      <EntityHeader
        back={{ href: "/app/settings/users", label: "Users" }}
        leading={<span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.07] text-base" aria-hidden>{initials(u.name)}</span>}
        title={u.name}
        chips={<><ToneBadge label={role} tone={ROLE_TONES[u.role]} /><ToneBadge label={STATUS_LABELS[u.status]} tone={STATUS_TONES[u.status]} />{mine ? <ToneBadge label="You" /> : null}</>}
        meta={[u.email, u.phone, u.lastLoginAt ? `Last sign-in ${relative(u.lastLoginAt)}` : "Never signed in"]}
        actions={<>
          {d.record ? <Link href={d.record.href} className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>{d.record.kind === "staff" ? "Staff record" : "Student record"}</Link> : null}
          {act && staff && !mine ? <FormModal title={`Change role for ${u.name}`} icon="users" fields={roleFields(roleOptions)} values={{ role: u.roleId ?? u.role }} hidden={{ id: u.id }} action={changeUserRole} trigger={{ label: "Change role", variant: "secondary" }} /> : null}
          {act && u.status === "invited" && u.email ? <ActionButton label="Send invite again" variant="default" action={resendInvite} values={{ id: u.id }} /> : null}
        </>}
      />
      <div className="pt-6" />
      <PanelGrid>
        <div className="flex flex-col gap-3 lg:col-span-7">
          <Panel title="What they can do">
            {d.everything ? <p className="text-sm text-[var(--ds-on-surface)]">Everything in the school. Admins cannot be limited.</p> : d.access.length ? (
              <ul className="flex flex-col gap-2">
                {d.access.map((m) => (
                  <li key={m.key} className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/[0.04] px-4 py-3">
                    <span className="min-w-[8ch] text-sm text-[var(--ds-on-surface)]">{m.name}</span>
                    {m.items.map((i) => <ToneBadge key={i} label={i} />)}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-[var(--ds-on-surface-muted)]">Only the basics below.</p>}
            <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">
              Everyone also gets the home page, notifications, messages and their own profile.{u.roleId ? <> The role is <Link className="underline" href={`/app/settings/roles/${u.roleId}`}>{role}</Link>.</> : staff ? <> See <Link className="underline" href={`/app/settings/roles/${u.role}`}>the {role} role</Link>.</> : null}
            </p>
          </Panel>
          <Panel title="Sign-in history" action={<Link href={`/app/settings/sign-ins?user=${u.id}`} className="text-xs text-[var(--ds-on-surface-muted)] underline">See all</Link>}>
            {history.length ? (
              <ul className="flex flex-col">
                {history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-2 py-2 text-sm">
                    <ToneBadge label={OUTCOME_LABELS[h.outcome] ?? h.outcome} tone={OUTCOME_TONES[h.outcome]} />
                    <span className="text-[var(--ds-on-surface)]">{h.device}{h.newDevice ? " (new device)" : ""}</span>
                    <span className="text-xs text-[var(--ds-on-surface-muted)]">{METHOD_LABELS[h.method]} · {h.ip ?? "unknown address"} · {dateTime(h.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : <WidgetEmptyState title="No sign-ins recorded yet." description="Sign-ins are recorded from now on, and kept for 180 days." />}
          </Panel>
          <Panel title="Recent actions">
            {d.recent.length ? (
              <ul className="flex flex-col">
                {d.recent.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl px-2 py-2 text-sm">
                    <span className="min-w-0 text-[var(--ds-on-surface)]">{a.summary ?? a.module}</span>
                    <span className="text-xs text-[var(--ds-on-surface-muted)]">{dateTime(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : <WidgetEmptyState title="Nothing they changed is on record." description="Their saved changes appear here, newest first." />}
            <div className="mt-3"><Link href={`/app/audit?actor=${u.id}`} className="text-xs text-[var(--ds-on-surface-muted)] underline">Open the audit log for this person</Link></div>
          </Panel>
        </div>
        <div className="flex flex-col gap-3 lg:col-span-5">
          <Panel title="Account">
            <FactList>
              <Fact label="Signs in with" copy={u.loginId}>{u.loginId}</Fact>
              <Fact label="Email" copy={u.email ?? undefined}>{u.email ? <span className="inline-flex flex-wrap items-center gap-2">{u.email}<ToneBadge label={u.emailVerifiedAt ? "Verified" : "Not verified"} tone={u.emailVerifiedAt ? "success" : "warning"} /></span> : null}</Fact>
              <Fact label="Mobile" copy={u.phone ?? undefined}>{u.phone}</Fact>
              <Fact label="Last sign-in" wrap>{u.lastLoginAt ? dateTime(u.lastLoginAt) : null}</Fact>
              <Fact label="Added">{shortDate(u.createdAt)}</Fact>
              <Fact label="Password">{u.status === "invited" ? "Not set yet" : u.mustChangePassword ? "Must be changed at next sign-in" : "Set by them"}</Fact>
            </FactList>
          </Panel>
          {act ? (
            <Panel title="Password and access">
              <div className="flex flex-col gap-2">
                {u.status !== "disabled" ? (
                  <>
                    <Line title="Password" hint={u.email ? "Email a link, or give a temporary password to read out or print." : "No email on file. Give a temporary password, or copy an access link."}>
                      {u.email ? <ActionButton variant="secondary" label="Email link" action={sendPasswordReset} values={{ id: u.id, mode: "email" }}
                        confirm={{ title: `Email a reset link to ${u.name}?`, body: `A link to set a new password goes to ${u.email}. It works for 24 hours.`, confirmLabel: "Send link" }} /> : null}
                      <RevealButton label="Temporary password" action={sendPasswordReset} values={{ id: u.id, mode: "temporary" }} valueKey="temporaryPassword" title={`Temporary password for ${u.name}`}
                        confirm="This replaces their password and signs them out everywhere. They must choose a new password when they sign in." note={`Shown once. Sign-in ID: ${u.loginId}. They must change it at first sign-in.`} />
                    </Line>
                    <Line title="Access link" hint="A fresh link, valid 7 days, to paste into WhatsApp. It opens the page where they set a password.">
                      <RevealButton label="Copy access link" action={makeAccessLink} values={{ id: u.id }} valueKey="url" title={`Access link for ${u.name}`}
                        note="Valid for 7 days and works once. Anyone with the link can set the password, so share it only with them." />
                    </Line>
                    <Line title="Sign out everywhere" hint="Ends every open session on every device.">
                      <ActionButton variant="secondary" label="Sign out" action={signOutUser} values={{ id: u.id }}
                        confirm={{ title: `Sign ${u.name} out everywhere?`, body: "They stay signed in nowhere and must sign in again.", confirmLabel: "Sign out" }} />
                    </Line>
                  </>
                ) : null}
                {mine ? <Inset><p className="text-sm text-[var(--ds-on-surface)]">This is your own account. You cannot disable it or change your own role.</p></Inset> : (
                  <Line title={u.status === "disabled" ? "Account is disabled" : "Disable account"} hint={u.status === "disabled" ? "They cannot sign in until you enable it." : "They are signed out everywhere and cannot sign in."}>
                    {u.status === "disabled" ? <ActionButton variant="secondary" label="Enable" action={enableUser} values={{ id: u.id }} /> : (
                      <ActionButton variant="secondary" label="Disable" action={disableUser} values={{ id: u.id }}
                        confirm={{ title: `Disable ${u.name}?`, body: "They are signed out everywhere and cannot sign in until you enable the account again.", confirmLabel: "Disable", danger: true }} />
                    )}
                  </Line>
                )}
              </div>
            </Panel>
          ) : (
            <Panel title="Password and access"><p className="text-sm text-[var(--ds-on-surface-muted)]">{ctx.supportStaffId ? "A support visit can look at accounts but not change them." : ctx.readOnly ? "The school is read-only, so accounts cannot be changed." : "Only an admin can change an admin's account."}</p></Panel>
          )}
          <Panel title="Devices signed in">
            {d.devices.length ? (
              <ul className="flex flex-col gap-2">
                {d.devices.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/[0.04] px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-[var(--ds-on-surface)]">{deviceLabel(s.userAgent)}{s.support ? " (Triakshi support)" : ""}</p>
                      <p className="truncate text-xs text-[var(--ds-on-surface-muted)]">{s.ip ?? "Unknown address"} · signed in {dateTime(s.createdAt)} · last active {relative(s.lastSeenAt)}</p>
                    </div>
                    {act && !mine ? <ActionButton variant="secondary" label="Sign out" action={endUserSession} values={{ id: u.id, sessionId: s.id }} /> : null}
                  </li>
                ))}
              </ul>
            ) : <WidgetEmptyState title="Not signed in anywhere." description="Open sessions show here, and each one can be ended." />}
          </Panel>
        </div>
      </PanelGrid>
    </>
  );
}
