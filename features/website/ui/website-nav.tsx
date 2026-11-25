import { getSchool } from "@smw/runtime";
import { WebsiteTabs } from "./website-tabs";

/** The tab bar, placed under each page's title. */
export async function WebsiteNav() {
  return <WebsiteTabs board={(await getSchool()).row.board} />;
}
