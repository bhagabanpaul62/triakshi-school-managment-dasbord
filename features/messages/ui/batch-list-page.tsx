import { refusalOr } from "@smw/runtime/refusal";
import { BatchListPage as List } from "./batch-page";
export const metadata = { title: "Sent to families" };
export default function Page(...a: Parameters<typeof List>) { return refusalOr(() => List(...a)); }
