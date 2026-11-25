/**
 * Every outside service behind an interface, with a real adapter and a fake one.
 * `services()` returns the process-wide set; tests call `useServices({...})` to swap in fakes.
 * @module @smw/integrations
 */
import { S3Storage, UploadError, uploadKey, type FileStorage } from "./storage";
import { assertFileContent } from "./files";
import { SmtpEmailSender, type EmailSender } from "./mail";
import { LogSmsSender, type SmsSender } from "./sms";
import { NodeDnsResolver, type DnsResolver } from "./dns";
import { NodeTlsProbe, type TlsProbe } from "./tls-probe";
import { WebPushSender, type PushSender } from "./push";
import { FakePaymentGateway, type PaymentGateway } from "./payments";

export * from "./storage";
export * from "./files";
export * from "./http";
export * from "./mail";
export * from "./push";
export * from "./sms";
export * from "./dns";
export * from "./tls-probe";
export * from "./pdf";
export * from "./fonts";
export * from "./qr";
export * from "./payments";

export interface Services { storage: FileStorage; email: EmailSender; sms: SmsSender; dns: DnsResolver; tls: TlsProbe; payments: PaymentGateway; push: PushSender }

const g = globalThis as unknown as { __smwServices?: Partial<Services>; __smwPaymentFactory?: () => PaymentGateway };

/** Billing registers the Cashfree gateway factory here; without it (or without keys) the fake gateway is used. */
export function registerPaymentGateway(factory: () => PaymentGateway) { g.__smwPaymentFactory = factory; }

export function services(): Services {
  const s = (g.__smwServices ??= {});
  return {
    get storage() { return (s.storage ??= new S3Storage()); },
    get email() { return (s.email ??= new SmtpEmailSender()); },
    get sms() { return (s.sms ??= new LogSmsSender()); },
    get dns() { return (s.dns ??= new NodeDnsResolver()); },
    get tls() { return (s.tls ??= new NodeTlsProbe()); },
    get push() { return (s.push ??= new WebPushSender()); },
    get payments() { return (s.payments ??= g.__smwPaymentFactory?.() ?? new FakePaymentGateway()); },
  };
}

/** Replace some services (tests, local tools). */
export function useServices(overrides: Partial<Services>) { Object.assign((g.__smwServices ??= {}), overrides); }
export * from "./cashfree";
export { parseSheet, SheetError, type SheetRows } from "./sheet";

/** The one place a support-ticket file is checked and stored (school and console): PDF or picture, the bytes decide the type, at most 10 MB each. */
export const TICKET_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
export const TICKET_FILE_MAX_BYTES = 10 * 1048576;
export async function storeTicketFile(schoolId: string, ticketId: string, file: { name: string; type: string; size: number; bytes: Uint8Array }): Promise<string> {
  if (!TICKET_FILE_TYPES.includes(file.type)) throw new UploadError("Attach a PDF or a picture");
  if (file.size > TICKET_FILE_MAX_BYTES || file.bytes.length > TICKET_FILE_MAX_BYTES) throw new UploadError(`${file.name} is larger than 10 MB`);
  assertFileContent(file, TICKET_FILE_TYPES);
  const key = uploadKey(schoolId, `private/support/${ticketId}`, file, "document");
  await services().storage.put(key, file.bytes, file.type);
  return key;
}
