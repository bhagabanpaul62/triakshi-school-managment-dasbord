import { z } from "zod";
import { loginBody } from "./_schemas";

const bearer = [{ bearerAuth: [] }];
const json = (schema: unknown, description = "OK") => ({ description, content: { "application/json": { schema } } });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const errors = (...codes: number[]) => Object.fromEntries(codes.map((c) => [String(c), { description: ERROR_TEXT[c] ?? "Error", content: { "application/json": { schema: ref("Error") } } }]));
const ERROR_TEXT: Record<number, string> = {
  401: "Missing, expired or wrong-school token (code `unauthenticated`)", 403: "Role or module not allowed (`forbidden`, `feature_off`)",
  404: "Not found", 422: "Validation failed; see `fieldErrors`", 429: "Too many login attempts", 501: "Not available yet (`not_ready`)",
};
const page = (item: string) => ({ type: "object", required: ["rows", "total", "page", "pageSize", "pageCount"], properties: { rows: { type: "array", items: ref(item) }, total: { type: "integer" }, page: { type: "integer" }, pageSize: { type: "integer" }, pageCount: { type: "integer" } } });
const listParams = [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
  { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
  { name: "q", in: "query", schema: { type: "string", maxLength: 100 }, description: "Search text" },
];
const get = (summary: string, tag: string, ok: unknown, extra: { parameters?: unknown[]; codes?: number[] } = {}) => ({
  get: { summary, tags: [tag], security: bearer, ...(extra.parameters ? { parameters: extra.parameters } : {}), responses: { "200": json(ok), ...errors(401, 403, ...(extra.codes ?? [])) } },
});

/** OpenAPI 3.1 document for /api/v1. Request bodies come from the zod schemas the routes use; paths are written by hand. */
export function buildOpenApi(origin: string) {
  const loose = { type: "object", additionalProperties: true };
  return {
    openapi: "3.1.0",
    info: {
      title: "Triakshi school API", version: "1.0.0",
      description: "Mobile API for one school. Call it on the school's own host (for example https://greenfield.example.in/api/v1). Log in to get a token, then send `Authorization: Bearer <token>`. Money is in paise, dates are YYYY-MM-DD, timestamps are ISO 8601.",
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: bearer,
    tags: [{ name: "Auth" }, { name: "Me" }, { name: "School" }],
    paths: {
      "/auth/login": { post: { summary: "Log in", tags: ["Auth"], security: [], requestBody: { required: true, content: { "application/json": { schema: z.toJSONSchema(loginBody) } } },
        responses: { "200": json(ref("LoginResponse")), ...errors(401, 403, 422, 429) } } },
      "/auth/logout": { post: { summary: "End this session", tags: ["Auth"], security: bearer, responses: { "200": json({ type: "object", properties: { ok: { type: "boolean" } } }), ...errors(401) } } },
      "/me": get("Who am I", "Me", ref("Me")),
      "/announcements": get("Announcements for my role", "School", page("Announcement"), { parameters: listParams }),
      "/timetable/today": get("Today's periods", "School", { type: "object", properties: { day: { type: ["integer", "null"], description: "1 = Monday ... 6 = Saturday; null on Sunday" }, rows: { type: "array", items: loose } } }),
      "/attendance/summary": get("Attendance summary of the signed-in student, or today's school summary (staff)", "School", loose, {
        parameters: [{ name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } }], codes: [422] }),
      "/fees/dues": get("Fee dues in paise", "School", loose, { parameters: listParams }),
      "/results": get("Published exam results", "School", { type: "object", properties: { results: { type: "array", items: loose } } }),
      "/assignments": get("Assignments", "School", loose, { parameters: listParams }),
      "/messages/threads": get("Message threads", "School", loose, { codes: [501] }),
    },
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "The `token` from POST /auth/login" } },
      schemas: {
        Error: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, fieldErrors: { type: "object", additionalProperties: { type: "string" } } } } } },
        User: { type: "object", properties: { id: { type: "string", format: "uuid" }, name: { type: "string" }, role: { enum: ["admin", "accountant", "teacher", "student", "staff"] }, email: { type: ["string", "null"] }, avatarUrl: { type: ["string", "null"] } } },
        LoginResponse: { type: "object", required: ["token", "expiresAt", "user"], properties: { token: { type: "string" }, expiresAt: { type: "string", format: "date-time" }, user: ref("User") } },
        Me: { type: "object", properties: { user: ref("User"), school: { type: "object", properties: { id: { type: "string" }, slug: { type: "string" }, name: { type: "string" } } }, features: { type: "array", items: { type: "string" } }, readOnly: { type: "boolean" }, expiresAt: { type: "string", format: "date-time" } } },
        Announcement: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, body: { type: "string" }, audience: { enum: ["all", "staff", "students", "parents", "class"] }, pinned: { type: "boolean" }, publishedAt: { type: "string", format: "date-time" } } },
      },
    },
  };
}
