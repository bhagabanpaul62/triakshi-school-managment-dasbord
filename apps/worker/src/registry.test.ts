import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { SCHEDULES, mergeJobs, scheduledNames, withLogging } from "./registry";
import { platformJobs } from "./platform-jobs";

const log = pino({ level: "silent" });

describe("job registry", () => {
  it("merges maps and rejects duplicates", () => {
    const a = async () => {};
    expect(Object.keys(mergeJobs({ x: a }, { y: a }))).toEqual(["x", "y"]);
    expect(() => mergeJobs({ x: a }, { x: a })).toThrow(/Duplicate job name: x/);
  });

  it("registers the platform jobs", () => {
    expect(Object.keys(platformJobs(log)).sort()).toEqual(["email.send"]);
  });

  it("schedules only jobs that have a handler", () => {
    const a = async () => {};
    expect(scheduledNames({ "billing.lifecycle": a })).toEqual(["billing.lifecycle"]);
    expect(scheduledNames({ "domains.verify-pending": a, "email.send": a })).toEqual(["domains.verify-pending"]);
    expect(SCHEDULES["billing.lifecycle"]).toEqual({ cron: "30 1 * * *", tz: "Asia/Kolkata" });
    expect(SCHEDULES["domains.verify-pending"]!.cron).toBe("*/10 * * * *");
  });

  it("schedules the communication jobs: deliver every minute, digest at 08:00 and 18:00 IST, cleanup at 03:30 IST", async () => {
    expect(SCHEDULES["comms.deliver"]).toEqual({ cron: "* * * * *", tz: "UTC" });
    expect(SCHEDULES["notifications.digest"]).toEqual({ cron: "0 8,18 * * *", tz: "Asia/Kolkata" });
    expect(SCHEDULES["comms.cleanup"]).toEqual({ cron: "30 3 * * *", tz: "Asia/Kolkata" });
    expect(SCHEDULES["notifications.email-digest"]).toBeUndefined();
    const { default: jobs } = await import("@smw/feature-notifications/jobs");
    for (const n of ["comms.deliver", "notifications.digest", "comms.cleanup"]) expect(typeof (jobs as Record<string, unknown>)[n]).toBe("function");
    expect(Object.keys(jobs).sort()).toEqual(["comms.cleanup", "comms.deliver", "notifications.digest"]);
  });

  it("runs each job and rethrows failures so pg-boss retries", async () => {
    const fn = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("boom"));
    const run = withLogging("t", fn, log);
    await run([{ id: "1", data: { a: 1 } }]);
    expect(fn).toHaveBeenCalledWith({ a: 1 });
    await expect(run([{ id: "2", data: null }])).rejects.toThrow("boom");
    expect(fn).toHaveBeenLastCalledWith({});
  });

  it("platform jobs and every feature's jobs merge without a name clash", async () => {
    const { FEATURE_JOBS } = await import("./generated/jobs");
    const jobs = mergeJobs(platformJobs(log), ...(FEATURE_JOBS as Record<string, () => Promise<void>>[]));
    for (const n of scheduledNames(jobs)) expect(typeof jobs[n]).toBe("function");
    expect(Object.keys(jobs)).toEqual(expect.arrayContaining(["email.send", "billing.lifecycle"]));
  });
});
