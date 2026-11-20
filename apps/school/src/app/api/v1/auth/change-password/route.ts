import { AppError, ValidationError } from "@smw/feature-kit";
import { AuthInputError, LoginError, SchoolAuth } from "@smw/auth";
import { apiHandler, bearerSession, readJson } from "@smw/runtime/bearer";
import { changePasswordBody } from "../../_schemas";

/** POST /api/v1/auth/change-password { currentPassword, newPassword }. Allowed while a password change is required; keeps this session, ends the others. */
export const POST = apiHandler(async (req) => {
  const body = await readJson(req, changePasswordBody);
  const { school, session } = await bearerSession(req, { allowMustChange: true });
  try {
    await new SchoolAuth(school.id).changePassword(session.user.id, body.currentPassword, body.newPassword, session.sessionId);
  } catch (e) {
    if (e instanceof LoginError) throw new AppError("Your current password is not right.", "invalid_credentials", 401);
    if (e instanceof AuthInputError) throw new ValidationError({ newPassword: e.message });
    throw e;
  }
  return { ok: true };
});
