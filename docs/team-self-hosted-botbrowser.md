# Team Self-Hosted Browser Runbook

Languages: [English](./team-self-hosted-botbrowser.md) | [中文](./team-self-hosted-botbrowser.zh.md)

This runbook starts the local team browser stack and walks through creating, sharing, joining, and launching the first team profile.

For a complete inventory of what this version currently supports, see [Team Edition Current Feature Overview](./team-current-feature-overview.md).

## Current Three Browser Environments

The desktop app currently exposes three browser environments. They are not at the same product maturity level:

| Environment | UI name | Suitable for team sharing now | Needs `.enc` template | When to use it |
| --- | --- | --- | --- | --- |
| Wayfern/Chromium | `Chromium` / `Wayfern` | Yes, default and recommended | No | Normal team shared environments. Donut registers the profile as a team profile, then syncs cookies, LocalStorage, and profile files after browser close. |
| BotBrowser | `BotBrowser` | Compatibility only in this client MVP | Usually yes | Existing records/assets are kept, but the normal member sharing flow does not use BotBrowser templates. |
| Camoufox/Firefox | `Firefox` / `Camoufox` | Not recommended for shared use yet | N/A | Kept for local use and data compatibility. This version does not allow members to one-click join and launch it from `Shared Profiles`. |

So the answer is not “only one browser exists.” The accurate rule is:

- **The default, product-like shared workflow is Wayfern/Chromium.**
- **BotBrowser records/assets are kept for compatibility, but do not use them as the normal team workflow in this MVP.**
- **Do not use Camoufox for team sharing acceptance yet.**

For shared team profiles, the server is the authoritative source. Each user's desktop only keeps local cache and runs the browser process. One profile has one active writer at a time, enforced by profile locks so two users cannot write the same environment simultaneously.

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

Deployment, server sizing, and desktop packaging notes are in [Team Deployment Guide](./team-deployment-guide.md).

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

Fast web admin path:

1. Open `http://127.0.0.1:12342/admin`.
2. Login with the admin account.
3. Open `Users`.
4. Enter email, temporary password, and role.
5. Click `Create user`.

Recommended desktop path:

1. In Donut Desktop, open Sync settings.
2. Log in to `Self-hosted` with the admin account.
3. Click `Team Admin`.
4. Open `Users`, enter email, temporary password, and role, then click `Create user`.

CLI fallback:

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

## 4. Compatibility Only: BotBrowser `.enc` Templates

If you only need a normal shared team environment, skip this section and use Wayfern/Chromium in step 7. The default shared Chromium environment does not need `.enc`.

The current client MVP hides BotBrowser template management from the default `Team Admin` path. These APIs remain only for legacy data and advanced compatibility testing.

CLI fallback:

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

Admin users will see a main-screen `Team` menu after login. `Team Admin` manages team users, Wayfern/Chromium team profiles, profile permissions, force unlock, and audit logs with action/profile/user filters. Non-admin members use the same self-hosted login and see `Shared Profiles`.

4. Login with a team user, for example:

```text
email: a@team.local
password: a-password
```

## 7. Create The First Shared Chromium Profile

Recommended desktop path:

1. Click `Create Profile`.
2. Choose `Chromium` / `Wayfern`.
3. Enter a profile name.
4. Configure proxy, fingerprint, extensions, or DNS options as needed.
5. Create the profile.

The create screen also shows `Firefox` / `Camoufox`, but in this version it is local-only for team usage: members cannot one-click join and launch it from `Shared Profiles`. Use `Chromium` / `Wayfern` for shared team environments.

After creating the local Wayfern/Chromium profile, click the row `Share to Team` action or open the profile info actions and choose `Share to Team`. Donut then treats this profile as a team environment:

- local profile metadata and fingerprint settings are created on this device;
- a matching `TeamProfile` is registered on the server with `engine: "wayfern"`;
- sync mode is set to `Regular`;
- Donut briefly acquires the server lock, uploads the initial profile metadata/manifest, then releases the lock.

