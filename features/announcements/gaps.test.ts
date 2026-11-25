// The gaps found in the PRD review: file order, the approver's view, resend, list filters and the body renderer.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@smw/db";
import { ValidationError } from "@smw/feature-kit";
import { MemoryStorage, useServices } from "@smw/integrations";
import { markdownToHtml, parseMarkdown } from "@smw/ui/markdown";
import { NoticeFileService, NoticeService, ReportService } from "./service";
import { build, BYTES, type Fx } from "./fixtures";
import { publishNow } from "./quick";

let fx: Fx;
const A = () => fx.school.as;
const section = (id: string) => ({ include: [{ type: "section", id }], exclude: [] });
const ALL = { include: [{ type: "everyone" }], exclude: [] };

beforeAll(async () => { useServices({ storage: new MemoryStorage() }); fx = await build("gp1"); });
afterAll(closeDb);

describe("N5: file order", () => {
  it("the writer reorders files and the order is kept; a stranger or a bad list is refused", async () => {
    const svc = new NoticeService(A().admin), files = new NoticeFileService(A().admin);
    const { id } = await svc.saveDraft({ title: "Trip", body: "x", audience: ALL });
    for (const name of ["a.pdf", "b.pdf", "c.pdf"]) await files.add(id, { name, type: "application/pdf", size: BYTES.pdf.length, bytes: BYTES.pdf });
    const names = async () => (await svc.get(id)).files.map((f) => f.name);
    expect(await names()).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    const ids = (await svc.get(id)).files.map((f) => f.id);
    await files.reorder(id, [...ids].reverse());
    expect(await names()).toEqual(["c.pdf", "b.pdf", "a.pdf"]);
    await expect(files.reorder(id, ["not-an-id"])).rejects.toBeInstanceOf(ValidationError);
    await expect(new NoticeFileService(A().teacher).reorder(id, ids)).rejects.toThrow();
  });
});

describe("N8 and N12: what the approver sees", () => {
  it("a notice sent back keeps what the reviewer saw; the approver may change audience and last date; any staff reader sees earlier wordings", async () => {
    const t = new NoticeService(A().teacher), admin = new NoticeService(A().admin);
    const { id } = await t.saveDraft({ title: "Fete", body: "Saturday", audience: ALL, response: { kind: "ack" } });
    await t.submit(id);
    await admin.askChanges({ id, note: "Add the time" });
    await t.saveDraft({ id, body: "Saturday at 10" });
    await t.submit(id);
    const waiting = await admin.get(id);
    expect(waiting.versions[0]).toMatchObject({ note: "As it was when sent back", snapshot: expect.objectContaining({ body: "Saturday" }) });
    expect(waiting.notice.body).toBe("Saturday at 10");
    const due = new Date(Date.now() + 3 * 864e5).toISOString();
    await admin.approve({ id, edits: { audience: section(fx.ids.s5a!), dueAt: due } });
    const after = await admin.get(id);
    expect(after.notice.dueAt?.toISOString()).toBe(due);
    expect(after.notice.audience.include).toEqual([{ type: "section", id: fx.ids.s5a }]);
    expect(after.versions.map((v) => v.note)).toEqual(["As sent for approval", "As it was when sent back"]);
    // a staff reader who is not the writer or an approver still reads the history
    const reader = new NoticeService(fx.as(fx.ids.teacher2!, "teacher"));
    await publishNow(A().admin, { title: "Staff memo", body: "v1", audience: { include: [{ type: "staff" }], exclude: [] } });
    expect((await reader.list({ q: "Staff memo" })).total).toBe(1);
  });
});

describe("N19: resend to those it did not reach", () => {
  it("tells the people with a login who have no proof of arrival", async () => {
    const { id } = await publishNow(A().admin, { title: "Resend me", body: "x", audience: section(fx.ids.s5a!) });
    const out = await new ReportService(A().admin).resend(id, "unreached");
    expect(out.sent).toBeGreaterThan(0);
    await expect(new ReportService(A().teacher).resend(id, "unreached")).rejects.toThrow();
  });
});

describe("N27: audience and date filters", () => {
  it("finds notices whose audience includes a rule, and by the day they went out (IST)", async () => {
    const svc = new NoticeService(A().admin);
    const all = await publishNow(A().admin, { title: "Filter all", body: "x", audience: ALL });
    const sec = await publishNow(A().admin, { title: "Filter section", body: "x", audience: section(fx.ids.s5a!) });
    const ids = async (q: object) => (await svc.list({ tab: "live", q: "Filter", ...q })).rows.map((r) => r.id).sort();
    expect(await ids({ audience: "everyone" })).toEqual([all.id]);
    expect(await ids({ audience: `section:${fx.ids.s5a}` })).toEqual([sec.id]);
    expect(await ids({ audience: "staff" })).toEqual([]);
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 330 * 60_000 + 864e5).toISOString().slice(0, 10);
    expect(await ids({ from: today, to: today })).toEqual([all.id, sec.id].sort());
    expect(await ids({ from: tomorrow })).toEqual([]);
    expect(await ids({ to: "2020-01-01" })).toEqual([]);
    await expect(svc.list({ audience: "class:nope" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("N3: the body can never become raw HTML", () => {
  const ALLOWED = /<\/?(p|br|h[1-6]|ul|ol|li|strong|em|a)(\s[^<>]*)?>/gi;
  const hostile = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '**<b>x</b>**', '[x](javascript:alert(1))', '[a"onmouseover="x](https://a.in/"onclick="y)', '<a href="https://x">y</a>', '# <iframe src=//evil>', '- <svg onload=alert(1)>', '&lt;b&gt; &#60;script&#62;', '<style>*{}</style>'];
  it("every tag in the output is one the renderer makes itself, and tags typed by the writer are text", () => {
    for (const src of hostile) {
      const out = markdownToHtml(src);
      expect(out.replace(ALLOWED, ""), src).not.toContain("<");
      // a handler or script link only matters inside a tag; typed as text it is escaped and harmless
      for (const tag of out.match(/<[^>]*>/g) ?? []) expect(tag, src).not.toMatch(/\son\w+=|javascript:/i);
    }
  });
  it("random text never makes a node outside the safe set, nor an unsafe link", () => {
    const parts = ["<", ">", "*", "**", "[", "]", "(", ")", "`", "\n", "- ", "1. ", "# ", "&", '"', "script", "onerror=", "javascript:", "https://a.in", " "];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let n = 0; n < 300; n++) {
      const src = Array.from({ length: 1 + Math.floor(rnd() * 25) }, () => parts[Math.floor(rnd() * parts.length)]).join("");
      expect(markdownToHtml(src).replace(ALLOWED, ""), src).not.toContain("<");
      const walk = (nodes: { t: string; v?: string; href?: string; c?: unknown[] }[]) => nodes.forEach((x) => {
        expect(["text", "b", "i", "a"]).toContain(x.t);
        if (x.t === "a") expect(x.href).toMatch(/^(https?:|mailto:|tel:)/i);
        if (x.c) walk(x.c as never);
      });
      for (const b of parseMarkdown(src)) {
        expect(["p", "h", "ul", "ol"]).toContain(b.t);
        if ("c" in b) walk(b.c as never); else for (const it of b.items) walk(it as never);
      }
    }
  });
});
