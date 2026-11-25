import { cache } from "react";
import { requireCtx } from "@smw/runtime";
import { HomeService } from "../home-service";

/** One HomeService per request: every panel asks this, so shared data (fee numbers, sections, papers) is loaded once. */
export const homeFor = cache(async () => new HomeService(await requireCtx()));
