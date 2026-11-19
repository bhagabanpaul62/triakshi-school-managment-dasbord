import { FormModal, type Field, type FormResult } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";

type Action = (fd: FormData) => Promise<FormResult>;

/** The edit-modal + delete-with-confirmation pair every academics row uses. */
export function RowActions({ what, icon, fields, values, id, update, remove, consequence }: {
  /** "section", "class", "term"... used in titles and labels. */
  what: string;
  icon: string;
  fields: Field[];
  values: Record<string, unknown>;
  id: string;
  update: Action;
  remove: Action;
  /** What deleting also removes, shown in the confirmation. */
  consequence: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <FormModal title={`Edit ${what}`} icon={icon} fields={fields} values={values} hidden={{ id }} action={update} trigger={{ label: "Edit", variant: "ghost", size: "sm" }} />
      <ActionButton variant="icon-delete" label={`Delete ${what}`} action={remove} values={{ id }}
        confirm={{ title: `Delete this ${what}?`, body: `${consequence} This cannot be undone.`, confirmLabel: "Delete", danger: true }} />
    </span>
  );
}
