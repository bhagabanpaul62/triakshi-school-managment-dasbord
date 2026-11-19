import { IconBuildingBank, IconCloudLock, IconCurrencyRupee, IconDatabase, IconDeviceMobile } from "@tabler/icons-react";
import { Container } from "./ui";

const FACTS = [
  { icon: IconBuildingBank, text: "CBSE, ICSE and state boards" },
  { icon: IconCurrencyRupee, text: "Rupees, with GST invoices" },
  { icon: IconDeviceMobile, text: "Works on any phone" },
  { icon: IconDatabase, text: "Each school's data kept apart" },
  { icon: IconCloudLock, text: "Encrypted daily backups" },
];

export function ProofStrip() {
  return (
    <div className="border-y border-line bg-white py-5 md:py-6">
      <Container>
        <ul aria-label="At a glance" className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
          {FACTS.map((f) => (
            <li key={f.text} className="flex items-center gap-3 text-[14.5px] font-medium leading-snug md:text-[15px]">
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-t-green text-green"><f.icon size={18} /></span>{f.text}
            </li>
          ))}
        </ul>
      </Container>
    </div>
  );
}
