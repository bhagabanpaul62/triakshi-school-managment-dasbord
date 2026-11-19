#!/usr/bin/env bash
# Nightly base backup + 30 day retention. Run from host cron (see infra/README.md), not inside the container.
#   30 21 * * * /opt/triakshi/repo/infra/backup/base-backup.sh >> /var/log/triakshi-backup.log 2>&1   (03:00 IST)
set -euo pipefail
cd "$(dirname "$0")/../.."
dc() { docker compose --env-file /opt/triakshi/.env -f infra/docker-compose.yml "$@"; }
echo "$(date -u +%FT%TZ) base backup start"
dc exec -T -u postgres postgres sh -c 'wal-g backup-push "$PGDATA"'
# Keep the newest 30 full backups (one per night = 30 days) and the WAL they need.
dc exec -T -u postgres postgres wal-g delete retain FULL 30 --confirm
dc exec -T -u postgres postgres wal-g backup-list
echo "$(date -u +%FT%TZ) base backup done"
