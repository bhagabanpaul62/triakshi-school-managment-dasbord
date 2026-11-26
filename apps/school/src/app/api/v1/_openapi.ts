import { z } from "zod";
import {
  answerBody, changePasswordBody, bookBody, cancelBookingBody, changeBody, deviceBody, loginBody, prefsBody, readBody, respondBody, rsvpBody, sendBody,
} from "./_schemas";
import { startInput } from "@smw/feature-messages/inputs";
import { raiseInput } from "@smw/feature-requests/inputs";

const loose = { type: "object", additionalProperties: true };
const ok = { type: "object", properties: { ok: { type: "boolean" } } };
const bearer = [{ bearerAuth: [] }];
const json = (schema: unknown, description = "OK") => ({ description, content: { "application/json": { schema } } });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const errors = (...codes: number[]) => Object.fromEntries(codes.map((c) => [String(c), { description: ERROR_TEXT[c] ?? "Error", content: { "application/json": { schema: ref("Error") } } }]));
const ERROR_TEXT: Record<number, string> = {
  401: "Missing, expired or wrong-school token (code `unauthenticated`)", 403: "Role or module not allowed (`forbidden`, `feature_off`, `read_only` is 423)",
  404: "Not found, or not yours (the API never says which)", 409: "The state changed under you (booking taken, notice closed, last date passed); the message says what to do", 423: "The school is read-only; reads still work", 422: "Validation failed; see `fieldErrors`", 429: "Too many login attempts",
};
const pageProps = (item: string) => ({ rows: { type: "array", items: ref(item) }, total: { type: "integer" }, page: { type: "integer" }, pageSize: { type: "integer" }, pageCount: { type: "integer" } });
const page = (item: string) => ({ type: "object", required: ["rows", "total", "page", "pageSize", "pageCount"], properties: pageProps(item) });
const listParams = [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
  { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
  { name: "q", in: "query", schema: { type: "string", maxLength: 100 }, description: "Search text" },
];
/** Request bodies come from the same zod schema the route parses with. Transforms and preprocessing are described by their input side. */
const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
const binary = { type: "string", format: "binary" };
/** A write that takes files also takes multipart: the same JSON in a `json` part, the files as `files` parts (or `file:<questionId>` for a notice answer). */
const multipart = (schema: z.ZodType, files: "files" | "file:<questionId>") => ({ schema: { type: "object", required: ["json"], properties: {
  json: { type: "string", description: "The same JSON as the application/json body", contentMediaType: "application/json", contentSchema: jsonSchema(schema) },
  ...(files === "files" ? { files: { type: "array", items: binary, description: "Up to 5 pictures or PDFs; the same limits as the website" } } : {}),
}, ...(files === "files" ? {} : { additionalProperties: binary, description: "One part `file:<questionId>` for each question that asks for a file" }) } });
const body = (schema: z.ZodType, files?: "files" | "file:<questionId>") => ({ required: true, content: { "application/json": { schema: jsonSchema(schema) }, ...(files ? { "multipart/form-data": multipart(schema, files) } : {}) } });
const fileIdParam = { name: "fileId", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const link = { type: "object", required: ["url", "expiresIn"], properties: { url: { type: "string" }, name: { type: "string" }, expiresIn: { type: "integer", description: "Seconds the link works; open it at once and do not store it" } } };
const idParam = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const op = (summary: string, tag: string, ok: unknown, o: { body?: z.ZodType; files?: "files" | "file:<questionId>"; parameters?: unknown[]; codes?: number[]; id?: boolean } = {}) => ({
  summary, tags: [tag], security: bearer,
  ...(o.id || o.parameters ? { parameters: [...(o.id ? [idParam] : []), ...(o.parameters ?? [])] } : {}),
  ...(o.body ? { requestBody: body(o.body, o.files) } : {}),
  responses: { "200": json(ok), ...errors(401, 403, ...(o.codes ?? [])) },
});
const query = (...names: [string, object, string?][]) => names.map(([name, schema, description]) => ({ name, in: "query", schema, ...(description ? { description } : {}) }));
const get = (summary: string, tag: string, ok: unknown, extra: { parameters?: unknown[]; codes?: number[] } = {}) => ({
  get: { summary, tags: [tag], security: bearer, ...(extra.parameters ? { parameters: extra.parameters } : {}), responses: { "200": json(ok), ...errors(401, 403, ...(extra.codes ?? [])) } },
});

/** OpenAPI 3.1 document for /api/v1. Request bodies come from the zod schemas the routes use; paths are written by hand. */
export function buildOpenApi(origin: string) {
    return {
    openapi: "3.1.0",
    info: {
      title: "Triakshi school API", version: "1.0.0",
      description: "Mobile API for one school. Call it on the school's own host (for example https://greenfield.example.in/api/v1). Log in to get a token, then send `Authorization: Bearer <token>`. Money is in paise, dates are YYYY-MM-DD, timestamps are ISO 8601.",
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: bearer,
    tags: ["Auth", "Me", "School", "Notices", "Conversations", "Requests", "Calendar", "Meetings", "Notifications", "Push"].map((name) => ({ name })),
    paths: {
      "/auth/login": { post: { summary: "Log in", tags: ["Auth"], security: [], requestBody: { required: true, content: { "application/json": { schema: z.toJSONSchema(loginBody) } } },
        responses: { "200": json(ref("LoginResponse")), ...errors(401, 403, 422, 429) } } },
      "/auth/logout": { post: { summary: "End this session", tags: ["Auth"], security: bearer, responses: { "200": json({ type: "object", properties: { ok: { type: "boolean" } } }), ...errors(401) } } },
      "/auth/change-password": { post: { summary: "Replace a default or temporary password (needed when other calls answer 403 password_change_required)", tags: ["Auth"], security: bearer, requestBody: body(changePasswordBody), responses: { "200": json(ok), ...errors(401, 422) } } },
      "/me": get("Who am I", "Me", ref("Me")),
      "/announcements": get("Announcements for my role", "School", page("Announcement"), { parameters: listParams }),
      "/timetable/today": get("Today's periods", "School", { type: "object", properties: { day: { type: ["integer", "null"], description: "1 = Monday ... 6 = Saturday; null on Sunday" }, rows: { type: "array", items: loose } } }),
      "/attendance/summary": get("Attendance summary of the signed-in student, or today's school summary (staff)", "School", loose, {
        parameters: [{ name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } }], codes: [422] }),
      "/fees/dues": get("Fee dues in paise", "School", loose, { parameters: listParams }),
      "/results": get("Published exam results", "School", { type: "object", properties: { results: { type: "array", items: loose } } }),
      "/assignments": get("Assignments", "School", loose, { parameters: listParams }),
      "/messages/threads": get("Message threads (same as /conversations, kept for old clients)", "School", ref("Inbox")),
      "/notices": { get: op("Notices sent to me, answers-needed first", "Notices", ref("NoticeFeed"), { parameters: query(["tab", { enum: ["inbox", "archive"], default: "inbox" }], ["page", { type: "integer", minimum: 1 }], ["pageSize", { type: "integer", minimum: 1, maximum: 100 }], ["q", { type: "string" }], ["category", { type: "string", format: "uuid" }]), codes: [422] }) },
      "/notices/{id}": { get: op("One notice; opening it marks it seen", "Notices", ref("NoticeOne"), { id: true, codes: [404], parameters: query(["lang", { type: "string" }, "Second language code when the notice has one"]) }) },
      "/notices/{id}/respond": { post: op("Answer a notice for my child", "Notices", { type: "object", properties: { recipientId: { type: "string" }, changed: { type: "boolean" } } }, { id: true, body: respondBody, files: "file:<questionId>", codes: [404, 409, 422, 423] }) },
      "/conversations": {
        get: op("My conversations, newest activity first", "Conversations", ref("Inbox"), { parameters: query(["view", { enum: ["all", "unread", "archived"] }], ["studentId", { type: "string", format: "uuid" }], ["q", { type: "string" }], ["cursor", { type: "string" }, "The `next` of the previous page"]), codes: [422] }),
        post: op("Start a conversation and send its first message", "Conversations", { type: "object", properties: { id: { type: "string" } } }, { body: startInput, files: "files", codes: [422, 423] }),
      },
      "/conversations/{id}": { get: op("One conversation; opening it marks it read", "Conversations", loose, { id: true, codes: [404], parameters: query(["before", { type: "string" }, "`oldestAt` of the oldest message you have, for older ones"]) }) },
      "/conversations/{id}/messages": { post: op("Reply in a conversation", "Conversations", loose, { id: true, body: sendBody, files: "files", codes: [404, 422, 423] }) },
      "/conversations/{id}/read": { post: op("Mark a conversation read", "Conversations", ok, { id: true, codes: [404] }) },
      "/requests": {
        get: op("Requests I may see", "Requests", page("RequestRow"), { parameters: [...listParams, ...query(["state", { type: "string" }], ["category", { type: "string", format: "uuid" }], ["view", { enum: ["mine", "unassigned", "team", "overdue", "all"] }, "Staff only"])] }),
        post: op("Raise a request (family) or write one down (office)", "Requests", { type: "object", properties: { id: { type: "string" }, number: { type: "string" } } }, { body: raiseInput, files: "files", codes: [422, 423] }),
      },
      "/requests/categories": { get: op("What a request may be about", "Requests", { type: "object", properties: { rows: { type: "array", items: loose } } }) },
      "/requests/{id}": { get: op("One request with its conversation and timeline", "Requests", loose, { id: true, codes: [404] }) },
      "/requests/{id}/answer": { post: op("Staff answer; a family writes back", "Requests", ok, { id: true, body: answerBody, files: "files", codes: [404, 409, 422, 423] }) },
      "/files/messages/{id}": { get: op("A 60-second link to a file in a conversation I am in", "Conversations", link, { id: true, codes: [404] }) },
      "/files/notices/{id}": { get: op("A 60-second link to a file on a notice sent to me", "Notices", link, { id: true, codes: [404] }) },
      "/requests/{id}/files/{fileId}": { get: op("A 60-second link to a file in a request I may see", "Requests", link, { id: true, parameters: [fileIdParam], codes: [404] }) },
      "/calendar": { get: op("Calendar items between two dates (IST), all layers I may see", "Calendar", { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, items: { type: "array", items: ref("CalendarItem") } } }, { parameters: query(["from", { type: "string", format: "date" }, "Default today"], ["to", { type: "string", format: "date" }, "Last day shown, default from + 30, at most 93 days"], ["layers", { type: "string" }, "events,holidays,exams,homework,timetable,meetings,fees"]), codes: [422] }) },
      "/calendar/events/{id}": { get: op("One event", "Calendar", loose, { id: true, codes: [404] }) },
      "/calendar/events/{id}/rsvp": { post: op("Answer an event", "Calendar", { type: "object", properties: { status: { enum: ["going", "waiting", "maybe", "not_going"] } } }, { id: true, body: rsvpBody, codes: [404, 409, 422, 423] }) },
      "/meetings": { get: op("Parent-teacher meetings I may see", "Meetings", page("MeetingRow"), { parameters: [...listParams, ...query(["state", { type: "string" }])] }) },
      "/meetings/{id}": { get: op("A family's booking page, or a teacher's own windows", "Meetings", loose, { id: true, codes: [404] }) },
      "/meetings/{id}/book": { post: op("Book a free time", "Meetings", loose, { id: true, body: bookBody, codes: [404, 409, 422, 423] }) },
      "/meetings/{id}/change": { post: op("Move a booking to another time", "Meetings", loose, { id: true, body: changeBody, codes: [404, 409, 422, 423] }) },
      "/meetings/{id}/cancel": { post: op("Give back one booked time (not the whole meeting)", "Meetings", loose, { id: true, body: cancelBookingBody, codes: [404, 409, 422, 423] }) },
      "/notifications": { get: op("My notifications, newest first", "Notifications", ref("NotificationPage"), { parameters: [...listParams, ...query(["tab", { enum: ["action", "all"] }], ["unread", { const: "1" }], ["group", { type: "string" }])] }) },
      "/notifications/read": { post: op("Mark one or all read", "Notifications", { type: "object", properties: { updated: { type: "integer" } } }, { body: readBody, codes: [422] }) },
      "/notifications/preferences": {
        get: op("My notification settings", "Notifications", loose),
        put: op("Change my notification settings (only what is sent)", "Notifications", loose, { body: prefsBody, codes: [422] }),
      },
      "/push/devices": {
        get: op("Devices that get my push messages", "Push", { type: "object", properties: { rows: { type: "array", items: loose } } }),
        post: op("Register a Web Push subscription", "Push", ok, { body: deviceBody, codes: [422] }),
      },
      "/push/devices/{id}": { delete: op("Remove a device", "Push", ok, { id: true, codes: [404] }) },

    },
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "The `token` from POST /auth/login" } },
      schemas: {
        Error: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, fieldErrors: { type: "object", additionalProperties: { type: "string" } } } } } },
        User: { type: "object", properties: { id: { type: "string", format: "uuid" }, name: { type: "string" }, role: { enum: ["admin", "accountant", "teacher", "student", "staff"] }, email: { type: ["string", "null"] }, avatarUrl: { type: ["string", "null"] } } },
        LoginResponse: { type: "object", required: ["token", "expiresAt", "user"], properties: { token: { type: "string" }, expiresAt: { type: "string", format: "date-time" }, user: ref("User") } },
        Me: { type: "object", properties: { user: ref("User"), school: { type: "object", properties: { id: { type: "string" }, slug: { type: "string" }, name: { type: "string" } } }, features: { type: "array", items: { type: "string" } }, readOnly: { type: "boolean" }, leftUntil: { type: "string", format: "date", description: "Only for a student who has left: the last day this login works. `features` is then only fees, exams, home, notifications and settings." }, expiresAt: { type: "string", format: "date-time" } } },
        Announcement: { type: "object", properties: { id: { type: "string" }, type: { type: "string" }, number: { type: ["string", "null"] }, title: { type: "string" }, body: { type: "string" }, excerpt: { type: "string" }, pinned: { type: "boolean" }, categoryName: { type: ["string", "null"] }, publishedAt: { type: ["string", "null"], format: "date-time" } } },
        NoticeFeed: { type: "object", required: ["rows", "unread"], properties: { ...pageProps("NoticeItem"), unread: { type: "integer" } } },
        NoticeItem: { type: "object", properties: { noticeId: { type: "string" }, recipientId: { type: "string" }, title: { type: "string" }, excerpt: { type: "string" }, type: { type: "string" }, urgent: { type: "boolean" }, pinned: { type: "boolean" }, seen: { type: "boolean" }, needsAnswer: { type: "boolean" }, answered: { type: "boolean" }, dueAt: { type: ["string", "null"], format: "date-time" }, responseKind: { type: "string" }, withdrawn: { type: "boolean" }, childName: { type: ["string", "null"] }, publishedAt: { type: ["string", "null"], format: "date-time" } } },
        NoticeOne: { type: "object", properties: { id: { type: "string" }, state: { type: "string" }, answering: { enum: ["open", "locked", "closed", "none"] }, response: loose, dueAt: { type: ["string", "null"] }, content: loose, other: loose, files: { type: "array", items: loose }, recipients: { type: "array", items: loose } } },
        Inbox: { type: "object", required: ["rows", "next", "unread"], properties: { rows: { type: "array", items: ref("Conversation") }, next: { type: ["string", "null"], description: "Pass as `cursor`; null on the last page" }, unread: { type: "integer" } } },
        Conversation: { type: "object", properties: { id: { type: "string" }, subject: { type: "string" }, kind: { type: "string" }, state: { enum: ["open", "closed"] }, studentName: { type: ["string", "null"] }, lastMessageAt: { type: "string", format: "date-time" }, people: { type: "array", items: loose }, unread: { type: "integer" }, preview: { type: "string" }, pinned: { type: "boolean" }, muted: { type: "boolean" }, archived: { type: "boolean" } } },
        RequestRow: { type: "object", properties: { id: { type: "string" }, number: { type: "string" }, subject: { type: "string" }, state: { type: "string" }, categoryName: { type: "string" }, studentName: { type: ["string", "null"] }, dueAt: { type: "string", format: "date-time" }, overdue: { type: "boolean" }, createdAt: { type: "string", format: "date-time" } } },
        MeetingRow: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, state: { type: "string" }, opensAt: { type: "string", format: "date-time" }, closesAt: { type: "string", format: "date-time" }, slots: { type: "integer" }, booked: { type: "integer" }, mine: { type: "integer" } } },
        CalendarItem: { type: "object", properties: { id: { type: "string" }, layer: { type: "string" }, title: { type: "string" }, startsAt: { type: "string", format: "date-time" }, endsAt: { type: ["string", "null"], format: "date-time" }, allDay: { type: "boolean" }, href: { type: "string" }, cancelled: { type: "boolean" }, meta: { type: "string" } } },
        NotificationPage: { type: "object", properties: { ...pageProps("Notification"), unread: { type: "integer" }, needsAction: { type: "integer" } } },
        Notification: { type: "object", properties: { id: { type: "string" }, topic: { type: "string" }, title: { type: "string" }, body: { type: ["string", "null"] }, href: { type: ["string", "null"] }, count: { type: "integer" }, action: { type: "boolean" }, urgent: { type: "boolean" }, readAt: { type: ["string", "null"], format: "date-time" }, createdAt: { type: "string", format: "date-time" } } },
      },
    },
  };
}
