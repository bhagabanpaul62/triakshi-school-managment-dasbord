"use client";

import { useRouter } from "next/navigation";
import { RecordPicker } from "@smw/ui/finance/RecordPicker";
import { findStudents } from "../collect-actions";

/** Pick a student and come back to this page with `?student=id`. */
export function StudentPicker({ path, initial }: { path: string; initial?: { id: string; label: string } }) {
  const router = useRouter();
  return <RecordPicker name="student" label="Student" action={findStudents} initial={initial ? [initial] : []} hotkey={false} onChange={(p) => router.push(p[0] ? `${path}?student=${p[0].id}` : path)} />;
}
