CREATE TABLE "school_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"base" text DEFAULT 'staff' NOT NULL,
	"grants" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"description" text
);
--> statement-breakpoint
ALTER TABLE "school_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "school_roles_school_idx" ON "school_roles" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "school_roles_name" ON "school_roles" USING btree ("school_id",lower("name"));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_school_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."school_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "school_roles_school_isolation" ON "school_roles" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
-- Parent logins were retired (docs/AUTH-PRD.md D1): guardians stay as contacts, the student login is the family login.
UPDATE "users" SET "status" = 'disabled' WHERE "role" = 'parent';--> statement-breakpoint
DELETE FROM "sessions" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "role" = 'parent');
