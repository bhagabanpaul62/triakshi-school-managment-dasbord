import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../apps/school/public/sw.js", import.meta.url), "utf8");
type Handler = (e: Record<string, unknown>) => void;

function boot(windows: { url: string; focus: () => Promise<void>; navigate?: (u: string) => Promise<void> }[] = []) {
  const handlers: Record<string, Handler> = {};
  const shown: { title: string; opts: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const self = {
    location: { origin: "https://school.test" },
    addEventListener: (n: string, h: Handler) => { handlers[n] = h; },
    skipWaiting: () => {}, clients: { claim: () => {}, matchAll: async () => windows, openWindow: async (u: string) => { opened.push(u); } },
    registration: { showNotification: async (title: string, opts: Record<string, unknown>) => { shown.push({ title, opts }); } },
  };
  runInNewContext(source, { self, URL, console });
  const wait = async (fn: (e: Record<string, unknown>) => void, e: Record<string, unknown>) => {
    let p: Promise<unknown> = Promise.resolve();
    fn({ ...e, waitUntil: (x: Promise<unknown>) => { p = x; } });
    await p;
  };
  const push = (data: unknown) => wait(handlers.push!, { data: { json: () => data } });
  const click = (href: unknown) => wait(handlers.notificationclick!, { notification: { close() {}, data: { href } } });
  return { shown, opened, push, click };
}

describe("service worker", () => {
  it("shows the title, text and tag it is sent, and keeps only an in-app link", async () => {
    const sw = boot();
    await sw.push({ title: "New message", body: "Open the app to read", tag: "thread:1", href: "/app/messages/1" });
    expect(sw.shown[0]).toMatchObject({ title: "New message", opts: { body: "Open the app to read", tag: "thread:1", renotify: true, data: { href: "https://school.test/app/messages/1" } } });
    await sw.push({ href: "https://evil.example/app" });
    expect(sw.shown[1]).toMatchObject({ title: "New notification", opts: { data: { href: "https://school.test/app/notifications" } } });
  });

  it("opens only a path inside /app on its own origin", async () => {
    const sw = boot();
    for (const bad of ["//evil.example/app", "https://evil.example/app", "/\\evil.example", "/application", "javascript:alert(1)", "/", undefined]) await sw.click(bad);
    expect(new Set(sw.opened)).toEqual(new Set(["https://school.test/app/notifications"]));
    await sw.click("/app/fees?x=1");
    expect(sw.opened.at(-1)).toBe("https://school.test/app/fees?x=1");
  });

  it("focuses an open window of the app instead of opening another", async () => {
    const calls: string[] = [];
    const sw = boot([{ url: "https://school.test/app", focus: async () => { calls.push("focus"); }, navigate: async (u) => { calls.push(u); } }]);
    await sw.click("/app/messages");
    expect(calls).toEqual(["focus", "https://school.test/app/messages"]);
    expect(sw.opened).toEqual([]);
  });
});
