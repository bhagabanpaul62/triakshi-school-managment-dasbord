// Write, send and fan out a notice in one call, skipping the 30-second undo wait. For seeds and tests only: real sending always waits.
import type { Ctx } from "@smw/feature-kit";
import { fanOut } from "./fan-out";
import { NoticeService } from "./notice-service";

export async function publishNow(ctx: Ctx, input: Record<string, unknown>): Promise<{ id: string; number: string | null }> {
  const svc = new NoticeService(ctx);
  const { id } = await svc.saveDraft({ type: "notice", ...input });
  const sent = await svc.publish(id, { confirmed: true });
  await fanOut(ctx.schoolId, id, new Date(Date.now() + 120_000));
  return { id, number: sent.number };
}
