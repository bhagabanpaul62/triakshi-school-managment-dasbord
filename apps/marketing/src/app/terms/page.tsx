import type { Metadata } from "next";
import { LegalPage } from "@/components/legal";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="Draft, to be reviewed by counsel before launch">
      <p>This page is a plain-language placeholder. A reviewed agreement replaces it before we take paying schools.</p>
      <h2>The trial</h2>
      <p>New schools get 30 days free with no card. After that, choose a plan to continue. Without one, the school goes read-only for 14 days, then is suspended, and its data is deleted after 90 more days.</p>
      <h2>Plans and payment</h2>
      <p>Prices are in rupees and exclude 18% GST. Each payment gets a GST invoice. Plans are by student count; if you grow past your cap you move to the next plan.</p>
      <h2>Your data</h2>
      <p>Your data is yours. We process it only to run the service for you, under a data processing agreement (DPA) signed with the school. You can export it at any time.</p>
      <h2>Acceptable use</h2>
      <p>Use the product for running a school. Do not attempt to access another school&rsquo;s data or disrupt the service.</p>
    </LegalPage>
  );
}
