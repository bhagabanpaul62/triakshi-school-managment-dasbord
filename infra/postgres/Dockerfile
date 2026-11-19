# Postgres 17 with wal-g for continuous WAL archiving and base backups to S3.
FROM postgres:17
ARG TARGETARCH
ARG WALG_VERSION=v3.0.10
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && arch="$([ "$TARGETARCH" = "arm64" ] && echo aarch64 || echo amd64)" \
 && curl -fsSL -o /usr/local/bin/wal-g "https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/wal-g-pg-22.04-${arch}" \
 && chmod +x /usr/local/bin/wal-g && wal-g --version \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
