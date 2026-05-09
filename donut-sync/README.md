# Donut Sync Team Server

Self-hosted sync server for team-managed Donut Browser profiles.

## Team Mode

Team mode stores profile metadata, permissions, locks, audit logs, and BotBrowser profile assets in Postgres, while profile files and `.enc` BotBrowser assets live in S3/MinIO.

Required environment:

```env
MULTI_USER_ENABLED=true
DATABASE_URL=postgresql://donut:donut@postgres:5432/donut
JWT_SECRET=change-me
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=http://127.0.0.1:8987
S3_BUCKET=donut-sync
```

`S3_ENDPOINT` is the server-to-S3 address. `S3_PUBLIC_ENDPOINT` is the address desktop clients use for presigned upload/download URLs.

Start the full local stack:

```bash
cd ..
bash scripts/start-team-browser-stack.sh
```

Full first-run instructions are in [Team Self-Hosted BotBrowser Runbook](../docs/team-self-hosted-botbrowser.md).

Run the product API acceptance suite after the stack is up:

```bash
pnpm test:team-product
```

On first boot the server creates the initial admin user from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

## Storage Layout

Team objects are scoped to the authenticated JWT team:

```text
teams/{teamId}/profiles/{profileId}/metadata.json
teams/{teamId}/profiles/{profileId}/manifest.json
teams/{teamId}/profiles/{profileId}/files/...
teams/{teamId}/bot_profiles/{botProfileAssetId}.enc
teams/{teamId}/extensions/...
teams/{teamId}/tombstones/...
```

Legacy single-user mode is still available by setting `MULTI_USER_ENABLED=false` and `SYNC_TOKEN`.
