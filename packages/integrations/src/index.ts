/**
 * Every outside service behind an interface, with a real adapter and a fake one.
 * `services()` returns the process-wide set; tests call `useServices({...})` to swap in fakes.
 * @module @smw/integrations
 */
import { S3Storage, type FileStorage } from "./storage";
import { SmtpEmailSender, type EmailSender } from "./mail";
import { LogSmsSender, type SmsSender } from "./sms";
import { NodeDnsResolver, type DnsResolver } from "./dns";
import { WebPushSender, type PushSender } from "./push";
import { FakePaymentGateway, type PaymentGateway } from "./payments";

export * from "./storage";
export * from "./files";
export * from "./mail";
export * from "./push";
export * from "./sms";
export * from "./dns";
export * from "./pdf";
export * from "./fonts";
export * from "./qr";
export * from "./payments";

export interface Services { storage: FileStorage; email: EmailSender; sms: SmsSender; dns: DnsResolver; payments: PaymentGateway; push: PushSender }

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
    get push() { return (s.push ??= new WebPushSender()); },
    get payments() { return (s.payments ??= g.__smwPaymentFactory?.() ?? new FakePaymentGateway()); },
  };
}

/** Replace some services (tests, local tools). */
export function useServices(overrides: Partial<Services>) { Object.assign((g.__smwServices ??= {}), overrides); }
export * from "./cashfree";
export { parseSheet, SheetError, type SheetRows } from "./sheet";
