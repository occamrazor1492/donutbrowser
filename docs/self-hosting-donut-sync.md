# Self-hosting `donut-sync`

`donut-sync` is the team-aware sync server that backs this internal-use fork. It stores user accounts, team profile metadata, permissions, profile locks, and audit logs in **Postgres**, and profile bundles + extensions + BotBrowser `.enc` templates in **S3-compatible object storage** (MinIO bundled by default).

This guide covers self-hosting it with Docker Compose. For a production VPS / 宝塔 / Caddy walkthrough with HTTPS, also read [team-deployment-guide.md](./team-deployment-guide.md) (and its [中文版](./team-deployment-guide.zh.md)).

## Two operating modes

| Mode | When to pick it | Auth |
|---|---|---|
| **`MULTI_USER_ENABLED=true`** (recommended) | Real team deployment — multiple users, team admin UI, profile permissions, distributed locks, audit log | JWT login; each user has their own email + password; an initial admin is bootstrapped from `ADMIN_EMAIL` / `ADMIN_PASSWORD` on first boot |
| **`MULTI_USER_ENABLED=false`** (legacy) | Single-user / single-token deploys, compat with the original upstream sync model | Shared bearer `SYNC_TOKEN`; no per-user accounts |

The desktop UI in this fork is built around the team mode. The legacy mode still works at the API level but won't surface team menus / permissions / locks in the app.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- An S3-compatible object storage — MinIO is included by default; AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces all work via the same env vars

## Quick start (full local stack)

The repo ships with a working `donut-sync/docker-compose.yml`:

```bash
cd donut-sync
cp .env.example .env  # then edit ADMIN_EMAIL / ADMIN_PASSWORD / JWT_SECRET
docker compose up -d
```

That brings up:

- `postgres` (image: `public.ecr.aws/docker/library/postgres:16`) — internal Docker network only
- `minio` (image: `quay.io/minio/minio:latest`) — S3 API on `127.0.0.1:8987`, console on `127.0.0.1:8988`
- `donut-sync` — NestJS API on `127.0.0.1:12342`

Verify it's up:

```bash
curl http://127.0.0.1:12342/health
# {"status":"ok"}

curl http://127.0.0.1:12342/readyz
# {"status":"ready","s3":true}
```

On first boot the server creates the initial admin from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

## Required environment

### Team mode (default)

```env
MULTI_USER_ENABLED=true
DATABASE_URL=postgresql://donut:donut@postgres:5432/donut
JWT_SECRET=<run: openssl rand -hex 32>
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<initial admin password>

# Server-side S3 endpoint (Docker network address)
S3_ENDPOINT=http://minio:9000
# Client-facing S3 endpoint (what the desktop hits for presigned URLs)
S3_PUBLIC_ENDPOINT=http://127.0.0.1:8987

S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=donut-sync
S3_FORCE_PATH_STYLE=true

PORT=12342
```

| Variable | Required | Notes |
|---|---|---|
| `MULTI_USER_ENABLED` | yes | `true` for team mode, `false` for legacy single-token mode |
| `DATABASE_URL` | team mode | Postgres connection string |
| `JWT_SECRET` | team mode | Random 32-byte hex used to sign access tokens |
| `ADMIN_EMAIL` | team mode | Initial admin account — created on first boot if no users exist |
| `ADMIN_PASSWORD` | team mode | Initial admin password — change it immediately after first login |
| `SYNC_TOKEN` | legacy mode | Shared bearer token; ignored in team mode |
| `SYNC_JWT_PUBLIC_KEY` | optional | Alternative to `SYNC_TOKEN` in legacy mode — verify externally-signed JWTs |
| `S3_ENDPOINT` | yes | Server-to-S3 address (e.g. `http://minio:9000` inside Docker, or `https://s3.amazonaws.com`) |
| `S3_PUBLIC_ENDPOINT` | yes | Address the desktop app hits when it follows a presigned upload/download URL. Usually different from `S3_ENDPOINT` when MinIO is behind a reverse proxy. |
| `S3_REGION` | no | Defaults to `us-east-1` |
| `S3_ACCESS_KEY_ID` | yes | S3 access key (or IAM role for AWS) |
| `S3_SECRET_ACCESS_KEY` | yes | S3 secret key |
| `S3_BUCKET` | no | Defaults to `donut-sync`. Create the bucket before first boot if your provider doesn't auto-create. |
| `S3_FORCE_PATH_STYLE` | conditional | `true` for MinIO / R2 / DigitalOcean Spaces and other path-style providers |
| `PORT` | no | Defaults to `12342` in this fork (upstream uses `3929`) |

