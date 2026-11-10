# Infrastructure

Everything needed to run the platform on a VPS. Empty for now.

| File | Purpose | When |
|---|---|---|
| `docker-compose.dev.yml` | Local PostgreSQL 17 with the three database roles | Phase 0, ticket P0-08 |
| `docker-compose.yml` | Production containers: caddy, marketing, console, school, worker, postgres | Phase 2 |
| `Caddyfile` | HTTPS, wildcard certificate, on-demand certificates for custom domains | Phase 2 and Phase 5 |
| Backup and deploy scripts | wal-g backups, restore test, deploy over SSH | Phase 2 |

See spec §21 for the full design.
