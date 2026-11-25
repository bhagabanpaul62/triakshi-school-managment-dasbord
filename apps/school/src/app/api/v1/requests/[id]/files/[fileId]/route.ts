import { RequestService } from "@smw/feature-requests/service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { idOf, linkOf, type FileParams } from "../../../../_lib";

/** GET /api/v1/requests/{id}/files/{fileId}: { url, expiresIn } for a file in a request I may see. Notes for the office are never shown to a family. */
export const GET = apiHandler(async (req, c: FileParams) => linkOf(await new RequestService(await bearerCtx(req)).fileLink(await idOf(c), await idOf(c, "fileId"))));
