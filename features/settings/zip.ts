import { closeSync, openSync, writeSync } from "node:fs";
import { createDeflateRaw, crc32, inflateRawSync } from "node:zlib";

/** What a plain zip (no zip64) can hold: 32-bit offsets and sizes, 16-bit entry count. We stop a little before the edge, with a clear message. */
export const ZIP_LIMIT = 4_000_000_000;
export const ZIP_MAX_ENTRIES = 65_535;

/** The export cannot be a plain zip. The words are for the person who asked. */
export class ZipTooBig extends Error {}

interface Done { name: Buffer; crc: number; csize: number; size: number; offset: number }

const dos = (d: Date) => ({
  time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
  date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
});

/**
 * A zip file built entry by entry with node:zlib only. Each entry is deflated as it is written (data descriptor, so no size is needed
 * first); the compressed bytes are kept in memory until `finish()`.
 * With `file`, bytes go to that path as they are made (memory stays flat); without it they are kept for `finish()`.
 * shortcut: no zip64. Past 65,535 entries or 4 GB (one entry's raw size too) it throws ZipTooBig; add zip64 records when a school needs more.
 */
export class ZipWriter {
  private readonly parts: Buffer[] = [];
  private fd: number | null = null;
  private readonly done: Done[] = [];
  private offset = 0;

  constructor(private readonly at = new Date(), file?: string, private readonly limit = ZIP_LIMIT) {
    if (file) this.fd = openSync(file, "w", 0o600);
  }

  private push(b: Buffer) {
    if (this.fd === null) this.parts.push(b); else writeSync(this.fd, b);
    this.offset += b.length;
    if (this.offset > this.limit) throw new ZipTooBig("The export is larger than 4 GB. Choose fewer modules, and leave out public files.");
  }

  /** Write one file. `fill` calls `write` with each chunk (a string or bytes) and may take as long as it likes between them. */
  async entry(name: string, fill: (write: (chunk: string | Buffer) => Promise<void>) => Promise<void>) {
    if (this.done.length >= ZIP_MAX_ENTRIES) throw new ZipTooBig("The export has more than 65,535 files. Choose fewer modules.");
    const nameBytes = Buffer.from(name, "utf8");
    const { time, date } = dos(this.at);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0808, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12); head.writeUInt16LE(nameBytes.length, 26);
    const start = this.offset;
    this.push(head); this.push(nameBytes);

    const deflater = createDeflateRaw();
    let csize = 0, size = 0, crc = 0;
    let failure: unknown;
    // An error thrown inside the stream's event would be uncaught: keep it and throw it from here.
    deflater.on("data", (c: Buffer) => { csize += c.length; try { this.push(c); } catch (e) { failure ??= e; } });
    const ended = new Promise<void>((res, rej) => { deflater.on("end", res); deflater.on("error", rej); });
    await fill(async (chunk) => {
      const b = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      size += b.length; crc = crc32(b, crc);
      if (size > this.limit) throw new ZipTooBig(`${name} alone is larger than 4 GB. Choose fewer modules.`);
      await new Promise<void>((res, rej) => deflater.write(b, (e) => (e ? rej(e) : res())));
      if (failure) throw failure;
    });
    deflater.end();
    await ended;
    if (failure) throw failure;

    const tail = Buffer.alloc(16);
    tail.writeUInt32LE(0x08074b50, 0); tail.writeUInt32LE(crc, 4); tail.writeUInt32LE(csize, 8); tail.writeUInt32LE(size, 12);
    this.push(tail);
    this.done.push({ name: nameBytes, crc, csize, size, offset: start });
  }

  /** A small file in one go. */
  add(name: string, body: string | Buffer) { return this.entry(name, (w) => w(body)); }

  /** Close a file-mode zip; returns its size. */
  close(): number {
    this.writeDirectory();
    closeSync(this.fd!);
    this.fd = null;
    return this.offset;
  }

  /** Abandon a file-mode zip (the caller deletes the file). */
  abort() { if (this.fd !== null) { closeSync(this.fd); this.fd = null; } }

  finish(): Buffer {
    this.writeDirectory();
    return Buffer.concat(this.parts);
  }

  private writeDirectory() {
    const { time, date } = dos(this.at);
    const dirStart = this.offset;
    for (const e of this.done) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0808, 8); h.writeUInt16LE(8, 10);
      h.writeUInt16LE(time, 12); h.writeUInt16LE(date, 14); h.writeUInt32LE(e.crc, 16); h.writeUInt32LE(e.csize, 20); h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28); h.writeUInt32LE(e.offset, 42);
      this.push(h); this.push(e.name);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(this.done.length, 8); end.writeUInt16LE(this.done.length, 10);
    end.writeUInt32LE(this.offset - dirStart, 12); end.writeUInt32LE(dirStart, 16);
    this.push(end);
  }
}

/** Reads a zip made by `ZipWriter` (or any plain zip): file name to bytes. For tests and for checking a file before it is stored. */
export function readZip(zip: Uint8Array): Map<string, Buffer> {
  const buf = Buffer.from(zip);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Broken zip directory");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const data = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(data, data + csize);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
