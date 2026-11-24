import { IconChip } from "@smw/ui/kit/Panel";
import type { Tone } from "@smw/ui/tone";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { MenuIconView } from "@smw/ui/shell/icons";
import type { FileLink } from "../service";
import { removeAttachment } from "./actions";

/** One status vocabulary for assignments, submissions and what a student sees, so the same word is the same colour everywhere. */
export const STATE_LABEL: Record<string, string> = {
  todo: "To do", overdue: "Overdue", submitted: "Submitted", late: "Late", graded: "Graded", returned: "Sent back", missing: "Missing",
  draft: "Draft", published: "Published", closed: "Closed", pending: "Not yet",
};
export const STATE_TONE: Record<string, Tone> = {
  todo: "default", overdue: "danger", submitted: "info", late: "warning", graded: "success", returned: "warning", missing: "danger",
  draft: "default", published: "info", closed: "default", pending: "default",
};

export const fmtSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`);

export const MUTED = "text-sm text-[var(--ds-on-surface-muted)]";

/** Files with signed download links; `removable` adds a delete button for the teacher. */
export function FileList({ files, empty = "No files.", removable }: { files: FileLink[]; empty?: string; removable?: boolean }) {
  if (files.length === 0) return <p className={MUTED}>{empty}</p>;
  return (
    <ul className="flex flex-col gap-0.5">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-3 rounded-2xl px-3 py-2 transition-colors duration-150 hover:bg-white/[0.04]">
          <IconChip><MenuIconView name="assignment" className="h-4 w-4" /></IconChip>
          <a href={f.url} target="_blank" rel="noreferrer" title={`Open ${f.fileName}`} className="min-w-0 flex-1 truncate text-sm text-[var(--ds-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">{f.fileName}</a>
          <span className="shrink-0 text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{fmtSize(f.size)}</span>
          {removable ? (
            <ActionButton variant="icon-delete" label={`Remove ${f.fileName}`} action={removeAttachment} values={{ id: f.id }}
              confirm={{ title: "Remove this file?", body: `"${f.fileName}" will no longer be available to students.`, confirmLabel: "Remove", danger: true }} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
