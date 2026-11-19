import { getSchool, requireCtx } from "@smw/runtime";
import { PRESETS } from "@smw/themes";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ThemeService } from "../service";
import { saveTheme } from "./actions";
import { ThemeEditor } from "./theme-editor";

export const metadata = { title: "Theme" };

export default async function ThemePage() {
  const ctx = await requireCtx();
  const { theme, limited, logoUrl } = await new ThemeService(ctx).get();
  const school = await getSchool();
  return (
    <>
      <PageHeader eyebrow="Website" title="Theme" description="Your colours, font and logo, on the website and in the panel." />
      <ThemeEditor initial={{ ...theme, logoUrl: theme.logoUrl ?? logoUrl }} presets={Object.values(PRESETS)} limited={limited} schoolName={school.name} action={saveTheme} />
    </>
  );
}
