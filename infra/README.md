# Infrastructure and EC2 runbook

Production runs on one EC2 VM with Docker Compose. Spec section 21 has the design. This file is the checklist an operator follows.

| File | Purpose |
|---|---|
| `docker-compose.dev.yml` | Local Postgres 17, RustFS (S3), Mailpit. `pnpm db:up` |
| `docker-compose.yml` | Production: caddy, marketing, console, school, worker, postgres (+ one-off `migrate`) |
| `Caddyfile`, `caddy/Dockerfile` | HTTPS edge, wildcard certificate (Cloudflare DNS-01), on-demand certificates for school domains |
| `../Dockerfile` | One Dockerfile for every app (`--build-arg APP=school --target app`) and the worker (`--target worker`) |
| `postgres/` | `init-roles.sql` (roles, safe for production), `local-test.sql` (local and CI only: test DB and CREATEDB), `postgresql.conf`, wal-g `Dockerfile` |
| `backup/` | `backup.conf` (WAL archiving), `base-backup.sh` (nightly), `walg.env.example` |
| `scripts/` | `set-db-passwords.sh`, `create-owner.ts`, `restore-test.sh` |
| `../.github/workflows/` | `ci.yml` (every push), `deploy.yml` (main, needs approval) |

Names below such as `yourbrand.com` are placeholders. Nothing here invents AWS resource IDs: you create them and paste yours in.

## 1. Launch the VM

1. EC2, region **ap-south-1 (Mumbai)**. Instance **t4g.large** (2 vCPU, 8 GB, ARM), AMI **Ubuntu Server 24.04 LTS (arm64)**, 40 GB gp3 root plus a 100 GB gp3 data volume if you want data off the root disk.
2. In Advanced details set **Metadata response hop limit = 2** and IMDSv2 required. Containers read the instance role through the metadata service and need the extra hop. Without it wal-g and S3 fail with credential errors.
3. Allocate an **Elastic IP** and associate it. DNS and the SES/Cashfree allowlists depend on it staying put.
4. Security group: inbound **22 from your IP only**, **80 and 443 from anywhere** (443 UDP too, for HTTP/3). Nothing else. Postgres is never published.
5. Key pair: create an ed25519 key. Keep the private key for GitHub (`EC2_SSH_KEY`).

## 2. AWS resources

