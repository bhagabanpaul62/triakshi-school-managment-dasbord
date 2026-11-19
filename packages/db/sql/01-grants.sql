-- Re-applied after every migrate/push. Idempotent.
GRANT USAGE ON SCHEMA public TO app_school, app_console;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_school, app_console;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_school, app_console;
