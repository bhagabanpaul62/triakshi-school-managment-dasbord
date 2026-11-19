-- Runs once on an empty volume (local and production). Passwords here are local defaults;
-- production overrides them with infra/scripts/set-db-passwords.sh. Nothing here grants CREATEDB.
CREATE ROLE app_migrate LOGIN PASSWORD 'app_migrate';
CREATE ROLE app_school LOGIN PASSWORD 'app_school';
CREATE ROLE app_console LOGIN PASSWORD 'app_console' BYPASSRLS;

ALTER DATABASE smw OWNER TO app_migrate;
\connect smw
ALTER SCHEMA public OWNER TO app_migrate;
GRANT USAGE ON SCHEMA public TO app_school, app_console;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_school, app_console;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_school, app_console;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrate IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_school, app_console;
