import { defaultConfig, type TemplateConfig } from "@smw/feature-finance/templates/config";
import { TemplateService } from "@smw/feature-finance/templates/service";
import type { Ctx } from "@smw/feature-kit";
import { todayIST } from "@smw/feature-kit/money";
import { HeadService } from "../service";
import { FeesLookup } from "./lookups";
import { can } from "./shared";

/** What the invoice editor needs from the server, the same for a new bill, a draft and a revision. */
export async function editorBase(ctx: Ctx): Promise<{ heads: { id: string; label: string }[]; config: TemplateConfig; today: string; classes: Awaited<ReturnType<FeesLookup["classes"]>>; canGroup: boolean }> {
  const [heads, config, classes] = await Promise.all([
    new HeadService(ctx).options(),
    new TemplateService(ctx).current("invoice").then((v) => v.config).catch(() => defaultConfig("invoice", [])),
    new FeesLookup(ctx).classes(),
  ]);
  return { heads: heads.filter((h) => h.isActive).map((h) => ({ id: h.id, label: h.name })), config, today: todayIST(), classes, canGroup: can(ctx, "setup") };
}
