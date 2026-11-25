import { NoticeService, PlanAdminService, SchoolAdminService, type NoticeState } from "@smw/platform";
import { listQueryFrom } from "@smw/feature-kit";
import { requireStaff } from "@smw/runtime/console";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { dateTime } from "@smw/ui/format";
import { createNotice, endNotice } from "../actions";

export const metadata = { title: "Notices to schools" };

const TONES = { info: "info", warning: "warning", danger: "danger", success: "success" } as const;
const TONE_LABELS = { info: "Information", warning: "Planned work", danger: "A problem", success: "Solved" } as const;
const STATE_LABELS: Record<NoticeState, string> = { running: "Showing now", upcoming: "Starts later", ended: "Ended" };
const STATE_TONES: Record<NoticeState, "success" | "info" | "default"> = { running: "success", upcoming: "info", ended: "default" };

export default async function NoticesPage() {
  const staff = await requireStaff();
  const canWrite = staff.role === "owner" || staff.role === "support";
  const [rows, plans, schools] = await Promise.all([
    new NoticeService(staff).list(),
    canWrite ? new PlanAdminService(staff).list() : Promise.resolve([]),
    canWrite ? new SchoolAdminService(staff).list(listQueryFrom({ pageSize: "100" })).then((p) => p.rows) : Promise.resolve([]),
  ]);
  const planKeys = [...new Map(plans.filter((p) => p.isActive).map((p) => [p.key, p.name])).entries()];
  const fields: Field[] = [
    { name: "title", label: "Title", required: true, wide: true, placeholder: "For example: Short break tonight at 11 pm" },
    { name: "body", label: "What schools should know", type: "textarea", required: true, wide: true, hint: "Plain words: what, when, and what they need to do (usually nothing)." },
    { name: "tone", label: "Kind", type: "select", options: Object.entries(TONE_LABELS).map(([value, label]) => ({ value, label })) },
    { name: "audience", label: "Who sees it", type: "select", options: [{ value: "all", label: "Every school" }, { value: "plan", label: "Schools on one plan" }, { value: "school", label: "One school" }] },
    { name: "planKey", label: "Plan (if one plan)", type: "select", options: [{ value: "", label: "-" }, ...planKeys.map(([value, label]) => ({ value, label }))] },
    { name: "schoolId", label: "School (if one school)", type: "select", options: [{ value: "", label: "-" }, ...schools.map((s) => ({ value: s.id, label: s.name }))] },
    { name: "startsAt", label: "Shows from (India time)", type: "datetime-local", hint: "Leave empty to show now." },
    { name: "endsAt", label: "Until (India time)", type: "datetime-local", hint: "Leave empty to keep showing until you end it." },
  ];
  const add = canWrite ? <FormModal title="New notice" icon="megaphone" fields={fields} values={{ tone: "info", audience: "all" }} action={createNotice} submitLabel="Post notice" size="lg" trigger={{ label: "New notice", plus: true }}
    summary="Schools see it as a strip across their panel and on their support page." /> : null;

  return (
    <>
      <PageHeader eyebrow="Business" title="Notices to schools" description="Planned work, a problem, solved. Shown to schools as a strip across their panel." actions={add} />
      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl bg-white/[0.035] p-6">
          <p className="text-sm text-[var(--ds-on-surface)]">No notices yet.</p>
          <p className="text-xs text-[var(--ds-on-surface-muted)]">Write one before planned work, or when something is wrong, so schools hear it from us first.</p>
          {add}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((n) => (
            <Panel key={n.id} title={n.title} action={<span className="flex items-center gap-2"><ToneBadge label={TONE_LABELS[n.tone]} tone={TONES[n.tone]} /><ToneBadge label={STATE_LABELS[n.state]} tone={STATE_TONES[n.state]} /></span>}>
              <p className="whitespace-pre-wrap text-sm text-[var(--ds-on-surface-variant)]">{n.body}</p>
              <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">
                For {n.audience === "all" ? "every school" : n.audience === "plan" ? `schools on the ${n.planKey} plan` : (n.school ?? "one school")} · from {dateTime(n.startsAt)}{n.endsAt ? ` until ${dateTime(n.endsAt)}` : ", until ended"}
              </p>
              {canWrite && n.state !== "ended" ? (
                <div className="mt-3"><ActionButton action={endNotice} values={{ id: n.id }} label={n.state === "upcoming" ? "Remove" : "End now"} variant="secondary"
                  confirm={{ title: n.state === "upcoming" ? "Remove this notice?" : "End this notice?", body: n.state === "upcoming" ? "It has not started, so it is removed." : "Schools stop seeing it at once. It stays in this list as a record.", confirmLabel: n.state === "upcoming" ? "Remove" : "End notice" }} /></div>
              ) : null}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
