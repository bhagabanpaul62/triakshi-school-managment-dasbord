import { getSchool } from "@smw/runtime";

export const dynamic = "force-dynamic";

/** A school without a logo still gets an app icon: its first letter on its colour. */
export async function GET() {
  const school = await getSchool();
  const letter = (school.name.trim()[0] ?? "S").toUpperCase().replace(/[&<>]/g, "S");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${school.theme.colors.primary}"/><text x="256" y="340" font-family="system-ui,sans-serif" font-size="280" font-weight="600" text-anchor="middle" fill="#fff">${letter}</text></svg>`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600" } });
}
