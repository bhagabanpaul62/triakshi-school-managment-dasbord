"use client";

import { useRouter } from "next/navigation";
import { RecordPicker } from "@smw/ui/finance/RecordPicker";
import { findStudents } from "./actions";

/** One search box that opens a student's money page: name or admission number. */
export function StudentJump({ label = "Find a student", to = (id: string) => `/app/fees/students/${id}` }: { label?: string; to?: (id: string) => string }) {
  const router = useRouter();
  return <RecordPicker action={findStudents} name="studentId" label={label} placeholder="Name or admission number, press / to jump here" onChange={(p) => { if (p[0]) router.push(to(p[0].id)); }} />;
}
