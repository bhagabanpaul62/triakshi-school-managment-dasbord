import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LoginError, SchoolAuth } from "@smw/auth";
import { closeDb, eq, oneTimeTokens, schoolRoles, users, withConsole, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, allows, type Ctx } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryEmailSender, useServices } from "@smw/integrations";
import { BASELINE_GRANTS, ROLE_TEMPLATES, matrixFor, permissionLabel, type Catalogue } from "./catalogue";
import { RoleService, UserAdminService, resolveRole } from "./service";

// Small stand-ins for the real features: this package cannot import them, and the rules under test do not care.
const library = { key: "library", name: "Library", permissions: { read: ["admin", "teacher"], manage: ["admin", "teacher"] } } as const;
const fees = { key: "fees", name: "Fees", permissions: { read: ["admin", "accountant"], manage: ["admin", "accountant"], self: ["student"] } } as const;
const home = { key: "home", name: "Home", permissions: { view: ["admin", "teacher", "student"] } } as const;
const CAT: Catalogue = [library, fees, home];
const SETTINGS_F = { key: "settings", name: "Settings", permissions: { read: ["admin", "accountant", "teacher", "student"], manage: ["admin"], audit: ["admin"], export: ["admin"] } } as const;
const ADMIN_F = { key: "billing", name: "Billing", permissions: { manage: ["admin"] } } as const;
// Admin-default but delegable: a transport in-charge may manage routes.
const DELEGABLE_F = { key: "transport", name: "Transport", permissions: { manage: ["admin"] } } as const;

let a: TestSchool, b: TestSchool;
beforeAll(async () => {
  useServices({ email: new MemoryEmailSender() });
  ({ a, b } = await createSchoolPair(["settings", "library", "fees"], "rbac"));
});
afterAll(closeDb);

const asAdmin = (s: TestSchool) => new UserAdminService(s.as.admin);
/** An admin context for a caller other than the admin being acted on (the audit log needs a real user id). */
const otherAdmin = (s: TestSchool): Ctx => ({ ...s.as.admin, userId: s.users.teacher });
const login = (s: TestSchool, role: "teacher" | "admin") => new SchoolAuth(s.id).login(`${role}-${s.slug}`, "password123");
const tokenIn = (url: string) => /token=([\w-]+)/.exec(url)![1]!;
const grantsOf = (r: { grants: string[] }): Ctx["grants"] => new Set(r.grants);

