import { requireCtx } from "@smw/runtime";
import { refusalOr } from "@smw/runtime/refusal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { PreferenceService } from "../prefs";
import { PreferencesPanel } from "./preferences-panel";

export const metadata = { title: "Notification settings" };

async function PreferencesPage() {
  const svc = new PreferenceService(await requireCtx());
  const [prefs, devices] = await Promise.all([svc.mine(), svc.devices()]);
  return (
    <>
      <PageHeader eyebrow="Communication" title="Notification settings" description="Everything always shows in the app. Choose what also reaches your phone and email." />
      <PreferencesPanel prefs={prefs} devices={devices.map((d) => ({ id: d.id, device: d.device, createdAt: d.createdAt.toISOString(), lastOkAt: d.lastOkAt?.toISOString() ?? null }))} />
    </>
  );
}

export default function Page() { return refusalOr(PreferencesPage); }
