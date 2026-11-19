-- Host lookup before the school is known (spec §8). Runs as the table owner, returns only id, slug, status.
CREATE OR REPLACE FUNCTION resolve_school_by_host(p_host text, p_root text)
RETURNS TABLE (id uuid, slug text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.slug, s.status FROM schools s
   WHERE p_host LIKE '%.' || p_root AND s.slug = left(p_host, length(p_host) - length(p_root) - 1)
  UNION ALL
  SELECT s.id, s.slug, s.status FROM school_domains d JOIN schools s ON s.id = d.school_id
   WHERE d.hostname = p_host AND d.status = 'verified'
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION resolve_school_by_host(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_school_by_host(text, text) TO app_school, app_console;

-- Login lookup across one school without a session yet is done inside withSchool, so no other definer functions.
