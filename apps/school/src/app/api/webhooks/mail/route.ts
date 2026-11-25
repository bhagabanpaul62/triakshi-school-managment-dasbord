import { mailWebhook } from "@smw/feature-notifications/email-health";

export const dynamic = "force-dynamic";
/** Bounce and spam events from the mail provider. Needs MAIL_WEBHOOK_SECRET. */
export const POST = mailWebhook;
