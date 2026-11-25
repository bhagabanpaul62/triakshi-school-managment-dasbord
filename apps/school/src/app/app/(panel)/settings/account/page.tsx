import AccountPage, { metadata } from "@smw/feature-settings/ui/account-page";
import { closeAccount } from "./actions";

export { metadata };

export default function Page() {
  return <AccountPage closeAction={closeAccount} />;
}
