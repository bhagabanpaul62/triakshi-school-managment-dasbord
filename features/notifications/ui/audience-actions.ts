"use server";

import { serviceAction } from "@smw/runtime";
import { AudienceService } from "../audience";

/** The picker posts the audience as one JSON field named `audience`. */
export async function previewAudience(fd: FormData) { return serviceAction(AudienceService, (s) => s.preview(fd.get("audience"))); }
export async function searchPeople(fd: FormData) { return serviceAction(AudienceService, (s) => s.people(fd.get("q"))); }
