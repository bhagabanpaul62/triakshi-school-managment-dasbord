import { redirect } from "next/navigation";
import { StaffAuth } from "@smw/auth";
import { getStaffSession } from "@smw/runtime/console";
import { AuthCard } from "@/components/auth-card";
import { TwoFactorForm } from "./two-factor-form";

export const metadata = { title: "Two-step check" };

export default async function TwoFactorPage() {
  const s = await getStaffSession();
  if (!s) redirect("/login");
  if (s.twoFactorPassed) redirect("/");
  const enrol = s.totpEnabled ? undefined : StaffAuth.newTotpSecret();
  return (
    <AuthCard eyebrow="Platform console" title={enrol ? "Set up two-step login" : "Two-step check"}
      intro={enrol ? "Staff accounts need an authenticator app. This takes a minute." : `Signed in as ${s.email}. Enter the code from your authenticator app.`}>
      <TwoFactorForm enrol={enrol} uri={enrol ? StaffAuth.totp(enrol, s.email).toString() : undefined} />
    </AuthCard>
  );
}
