import { renderSite, generateSiteMetadata } from "./site-page";

type Search = Record<string, string | string[] | undefined>;

/** The home page at `/`. */
export default async function HomePage({ searchParams }: { searchParams: Promise<Search> }) {
  return renderSite({}, await searchParams);
}
export const generateMetadata = () => generateSiteMetadata({});
