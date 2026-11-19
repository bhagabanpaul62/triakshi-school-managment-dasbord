import type { Metadata } from "next";
import { LegalPage } from "@/components/legal";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="Draft, to be reviewed by counsel before launch">
      <p>This page is a plain-language placeholder. It will be replaced by a reviewed policy before we take paying schools.</p>
      <h2>Who is responsible for the data</h2>
      <p>The school is the data fiduciary for its students, parents and staff. Triakshi acts as a data processor for the school and handles that data only to run the service. A data processing agreement (DPA) covers this and is available to every school on request.</p>
      <h2>What we collect</h2>
      <p>At signup: the school name and address, your name, email and phone. Inside the product: whatever the school enters, such as student records, attendance, fees and marks.</p>
      <h2>Where it lives</h2>
      <p>On servers in India. Each school&rsquo;s data is isolated from other schools&rsquo; data in the database.</p>
      <h2>Your rights</h2>
      <p>Schools can export their data at any time, including during the read-only period after a trial ends. Data is deleted 90 days after suspension. Under India&rsquo;s DPDP Act, individuals can ask their school to access, correct or erase their data, and the school can ask us to carry that out.</p>
    </LegalPage>
  );
}
