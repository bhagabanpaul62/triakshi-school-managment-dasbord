import { z } from "zod";
import { f } from "@smw/feature-kit";
import { STAFF_GENDERS, STAFF_USER_ROLES } from "./schema";

const role = z.enum(STAFF_USER_ROLES, { error: "Pick a role" });

/** Everything about the person except the role (shared by create and edit). */
const person = {
  name: f.text(2, 120, "Enter the full name"),
  employeeId: f.text(1, 30, "Enter the employee ID"),
  email: f.optEmail(),
  phone: f.optPhone(),
  designation: f.optText(80),
  department: f.optText(80),
  qualification: f.optText(120),
  joiningDate: f.optDate(),
  gender: z.preprocess((v) => (v === "" ? undefined : v), z.enum(STAFF_GENDERS).optional()),
  dob: f.optDate(),
  address: f.optText(300),
};

export const staffInput = z.object({ role, ...person });
export const staffUpdateInput = z.object(person);
export const roleInput = z.object({ role });

export const resetPasswordInput = z.object({
  token: z.string().min(10, "This link is not valid"),
  password: z.string().min(8, "Use at least 8 characters").max(128, "Use at most 128 characters"),
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { message: "The two passwords do not match", path: ["confirm"] });
