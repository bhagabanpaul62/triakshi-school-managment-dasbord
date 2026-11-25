export const dynamic = "force-dynamic";
import SiteLayout from "./(site)/layout";
import HomePage from "@smw/feature-website/ui/home-page";

export { generateMetadata } from "@smw/feature-website/ui/home-page";

/** The school's public home page. The (site) layout is applied here by hand because `/` lives outside the route group. */
export default async function Page(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SiteLayout><HomePage searchParams={props.searchParams} /></SiteLayout>;
}
