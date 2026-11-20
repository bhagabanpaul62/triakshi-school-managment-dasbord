import Link from "next/link";
import { buttonVariants } from "@smw/ui/ui/button";
import { requireCtx } from "@smw/runtime";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { KpiRow } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { MenuIconView } from "@smw/ui/shell/icons";
import { ToneBadge, WidgetEmptyState, ROW_HOVER, type Tone } from "@smw/ui/widgets/WidgetPrimitives";
import { shortDate } from "@smw/ui/format";
import { BookService, LoanService } from "../service";
import { addCopies, deleteBook, issueBook, markCopy, returnLoan, updateBook } from "./actions";
import { returnConfirm } from "./return-confirm";
import { bookFields, copiesFields, issueFields } from "./fields";

export const metadata = { title: "Book" };

const TONE: Record<string, Tone> = { available: "success", issued: "info", lost: "danger", damaged: "warning" };
const LABEL: Record<string, string> = { available: "On shelf", issued: "Issued", lost: "Lost", damaged: "Damaged" };

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const books = new BookService(ctx);
  const d = await books.detail(id);
  const canManage = books.can("manage");
  const staff = canManage ? await new LoanService(ctx).staffOptions() : [];
  const { book } = d;

  return (
    <>
      <EntityHeader
        back={{ href: "/app/library/books", label: "Books" }}
        leading={<span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.06]"><MenuIconView name="book" className="h-6 w-6" /></span>}
        title={book.title}
        chips={<ToneBadge label={book.category} />}
        meta={[book.author, book.publisher, book.language, book.isbn ? `ISBN ${book.isbn}` : null]}
        actions={canManage ? <>
          <Link href={`/app/library/labels?book=${book.id}`} target="_blank" className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Print labels</Link>
          <FormModal title="Add copies" icon="library" fields={copiesFields} hidden={{ bookId: book.id }} values={{ copies: 1 }} action={addCopies} submitLabel="Add copies" trigger={{ label: "Add copies", variant: "secondary", plus: true }} />
          <FormModal title="Edit book" icon="library" fields={bookFields(false)} values={book} hidden={{ id: book.id }} action={updateBook} trigger={{ label: "Edit", variant: "secondary" }} />
          <ActionButton variant="icon-delete" label="Delete book" action={deleteBook} values={{ id: book.id }} redirectTo="/app/library/books"
            confirm={{ title: "Delete this book?", body: `${book.title} and its ${d.copies.length} copies will be removed. Books that were ever lent cannot be deleted.`, confirmLabel: "Delete", danger: true }} />
        </> : null}
      />
      <div className="h-8" />
      <KpiRow>
        <StatCard label="Copies" value={String(d.copies.length)} icon={<MenuIconView name="library" />} />
        <StatCard label="On the shelf" value={String(d.available)} icon={<MenuIconView name="check" />} />
        <StatCard label="Issued" value={String(d.issued)} icon={<MenuIconView name="book" />} />
        <StatCard label="Times borrowed" value={String(d.timesBorrowed)} icon={<MenuIconView name="chart" />} />
      </KpiRow>
      <Panel title="Copies">
        {d.copies.length === 0 ? <WidgetEmptyState title="No copies yet." description="Add the copies the library holds." /> : (
          <ul className="flex flex-col">
            {d.copies.map((c) => (
              <li key={c.id} className={`flex flex-wrap items-center gap-3 rounded-2xl px-2 py-3 ${ROW_HOVER}`}>
                <span className="w-24 font-mono text-xs">{c.accessionLabel}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{c.borrowerName ? `With ${c.borrowerName}` : c.shelf ? `Shelf ${c.shelf}` : "No shelf set"}</span>
                  {c.dueOn ? <span className="block text-xs text-[var(--ds-on-surface-muted)]">Due {shortDate(c.dueOn)}</span> : null}
                </span>
                <ToneBadge label={c.overdue ? "Overdue" : LABEL[c.status] ?? c.status} tone={c.overdue ? "danger" : TONE[c.status] ?? "default"} />
                {canManage ? (
                  <span className="inline-flex items-center gap-1">
                    {c.status === "available" ? <>
                      <FormModal title={`Issue ${c.accessionLabel}`} description={book.title} icon="book" fields={issueFields(staff)} hidden={{ copyId: c.id }} action={issueBook} submitLabel="Issue book"
                        trigger={{ label: "Issue", variant: "secondary", size: "sm", plus: false }} />
                      <ActionButton label="Mark lost" variant="ghost" action={markCopy} values={{ id: c.id, status: "lost" }}
                        confirm={{ title: "Mark this copy lost?", body: `${c.accessionLabel} will not be lent out again until you put it back on the shelf.`, confirmLabel: "Mark lost", danger: true }} />
                    </> : null}
                    {c.status === "issued" && c.loanId ? <ActionButton label="Return" variant="secondary" action={returnLoan} values={{ id: c.loanId }} confirm={c.fine > 0 ? returnConfirm({ title: book.title, borrowerName: c.borrowerName ?? "The borrower", daysLate: c.daysLate, finePaise: c.fine }) : undefined} /> : null}
                    {c.status === "lost" || c.status === "damaged" ? <ActionButton label="Back on shelf" variant="ghost" action={markCopy} values={{ id: c.id, status: "available" }} /> : null}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
