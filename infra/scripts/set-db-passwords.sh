#!/usr/bin/env bash
# Sets the three role passwords from the environment. Mounted into /docker-entrypoint-initdb.d so it runs on first boot,
# and safe to run again by hand to rotate: docker compose exec postgres /docker-entrypoint-initdb.d/02-passwords.sh
set -euo pipefail
: "${APP_MIGRATE_PASSWORD:?set APP_MIGRATE_PASSWORD}" "${APP_SCHOOL_PASSWORD:?set APP_SCHOOL_PASSWORD}" "${APP_CONSOLE_PASSWORD:?set APP_CONSOLE_PASSWORD}"
psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d postgres \
  -v mig="$APP_MIGRATE_PASSWORD" -v sch="$APP_SCHOOL_PASSWORD" -v con="$APP_CONSOLE_PASSWORD" <<'SQL'
ALTER ROLE app_migrate PASSWORD :'mig';
ALTER ROLE app_school  PASSWORD :'sch';
ALTER ROLE app_console PASSWORD :'con';
SQL
echo "database role passwords set"
