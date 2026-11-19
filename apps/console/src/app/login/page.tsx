import { redirect } from "next/navigation";
import { getStaffSession } from "@smw/runtime/console";
import { AuthCard } from "@/components/auth-card";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const s = await getStaffSession();
  if (s?.twoFactorPassed) redirect("/");
  return (
    <AuthCard eyebrow="Platform console" title="Sign in" intro="For Triakshi staff. Schools sign in on their own address.">
      <LoginForm />
    </AuthCard>
  );
}
