import { enquiryJobs } from "./enquiry-jobs";
import { siteJobs } from "./site-jobs";

export default { ...siteJobs, ...enquiryJobs } satisfies Record<string, () => Promise<unknown>>;
