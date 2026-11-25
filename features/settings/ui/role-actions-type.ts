import type { FormResult } from "@smw/ui/shell/FormModal";

type Act = (fd: FormData) => Promise<FormResult>;
/** Server actions bound to the school's feature list by the route file: only the school app can import every feature. */
export interface RoleActions { create: Act; update: Act; copy: Act; remove: Act }
