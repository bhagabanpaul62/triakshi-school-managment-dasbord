"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilesField } from "@smw/ui/comm/FilesField";
import { PRIMARY_BTN } from "@smw/ui/finance/ui";
import { keepValues } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { addPrivacyFiles } from "./data-actions";

/** Add documents (an ID proof, a signed letter) to one request. PDFs and pictures, 10 MB each. */
export function PrivacyFilesForm({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const submit = (fd: FormData, reset: () => void) => start(async () => {
    const r = await addPrivacyFiles(fd);
    if (r.ok) { reset(); toast(r.message ?? "Documents added"); router.refresh(); } else toast(r.error, "danger");
  });
  return (
    <form onSubmit={keepValues(submit)} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <FilesField accept={["application/pdf", "image/*"]} maxCount={10} maxMb={10} label="Documents (PDF or pictures)" />
      <div><button type="submit" disabled={pending} className={PRIMARY_BTN}>Add the documents</button></div>
    </form>
  );
}
