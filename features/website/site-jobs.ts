import { DisclosureService } from "./disclosure-service";
import { InsightsService } from "./insights-service";
import { SiteService } from "./site-service";

export const siteJobs: Record<string, () => Promise<unknown>> = {
  "website.publish-due": () => SiteService.publishDue(),
  "website.document-expiry": async () => ({ warned: await DisclosureService.expiry(), pruned: await InsightsService.prunePageDays() }),
};
