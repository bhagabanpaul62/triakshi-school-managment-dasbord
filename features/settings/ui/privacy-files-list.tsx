import { shortDate } from "@smw/ui/format";
import { PILL_BTN } from "@smw/ui/finance/ui";
import type { PrivacyFile } from "../privacy-service";
import { PrivacyFilesForm } from "./privacy-files";

const size = (b: number) => (b < 1_048_576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1_048_576).toFixed(1)} MB`);

/** The documents of one request, each opened through the checked route, and the form to add more while it is open. */
export function PrivacyFiles({ requestId, files, open }: { requestId: string; files: PrivacyFile[]; open: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {files.length === 0 ? <p className="text-sm text-[var(--ds-on-surface-muted)]">No documents yet.</p> : (
        <ul className="flex flex-col gap-2">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/[0.035] px-4 py-2">
              <span className="min-w-0"><span className="block truncate text-sm text-[var(--ds-on-surface)]">{f.fileName}</span><span className="text-xs text-[var(--ds-on-surface-muted)]">{size(f.size)} · {shortDate(f.createdAt)}</span></span>
              <a href={`/api/privacy/${requestId}/files/${f.id}`} target="_blank" rel="noreferrer" className={PILL_BTN} aria-label={`Open ${f.fileName}`}>Open</a>
            </li>
          ))}
        </ul>
      )}
      {open ? <PrivacyFilesForm id={requestId} /> : null}
    </div>
  );
}
