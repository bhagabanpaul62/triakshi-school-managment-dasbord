import { IconAlertTriangle, IconArchive, IconBan, IconCalendar, IconCheck, IconChecks, IconCircleFilled, IconClock, IconEye, IconHourglass, IconMailOff, IconPencil, IconQuestionMark, IconSend, IconArrowBackUp, IconX, type Icon } from "@tabler/icons-react";
import { cn } from "../../lib/utils";
import { TONE } from "../../lib/tone";
import { commState, type CommIcon, type CommKind } from "./states";

const ICONS: Record<CommIcon, Icon> = {
  pencil: IconPencil, hourglass: IconHourglass, clock: IconClock, calendar: IconCalendar, send: IconSend, check: IconCheck, checks: IconChecks,
  eye: IconEye, x: IconX, alert: IconAlertTriangle, ban: IconBan, undo: IconArrowBackUp, archive: IconArchive, mailoff: IconMailOff, question: IconQuestionMark, dot: IconCircleFilled,
};

export interface StateChipProps {
  kind: CommKind;
  /** Any state of that kind, for example "pending_approval". An unknown state shows its own text in neutral. */
  state: string;
  className?: string;
}

/** One chip for every communication state. The words always say the state; the icon and colour only add urgency. */
export function StateChip({ kind, state, className }: StateChipProps) {
  const { label, tone, icon } = commState(kind, state);
  const I = ICONS[icon];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", TONE[tone].chip, className)}>
      <I className="h-3 w-3" aria-hidden />{label}
    </span>
  );
}
