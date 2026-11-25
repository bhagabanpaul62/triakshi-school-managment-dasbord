import { createReadStream, readFileSync, statSync } from "node:fs";
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, CreateBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@smw/config";

export interface StoredFile { key: string; size: number; contentType: string }

/** Private file storage. Keys always start with the school id: `<schoolId>/<area>/<uuid>-<name>`. */
export interface FileStorage {
  put(key: string, body: Uint8Array | Buffer, contentType: string): Promise<StoredFile>;
  /** Store a file from disk without holding it in memory (S3: streamed with its length). */
  putFile(key: string, path: string, contentType: string): Promise<StoredFile>;
  /** Short-lived URL to read a private file. */
  signedUrl(key: string, seconds?: number): Promise<string>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  /** Files whose key starts with `prefix`, up to 1000. */
  list(prefix: string): Promise<{ key: string; size: number; modified: Date }[]>;
}

export const UPLOAD_RULES = {
  image: { types: ["image/png", "image/jpeg", "image/webp"], maxBytes: 5 * 1024 * 1024 },
  document: { types: ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], maxBytes: 15 * 1024 * 1024 },
} as const;

export class UploadError extends Error {}

/** Check type and size before storing; returns a safe key under the school. */
export function uploadKey(schoolId: string, area: string, file: { name: string; type: string; size: number }, kind: keyof typeof UPLOAD_RULES) {
  const rule = UPLOAD_RULES[kind];
  if (!(rule.types as readonly string[]).includes(file.type)) throw new UploadError("This file type is not allowed.");
  if (file.size > rule.maxBytes) throw new UploadError(`File is larger than ${Math.round(rule.maxBytes / 1048576)} MB.`);
  const safe = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").slice(-60);
  return `${schoolId}/${area}/${crypto.randomUUID()}-${safe}`;
}

export class S3Storage implements FileStorage {
  private client: S3Client;
  private bucket: string;
  private ready?: Promise<void>;

  constructor() {
    const e = env();
    this.bucket = e.S3_BUCKET;
    this.client = new S3Client({
      region: e.S3_REGION, endpoint: e.S3_ENDPOINT || undefined, forcePathStyle: e.S3_FORCE_PATH_STYLE,
      credentials: e.S3_ACCESS_KEY_ID ? { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY ?? "" } : undefined,
    });
  }

  /** Local stand-in only: create the bucket on first use. In AWS the bucket is created by the runbook. */
  private ensureBucket() {
    if (!env().S3_ENDPOINT) return Promise.resolve();
    this.ready ??= this.client.send(new HeadBucketCommand({ Bucket: this.bucket })).then(() => undefined)
      .catch(() => this.client.send(new CreateBucketCommand({ Bucket: this.bucket })).then(() => undefined));
    return this.ready;
  }

  async put(key: string, body: Uint8Array | Buffer, contentType: string) {
    await this.ensureBucket();
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
    return { key, size: body.byteLength, contentType };
  }
  async putFile(key: string, path: string, contentType: string) {
    await this.ensureBucket();
    const size = statSync(path).size;
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: createReadStream(path), ContentLength: size, ContentType: contentType }));
    return { key, size, contentType };
  }
  async signedUrl(key: string, seconds = 300) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: seconds });
  }
  async get(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return r.Body!.transformToByteArray();
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async list(prefix: string) {
    await this.ensureBucket();
    const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, MaxKeys: 1000 }));
    return (r.Contents ?? []).map((o) => ({ key: o.Key!, size: o.Size ?? 0, modified: o.LastModified ?? new Date(0) }));
  }
}

export class MemoryStorage implements FileStorage {
  readonly files = new Map<string, { body: Uint8Array; contentType: string }>();
  async put(key: string, body: Uint8Array | Buffer, contentType: string) {
    this.files.set(key, { body: new Uint8Array(body), contentType });
    return { key, size: body.byteLength, contentType };
  }
  async putFile(key: string, path: string, contentType: string) { return this.put(key, readFileSync(path), contentType); }
  async signedUrl(key: string) { return `memory://${key}`; }
  async get(key: string) { const f = this.files.get(key); if (!f) throw new Error("not found"); return f.body; }
  async delete(key: string) { this.files.delete(key); }
  async list(prefix: string) {
    return [...this.files.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, f]) => ({ key, size: f.body.byteLength, modified: new Date() }));
  }
}
