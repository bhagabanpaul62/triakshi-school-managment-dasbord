ALTER TABLE "students" ADD COLUMN "left_reason" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "pen" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "joins_on" date;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "joins_year_id" uuid;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "joins_section_id" uuid;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_joins_year_id_academic_years_id_fk" FOREIGN KEY ("joins_year_id") REFERENCES "public"."academic_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_joins_section_id_sections_id_fk" FOREIGN KEY ("joins_section_id") REFERENCES "public"."sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "students_joins" ON "students" USING btree ("school_id","joins_on") WHERE "students"."status" = 'joining';--> statement-breakpoint
-- A student who left or graduated is no longer "studying" in the year they left. Nothing about an active student changes.
UPDATE "student_enrollments" e SET "outcome" = CASE s."status" WHEN 'alumni' THEN 'graduated' ELSE 'left' END
FROM "students" s, "academic_years" y
WHERE s."id" = e."student_id" AND y."id" = e."year_id" AND s."status" IN ('left', 'alumni') AND e."outcome" = 'studying'
  AND (s."left_on" IS NULL OR y."starts_on" <= s."left_on");
