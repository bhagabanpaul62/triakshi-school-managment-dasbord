import { IconFile, IconFileSpreadsheet, IconFileText, IconPdf, IconExternalLink, type Icon } from "@tabler/icons-react";
import { cn } from "../../lib/utils";
import { FOCUS } from "../finance/ui";
import { fileKind, fileSize, type FileKind } from "./file-utils";

export interface FileItem {
  id: string;
  name: string;
  sizeBytes: number;
  /** MIME type when known; the file extension is used otherwise. */
  type?: string;
  /** Where the file opens. */
  href: string;
}

const ICON: Record<Exclude<FileKind, "image">, Icon> = { pdf: IconPdf, sheet: IconFileSpreadsheet, doc: IconFileText, other: IconFile };

export interface FileListProps {
  files: FileItem[];
  className?: string;
}

/** Attached files: image preview for pictures, an icon for the rest, name, size and an open link. */
export function FileList({ files, className }: FileListProps) {
  if (files.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {files.map((f) => {
        const kind = fileKind(f.name, f.type);
        const I = kind === "image" ? null : ICON[kind];
        return (
          <li key={f.id}>
            <a href={f.href} target="_blank" rel="noopener noreferrer" className={cn("flex min-h-12 items-center gap-3 rounded-xl bg-white/[0.05] p-2 transition-colors hover:bg-white/[0.09]", FOCUS)}>
              {I ? (
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[var(--ds-on-surface-variant)]"><I className="h-5 w-5" /></span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.href} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-lg bg-white/[0.06] object-cover" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-[var(--ds-on-surface)]">{f.name}</span>
                <span className="block text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{fileSize(f.sizeBytes)}</span>
              </span>
              <IconExternalLink className="h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)]" aria-hidden />
              <span className="sr-only">Open {f.name} in a new tab</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