### Legacy single-token mode

```env
MULTI_USER_ENABLED=false
SYNC_TOKEN=<run: openssl rand -hex 32>
S3_ENDPOINT=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_BUCKET=donut-sync
PORT=12342
```

The desktop client's "advanced token" mode in the Sync dialog talks to this — but you lose team admin / permissions / locks.

## Storage layout

Everything is scoped under the authenticated team's id:

```text
teams/{teamId}/profiles/{profileId}/metadata.json
teams/{teamId}/profiles/{profileId}/manifest.json
teams/{teamId}/profiles/{profileId}/files/...
teams/{teamId}/bot_profiles/{botProfileAssetId}.enc
teams/{teamId}/extensions/...
teams/{teamId}/tombstones/...
```

- `metadata.json` — profile config (browser, fingerprint config, proxy assignment, group)
- `manifest.json` — per-file SHA256 ledger driving delta sync
- `files/...` — the actual profile data (cookies SQLite, IndexedDB, extensions state, etc.)
- `bot_profiles/{id}.enc` — BotBrowser fingerprint template assets, uploaded once and shared across team members
- `tombstones/` — deletion markers, propagated to other devices so delete-on-A propagates to B

Big blobs (`.enc` templates, profile bundles) round-trip via **presigned URLs** — the desktop hits `S3_PUBLIC_ENDPOINT` directly, the API server never proxies the bytes.

## Postgres schema (team mode)

`prisma/schema.prisma` is the source of truth. Conceptually:

| Table | Holds |
|---|---|
| `Team` | Team container — every other row is scoped to one |
| `User` | Email, bcrypt-hashed password, role (`admin` / `member`), disabled flag |
| `TeamProfile` | Profile metadata, engine, sync mode, optional BotBrowser asset reference |
| `ProfilePermission` | `owner` / `editor` / `viewer` per (user, profile) |
| `ProfileLock` | One active write-lock per profile + heartbeat timestamp |
| `BotProfileAsset` | Uploaded BotBrowser `.enc` template, deduplicated by hash |
| `AuditLog` | Key team operations: login, profile create/delete, share, lock acquire/release |

Migrations are managed with Prisma:

```bash
cd donut-sync
pnpm db:migrate   # apply on deploy
pnpm db:generate  # regenerate the typed client after schema edits
```

## Health endpoints

| Endpoint | Purpose | Status code |
|---|---|---|
| `GET /health` | Liveness — server is running | 200 always when the process is alive |
| `GET /readyz` | Readiness — server is running **and** S3 is reachable | 200 if S3 ping succeeds, 503 otherwise |

Put `/readyz` behind your load balancer / orchestrator's health check so a broken S3 fails out of rotation.

## Using external S3 storage

Drop the `minio` service from `docker-compose.yml` and swap the env:

### AWS S3

```yaml
environment:
  MULTI_USER_ENABLED: "true"
  DATABASE_URL: postgresql://...
  JWT_SECRET: ...
  ADMIN_EMAIL: admin@example.com
  ADMIN_PASSWORD: ...
  S3_ENDPOINT: https://s3.us-east-1.amazonaws.com
  S3_PUBLIC_ENDPOINT: https://s3.us-east-1.amazonaws.com
  S3_REGION: us-east-1
  S3_ACCESS_KEY_ID: <aws-access-key>
  S3_SECRET_ACCESS_KEY: <aws-secret-key>
  S3_BUCKET: your-bucket
  # don't set S3_FORCE_PATH_STYLE for AWS
```

### Cloudflare R2

```yaml
environment:
  S3_ENDPOINT: https://<account-id>.r2.cloudflarestorage.com
  S3_PUBLIC_ENDPOINT: https://<account-id>.r2.cloudflarestorage.com
  S3_REGION: auto
  S3_ACCESS_KEY_ID: <r2-access-key>
  S3_SECRET_ACCESS_KEY: <r2-secret-key>
  S3_BUCKET: your-bucket
  S3_FORCE_PATH_STYLE: "true"
```

### MinIO behind a public reverse proxy

