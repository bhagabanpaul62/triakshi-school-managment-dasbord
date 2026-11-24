import type { Field } from "@smw/ui/shell/FormModal";
import type { Vendor } from "../vendors";

export function vendorFields(accounts: { id: string; code: string; name: string }[], v?: Vendor): Field[] {
  const keep = (last4: string | null | undefined) => (last4 ? `Leave blank to keep the saved one (ends ${last4}).` : "Stored sealed. Only the last 4 digits are ever shown.");
  return [
    { name: "name", label: "Name", required: true, wide: true, section: "Who" },
    { name: "contactName", label: "Contact person" }, { name: "phone", label: "Phone", type: "tel" }, { name: "email", label: "Email", type: "email" }, { name: "address", label: "Address", type: "textarea", wide: true },
    { name: "gstin", label: "GSTIN", placeholder: "29ABCDE1234F1Z5", section: "Tax" },
    { name: "pan", label: "PAN", placeholder: "ABCDE1234F", hint: keep(v?.panLast4) }, { name: "tdsPercent", label: "Tax withheld (TDS) %", type: "number", step: "0.01", min: 0, max: 30, hint: "Taken off each bill by default, for example 10 for rent." },
    { name: "defaultAccountId", label: "Usual account", type: "select", options: accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })) },
    { name: "bankAccount", label: "Bank account number", hint: keep(v?.bankLast4), section: "How to pay" }, { name: "ifsc", label: "IFSC", placeholder: "HDFC0001234" }, { name: "upiId", label: "UPI ID", placeholder: "name@bank" },
  ];
}
export const vendorValues = (v: Vendor) => ({ id: v.id, name: v.name, contactName: v.contactName, phone: v.phone, email: v.email, address: v.address, gstin: v.gstin, tdsPercent: v.tdsBasisPoints / 100, defaultAccountId: v.defaultAccountId, ifsc: v.ifsc, upiId: v.upiId });
