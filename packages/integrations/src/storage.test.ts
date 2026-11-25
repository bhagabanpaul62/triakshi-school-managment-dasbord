import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./storage";

describe("MemoryStorage.putFile", () => {
  it("stores a file from disk under the key, with its size and type", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "st-")), "a.zip");
    writeFileSync(path, Buffer.from([80, 75, 3, 4, 9]));
    const s = new MemoryStorage();
    expect(await s.putFile("school/exports/a.zip", path, "application/zip")).toEqual({ key: "school/exports/a.zip", size: 5, contentType: "application/zip" });
    expect([...(await s.get("school/exports/a.zip"))]).toEqual([80, 75, 3, 4, 9]);
  });
});
