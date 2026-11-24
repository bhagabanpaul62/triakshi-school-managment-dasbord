import type { Field } from "@smw/ui/shell/FormModal";

export const offlineFields: Field[] = [
  { name: "amountPaise", label: "Amount received", type: "money", required: true, hint: "Cash that reached the bank. With the tax withheld below, it must equal the amount due." },
  { name: "tdsPaise", label: "Tax withheld (TDS)", type: "money", hint: "Only if the school deducted tax. At most 10%. The school then uploads the certificate." },
  { name: "method", label: "Paid by", type: "select", required: true, options: [
    { value: "bank_transfer", label: "Bank transfer" }, { value: "cheque", label: "Cheque" }, { value: "upi", label: "UPI" }, { value: "cash", label: "Cash" },
  ] },
  { name: "reference", label: "Reference", placeholder: "UTR or cheque number" },
  { name: "paidOn", label: "Received on", type: "date" },
];

export const refundFields: Field[] = [
  { name: "method", label: "Paid back by", type: "select", required: true, options: [
    { value: "bank_transfer", label: "Bank transfer" }, { value: "cheque", label: "Cheque" }, { value: "upi", label: "UPI" }, { value: "cash", label: "Cash" },
  ] },
  { name: "reference", label: "Reference", placeholder: "UTR or cheque number" },
  { name: "paidOn", label: "Paid on", type: "date" },
];

export const reasonField: Field[] = [{ name: "reason", label: "What is wrong with it", type: "textarea", required: true, hint: "The school sees this next to its upload button." }];
