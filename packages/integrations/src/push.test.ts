import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
let keys: Record<string, string | undefined> = {};
vi.mock("web-push", () => ({ default: { sendNotification: (...a: unknown[]) => send(...a) } }));
vi.mock("@smw/config", () => ({ env: () => ({ MAIL_FROM: "Triakshi <no-reply@x.in>", ...keys }) }));

const { MemoryPushSender, WebPushSender, pushConfigured } = await import("./push");
const sub = { endpoint: "https://push.example/1", p256dh: "p", auth: "a" };
const opts = { ttl: 60, urgency: "normal" } as const;

beforeEach(() => { send.mockReset(); keys = {}; });

describe("push", () => {
  it("is configured only with both keys", () => {
    expect(pushConfigured()).toBe(false);
    keys = { VAPID_PUBLIC_KEY: "pub" };
    expect(pushConfigured()).toBe(false);
    keys = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" };
    expect(pushConfigured()).toBe(true);
  });

  it("refuses to send without keys", async () => {
    await expect(new WebPushSender().send(sub, { title: "t", body: "b" }, opts)).rejects.toThrow("not configured");
  });

  it("sends with the school-less VAPID details and maps 404/410 to gone, other errors throw", async () => {
    keys = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" };
    send.mockResolvedValueOnce({});
    expect(await new WebPushSender().send(sub, { title: "t", body: "b" }, opts)).toBe("ok");
    expect(send.mock.calls[0]![2].vapidDetails.subject).toBe("mailto:no-reply@x.in");
    send.mockRejectedValueOnce({ statusCode: 410 });
    expect(await new WebPushSender().send(sub, { title: "t", body: "b" }, opts)).toBe("gone");
    send.mockRejectedValueOnce({ statusCode: 404 });
    expect(await new WebPushSender().send(sub, { title: "t", body: "b" }, opts)).toBe("gone");
    send.mockRejectedValueOnce({ statusCode: 500 });
    await expect(new WebPushSender().send(sub, { title: "t", body: "b" }, opts)).rejects.toMatchObject({ statusCode: 500 });
  });

  it("the memory sender records, and can answer gone or fail", async () => {
    const m = new MemoryPushSender();
    expect(await m.send(sub, { title: "t", body: "b" }, opts)).toBe("ok");
    expect(m.sent).toHaveLength(1);
    m.gone.add(sub.endpoint);
    expect(await m.send(sub, { title: "t", body: "b" }, opts)).toBe("gone");
    m.failing.add("x");
    await expect(m.send({ ...sub, endpoint: "x" }, { title: "t", body: "b" }, opts)).rejects.toThrow();
  });
});
