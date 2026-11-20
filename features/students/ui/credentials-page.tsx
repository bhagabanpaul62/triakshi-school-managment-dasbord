import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { CredentialService, StudentService } from "../service";
import { PrintButton } from "./print-button";

export const metadata = { title: "Student login slips" };

/** Print: drop the app chrome and use plain black on white, so slips can be cut out of an A4 sheet. */
const PRINT_CSS = "@media print { aside, header, nav, [role=dialog], [data-no-print] { display: none !important; } body { background: #fff !important; } main { padding: 0 !important; } @page { size: A4; margin: 10mm; } }";

/** /app/students/credentials?classId=: one login slip per active student of the class who has never signed in. */
export default async function CredentialsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const students = new StudentService(ctx);
  if (!students.can("write")) redirect("/app/students");
  const raw = (await searchParams).classId;
  const classId = z.uuid().safeParse(Array.isArray(raw) ? raw[0] : raw).data;

  const [look, data, host] = await Promise.all([
    students.lookups(),
    classId ? new CredentialService(ctx).slips(classId) : null,
    headers().then((h) => h.get("host") ?? ""),
  ]);

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div data-no-print>
        <PageHeader eyebrow="Students" title="Login slips"
          description="First sign-in details for students who have never signed in. Print, cut and hand out. They must choose a new password at first sign-in."
          actions={data && data.slips.length ? <PrintButton label="Print slips" /> : null} />
        <Panel title="Class">
          {look.classes.length === 0 ? <WidgetEmptyState title="No classes yet." description="Set up classes in Academics first." /> : (
            <ul className="flex flex-wrap gap-2">
              {look.classes.map((c) => (
                <li key={c.id}>
                  <Link href={`/app/students/credentials?classId=${c.id}`} aria-current={c.id === classId ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm transition-colors hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] ${c.id === classId ? "bg-white/[0.14]" : "bg-white/[0.07]"}`}>
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {!data ? (
        <div className="mt-3" data-no-print><Panel title="Slips"><WidgetEmptyState title="Pick a class." description="Choose the class above to list its students." /></Panel></div>
      ) : data.slips.length === 0 ? (
        <div className="mt-3" data-no-print><Panel title="Slips"><WidgetEmptyState title="Nothing to print." description="Every active student of this class has already signed in." /></Panel></div>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 print:mt-0 print:grid-cols-2 print:gap-2" aria-label="Login slips">
          {data.slips.map((s) => (
            <li key={s.id} className="break-inside-avoid rounded-3xl bg-[var(--ds-surface-container-low)] p-5 print:rounded-none print:border print:border-dashed print:border-black print:bg-white print:p-4 print:text-black">
              <p className="text-xs uppercase tracking-wide text-[var(--ds-on-surface-muted)] print:text-black">{data.schoolName}</p>
              <p className="mt-2 break-words text-lg font-medium">{s.name}</p>
              {s.classSection ? <p className="text-sm text-[var(--ds-on-surface-variant)] print:text-black">Class {s.classSection}</p> : null}
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-[var(--ds-on-surface-muted)] print:text-black">Login ID</dt><dd className="break-all font-mono">{s.loginId}</dd>
                <dt className="text-[var(--ds-on-surface-muted)] print:text-black">Password</dt>
                <dd className="break-all font-mono">{s.password ?? "Ask the school office"}</dd>
              </dl>
              <p className="mt-3 break-all text-xs text-[var(--ds-on-surface-muted)] print:text-black">Sign in at {host}/login</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
