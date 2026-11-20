import { templateCsv } from "./import";

/** GET /app/staff/import/template: the CSV template download. */
export async function GET() {
  return new Response(templateCsv(), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="staff-template.csv"', "cache-control": "no-store" },
  });
}
