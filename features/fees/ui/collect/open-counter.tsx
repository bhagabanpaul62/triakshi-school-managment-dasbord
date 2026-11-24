import { FormModal } from "@smw/ui/shell/FormModal";
import { openCounter } from "../collect-actions";

/** The Open counter button: a small form asking for the float. */
export function OpenCounter({ label = "Open counter" }: { label?: string }) {
  return (
    <FormModal title="Open your counter" description="Count the cash already in the box. Cash you take today is checked against this when you close." icon="money" action={openCounter} submitLabel="Open counter"
      fields={[{ name: "floatPaise", label: "Cash in the box now (float)", type: "money", hint: "Leave empty if the box starts empty." }]} trigger={{ label, variant: "secondary", plus: false }} successMessage="Counter open" />
  );
}
