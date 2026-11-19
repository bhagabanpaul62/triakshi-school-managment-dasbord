-- Local + CI only. Never mount this in production: it creates the integration-test database and lets
-- app_migrate create one database per feature suite. Run after init-roles.sql.
CREATE DATABASE smw_test OWNER app_migrate;
ALTER ROLE app_migrate CREATEDB;

\connect smw_test
ALTER SCHEMA public OWNER TO app_migrate;
GRANT USAGE ON SCHEMA public TO app_school, app_console;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_school, app_console;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_school, app_console;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrate IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_school, app_console;
