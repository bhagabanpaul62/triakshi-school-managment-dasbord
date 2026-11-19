import { eq, platformStaff, staffSessions } from "@smw/db";
import { Passwords } from "@smw/auth";
import { ConflictError, NotFoundError, PlatformService, rethrowUnique } from "@smw/feature-kit";
import { assertId, staffInput } from "./inputs";
import { z } from "zod";

/** Platform staff accounts. Owner only. Never returns password hashes or TOTP secrets. */
export class StaffAdminService extends PlatformService {
  async list() {
    this.require("owner");
    return this.tx((tx) => tx.select({
      id: platformStaff.id, name: platformStaff.name, email: platformStaff.email, role: platformStaff.role, status: platformStaff.status,
      totpEnabled: platformStaff.totpEnabled, lastLoginAt: platformStaff.lastLoginAt, createdAt: platformStaff.createdAt,
    }).from(platformStaff).orderBy(platformStaff.createdAt));
  }

  async create(input: unknown) {
    this.require("owner");
    const d = this.parse(staffInput, input);
    const passwordHash = await Passwords.hash(d.password);
    return this.tx(async (tx) => {
      try {
        const [s] = await tx.insert(platformStaff).values({ name: d.name, email: d.email.toLowerCase(), role: d.role, passwordHash }).returning({ id: platformStaff.id });
        await this.audit(tx, "staff.create", `Added ${d.role} ${d.name}`, null, { staffId: s!.id });
        return s!;
      } catch (err) { return rethrowUnique(err, "A staff member with that email already exists."); }
    });
  }

  async setStatus(staffId: string, status: "active" | "disabled") {
    this.require("owner");
    assertId(staffId, "Staff member");
    status = this.parse(z.enum(["active", "disabled"]), status);
    if (staffId === this.ctx.staffId && status === "disabled") throw new ConflictError("You cannot disable your own account.");
    return this.tx(async (tx) => {
      const [s] = await tx.update(platformStaff).set({ status }).where(eq(platformStaff.id, staffId)).returning();
      if (!s) throw new NotFoundError("Staff member");
      if (status === "disabled") await tx.delete(staffSessions).where(eq(staffSessions.staffId, staffId));
      await this.audit(tx, status === "disabled" ? "staff.disable" : "staff.enable", `${status === "disabled" ? "Disabled" : "Enabled"} ${s.name}`, null, { staffId });
    });
  }

  /** Forget the authenticator: the next login shows the enrolment step again. Signs them out. */
  async resetTwoFactor(staffId: string) {
    this.require("owner");
    assertId(staffId, "Staff member");
    return this.tx(async (tx) => {
      const [s] = await tx.update(platformStaff).set({ totpSecret: null, totpEnabled: false }).where(eq(platformStaff.id, staffId)).returning();
      if (!s) throw new NotFoundError("Staff member");
      await tx.delete(staffSessions).where(eq(staffSessions.staffId, staffId));
      await this.audit(tx, "staff.reset_2fa", `Reset two-step login for ${s.name}`, null, { staffId });
    });
  }
}
