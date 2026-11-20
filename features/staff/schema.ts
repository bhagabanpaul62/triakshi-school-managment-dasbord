import { date, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant, users } from "@smw/db";

/** Staff sign in as platform users; these are the roles a staff member can hold. */
export const STAFF_USER_ROLES = ["admin", "accountant", "teacher", "staff"] as const;
export const STAFF_STATUSES = ["active", "left"] as const;
export const STAFF_GENDERS = ["male", "female", "other"] as const;
export const EMPLOYMENT_TYPES = ["permanent", "contract", "part_time", "visiting"] as const;

/** The employment record of one staff user (the login itself is the users row). */
export const staffProfiles = pgTable("staff_profiles", {
  ...schoolColumns(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  employeeId: text("employee_id").notNull(),
  designation: text("designation"),
  department: text("department"),
  qualification: text("qualification"),
  joiningDate: date("joining_date"),
  phone: text("phone"),
  email: text("email"),
  /** S3 key of the photo (private; shown through a signed URL). */
  photoKey: text("photo_key"),
  status: text("status").$type<(typeof STAFF_STATUSES)[number]>().notNull().default("active"),
  gender: text("gender").$type<(typeof STAFF_GENDERS)[number]>(),
  dob: date("dob"),
  address: text("address"),
  employmentType: text("employment_type").$type<(typeof EMPLOYMENT_TYPES)[number]>(),
  experienceYears: integer("experience_years"),
  bloodGroup: text("blood_group"),
  emergencyName: text("emergency_name"),
  emergencyPhone: text("emergency_phone"),
}, (t) => [
  ...tenant(t, "staff_profiles"),
  uniqueIndex("staff_profiles_user").on(t.userId),
  uniqueIndex("staff_profiles_employee").on(t.schoolId, t.employeeId),
  index("staff_profiles_department").on(t.schoolId, t.department),
]);
