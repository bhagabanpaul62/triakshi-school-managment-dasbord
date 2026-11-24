import type { Ctx } from "@smw/feature-kit";
import { LeaveService } from "../leave-service";
import type { NavItem } from "./nav";

/** Which attendance pages this caller gets in the header switcher. */
export function attendanceNav(canRead: boolean, canManage: boolean, canApprove = false, canLeave = false, canMark = false): NavItem[] {
  return [
    ...(canMark ? [{ href: "/app/attendance/periods", label: "My classes" }] : []),
    ...(canRead ? [{ href: "/app/attendance", label: "Mark" }, { href: "/app/attendance/register", label: "Register" }, { href: "/app/attendance/eligibility", label: "Eligibility" }] : []),
    ...(canApprove ? [{ href: "/app/attendance/leave-requests", label: "Leave requests" }, { href: "/app/attendance/leave-calendar", label: "Who is away" }] : []),
    ...(canLeave ? [{ href: "/app/attendance/my-leave", label: "My leave" }] : []),
    ...(canManage ? [{ href: "/app/attendance/staff", label: "Staff" }, { href: "/app/attendance/leave-balances", label: "Leave balances" }, { href: "/app/attendance/leave-types", label: "Leave types" }, { href: "/app/attendance/staff/register", label: "Staff register" }, { href: "/app/attendance/holidays", label: "Holidays" }] : []),
  ];
}

export function attendanceNavFor(ctx: Ctx): NavItem[] {
  const s = new LeaveService(ctx);
  return attendanceNav(s.can("read"), s.can("manage"), s.can("approve"), s.can("leave"), s.can("mark"));
}
