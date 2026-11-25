import { snapshotAll } from "./snapshot";

/** Run by the worker nightly (02:45 IST): how far each school has come, for the console. */
export default {
  "setup.snapshot": () => snapshotAll(),
} satisfies Record<string, () => Promise<unknown>>;
