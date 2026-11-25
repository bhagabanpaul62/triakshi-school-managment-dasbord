"use server";

import { serviceAction } from "@smw/runtime";
import { CommSettingsService } from "../settings";

/** Takes only the changed fields; the service fills the rest. */
export async function saveCommSettings(patch: unknown) {
  return serviceAction(CommSettingsService, (s) => s.save(patch));
}
