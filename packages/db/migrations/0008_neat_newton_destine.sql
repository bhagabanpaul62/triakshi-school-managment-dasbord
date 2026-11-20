ALTER TABLE "absence_alerts" ADD COLUMN "queued_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "absence_alerts" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
-- Alerts written before the queue were sent at the time: mark them sent so the worker never resends them.
UPDATE "absence_alerts" SET "sent_at" = "created_at", "queued_at" = "created_at";--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "rte_quota" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "absence_alerts_unsent" ON "absence_alerts" USING btree ("queued_at") WHERE "absence_alerts"."sent_at" is null;