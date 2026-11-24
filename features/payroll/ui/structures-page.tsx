import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { EmptyLine } from "@smw/ui/finance/States";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { StructureService } from "../services/structures";
import { copyStructure, deleteStructure, saveStructure } from "./actions";
import { NoAccess, PILL_BTN, PRIMARY_BTN, PayNav, one, type Search } from "./common";
import { StructureEditor } from "./structure-editor";

export const metadata = { title: "Pay structures" };

export default async function StructuresPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  const svc = new StructureService(ctx);
  if (!svc.can("read")) return <NoAccess what="Pay structures" />;
  const edit = one((await searchParams).edit);
  const manage = svc.can("manage");
  const list = await svc.list();
  const open = edit && edit !== "new" ? await svc.get(edit).catch(() => null) : null;
  return (
    <>
      <PageHeader eyebrow="Payroll" title="Pay structures" description="How a gross pay is split: basic, allowances, deductions and employer costs. People are paid by one structure each." actions={manage ? <Link href="/app/payroll/structures?edit=new" className={PRIMARY_BTN}>New structure</Link> : null} />
      <PayNav active="structures" manager />
      {edit && (edit === "new" || open) ? (
        <Panel title={open ? open.structure.name : "New structure"} action={<Link href="/app/payroll/structures" className="text-xs text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]">Close</Link>} className="mb-6">
          <StructureEditor key={open?.structure.id ?? "new"} id={open?.structure.id} name={open?.structure.name ?? ""} locked={!manage || (open?.people ?? 0) > 0} save={saveStructure} copy={manage ? copyStructure : undefined}
            components={(open?.components ?? []).map(({ label, kind, mode, value, isBasic, isWage, proRata, taxable }) => ({ label, kind, mode, value: Number(value), isBasic, isWage, proRata, taxable }))} />
        </Panel>
      ) : null}
      {list.length === 0 ? <EmptyLine title="No pay structures yet." hint="Make one for teachers and one for support staff, then set each person's pay against it." action={manage ? <Link href="/app/payroll/structures?edit=new" className={PRIMARY_BTN}>Make the first structure</Link> : undefined} /> : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {list.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 rounded-3xl bg-[var(--ds-surface-container-low)] p-5">
              <span className="min-w-0"><Link href={`/app/payroll/structures?edit=${s.id}`} className="block truncate font-medium hover:underline">{s.name}</Link><span className="mt-1 block text-xs text-[var(--ds-on-surface-muted)]">{s.components} components · {s.people} pay assignments {s.isActive ? "" : "· switched off"}</span></span>
              <span className="flex items-center gap-1">{s.people ? <ToneBadge label="In use" tone="info" /> : null}
                {manage ? <><ActionButton action={copyStructure} values={{ id: s.id }} label="Copy" variant="ghost" redirectTo="/app/payroll/structures" />
                  {s.people === 0 ? <ActionButton action={deleteStructure} values={{ id: s.id }} label={`Delete ${s.name}`} variant="icon-delete" confirm={{ title: `Delete ${s.name}?`, body: "Nobody is paid by it. This cannot be undone.", danger: true }} /> : null}</> : null}
                <Link href={`/app/payroll/structures?edit=${s.id}`} className={PILL_BTN}>Open</Link></span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
