import { PRESETS } from "@smw/themes";
import { TEMPLATES, TEMPLATE_KEYS } from "@smw/site-templates";
import { shortDate } from "@smw/ui/format";
import { backHref, nextHref } from "../steps";
import { SetupFrame, loadWizard } from "./frame";
import { WebsitePicker } from "./website-picker";

export const metadata = { title: "Setup: Website" };

const LABELS: Record<string, string> = { ocean: "Ocean", forest: "Forest", maroon: "Maroon", royal: "Royal" };

export default async function WebsiteStepPage() {
  const { svc, progress } = await loadWizard();
  const site = await svc.websiteState();
  const next = nextHref("website", progress.available);
  return (
    <SetupFrame current="website" progress={progress}>
      <WebsitePicker
        templates={TEMPLATE_KEYS.map((key) => ({ key, ...TEMPLATES[key] }))}
        presets={Object.entries(PRESETS).map(([key, t]) => ({ key, label: LABELS[key] ?? key, primary: t.colors.primary, secondary: t.colors.secondary, accent: t.colors.accent }))}
        template={site.template} preset={site.preset} publishedAt={site.publishedAt ? shortDate(site.publishedAt) : null}
        next={next} back={backHref("website", progress.available)} skip={next} />
    </SetupFrame>
  );
}
