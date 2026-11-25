/**
 * Environment settings for every app and package, validated once with zod. Read settings only through `env()`.
 * Secrets are never logged: `describeEnv()` prints names only.
 * @module @smw/config
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const bool = z.enum(["true", "false", "1", "0", ""]).default("false").transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ROOT_DOMAIN: z.string().min(1).default("localhost"),
  APP_PROTOCOL: z.enum(["http", "https"]).default("http"),
  SCHOOL_PORT: z.string().default("4100"),
  CONSOLE_URL: z.string().default("http://localhost:4102"),
  MARKETING_URL: z.string().default("http://localhost:4101"),

  DATABASE_URL_MIGRATE: z.string().url(),
  DATABASE_URL_SCHOOL: z.string().url(),
  DATABASE_URL_CONSOLE: z.string().url(),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("ap-south-1"),
  S3_BUCKET: z.string().default("smw-files"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,

  SMTP_HOST: z.string().default("127.0.0.1"),
  SMTP_PORT: z.coerce.number().default(1025),
  /** Implicit TLS. Unset = on for port 465 only; 587 uses STARTTLS. */
  SMTP_SECURE: z.enum(["true", "false", "1", "0", ""]).optional().transform((v) => (v ? v === "true" || v === "1" : undefined)),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default("Triakshi <no-reply@yourbrand.com>"),

  /** Web push keys (npx web-push generate-vapid-keys). Without them push is hidden and nothing else breaks. */
  VAPID_PUBLIC_KEY: z.preprocess((v) => v || undefined, z.string().optional()),
  VAPID_PRIVATE_KEY: z.preprocess((v) => v || undefined, z.string().optional()),
  VAPID_SUBJECT: z.preprocess((v) => v || undefined, z.string().optional()),
  /** Emails per IST day across all schools (Brevo free is 300). */
  MAIL_DAILY_LIMIT: z.preprocess((v) => v || undefined, z.coerce.number().int().positive().default(300)),
  /** Shared secret for the mail provider's bounce webhook. Without it the webhook refuses everything. */
  MAIL_WEBHOOK_SECRET: z.preprocess((v) => v || undefined, z.string().optional()),

  CASHFREE_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  /** "true" turns on the test checkout off localhost (a temporary demo server). Anyone can "pay" with it: never on a real launch. */
  FAKE_PAYMENTS: z.enum(["true", "false"]).default("false"),
  CASHFREE_APP_ID: z.string().optional(),
  CASHFREE_SECRET_KEY: z.string().optional(),
  /** Recurring auto-renew has not been proven against Cashfree's sandbox, so its option stays hidden until this is true. */
  CASHFREE_SUBSCRIPTIONS: bool,

  PLATFORM_GSTIN: z.string().default("29ABCDE1234F1Z5"),
  PLATFORM_STATE: z.string().default("Karnataka"),
  PLATFORM_LEGAL_NAME: z.string().default("Triakshi Technologies Pvt Ltd"),

  /** 32+ random characters. Encrypts salary, bank and identity numbers; losing it loses them. Needed before payroll is used off localhost. */
  DATA_KEY: z.preprocess((v) => v || undefined, z.string().min(32).optional()),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Load the repo-root `.env.local` (then `.env`) once, without overriding real environment variables. */
function loadRootEnvFile() {
  if (process.env.DATABASE_URL_SCHOOL) return;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    for (const name of [".env.local", ".env"]) {
      const file = join(/* turbopackIgnore: true */ dir, name);
      if (existsSync(/* turbopackIgnore: true */ file) && existsSync(/* turbopackIgnore: true */ join(dir, "pnpm-workspace.yaml"))) {
        process.loadEnvFile(file);
        return;
      }
    }
    dir = dirname(dir);
  }
}

export function env(): Env {
  if (cached) return cached;
  loadRootEnvFile();
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid or missing environment settings: ${names}. Copy .env.example to .env.local.`);
  }
  cached = parsed.data;
  return cached;
}

/** Names of the settings that are present. Values are never returned. */
export const describeEnv = () => Object.keys(env()).filter((k) => process.env[k] !== undefined);

/** Base URL of a school host, e.g. `http://a.localhost:4100`. */
export function schoolUrl(slug: string, path = "") {
  const e = env();
  // The port depends on the domain, not the build: a local domain is reached on SCHOOL_PORT even under
  // `next start` (NODE_ENV=production); a real domain sits behind the proxy on 443.
  const port = isLocal() ? `:${e.SCHOOL_PORT}` : "";
  return `${e.APP_PROTOCOL}://${slug}.${e.ROOT_DOMAIN}${port}${path}`;
}

/** NODE_ENV: how the code was built. `next start` is always "production", even on a laptop. */
export const isProd = () => env().NODE_ENV === "production";

/**
 * Running on a local domain (localhost, *.localhost, *.test): a developer's machine, whatever the build.
 * Dev-only features (fake payment page, Mailpit link) key off this, never off NODE_ENV, so a local
 * production build can be tested end to end and a real domain can never reach them.
 */
export const isLocal = () => /(^|\.)(localhost|test)$/.test(env().ROOT_DOMAIN);

/** The test checkout (no Cashfree keys): always on localhost, elsewhere only when FAKE_PAYMENTS=true. */
export const fakePayments = () => isLocal() || env().FAKE_PAYMENTS === "true";

/** Whether the auto-renew option may be shown or used. */
export const autoRenewEnabled = () => env().CASHFREE_SUBSCRIPTIONS;

/** Cookies get `secure` when the site is served over https, which is what the flag is about. */
export const secureCookies = () => env().APP_PROTOCOL === "https";
