import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { HouseService } from "../service";

/** The signed-in student's house, points and rank. Renders nothing for anyone else, so any page can drop it in (the student "my record" page uses it). */
export async function MyHouse() {
  const ctx = await requireCtx();
  if (ctx.role !== "student") return null;
  const mine = await new HouseService(ctx).mine().catch(() => null);
  if (!mine) return null;
  return (
    <Panel title="My house">
      <div className="flex flex-wrap items-center gap-3">
        <ToneBadge tone={mine.tone} label={mine.name} />
        <span className="text-sm text-[var(--ds-on-surface-variant)]">{mine.points} points · ranked {mine.rank} of {mine.of}</span>
      </div>
    </Panel>
  );
}
