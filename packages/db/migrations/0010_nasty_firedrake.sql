ALTER TABLE "fee_allocations" ADD COLUMN "advance_id" uuid;--> statement-breakpoint
ALTER TABLE "fee_counters" ADD COLUMN "first_expected_paise" bigint;--> statement-breakpoint
ALTER TABLE "fee_counters" ADD COLUMN "first_counted_paise" bigint;--> statement-breakpoint
ALTER TABLE "fee_counters" ADD COLUMN "first_reason" text;--> statement-breakpoint
ALTER TABLE "fee_receipts" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "pay_declarations" ADD COLUMN "accepted_by" uuid;--> statement-breakpoint
ALTER TABLE "pay_declarations" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pay_declarations" ADD COLUMN "returned_note" text;--> statement-breakpoint
ALTER TABLE "pay_profiles" ADD COLUMN "bank_changed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_receipts_request" ON "fee_receipts" USING btree ("school_id","request_id");--> statement-breakpoint
-- Everyone on the staff may read their own payslips, whatever their custom role.
UPDATE "school_roles" SET "grants" = array_append("grants", 'payroll:self') WHERE NOT ('payroll:self' = ANY("grants"));--> statement-breakpoint
-- Schools that already have the ready-made roles get the new money roles once; a name already in use is left alone.
INSERT INTO "school_roles" ("id", "school_id", "name", "description", "base", "is_template", "grants")
SELECT gen_random_uuid(), s."school_id", r.name, r.description, 'staff', true, r.grants
FROM (SELECT DISTINCT "school_id" FROM "school_roles" WHERE "is_template") s
CROSS JOIN (VALUES
  ('Fee accountant', 'Sets up fees, collects and proposes concessions.', '{home:view,notifications:read,messages:use,settings:read,payroll:self,fees:read,fees:collect,fees:setup,fees:concede,finance:read,students:read,attendance:leave,expenses:claim}'::text[]),
  ('Cashier', 'Takes money at the counter and prints receipts. Cannot change bills.', '{home:view,notifications:read,messages:use,settings:read,payroll:self,fees:read,fees:collect,students:read,attendance:leave,expenses:claim}'::text[]),
  ('Bursar', 'Approves money requests and closes months.', '{home:view,notifications:read,messages:use,settings:read,payroll:self,finance:read,finance:approve,finance:close,fees:read,expenses:read,payroll:read,attendance:leave,expenses:claim}'::text[]),
  ('Auditor', 'Reads every book and report. Changes nothing.', '{home:view,notifications:read,messages:use,settings:read,payroll:self,finance:read,fees:read,expenses:read,payroll:read,attendance:leave,expenses:claim}'::text[])
) AS r(name, description, grants)
ON CONFLICT DO NOTHING;
