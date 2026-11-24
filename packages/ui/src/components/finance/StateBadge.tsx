import { ToneBadge } from "../dashboard/widgets/WidgetPrimitives";
import { stateInfo } from "./logic";

export { STATE_MAP } from "./logic";

export interface StateBadgeProps {
  /** Any finance state: draft, overdue, part_paid, cleared, locked... An unknown state shows its own text in neutral. */
  state: string;
  className?: string;
}

/** One chip for every finance state. The label always says the state, colour only adds urgency. */
export function StateBadge({ state, className }: StateBadgeProps) {
  const { label, tone } = stateInfo(state);
  return <ToneBadge label={label} tone={tone} className={className} />;
}
