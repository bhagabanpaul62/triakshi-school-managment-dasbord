import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { deleteEvent, updateEvent } from "./actions";
import { eventFields, toFormValues, type EventView } from "./fields";

/** Edit and delete for one event. Used by the list rows and by the calendar's detail dialog. */
export function EventActions({ event, classes }: { event: EventView; classes: { value: string; label: string }[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      <FormModal title="Edit event" icon="event" fields={eventFields(classes)} values={toFormValues(event)} hidden={{ id: event.id }} action={updateEvent}
        trigger={{ label: "Edit", variant: "ghost", size: "sm" }} />
      <ActionButton variant="icon-delete" label="Delete event" action={deleteEvent} values={{ id: event.id }}
        confirm={{ title: "Delete this event?", body: `"${event.title}" will be removed from every calendar. This cannot be undone.`, confirmLabel: "Delete", danger: true }} />
    </span>
  );
}
