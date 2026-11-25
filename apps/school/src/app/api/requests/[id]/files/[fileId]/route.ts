import { requestFile } from "@smw/feature-requests/csv";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  return requestFile(req, await params);
}
