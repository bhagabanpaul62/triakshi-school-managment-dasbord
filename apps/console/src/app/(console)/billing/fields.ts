import type { Field } from "@smw/ui/shell/FormModal";

export const offlineFields: Field[] = [
  { name: "amountPaise", label: "Amount received", type: "money", required: true, hint: "Must match the invoice total, GST included." },
  { name: "method", label: "Paid by", type: "select", required: true, options: [
    { value: "bank_transfer", label: "Bank transfer" }, { value: "cheque", label: "Cheque" }, { value: "upi", label: "UPI" }, { value: "cash", label: "Cash" },
  ] },
  { name: "reference", label: "Reference", placeholder: "UTR or cheque number" },
  { name: "paidOn", label: "Received on", type: "date" },
];
