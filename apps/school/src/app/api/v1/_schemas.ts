import { z } from "zod";

export const loginBody = z.object({
  identifier: z.string().trim().min(1, "Enter your login ID, email or phone").max(200),
  password: z.string().min(1, "Enter your password").max(200),
});
export type LoginBody = z.infer<typeof loginBody>;

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1, "Enter your current password").max(200),
  newPassword: z.string().min(1, "Enter a new password").max(200),
});