```yaml
environment:
  # Server-to-S3 stays inside Docker
  S3_ENDPOINT: http://minio:9000
  # Desktop apps follow presigned URLs to the public address
  S3_PUBLIC_ENDPOINT: https://s3.example.com
  S3_REGION: us-east-1
  S3_ACCESS_KEY_ID: minioadmin
  S3_SECRET_ACCESS_KEY: minioadmin
  S3_BUCKET: donut-sync
  S3_FORCE_PATH_STYLE: "true"
```

## Configuring the desktop app

1. Open Donut Browser
2. Right-side `···` dropdown → **账户** (labelled "Sync Service" in English, currently translated as 账户)
3. **Server URL** — e.g. `https://sync.example.com`
4. **Email + Password** — admin account for first login (set as `ADMIN_EMAIL` / `ADMIN_PASSWORD`)
5. **Save**

A successful login adds the **团队** (Team) menu in the header. Admins see **团队管理** (Team Admin) where they can invite more users.

## Security

- **Strong `JWT_SECRET`** — `openssl rand -hex 32`, keep it out of git
- **HTTPS in production** — terminate TLS at Caddy / Nginx / Traefik in front of `donut-sync`. JWTs are sent in the `Authorization` header and S3 presigned URLs include credentials in query strings
- **Don't expose Postgres or MinIO directly** — keep them on the Docker internal network, only the API and (optionally) `S3_PUBLIC_ENDPOINT` go through the reverse proxy
- **S3 credentials** — for AWS/R2 use dedicated IAM keys with read/write to the bucket only, not your account-wide creds
- **Initial admin password** — change it from the team admin UI immediately after first login

### Example: Caddy

```caddy
sync.example.com {
    reverse_proxy 127.0.0.1:12342
}

s3.example.com {
    reverse_proxy 127.0.0.1:8987
}
```

### Example: Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name sync.example.com;
    ssl_certificate     /etc/letsencrypt/live/sync.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sync.example.com/privkey.pem;

    client_max_body_size 200M;  # for large profile uploads via API

    location / {
        proxy_pass http://127.0.0.1:12342;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl http2;
    server_name s3.example.com;
    ssl_certificate     /etc/letsencrypt/live/s3.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/s3.example.com/privkey.pem;

    client_max_body_size 0;  # MinIO handles range uploads itself

    location / {
        proxy_pass http://127.0.0.1:8987;
        proxy_set_header Host $host;
        proxy_request_buffering off;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Operations

### Acceptance test suite

After bringing the stack up:

```bash
cd donut-sync
pnpm test:team-product
```

It hits the deployed API with a real test team and verifies the full lifecycle: create team, create profile, share, acquire lock, presigned upload, presigned download, delete + tombstone propagation.

### Run from source (dev mode)

```bash
cd donut-sync
pnpm install
pnpm db:generate
pnpm start:dev   # NestJS hot-reload on PORT (default 12342)
```

For an end-to-end local sync test that also drives the Rust client side, use:

```bash
bash scripts/start-team-browser-stack.sh   # brings up docker + waits for healthy
node scripts/sync-test-harness.mjs         # exercises the sync API
```

### Backups

Two things to back up:

1. **Postgres** — `pg_dump` on a schedule. Holds the source-of-truth user / team / profile metadata.
2. **The S3 bucket** — your provider's snapshot / lifecycle / versioning. Holds every profile bundle and every `.enc` template.

You don't need to back up the desktop apps — they're stateless caches over the server.

## Troubleshooting

| Symptom | Diagnosis |
|---|---|
| `/readyz` returns 503 with `"s3":false` | `S3_ENDPOINT` is wrong, bucket doesn't exist, or credentials don't have access. Check `docker compose logs donut-sync` for the underlying S3 error. |
| Desktop logs in but never sees team menu | The user's role is `member` and `MULTI_USER_ENABLED` is false on the server. Confirm in `docker compose logs donut-sync` that the boot line says "team mode". |
| Sync uploads fail with redirect / 403 | `S3_PUBLIC_ENDPOINT` doesn't match what the desktop can actually reach. If you're behind a reverse proxy, make sure HTTPS terminates correctly and the bucket policy allows the presigned operation. |
| `Failed to load self-hosted token: Decryption failed` on browser launch | The desktop binary was rebuilt with a different `DONUT_BROWSER_VAULT_PASSWORD` than the one that encrypted the token on disk. In recent fork builds the app self-heals: it discards the bad token, logs a warning, and shows you as logged out — re-login through Settings → Sync. Older builds need you to delete `~/Library/Application Support/DonutBrowser/settings/sync_token.dat` manually before re-login. |
