#!/usr/bin/env bash
# Monthly restore drill. Run on STAGING only: it restores the latest production backup into a throwaway
# Postgres container, replays WAL, and checks that real data came back. Nothing touches production.
#   WALG_S3_PREFIX=s3://bucket/triakshi/production ./infra/scripts/restore-test.sh [backup-name|LATEST] [recovery-target-time]
set -euo pipefail
: "${WALG_S3_PREFIX:?set WALG_S3_PREFIX to the production backup prefix}"
BACKUP="${1:-LATEST}"
TARGET_TIME="${2:-}"
IMAGE="${PG_IMAGE:-ghcr.io/${GHCR_OWNER:?set GHCR_OWNER}/triakshi-postgres:${IMAGE_TAG:-latest}}"
NAME="triakshi-restore-test"
VOL="triakshi-restore-test-data"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker volume rm "$VOL" >/dev/null 2>&1 || true
docker volume create "$VOL" >/dev/null
WALG_ENV=(-e WALG_S3_PREFIX -e AWS_REGION="${AWS_REGION:-ap-south-1}" -e PGHOST=/var/run/postgresql -e PGUSER=postgres)

echo "1/4 fetching base backup: $BACKUP"
docker run --rm "${WALG_ENV[@]}" -u postgres -v "$VOL":/var/lib/postgresql/data "$IMAGE" \
  sh -c 'wal-g backup-fetch /var/lib/postgresql/data '"$BACKUP"' && touch /var/lib/postgresql/data/recovery.signal'

echo "2/4 configuring recovery"
RECOVERY="restore_command = 'wal-g wal-fetch %f %p'"
[ -n "$TARGET_TIME" ] && RECOVERY="$RECOVERY\nrecovery_target_time = '$TARGET_TIME'\nrecovery_target_action = 'promote'"
docker run --rm -u postgres -v "$VOL":/var/lib/postgresql/data "$IMAGE" \
  sh -c "printf '$RECOVERY\nlisten_addresses = ''*''\n' >> /var/lib/postgresql/data/postgresql.auto.conf"

echo "3/4 starting restored database (no archiving)"
docker run -d --name "$NAME" "${WALG_ENV[@]}" -v "$VOL":/var/lib/postgresql/data "$IMAGE" postgres -c archive_mode=off >/dev/null
for i in $(seq 1 90); do
  docker exec "$NAME" pg_isready -U postgres -q && ! docker exec "$NAME" psql -U postgres -Atc 'select pg_is_in_recovery()' | grep -q t && break
  sleep 5
done

echo "4/4 sanity checks"
Q() { docker exec "$NAME" psql -U postgres -d smw -Atc "$1"; }
SCHOOLS=$(Q 'select count(*) from schools')
USERS=$(Q 'select count(*) from users')
LATEST=$(Q 'select max(created_at) from audit_logs' || echo none)
echo "schools=$SCHOOLS users=$USERS latest_audit_log=$LATEST"
[ "$SCHOOLS" -gt 0 ] || { echo "FAIL: no schools restored"; exit 1; }
docker rm -f "$NAME" >/dev/null; docker volume rm "$VOL" >/dev/null
echo "restore drill passed at $(date -u +%FT%TZ)"
