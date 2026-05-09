# Team Self-Hosted BotBrowser Runbook

Languages: [English](./team-self-hosted-botbrowser.md) | [中文](./team-self-hosted-botbrowser.zh.md)

This runbook starts the local team browser stack and walks through the first usable profile.

## 0. Local Dev Quick Start

This is the exact local path used on macOS during development.

Start the self-hosted team sync server:

```bash
bash scripts/start-team-browser-stack.sh
```

The local services should be:

```text
donut-sync API: http://127.0.0.1:12342
MinIO console:  http://127.0.0.1:8988
Next dev UI:    http://127.0.0.1:12341
```

Verify the backend:

```bash
curl http://127.0.0.1:12342/health
curl http://127.0.0.1:12342/readyz
```

Run the product API acceptance suite:

```bash
pnpm test:team-product
```

The full product test matrix is in [Team Self-Hosted Product Test Plan](./team-product-test-plan.md).

If this machine does not have `pnpm`, create a local Corepack shim:

```bash
mkdir -p /private/tmp/corepack-bin
COREPACK_HOME=/private/tmp/corepack-cache corepack enable --install-directory /private/tmp/corepack-bin
```

Use the local Corepack shim for this shell:

```bash
export PATH="/private/tmp/corepack-bin:/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH"
export COREPACK_HOME=/private/tmp/corepack-cache
```

Install dependencies:

```bash
pnpm install
```

Install Rust if `cargo` is missing:

```bash
HOMEBREW_NO_AUTO_UPDATE=1 brew install rust
```

Prebuild Donut sidecar binaries once so Tauri does not time out while waiting for the frontend:

```bash
pnpm copy-proxy-binary
```

Start Donut Desktop:

```bash
pnpm tauri dev
```

Check running processes:

```bash
pgrep -fl 'tauri dev|next dev|donutbrowser'
```

Stop the desktop dev session by pressing `Ctrl+C` in the terminal running `pnpm tauri dev`.

Stop the server:

```bash
cd donut-sync
docker compose down
```

## 1. Start The Server

From the repo root:

```bash
bash scripts/start-team-browser-stack.sh
```

Default local admin:

```text
email: admin@example.com
password: change-me
```

For a real team, override the defaults:

```bash
JWT_SECRET='replace-with-a-long-random-secret' \
ADMIN_EMAIL='admin@your-team.com' \
ADMIN_PASSWORD='replace-with-a-strong-password' \
bash scripts/start-team-browser-stack.sh
```

Health check:

```bash
curl http://127.0.0.1:12342/health
```

Expected response:

```json
{"status":"ok"}
```

Useful service URLs:

```text
donut-sync API: http://127.0.0.1:12342
MinIO console:  http://127.0.0.1:8988
```

The compose file uses `public.ecr.aws/docker/library/postgres:16`, `quay.io/minio/minio:latest`, and `public.ecr.aws/docker/library/node:22-alpine` so local startup does not depend on Docker Hub.

## 2. Login As Admin

```bash
TOKEN="$(curl -sS http://127.0.0.1:12342/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"change-me"}' \
  | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
```

## 3. Create Team Users

```bash
curl -sS http://127.0.0.1:12342/v1/admin/users \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"email":"a@team.local","password":"a-password","role":"member"}'

curl -sS http://127.0.0.1:12342/v1/admin/users \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"email":"b@team.local","password":"b-password","role":"member"}'
```

List users:

```bash
curl -sS http://127.0.0.1:12342/v1/admin/users \
  -H "authorization: Bearer $TOKEN"
```

## 4. Upload A BotBrowser `.enc` Template

Put your BotBrowser encrypted profile somewhere local, for example:

```text
/Users/zhongziyun/Desktop/template.enc
```

Upload it:

```bash
ENC_BASE64="$(base64 < /Users/zhongziyun/Desktop/template.enc | tr -d '\n')"

curl -sS http://127.0.0.1:12342/v1/admin/bot-profiles \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"default-bot-template\",\"contentBase64\":\"$ENC_BASE64\",\"browserMajorVersion\":\"120\",\"platform\":\"macos\"}"
```

Save the returned `id` as `BOT_ASSET_ID`.

## 5. Start Donut Desktop

Install dependencies and start the desktop app:

```bash
corepack enable
pnpm install
pnpm copy-proxy-binary
pnpm tauri dev
```

If `pnpm` is not available, use Node's Corepack:

```bash
COREPACK_HOME=/private/tmp/corepack-cache corepack pnpm install
COREPACK_HOME=/private/tmp/corepack-cache corepack pnpm copy-proxy-binary
COREPACK_HOME=/private/tmp/corepack-cache corepack pnpm tauri dev
```

## 6. Login To Self-Hosted Sync

In Donut Desktop:

1. Open Sync settings.
2. Select `Self-hosted`.
3. Server URL:

```text
http://127.0.0.1:12342
```

4. Login with a team user, for example:

```text
email: a@team.local
password: a-password
```

## 7. Create The First BotBrowser Profile

Until the profile creation UI is expanded for BotBrowser, create the metadata file directly.

```bash
PROFILE_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
PROFILE_DIR="$HOME/Library/Application Support/DonutBrowserDev/profiles/$PROFILE_ID"
mkdir -p "$PROFILE_DIR"
```

Replace `BOT_ASSET_ID_HERE` with the asset id from step 4:

```bash
cat > "$PROFILE_DIR/metadata.json" <<EOF
{
  "id": "$PROFILE_ID",
  "name": "Team Bot Profile 01",
  "browser": "botbrowser",
  "engine": "botbrowser",
  "version": "external",
  "sync_mode": "Regular",
  "host_os": "macos",
  "botbrowser_config": {
    "executable_path": "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "bot_profile_asset_id": "BOT_ASSET_ID_HERE",
    "locale": "en-US",
    "timezone": "America/Los_Angeles",
    "languages": "en-US,en",
    "local_dns": true,
    "port_protection": true
  }
}
EOF
```

Restart Donut Desktop. The profile should appear in the profile list.

## 8. Launch And Share

When user A launches the profile:

```text
Donut gets a server lock
Donut downloads the latest server profile state
Donut downloads the BotBrowser .enc asset if missing locally
Donut launches Chromium/BotBrowser with --bot-profile
Donut keeps lock heartbeat alive
Donut syncs cookies/local storage/profile files after browser close
Donut releases the lock
```

Grant user B access:

```bash
curl -sS http://127.0.0.1:12342/v1/team-profiles/$PROFILE_ID/permissions \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"userId":"B_USER_ID","permission":"editor"}'
```

If B starts the same profile while A is using it, B should receive a lock conflict. After A closes the browser and sync completes, B can start it and reuse the same server-side state.

## 9. Stop The Server

```bash
cd donut-sync
docker compose down
```

To remove all local server data:

```bash
cd donut-sync
docker compose down -v
```
