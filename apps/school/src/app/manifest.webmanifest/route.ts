import { getSchool } from "@smw/runtime";

export const dynamic = "force-dynamic";

/** The school's own installable app: its name, colours and logo, on its own subdomain or custom domain. */
export async function GET() {
  const school = await getSchool();
  const logo = school.logoUrl ?? school.theme.logoUrl;
  const c = school.theme.colors;
  return Response.json({
    id: "/app", name: school.name, short_name: school.name.length > 12 ? school.name.split(/\s+/)[0]!.slice(0, 12) : school.name,
    description: `${school.name} on Triakshi`, start_url: "/app", scope: "/", display: "standalone",
    theme_color: c.primary, background_color: c.background,
    icons: logo ? [{ src: logo, sizes: "192x192", purpose: "any" }, { src: logo, sizes: "512x512", purpose: "any" }]
      : [{ src: "/api/push/icon", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  }, { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=300" } });
}
