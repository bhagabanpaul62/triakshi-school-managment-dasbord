import Link from "next/link";
import { SetupStatusService } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { Panel } from "@smw/ui/kit/Panel";
import { dateTime, shortDate } from "@smw/ui/format";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";

/** How far the school has come in setting up, from last night's picture, and the questions it asked on the way. */
export async function SetupPanel({ id }: { id: string }) {
  const { status: s, tickets } = await new SetupStatusService(await requireStaff()).forSchool(id);
  const facts = (s?.facts ?? {}) as { wizardNext?: string | null; wizardFinished?: boolean; tasksSkipped?: number };
  return (
    <div className="pb-8">
      <Panel title="Setup" action={s ? <ToneBadge label={`${s.percent}% done`} tone={s.percent >= 50 ? "success" : "warning"} /> : <ToneBadge label="No picture yet" />}>
        {s ? (
          <FactList>
            <Fact label="Getting started">{s.done} of {s.total} tasks done</Fact>
            <Fact label="Stuck on">{s.nextLabel ?? "Nothing, all done"}</Fact>
            <Fact label="Setup wizard">{facts.wizardFinished ? "Finished" : `Not finished${facts.wizardNext ? `, next: ${facts.wizardNext}` : ""}`}</Fact>
            <Fact label="Last sign-in">{s.lastLoginAt ? dateTime(s.lastLoginAt) : "Nobody has signed in"}</Fact>
            <Fact label="Students">{String(s.students)}</Fact>
            <Fact label="First attendance">{s.firstAttendanceOn ?? "Not marked yet"}</Fact>
            <Fact label="Picture taken">{shortDate(s.updatedAt)}</Fact>
          </FactList>
        ) : <p className="px-1 text-sm text-[var(--ds-on-surface-muted)]">The nightly picture has not run for this school yet.</p>}
        <p className="px-1 pt-4 text-sm">
          {tickets.length ? (
            <>
              <span className="text-[var(--ds-on-surface-muted)]">Setup questions: </span>
              {tickets.map((t, i) => <span key={t.id}>{i ? ", " : ""}<Link href={`/support/${t.id}`} className="underline underline-offset-4">T-{t.number}</Link> <span className="text-xs text-[var(--ds-on-surface-muted)]">({t.status})</span></span>)}
              {" "}<Link href={`/support?school=${id}`} className="text-[var(--ds-on-surface-variant)] underline underline-offset-4">All tickets</Link>
            </>
          ) : <span className="text-[var(--ds-on-surface-muted)]">No setup questions from this school.</span>}
        </p>
      </Panel>
    </div>
  );
}
