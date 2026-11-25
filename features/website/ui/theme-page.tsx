import { getSchool, requireCtx } from "@smw/runtime";
import { PRESETS } from "@smw/themes";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ThemeService } from "../service";
import { saveTheme } from "./actions";
import { resetTheme, uploadThemeAsset } from "./site-actions";
import { ThemeEditor } from "./theme-editor";

export const metadata = { title: "Theme" };

export default async function ThemePage() {
  const ctx = await requireCtx();
  const svc = new ThemeService(ctx);
  if (!svc.can("manage")) return <NoAccess title="Changing the theme is for people who edit the website." hint="Ask your admin to give your role the website editing right." />;
  const { theme, limited, logoUrl } = await svc.get();
  const school = await getSchool();
  return (
    <>
      <PageHeader eyebrow="Website" title="Theme" description="Your colours, font and logo, on the website and in the panel." />
      <ThemeEditor initial={{ ...theme, logoUrl: theme.logoUrl ?? logoUrl }} presets={Object.values(PRESETS)} limited={limited} schoolName={school.name} action={saveTheme} upload={uploadThemeAsset} reset={resetTheme} />
    </>
  );
}
