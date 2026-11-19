import { LifecycleService } from "@smw/billing";

// Schedule "billing.lifecycle" once a day (the worker owns the schedule).
export default {
  "billing.lifecycle": async () => { await new LifecycleService().runDaily(); },
};