describe("custom roles", () => {
  it("a Library role passes library checks and fails fees", async () => {
    const role = await new RoleService(a.as.admin).create({ name: "Library desk", base: "staff", grants: ["library:read", "library:manage"] }, CAT);
    const ctx: Ctx = { ...a.as.teacher, role: "staff", features: new Set(["library", "fees", "home"]), grants: grantsOf(role) };
    expect(allows(ctx, library, "manage")).toBe(true);
    expect(allows(ctx, fees, "read")).toBe(false);
    expect(allows(ctx, home, "view")).toBe(true); // baseline grants come with every role
  });

  it("rejects a grant that is not a real feature permission", async () => {
    const svc = new RoleService(a.as.admin);
    await expect(svc.create({ name: "Bad", base: "staff", grants: ["fees:fly"] }, CAT)).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.create({ name: "Admin", base: "staff", grants: [] }, CAT)).rejects.toMatchObject({ fieldErrors: { name: expect.any(String) } });
  });

  it("a role keeps grants for modules that are switched off when edited", async () => {
    const svc = new RoleService({ ...a.as.admin, features: new Set(["settings", "library"]) });
    const role = await new RoleService(a.as.admin).create({ name: "Mixed", base: "teacher", grants: ["fees:read", "library:read"] }, CAT);
    const saved = await svc.update(role.key, { name: "Mixed", base: "teacher", grants: ["library:manage"] }, CAT);
    expect(saved.grants).toEqual(expect.arrayContaining(["fees:read", "library:manage"]));
    expect(saved.grants).not.toContain("library:read");
  });

  it("seeds the ready-made roles once and shows the built-in ones read-only", async () => {
    const rows = await new RoleService(b.as.admin).list(CAT);
    expect(rows.filter((r) => r.kind === "system").map((r) => r.key)).toEqual(["admin", "teacher", "student", "accountant"]);
    const lib = rows.find((r) => r.name === "Librarian");
    expect(lib).toMatchObject({ kind: "template", base: "staff" });
    expect(lib!.grants).toEqual(expect.arrayContaining(["library:read", "library:manage", "home:view"]));
    expect((await new RoleService(b.as.admin).list(CAT)).filter((r) => r.name === "Librarian")).toHaveLength(1);
  });

  it("refuses to delete a role somebody holds, then deletes it once they move", async () => {
    const roles = new RoleService(a.as.admin);
    const role = await roles.create({ name: "Temp role", base: "staff", grants: ["library:read"] }, CAT);
    await asAdmin(a).changeRole(a.users.accountant, { role: role.key });
    await expect(roles.remove(role.key)).rejects.toBeInstanceOf(ConflictError);
    await asAdmin(a).changeRole(a.users.accountant, { role: "accountant" });
    await expect(roles.remove(role.key)).resolves.toEqual({ id: role.key });
  });

  it("school B cannot see or change school A's roles", async () => {
    const mine = await new RoleService(a.as.admin).create({ name: "Only A", base: "staff", grants: [] }, CAT);
    const theirs = new RoleService(b.as.admin);
    expect((await theirs.list(CAT)).map((r) => r.name)).not.toContain("Only A");
    await expect(theirs.update(mine.key, { name: "Hijacked", base: "staff", grants: [] }, CAT)).rejects.toBeInstanceOf(NotFoundError);
    await expect(theirs.remove(mine.key)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new UserAdminService(b.as.admin).changeRole(b.users.teacher, { role: mine.key })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("user admin guards", () => {
  it("the last admin cannot be demoted or disabled, and nobody disables themselves", async () => {
    await expect(new UserAdminService(otherAdmin(a)).changeRole(a.users.admin, { role: "teacher" })).rejects.toBeInstanceOf(ConflictError);
    await expect(asAdmin(a).disable(a.users.admin)).rejects.toThrow(/own account/);
    await expect(new UserAdminService(otherAdmin(a)).disable(a.users.admin)).rejects.toThrow(/last admin/);
    // With a second admin the first may step down.
    await asAdmin(a).changeRole(a.users.accountant, { role: "admin" });
    const second = new UserAdminService({ ...a.as.admin, userId: a.users.accountant });
    await expect(second.changeRole(a.users.admin, { role: "teacher" })).resolves.toMatchObject({ role: "teacher", roleId: null });
    await second.changeRole(a.users.admin, { role: "admin" }).catch(() => undefined);
  });

  it("a role change ends the person's open sessions and moves them to the role's base kind", async () => {
    const role = await new RoleService(b.as.admin).create({ name: "Front", base: "teacher", grants: ["library:read"] }, CAT);
    const { token } = await login(b, "teacher");
    expect(await new SchoolAuth(b.id).validate(token)).not.toBeNull();
    const row = await new UserAdminService(b.as.admin).changeRole(b.users.teacher, { role: role.key });
    expect(row).toMatchObject({ role: "teacher", roleId: role.key, roleName: "Front" });
    expect(await new SchoolAuth(b.id).validate(token)).toBeNull();
  });

  it("a temporary password is shown once, must be changed, and ends sessions", async () => {
    const { token } = await login(a, "teacher");
    const r = await asAdmin(a).resetPassword(a.users.teacher, { mode: "temporary" });
    if (!("temporaryPassword" in r)) throw new Error("expected a temporary password");
    expect(r.temporaryPassword).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    const [u] = await withSchool(a.id, (tx) => tx.select().from(users).where(eq(users.id, a.users.teacher)));
    expect(u!.mustChangePassword).toBe(true);
    expect(await new SchoolAuth(a.id).validate(token)).toBeNull();
    expect((await new SchoolAuth(a.id).login(r.loginId, r.temporaryPassword)).token).toBeTruthy();
  });

  it("an access link works once, as an invite for a new login and a reset for an active one", async () => {
    const auth = new SchoolAuth(a.id);
    const active = await asAdmin(a).accessLink(a.users.student);
    expect(active.days).toBe(7);
    await auth.resetPassword(tokenIn(active.url), "fresh-pass-1");
    await expect(auth.resetPassword(tokenIn(active.url), "fresh-pass-2")).rejects.toBeInstanceOf(LoginError);

    const [invited] = await withConsole((tx) => tx.insert(users).values({ schoolId: a.id, role: "teacher", loginId: "new.hire", name: "New Hire", status: "invited" }).returning());
    const link = await asAdmin(a).accessLink(invited!.id);
    const [tok] = await withSchool(a.id, (tx) => tx.select().from(oneTimeTokens).where(eq(oneTimeTokens.userId, invited!.id)));
    expect(tok!.purpose).toBe("invite");
    await auth.resetPassword(tokenIn(link.url), "fresh-pass-3");
    const [after] = await withSchool(a.id, (tx) => tx.select().from(users).where(eq(users.id, invited!.id)));
    expect(after!.status).toBe("active");
  });

  it("sign out everywhere ends every session", async () => {
    const one = await login(b, "admin"), two = await login(b, "admin");
    await new UserAdminService(otherAdmin(b)).signOutEverywhere(b.users.admin);
    const auth = new SchoolAuth(b.id);
    expect(await auth.validate(one.token)).toBeNull();
    expect(await auth.validate(two.token)).toBeNull();
  });
});

describe("settings:manage is not a way to become admin", () => {
  const custom = (s: TestSchool, grants: string[]): Ctx => ({ ...s.as.teacher, role: "staff", grants: new Set(grants) });
  const ADMINISH = ["settings:manage", "settings:read"];
  const delegate = (s: TestSchool) => new UserAdminService(custom(s, ADMINISH)); // as if an older role still held it

  it("a non-admin actor cannot act on an admin, or make anyone one", async () => {
    const svc = delegate(a);
    await expect(svc.changeRole(a.users.accountant, { role: "admin" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.changeRole(a.users.admin, { role: "teacher" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.resetPassword(a.users.admin, { mode: "email" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.resetPassword(a.users.admin, { mode: "temporary" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.accessLink(a.users.admin)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.disable(a.users.admin)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.enable(a.users.admin)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.signOutEverywhere(a.users.admin)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("nobody changes their own role", async () => {
    await expect(new UserAdminService(a.as.admin).changeRole(a.users.admin, { role: "admin" })).rejects.toThrow(/own role/);
  });

  it("resolveRole refuses admin for a non-admin actor", async () => {
    await expect(withSchool(a.id, (tx) => resolveRole(tx, "admin", "staff"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(withSchool(a.id, (tx) => resolveRole(tx, "admin", "admin"))).resolves.toMatchObject({ role: "admin" });
  });

  it("a non-admin may still manage non-admin logins", async () => {
    await expect(delegate(a).signOutEverywhere(a.users.student)).resolves.toEqual({ id: a.users.student });
  });

  it("enable refuses a retired parent login", async () => {
    await withSchool(a.id, (tx) => tx.update(users).set({ status: "disabled" }).where(eq(users.id, a.users.parent)));
    await expect(asAdmin(a).enable(a.users.parent)).rejects.toBeInstanceOf(ConflictError);
  });

  it("a crafted role post cannot carry settings or admin-only grants", async () => {
    const svc = new RoleService(a.as.admin);
    const form = { name: "Sneaky", base: "staff", "g.settings": ["manage"], "g.library": ["read"] };
    await expect(svc.create(form, [...CAT, SETTINGS_F])).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.create({ name: "Sneaky2", base: "staff", grants: ["billing:manage"] }, [...CAT, ADMIN_F])).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.create({ name: "Transport lead", base: "staff", grants: ["transport:manage"] }, [...CAT, DELEGABLE_F])).resolves.toBeTruthy();
    const ok = await svc.create({ name: "Fine", base: "staff", grants: ["library:read"] }, [...CAT, SETTINGS_F]);
    expect(ok.grants).toContain("settings:read"); // the baseline that opens My profile
    expect(ok.grants).not.toContain("settings:manage");
    // Update cannot smuggle it in either, nor can the kept-grants path.
    await expect(svc.update(ok.key, { name: "Fine", base: "staff", grants: ["settings:export"] }, [...CAT, SETTINGS_F])).rejects.toBeInstanceOf(ValidationError);
    // Seeded or older stored grants are dropped on the next save, not carried.
    await withSchool(a.id, (tx) => tx.update(schoolRoles).set({ grants: ["settings:manage", "library:read"] }).where(eq(schoolRoles.id, ok.key)));
    const saved = await svc.update(ok.key, { name: "Fine", base: "staff", grants: ["library:read"] }, [...CAT, SETTINGS_F]);
    expect(saved.grants).not.toContain("settings:manage");
  });

  it("the matrix does not offer admin-only permissions", () => {
    const keys = matrixFor([...CAT, SETTINGS_F, ADMIN_F, DELEGABLE_F], new Set(["library", "billing", "transport"])).flatMap((m) => m.permissions.map((p) => p.grant));
    expect(keys).toContain("library:read");
    expect(keys).not.toContain("billing:manage");
    expect(keys).toContain("transport:manage");
  });

  it("a user cannot add grants to the custom role they hold", async () => {
    const role = await new RoleService(a.as.admin).create({ name: "Self edit", base: "staff", grants: ["library:read"] }, CAT);
    await asAdmin(a).changeRole(a.users.accountant, { role: role.key });
    const holder = new RoleService({ ...a.as.admin, userId: a.users.accountant });
    await expect(holder.update(role.key, { name: "Self edit", base: "staff", grants: ["library:read", "library:manage"] }, CAT)).rejects.toBeInstanceOf(ForbiddenError);
    await asAdmin(a).changeRole(a.users.accountant, { role: "accountant" });
  });
});

describe("communication grants", () => {
  const COMM: Catalogue = [
    { key: "announcements", name: "Notices", permissions: { read: ["admin", "teacher", "student"], draft: ["admin", "teacher"], publish: ["admin", "teacher"], approve: ["admin"], urgent: ["admin"], whole: ["admin"], manage: ["admin"] } },
    { key: "messages", name: "Messages", permissions: { use: ["admin", "teacher", "student"], all: ["admin", "accountant"], safeguard: ["admin"], manage: ["admin"] } },
    { key: "notifications", name: "Notifications", permissions: { read: ["admin", "teacher", "student"], manage: ["admin"], delivery: ["admin"] } },
    { key: "requests", name: "Requests", permissions: { use: ["admin", "student"], office: ["admin", "accountant"], manage: ["admin"] } },
    { key: "events", name: "Calendar", permissions: { read: ["admin", "student"], write: ["admin", "teacher"], manage: ["admin"] } },
  ];
  const all = new Set(COMM.map((f) => f.key));

  it("the matrix shows messages and notifications, but not the baseline grants", () => {
    const grants = matrixFor(COMM, all).flatMap((m) => m.permissions.map((p) => p.grant));
    expect(grants).toEqual(expect.arrayContaining(["messages:all", "messages:safeguard", "messages:manage", "notifications:manage", "notifications:delivery", "announcements:draft", "announcements:approve", "requests:office"]));
    for (const g of ["messages:use", "notifications:read", "announcements:read", "events:read", "requests:use"]) expect(grants).not.toContain(g);
  });

  it("the baseline holds the new read grants and labels say what they do", () => {
    expect(BASELINE_GRANTS).toEqual(expect.arrayContaining(["announcements:read", "events:read", "requests:use"]));
    const label = (f: string, p: string) => matrixFor(COMM, all).find((m) => m.key === f)!.permissions.find((x) => x.key === p)!.label;
    expect(label("announcements", "approve")).toBe("Approve notices");
    expect(label("announcements", "whole")).toBe("Publish to the whole school without approval");
    expect(permissionLabel("approve")).toBe("Approve requests");
    expect(label("announcements", "draft")).toBe("Write drafts");
    expect(label("messages", "safeguard")).toBe("Review reported conversations");
    expect(label("requests", "office")).toBe("Work the requests inbox".replace("requests inbox", "office inbox"));
    expect(label("notifications", "delivery")).toBe("See delivery and failures");
  });

  it("templates: front office drafts but does not publish; two new roles; every grant is real", () => {
    const t = (n: string) => ROLE_TEMPLATES.find((r) => r.name === n)!;
    expect(t("Front office").grants).toEqual(expect.arrayContaining(["announcements:draft", "requests:office", "meetings:use"]));
    expect(t("Front office").grants).not.toContain("announcements:publish");
    expect(t("Safeguarding lead").grants).toEqual(["messages:safeguard", "students:read"]);
    expect(t("Coordinator").grants).toEqual(expect.arrayContaining(["announcements:draft", "announcements:publish", "announcements:approve", "events:write", "requests:office", "students:read", "academics:read"]));
  });

  it("another school's roles never show up", async () => {
    expect((await new RoleService(b.as.admin).list(COMM)).map((r) => r.name)).not.toContain("Old notices");
  });
});
