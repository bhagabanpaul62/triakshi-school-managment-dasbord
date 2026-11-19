import { ImportService } from "./service";

/** GET /app/students/import/template: the CSV template download. */
export async function GET() {
  return new Response(ImportService.templateCsv(), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="students-template.csv"', "cache-control": "no-store" },
  });
}
