import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ZipTooBig, ZipWriter, readZip } from "./zip";

const hasUnzip = spawnSync("unzip", ["-v"]).status === 0;

describe("ZipWriter", () => {
  it("round-trips entries, including a big one written in chunks", async () => {
    const z = new ZipWriter();
    await z.add("README.txt", "hello, नमस्ते");
    const line = "1,Riya Sharma,\"a, b\"\r\n";
    await z.entry("data/students.csv", async (w) => { for (let i = 0; i < 20_000; i++) await w(line); });
    await z.add("empty.txt", "");
    const files = readZip(z.finish());
    expect([...files.keys()]).toEqual(["README.txt", "data/students.csv", "empty.txt"]);
    expect(files.get("README.txt")!.toString()).toBe("hello, नमस्ते");
    expect(files.get("data/students.csv")!.length).toBe(line.length * 20_000);
    expect(files.get("empty.txt")!.length).toBe(0);
  });

  it.skipIf(!hasUnzip)("is a zip the system unzip accepts (crc and sizes are right)", async () => {
    const z = new ZipWriter();
    await z.add("a.txt", "alpha");
    await z.entry("dir/b.csv", async (w) => { await w("x,y\r\n"); await w(Buffer.from("1,2\r\n")); });
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    const file = join(dir, "t.zip");
    writeFileSync(file, z.finish());
    expect(execFileSync("unzip", ["-t", file]).toString()).toContain("No errors detected");
    expect(execFileSync("unzip", ["-p", file, "dir/b.csv"]).toString()).toBe("x,y\r\n1,2\r\n");
    expect(readFileSync(file).length).toBeGreaterThan(0);
  });

  it("writes to a file as it goes, and the file reads back the same", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "zipf-")), "f.zip");
    const z = new ZipWriter(new Date(), file);
    await z.add("a.txt", "alpha");
    await z.entry("b.csv", async (w) => { for (let i = 0; i < 1000; i++) await w("1,2,3\r\n"); });
    const size = z.close();
    expect(size).toBe(readFileSync(file).length);
    const files = readZip(readFileSync(file));
    expect(files.get("a.txt")!.toString()).toBe("alpha");
    expect(files.get("b.csv")!.length).toBe(7000);
  });

  it("refuses clearly past 65,535 files, and past its size limit, instead of writing a broken zip", async () => {
    const z = new ZipWriter();
    for (let i = 0; i < 65_535; i++) await z.add(`f${i}`, "");
    await expect(z.add("one-more", "")).rejects.toThrow(ZipTooBig);
    const small = new ZipWriter(new Date(), undefined, 1000);
    await expect(small.entry("big.txt", async (w) => { await w(Buffer.alloc(2000, 1)); })).rejects.toThrow(/larger than 4 GB/);
  });

  it("refuses something that is not a zip", () => {
    expect(() => readZip(Buffer.from("nope"))).toThrow(/Not a zip/);
  });
});
