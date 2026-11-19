import { notFound } from "next/navigation";
import { NotFoundError } from "@smw/feature-kit";
import { ApprovalService } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { PanelGrid } from "@smw/ui/shell/PageHeader";
import { dateTime, relative } from "@smw/ui/format";
import { ReviewActions } from "@/components/review-actions";
import { SCHOOL_LABELS, SCHOOL_TONES } from "@/lib/tones";

export const metadata = { title: "Review school" };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff();
  let s;
  try { s = await new ApprovalService(staff).review(id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const canDecide = staff.role === "owner";

  return (
    <>
      <EntityHeader back={{ href: "/approvals", label: "Approvals" }} title={s.name}
        chips={<ToneBadge label={SCHOOL_LABELS[s.status]!} tone={SCHOOL_TONES[s.status]} />}
        meta={[`Registered ${relative(s.createdAt)}`, [s.city, s.state].filter(Boolean).join(", ")]}
        actions={<ReviewActions id={s.id} name={s.name} status={s.status} adminEmail={s.adminEmail} canDecide={canDecide} />} />
      <div className="pt-6">
        <PanelGrid>
          <div className="lg:col-span-7">
            <Panel title="School">
              <FactList>
                <Fact label="Name">{s.name}</Fact>
                <Fact label="Address" copy={s.slug}>{s.slug}</Fact>
                <Fact label="Board">{s.board}</Fact>
                <Fact label="Location">{[s.city, s.state].filter(Boolean).join(", ")}</Fact>
                <Fact label="Size">{s.planName ? `${s.planName}, up to ${s.studentCap} students` : `Up to ${s.studentCap} students`}</Fact>
                <Fact label="Phone" copy={s.phone ?? undefined}>{s.phone}</Fact>
                <Fact label="Registered">{dateTime(s.createdAt)}</Fact>
              </FactList>
            </Panel>
          </div>
          <div className="lg:col-span-5">
            <Panel title="Administrator">
              <FactList>
                <Fact label="Name">{s.adminName}</Fact>
                <Fact label="Email" copy={s.adminEmail ?? undefined}>{s.adminEmail}</Fact>
                <Fact label="Verification"><ToneBadge label={s.emailVerified ? "Verified, password set" : "Not verified yet"} tone={s.emailVerified ? "success" : "warning"} /></Fact>
                {s.rejectedReason ? <Fact label="Rejected because">{s.rejectedReason}</Fact> : null}
              </FactList>
              <p className="pt-4 text-xs text-[var(--ds-on-surface-muted)]">
                {!canDecide ? "Only an owner can approve or reject."
                  : s.status === "pending" ? (s.emailVerified ? "Approving starts a 30-day trial today and emails a sign-in link." : "They have not verified their email yet. You can still approve, they sign in after verifying.")
                  : "Reopen to send it back to the queue."}
              </p>
            </Panel>
          </div>
        </PanelGrid>
      </div>
    </>
  );
}
