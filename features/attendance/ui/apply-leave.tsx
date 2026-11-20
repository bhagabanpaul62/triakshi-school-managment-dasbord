import { FormModal } from "@smw/ui/shell/FormModal";
import { applyLeave } from "./actions";
import { leaveFields } from "./fields";

/** The "Apply for leave" dialog. A student login with several students picks one. */
export function ApplyLeave({ kids }: { kids: { id: string; name: string }[] }) {
  return <FormModal title="Apply for leave" icon="calendar" fields={leaveFields({ kids, file: true })} action={applyLeave} submitLabel="Send request" successMessage="Leave request sent" />;
}
