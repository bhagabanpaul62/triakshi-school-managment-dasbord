-- The one SQL form of "is this day closed for students of this class" (the TypeScript twin is closedDays in holidays.ts).
-- Invoker rights on purpose: attendance_holidays is read under the caller's row-level security, so only their school's rows count.
-- plpgsql, so the file also loads when a build leaves the attendance tables out.
CREATE OR REPLACE FUNCTION school_day_closed(p_date date, p_class uuid) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF extract(dow FROM p_date) = 0 THEN
    RETURN NOT EXISTS (SELECT 1 FROM attendance_holidays h WHERE h.date = p_date AND h.kind = 'working'
      AND (h.applies_to <> 'classes' OR (p_class IS NOT NULL AND p_class = ANY(h.class_ids))));
  END IF;
  RETURN EXISTS (SELECT 1 FROM attendance_holidays h WHERE h.date = p_date AND h.kind <> 'working'
    AND (h.applies_to <> 'classes' OR (p_class IS NOT NULL AND p_class = ANY(h.class_ids))));
END $$;
GRANT EXECUTE ON FUNCTION school_day_closed(date, uuid) TO app_school;