- **S3 files bucket** (private): Block all public access ON, Versioning ON, default encryption on. The app uses presigned URLs.
- **S3 backups bucket** (private, same settings, same region). Add a lifecycle rule that expires noncurrent versions after 35 days. Data and backups must stay in India.
- **IAM role for the instance** (EC2 trust), attached as the instance profile. Policy: `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `arn:aws:s3:::<files-bucket>/*`; the same on `<backup-bucket>/*`; `s3:ListBucket` and `s3:GetBucketLocation` on both bucket ARNs. Add the CloudWatch agent managed policy if you use it.
- **SES (ap-south-1)**: verify the domain (Easy DKIM, 3 CNAMEs in Cloudflare), set a custom MAIL FROM, then request **production access** (out of sandbox). Create SMTP credentials (SES console, SMTP settings). Those are `SMTP_USER` and `SMTP_PASS`, not IAM keys.

## 3. Cloudflare DNS

Zone `yourbrand.com`. All records **DNS only (grey cloud)** so Caddy sees real client IPs and issues certificates itself.

| Type | Name | Value |
|---|---|---|
| A | `@` | Elastic IP |
| A | `*` | Elastic IP |
| A | `sites` | Elastic IP (CNAME target for school custom domains) |
| A | `console` | Elastic IP |
| A | `www` | Elastic IP |

Create an API token: Cloudflare, My Profile, API Tokens, Create, template **Edit zone DNS**, scoped to this one zone. That is `CF_API_TOKEN` (Caddy uses it to answer the wildcard DNS-01 challenge).

## 4. Prepare the host

```bash
ssh ubuntu@<elastic-ip>
sudo apt-get update && sudo apt-get -y upgrade
# Docker + compose plugin (official repo)
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=arm64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker ubuntu     # log out and back in
sudo mkdir -p /opt/triakshi/repo && sudo chown -R ubuntu:ubuntu /opt/triakshi
docker compose version
```

### Hardening

```bash
# Firewall. Note: Docker publishes ports by editing iptables and bypasses ufw, so the security group is the real gate. Keep both.
sudo ufw default deny incoming && sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443 && sudo ufw enable
# SSH keys only
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/;s/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart ssh      # keep your current session open and test a second login first
sudo apt-get install -y fail2ban unattended-upgrades
sudo systemctl enable --now fail2ban
sudo dpkg-reconfigure -plow unattended-upgrades
```

## 5. `/opt/triakshi/.env`

`sudo -u ubuntu install -m 600 /dev/null /opt/triakshi/.env`, then fill it in. Use hex for passwords so they are safe inside URLs: `openssl rand -hex 24`. Compose reads this file for variable substitution and passes it to every app container. The deploy workflow adds `IMAGE_PREFIX` and `IMAGE_TAG` for you.

```ini
# --- Domain ---
NODE_ENV=production
ROOT_DOMAIN=yourbrand.com              # schools live at <slug>.yourbrand.com, marketing at the apex
APP_PROTOCOL=https
CONSOLE_URL=https://console.yourbrand.com
MARKETING_URL=https://yourbrand.com
ACME_EMAIL=ops@yourbrand.com           # Let's Encrypt account
CF_API_TOKEN=...                       # Cloudflare token from step 3
# CONSOLE_ALLOW_CIDRS=203.0.113.7/32   # optional: only these IPs reach the console (webhooks always pass). Space separated.

# --- Postgres (passwords are applied on first boot by set-db-passwords.sh) ---
POSTGRES_PASSWORD=<hex>
APP_MIGRATE_PASSWORD=<hex>
APP_SCHOOL_PASSWORD=<hex>
APP_CONSOLE_PASSWORD=<hex>
DATABASE_URL_MIGRATE=postgres://app_migrate:<APP_MIGRATE_PASSWORD>@postgres:5432/smw
DATABASE_URL_SCHOOL=postgres://app_school:<APP_SCHOOL_PASSWORD>@postgres:5432/smw
DATABASE_URL_CONSOLE=postgres://app_console:<APP_CONSOLE_PASSWORD>@postgres:5432/smw

# --- Files: AWS S3. No S3_ENDPOINT, no keys: the instance role signs requests ---
S3_REGION=ap-south-1
S3_BUCKET=<files-bucket>
S3_FORCE_PATH_STYLE=false
# S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_ENDPOINT: leave unset in production

# --- Email: Amazon SES SMTP ---
SMTP_HOST=email-smtp.ap-south-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=<ses smtp user>
SMTP_PASS=<ses smtp password>
MAIL_FROM="Triakshi <no-reply@yourbrand.com>"

# --- Payments ---
CASHFREE_ENV=production
CASHFREE_APP_ID=<live app id>
CASHFREE_SECRET_KEY=<live secret>

# --- Our GST details on invoices ---
PLATFORM_GSTIN=<real GSTIN>
PLATFORM_STATE=<state>
PLATFORM_LEGAL_NAME="<registered company name>"

# --- Backups (credentials come from the instance role) ---
WALG_S3_PREFIX=s3://<backup-bucket>/triakshi/production
AWS_REGION=ap-south-1

# --- Monitoring (optional) ---
LOG_LEVEL=info
SENTRY_DSN=                            # placeholder: set when you add Sentry or GlitchTip
```

Other variables used by the code that you set locally in `.env.example` (`SCHOOL_PORT`) are not needed in production: containers listen on 3000 inside the network.

## 6. GitHub

Repository settings:

- **Secrets**: `EC2_HOST` (the Elastic IP), `EC2_SSH_KEY` (private key contents). Optional variable `EC2_USER` if not `ubuntu`.
- **Environments**: create `production` and add **required reviewers**. That is the manual approval gate.
- The workflow pushes images to GHCR as `ghcr.io/<owner>/triakshi-{marketing,console,school,worker,postgres,caddy}`. The deploy job logs the host into GHCR with a short-lived token each run, so the packages can stay private.
- Images are built for arm64 on `ubuntu-24.04-arm`. Private repositories need a larger arm runner there, or switch the job to `ubuntu-24.04` with QEMU (slow).

## 7. First deploy

The first run needs the infra files on the host. Either merge to `main` and approve the deploy, or do it by hand:

```bash
# from your laptop, in the repo
tar czf - infra | ssh ubuntu@<ip> 'tar xzf - -C /opt/triakshi/repo'
# on the host: IMAGE_PREFIX and IMAGE_TAG must be in .env (the workflow writes them); then
cd /opt/triakshi/repo
alias dc='docker compose --env-file /opt/triakshi/.env -f infra/docker-compose.yml'
dc pull && dc up -d postgres        # first boot creates the roles and applies passwords
dc run --rm migrate                  # applies migrations + post SQL
dc run --rm worker pnpm --filter @smw/school bootstrap   # module catalogue from code + default plans (only if none); safe every deploy
dc up -d
dc ps                                # everything healthy
```

**Migrations**: the `migrate` job runs `pnpm --filter @smw/db migrate`, which needs a committed `packages/db/migrations` folder (`pnpm --filter @smw/db generate`, then commit). Every deploy runs it before restarting the apps.

Check `https://yourbrand.com`, `https://console.yourbrand.com`, `https://anything.yourbrand.com`. The first request may take a few seconds while Caddy gets the wildcard certificate; watch with `dc logs -f caddy`.

### The first console owner

```bash
dc run --rm worker pnpm exec tsx infra/scripts/create-owner.ts you@yourbrand.com "Your Name"
```

It prints a one-time password and a TOTP secret (plus an `otpauth://` URL). Add the secret to your authenticator app, log in at `console.yourbrand.com`, then change the password. Set `OWNER_PASSWORD=...` in the command environment if you want to choose it. The script is baked into the worker image (it lives in `infra/scripts/`).

## 8. Backups

wal-g streams WAL to the backup bucket continuously (`archive_command` in `backup/backup.conf`, `archive_timeout = 60`). Add the nightly base backup to the host crontab (`crontab -e`, host timezone is UTC, so this is 03:00 IST):

```cron
30 21 * * * /opt/triakshi/repo/infra/backup/base-backup.sh >> /var/log/triakshi-backup.log 2>&1
```

`base-backup.sh` takes the backup and keeps the newest 30 full backups (30 days). Check after the first night: `dc exec -u postgres postgres wal-g backup-list`. If `wal-g` reports credential errors, the instance metadata hop limit (step 1.2) is the usual cause.

### Restore drill (monthly, on staging)

Staging is a second, smaller VM set up the same way. On it:

```bash
export GHCR_OWNER=<owner> IMAGE_TAG=latest
export WALG_S3_PREFIX=s3://<backup-bucket>/triakshi/production   # production's prefix, read-only role is enough
./infra/scripts/restore-test.sh              # newest backup
./infra/scripts/restore-test.sh LATEST "2026-12-01 10:30:00+00"   # point-in-time
```

It fetches the base backup into a throwaway container, replays WAL, and checks that schools were restored. Log the date and result. A drill that has not been run is not a backup.

## 9. Monitoring

- **Uptime**: an external check (UptimeRobot, Better Stack, or CloudWatch Synthetics from another region) on `https://yourbrand.com`, `https://console.yourbrand.com/login` and one school host. Alert to your phone.
- **Errors**: create a Sentry (or GlitchTip) project and put the DSN in `SENTRY_DSN`. The apps do not read it yet, so wiring the SDK is a code task.
- **Logs**: structured JSON in `docker logs`, rotated at 5 x 20 MB per container. `dc logs -f worker` for job output.
- **Host metrics**: install the CloudWatch agent (`amazon-cloudwatch-agent`), collect memory and disk, and alarm at 80% disk. Postgres and WAL fill the disk first.

## 10. Day-2 commands

```bash
dc ps                         # state
dc logs -f school             # logs
dc run --rm migrate           # apply migrations by hand
dc up -d school               # restart one service with current images
dc exec postgres /docker-entrypoint-initdb.d/02-passwords.sh   # rotate DB role passwords after editing .env
```

Rollback: set `IMAGE_TAG=<previous sha>` in `/opt/triakshi/.env`, `dc up -d`. Migrations are not reversed, so write them to be backward compatible for one release.

Scaling path (spec section 21): move Postgres to its own server with a replica, then run several school containers behind Caddy.
