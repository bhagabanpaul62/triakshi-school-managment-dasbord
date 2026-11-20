import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader, KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { MenuIconView } from "@smw/ui/shell/icons";
import { FormModal } from "@smw/ui/shell/FormModal";
import { shortDate } from "@smw/ui/format";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { HouseService, SectionService } from "../service";
import { assignHouse, awardPoints, createHouse, deleteHouse, deletePoints, updateHouse, updatePoints } from "./actions";
import { awardFields, houseFields, pointsFields } from "./fields";
import { MiniList } from "./mini-list";
import { MyHouse } from "./my-house";
import { RowActions } from "./row-actions";
import { TeacherSelect } from "./teacher-select";

export const metadata = { title: "Houses" };

export default async function HousesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const svc = new HouseService(ctx);
  const canManage = svc.can("manage");
  const canAward = svc.can("houses");
  const [standings, log, sectionOptions] = await Promise.all([svc.standings(), svc.log(), canManage ? new SectionService(ctx).options() : Promise.resolve([])]);
  const sectionId = typeof sp.section === "string" ? sp.section : undefined;
  const roster = canManage && sectionId && ctx.features.has("students") ? await svc.roster(sectionId).catch(() => []) : [];
  const houseOptions = standings.map((h) => ({ value: h.id, label: h.name }));
  const fields = houseFields(roster.map((s) => ({ value: s.id, label: s.name })));
  const members = standings.reduce((n, h) => n + h.members, 0);
  const award = canAward && standings.length ? <FormModal title="Award points" icon="users" fields={awardFields(houseOptions)} action={awardPoints} submitLabel="Save points" /> : null;

  return (
    <>
      <PageHeader eyebrow="Academics" title="Houses" description="Houses compete through the year. Award points for wins, effort and good conduct."
        actions={<>{award}{canManage ? <FormModal title="New house" icon="users" fields={houseFields([])} action={createHouse} values={{ tone: "info" }} trigger={{ label: "New house", variant: "secondary" }} /> : null}</>} />
      <MyHouse />
      {standings.length ? (
        <KpiRow>
          <StatCard label="Leading house" value={standings[0]!.name} icon={<MenuIconView name="users" />} meta={`${standings[0]!.points} points`} />
          <StatCard label="Houses" value={String(standings.length)} icon={<MenuIconView name="class" />} />
          <StatCard label="Students in houses" value={String(members)} icon={<MenuIconView name="users" />} />
        </KpiRow>
      ) : null}
      <PanelGrid>
        <div className="lg:col-span-7">
          <Panel title="Standings">
            <MiniList
              empty={{ title: "No houses yet.", description: canManage ? "Add the school's houses, then put students in them." : "The school has not set up houses." }}
              items={standings.map((h, i) => ({
                id: h.id,
                title: <span className="inline-flex items-center gap-2"><span className="font-mono text-xs text-[var(--ds-on-surface-muted)]">{i + 1}</span><ToneBadge tone={h.tone} label={h.name} /></span>,
                meta: `${h.points} points · ${h.members} ${h.members === 1 ? "student" : "students"}${h.captainName ? ` · Captain ${h.captainName}` : ""}`,
                actions: canManage ? <RowActions what="house" icon="users" fields={fields} values={h} id={h.id} update={updateHouse} remove={deleteHouse}
                  consequence={`${h.name} will be removed. A house with students or points entries can't be deleted: move the students out and delete its entries first.`} /> : null,
              }))} />
          </Panel>
        </div>
        <div className="lg:col-span-5">
          <Panel title="Recent points">
            <MiniList
              empty={{ title: "No points yet.", description: "Awarded points show here." }}
              items={log.map((l) => ({ id: l.id, title: `${l.points > 0 ? "+" : ""}${l.points} ${l.houseName}`, meta: `${l.reason} · ${l.by ?? "Staff"} · ${shortDate(l.awardedOn)}`,
                actions: canManage ? <RowActions what="points entry" icon="users" fields={pointsFields} values={l} id={l.id} update={updatePoints} remove={deletePoints}
                  consequence={`The ${l.points > 0 ? "+" : ""}${l.points} for ${l.houseName} will come off the standings.`} /> : null }))} />
          </Panel>
        </div>
        {canManage && standings.length && ctx.features.has("students") ? (
          <div className="lg:col-span-12">
            <Panel title="Members">
              <nav aria-label="Pick a section" className="mb-4 flex flex-wrap gap-2">
                {sectionOptions.map((s) => (
                  <Link key={s.value} href={`?section=${s.value}`} aria-current={s.value === sectionId ? "page" : undefined}
                    className={`inline-flex h-9 items-center rounded-full px-3 text-sm focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] ${s.value === sectionId ? "bg-[var(--ds-color-primary-500)]/20 text-[var(--ds-on-surface)]" : "bg-white/[0.05] text-[var(--ds-on-surface-variant)] hover:bg-white/[0.08]"}`}>{s.label}</Link>
                ))}
              </nav>
              {sectionId ? (
                <MiniList empty={{ title: "No students here.", description: "This section has no active students." }}
                  items={roster.map((st) => ({
                    id: st.id, title: st.name, meta: st.rollNo ? `Roll ${st.rollNo}` : undefined,
                    actions: <TeacherSelect label={`House of ${st.name}`} value={st.houseId} teachers={houseOptions} action={assignHouse} fields={{ studentId: st.id }} name="houseId" empty="No house" className="w-44" />,
                  }))} />
              ) : <p className="text-sm text-[var(--ds-on-surface-muted)]">Pick a section to put its students in houses. Picking a section also lets you choose a house captain when you edit a house.</p>}
            </Panel>
          </div>
        ) : null}
      </PanelGrid>
    </>
  );
}