This is the normal AdsPower-style flow for this MVP: no BotBrowser `.enc` template is required for the default shared Chromium environment, and members do not import template files manually.

BotBrowser and Camoufox are retained for compatibility, but the current client sharing flow is Wayfern/Chromium-first. Do not use BotBrowser templates as the normal team setup path in this version.

CLI fallback for debugging:

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

Restart Donut Desktop. The profile should appear in the profile list. This CLI fallback is only for BotBrowser debugging; normal team environments should be created from the desktop UI as Wayfern/Chromium profiles.

## 8. Share The Profile With Team Members

The user who creates a profile is the `owner` by default. Admins can see all team profiles.

For another user to actually use the environment, normally grant `editor`:

| Permission | Can see it | Can launch | Can sync changes after close | Can manage permissions |
| --- | --- | --- | --- | --- |
| `owner` | Yes | Yes | Yes | Yes |
| `editor` | Yes | Yes | Yes | No |
| `viewer` | Yes | No | No | No |

Recommended desktop sharing flow:

1. Admin or owner opens the main `Team` menu → `Team Admin`.
2. Open `Profiles`.
3. Find the target profile.
4. Select the team member and permission. Use `Editor` for normal usage.
5. Save the permission.

CLI fallback:

```bash
curl -sS http://127.0.0.1:12342/v1/team-profiles/$PROFILE_ID/permissions \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"userId":"B_USER_ID","permission":"editor"}'
```

## 9. Join A Shared Profile As A Member

After an admin grants access, a member can add a shared profile without manually creating a local profile:

1. Login to the same self-hosted server.
2. Open the main `Team` menu and click `Shared Profiles`.
3. Find the shared Chromium/Wayfern profile.
4. Click `Add to local`.
5. Click `Preflight` to verify login, permission, browser runtime/fingerprint data, and lock state.
6. Click `Launch` after preflight passes.

Wayfern/Chromium shared profiles can be joined and launched from this member flow. BotBrowser and Camoufox team profile records remain compatible server data, but one-click member launch is not enabled in the current client MVP.

Common preflight failures:

| Failure | Fix |
| --- | --- |
| Self-hosted login | Login again in Sync settings. |
| Launch permission | Ask an admin for `owner` or `editor` permission. |
| Browser runtime | Download the required Wayfern/Chromium runtime. |
| Fingerprint data | Wayfern generates fingerprint data automatically. No `.enc` template is required. |
| Profile lock | Wait for the other user to close the profile, or ask an admin to force unlock if it is stale. |

## 10. Launch, Sync, And Locking

When user A launches the profile:

```text
Donut gets a server lock
Donut downloads the latest server profile state
Donut launches Chromium/Wayfern
Donut keeps lock heartbeat alive
After browser close, Donut waits for profile files to become stable
Donut syncs cookies/local storage/profile files while the lock is still held
Donut releases the lock
```

If B starts the same profile while A is using it, B should receive a lock conflict. After A closes the browser and sync completes, B can open `Shared Profiles`, add or refresh the local profile, launch it, and reuse the same server-side state.

## 11. Recommended Acceptance Flow

Use two users to prove sharing works end to end:

1. Admin creates user A and user B.
2. A logs in to self-hosted.
3. A creates a `Chromium` / `Wayfern` profile, for example `test`.
4. A clicks `Share to Team` for `test`.
5. A launches `test`, logs in to a test website, then closes the browser.
6. Admin or A grants B `editor` in `Team` → `Team Admin` → `Profiles`.
7. B logs in to the same self-hosted server.
8. B opens `Team` → `Shared Profiles`, finds `test`, and clicks `Add to local`.
9. B runs `Preflight` and verifies login, permission, runtime, fingerprint data, and lock checks pass.
10. B clicks `Launch` and should see the login state A synced to the server.
11. If A and B launch `test` at the same time, the second launcher should be rejected by the lock.

## 12. Stop The Server

```bash
cd donut-sync
docker compose down
```

To remove all local server data:

```bash
cd donut-sync
docker compose down -v
```
