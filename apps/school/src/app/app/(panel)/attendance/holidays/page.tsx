import { refusalOr } from "@smw/runtime/refusal";
import HolidaysPage from "@smw/feature-attendance/ui/holidays-page";

export { metadata } from "@smw/feature-attendance/ui/holidays-page";

export default function Page(props: Parameters<typeof HolidaysPage>[0]) { return refusalOr(() => HolidaysPage(props)); }
