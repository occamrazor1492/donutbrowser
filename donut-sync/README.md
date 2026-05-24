# donut-sync

Languages: [English](./README.md) | [中文](./README.zh.md)

Self-hosted team sync server for [Donut Browser (internal-use fork)](../README.md).

`donut-sync` is a NestJS API backed by **Postgres** (users, teams, profile metadata, permissions, locks, audit log) and **S3-compatible object storage** (profile bundles, BotBrowser `.enc` templates, extensions, tombstones — MinIO bundled by default). The desktop app authenticates with JWT and round-trips big blobs via presigned URLs straight to the object store.

For the full deployment walkthrough (env vars, Postgres schema, HTTPS, AWS S3 / Cloudflare R2 / MinIO setups, Caddy / Nginx examples) see [**docs/self-hosting-donut-sync.md**](../docs/self-hosting-donut-sync.md). The TL;DR follows.

## Quick start (Docker)

```bash
cp .env.example .env   # then edit ADMIN_EMAIL / ADMIN_PASSWORD / JWT_SECRET
docker compose up -d
```

Brings up:

- `postgres` (image: `public.ecr.aws/docker/library/postgres:16`) — Docker network only
- `minio` — S3 on `127.0.0.1:8987`, console on `127.0.0.1:8988`
- `donut-sync` — NestJS API on `127.0.0.1:12342`

Verify:

```bash
curl http://127.0.0.1:12342/health   # {"status":"ok"}
curl http://127.0.0.1:12342/readyz   # {"status":"ready","s3":true}
```

The initial admin user is bootstrapped from `ADMIN_EMAIL` / `ADMIN_PASSWORD` on first boot.

## Two operating modes

| Mode | Env switch | Auth | When to use |
|---|---|---|---|
| **Team mode (default)** | `MULTI_USER_ENABLED=true` | JWT per user, bcrypt-hashed passwords | Real team — multi-user, permissions, locks, admin UI |
| **Legacy single-token** | `MULTI_USER_ENABLED=false` | Shared bearer `SYNC_TOKEN` | Single user / compat with original upstream model |

The desktop app's team UI (`团队管理` / `共享 Profiles` / `分享 profile`) only appears in team mode.

## Required environment

```env
MULTI_USER_ENABLED=true
DATABASE_URL=postgresql://donut:donut@postgres:5432/donut
JWT_SECRET=<openssl rand -hex 32>
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<initial admin password>

S3_ENDPOINT=http://minio:9000                # server-to-S3
S3_PUBLIC_ENDPOINT=http://127.0.0.1:8987     # client follows presigned URLs to this address
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=donut-sync
S3_FORCE_PATH_STYLE=true                     # MinIO / R2 / DO Spaces

PORT=12342                                   # default for this fork
```

Full env-var reference and S3-provider examples (AWS S3, Cloudflare R2, MinIO behind a reverse proxy) live in [docs/self-hosting-donut-sync.md](../docs/self-hosting-donut-sync.md).

## Storage layout

Every object is scoped to the authenticated JWT's team:

```text
teams/{teamId}/profiles/{profileId}/metadata.json
teams/{teamId}/profiles/{profileId}/manifest.json
teams/{teamId}/profiles/{profileId}/files/...
teams/{teamId}/bot_profiles/{botProfileAssetId}.enc
teams/{teamId}/extensions/...
teams/{teamId}/tombstones/...
```

Big blobs (`.enc` templates, profile bundles) skip the API entirely — desktop hits `S3_PUBLIC_ENDPOINT` via presigned upload/download URLs.

## Postgres schema

Source of truth: [`prisma/schema.prisma`](prisma/schema.prisma). Conceptual tables:

| Table | Purpose |
|---|---|
| `Team` | Team container — every other row is scoped to one |
| `User` | Email, bcrypt-hashed password, role (`admin`/`member`), disabled flag |
| `TeamProfile` | Profile metadata, engine, sync mode, optional BotBrowser asset reference |
| `ProfilePermission` | `owner` / `editor` / `viewer` per (user, profile) |
| `ProfileLock` | One active write-lock per profile + heartbeat timestamp |
| `BotProfileAsset` | Uploaded BotBrowser `.enc` template, dedup by hash |
| `AuditLog` | Login, profile create/delete, share, lock acquire/release |

Migrations:

```bash
pnpm db:migrate    # apply pending migrations
pnpm db:generate   # regenerate the typed Prisma client after schema edits
```

## Development

```bash
pnpm install
pnpm db:generate
pnpm start:dev     # NestJS hot-reload on PORT
```

The product acceptance suite drives the deployed server end-to-end:

```bash
pnpm test:team-product   # from repo root
```

It creates a real test team, profile, lock, presigned upload + download, delete + tombstone propagation. Use this against staging before promoting a deploy.

Unit tests:

```bash
pnpm test
pnpm test:cov
```

## See also

- [docs/self-hosting-donut-sync.md](../docs/self-hosting-donut-sync.md) — full self-hosting guide with HTTPS examples
- [docs/team-deployment-guide.md](../docs/team-deployment-guide.md) ([中文](../docs/team-deployment-guide.zh.md)) — VPS + 宝塔 / Caddy / Nginx walkthrough
- [docs/architecture.md](../docs/architecture.md) — how the desktop and server fit together
- [docs/team-current-feature-overview.md](../docs/team-current-feature-overview.md) — what team mode actually does today
