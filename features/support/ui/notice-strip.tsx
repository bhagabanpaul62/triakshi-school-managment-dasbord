import { requireCtx } from "@smw/runtime";
import { cn } from "@smw/ui/utils";
import { TONE } from "@smw/ui/tone";
import { activeNotices, type ShownNotice } from "../notices";

const FILL = { info: TONE.info.chip, warning: TONE.warning.chip, danger: TONE.danger.chip, success: TONE.success.chip };

/** What Triakshi is telling schools right now: planned work, a problem, solved. Shown to everyone signed in; a failure here never breaks a page. */
export async function NoticeStrip({ limit = 3 }: { limit?: number }) {
  let list: ShownNotice[] = [];
  try {
    const ctx = await requireCtx();
    list = await activeNotices(ctx.schoolId, limit);
  } catch (e) {
    if (String((e as { digest?: unknown })?.digest ?? "").startsWith("NEXT_")) throw e;
  }
  if (!list.length) return null;
  return (
    <div className="flex flex-col gap-2 pb-4" aria-label="Messages from Triakshi">
      {list.map((n) => (
        <div key={n.id} role="status" className={cn("rounded-2xl px-4 py-3 text-sm", FILL[n.tone])}>
          <p className="font-medium">{n.title}</p>
          <p className="mt-0.5 whitespace-pre-wrap opacity-90">{n.body}</p>
        </div>
      ))}
    </div>
  );
}
