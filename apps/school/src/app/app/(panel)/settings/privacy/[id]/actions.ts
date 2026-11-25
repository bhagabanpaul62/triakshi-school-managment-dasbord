"use server";

import { actionCtx, runAction } from "@smw/runtime";
import { eraseStudentForRequest } from "@/lib/erase-student";

export async function eraseStudent(fd: FormData) {
  return runAction(async () => {
    const r = await eraseStudentForRequest(await actionCtx(), {
      studentId: String(fd.get("studentId")), requestId: String(fd.get("requestId")), confirm: String(fd.get("confirm") ?? ""), reason: String(fd.get("reason") ?? ""),
    });
    return { id: String(fd.get("studentId")), already: r.already };
  }, "Done. The request is closed.");
}
