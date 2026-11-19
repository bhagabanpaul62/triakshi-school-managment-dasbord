import type { NavItem } from "./nav";

/** Which attendance pages this caller gets in the header switcher. */
export function attendanceNav(canRead: boolean, canManage: boolean): NavItem[] {
  return [
    ...(canRead ? [{ href: "/app/attendance", label: "Mark" }, { href: "/app/attendance/register", label: "Register" }] : []),
    ...(canManage ? [{ href: "/app/attendance/staff", label: "Staff" }, { href: "/app/attendance/holidays", label: "Holidays" }] : []),
  ];
}
