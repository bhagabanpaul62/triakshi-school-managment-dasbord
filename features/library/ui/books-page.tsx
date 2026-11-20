import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal, INPUT } from "@smw/ui/shell/FormModal";
import { Panel } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import { BookService } from "../service";
import { createBook } from "./actions";
import { CATEGORIES, bookFields } from "./fields";

export const metadata = { title: "Books" };

const columns: Column[] = [
  { key: "title", label: "Title" },
  { key: "author", label: "Author" },
  { key: "category", label: "Category", type: "badge", hideOnMobile: true },
  { key: "language", label: "Language", hideOnMobile: true },
  { key: "copiesLabel", label: "On shelf" },
];

export default async function BooksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new BookService(ctx);
  const [page, categories] = await Promise.all([svc.listWithCounts(listQueryFrom(await searchParams)), svc.categories()]);
  const canManage = svc.can("manage");
  const add = canManage ? <FormModal title="Add book" icon="library" fields={bookFields(true)} action={createBook} submitLabel="Add book" values={{ copies: 1, language: "English" }} /> : null;

  return (
    <>
      <PageHeader eyebrow="Library" title="Books" description="Every title with its copies. Open a book to issue or return a copy." actions={add} />
      {canManage ? (
        <div className="pb-4">
          <Panel title="Print accession labels">
            <form method="get" action="/app/library/labels" target="_blank" className="flex flex-wrap items-end gap-3">
              <div className="flex w-32 flex-col gap-1">
                <label htmlFor="lbl-from" className="text-sm text-[var(--ds-on-surface-variant)]">From accession</label>
                <input id="lbl-from" name="from" placeholder="ACC-00001" required className={INPUT} />
              </div>
              <div className="flex w-32 flex-col gap-1">
                <label htmlFor="lbl-to" className="text-sm text-[var(--ds-on-surface-variant)]">To (optional)</label>
                <input id="lbl-to" name="to" placeholder="ACC-00024" className={INPUT} />
              </div>
              <Button type="submit" variant="secondary" className="rounded-full">Open label sheet</Button>
              <p className="basis-full text-xs text-[var(--ds-on-surface-muted)]">24 labels per A4 sheet, each with the title and a Code 128 barcode. To print every copy of one book, open the book.</p>
            </form>
          </Panel>
        </div>
      ) : null}
      <DataTable
        columns={columns} rows={page.rows} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/app/library/books/{id}"
        searchPlaceholder="Search title, author or ISBN"
        filters={[{ key: "category", label: "Category", options: [...new Set([...CATEGORIES, ...categories])].map((c) => ({ value: c, label: c })) }]}
        empty={{ title: "No books yet.", description: "Add a book and how many copies the library holds.", action: add ?? undefined }}
      />
    </>
  );
}
