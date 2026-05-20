# Team Edition Current Feature Overview

Languages: [English](./team-current-feature-overview.md) | [中文](./team-current-feature-overview.zh.md)

This document describes what the current team self-hosted browser build can do today, what runs on the server, what runs on each desktop client, and which parts are still internal-test level rather than polished product release.

## Product Position

The current build is an internal team MVP for a self-hosted multi-user browser system.

It is designed for:

- Team-owned profile data stored on your own server.
- Multiple users logging in with team accounts.
- Admin-managed users, BotBrowser templates, team profiles, permissions, locks, and audit logs.
- Wayfern/Chromium as the default shared team browser environment.
- BotBrowser retained as an advanced Chromium fingerprint execution layer.
- Local Mac/Windows desktop clients running the browser process on each user's own machine.

It is not designed as:

- A web remote browser control panel.
- A cloud browser streaming system.
- A commercial hosted SaaS.
- A fully signed public desktop release.
- A real-time multi-user editing system for one profile.

## Three Browser Environments And Sharing Status

The current version supports three browser environments, but their sharing support is different:

| Environment | engine/browser | Current sharing status | Notes |
| --- | --- | --- | --- |
| Wayfern/Chromium | `wayfern` / `wayfern` | Default supported path, recommended for normal team use | Creating a Chromium profile while logged into self-hosted automatically registers a team profile. No `.enc` template is required. |
| BotBrowser | `botbrowser` / `botbrowser` | Supported, but advanced | Requires a BotBrowser `.enc` template or local `.enc` path, and each client needs a valid executable path. |
| Camoufox/Firefox | `camoufox` / `camoufox` | No member one-click shared launch yet | Server metadata compatibility is retained, but it is not the current shared-team acceptance path. |

In practice, users should create and share `Chromium` / `Wayfern` environments first. Choose `BotBrowser` only when the team has prepared `.enc` templates and explicitly needs BotBrowser. Do not use Camoufox as the main shared environment path in this version.

## Server Features

The server is the authoritative source for team data. Local clients are only caches and runtime environments.

Current server components:

- `donut-sync` NestJS API.
- Postgres for users, teams, profile metadata, permissions, locks, and audit logs.
- MinIO or any S3-compatible object storage for profile files, manifests, tombstones, extensions, and BotBrowser `.enc` templates.
- Nginx, Caddy, or Baota-managed Nginx for HTTPS reverse proxy.

Current server data model:

- `Team`: team container.
- `User`: email, password hash, role, disabled state.
- `TeamProfile`: team profile metadata, engine, sync mode, optional BotBrowser template reference.
- `ProfilePermission`: `owner`, `editor`, or `viewer`.
- `ProfileLock`: one active writer lock per profile.
- `BotProfileAsset`: uploaded BotBrowser `.enc` template.
- `AuditLog`: key team actions and sync actions.

Current storage layout:

```text
teams/{teamId}/profiles/{profileId}/metadata.json
teams/{teamId}/profiles/{profileId}/manifest.json
teams/{teamId}/profiles/{profileId}/files/...
teams/{teamId}/bot_profiles/{botProfileAssetId}.enc
teams/{teamId}/extensions/...
teams/{teamId}/tombstones/...
```

## Authentication And Permissions

The self-hosted team mode supports JWT login.

Current auth behavior:

- `MULTI_USER_ENABLED=true` enables team JWT mode.
- `POST /v1/auth/login` returns a JWT for enabled users.
- `GET /v1/me` returns user, role, team, and team mode.
- Disabled users cannot log in.
- Disabled users cannot continue using old tokens.
- Legacy single-user `SYNC_TOKEN` mode remains available when team mode is disabled.

Current roles:

| Role | Meaning |
| --- | --- |
| `admin` | Can manage team users, BotBrowser templates, profiles, permissions, locks, and audit logs. |
| `member` | Can use profiles they own or have been granted access to. |

Current profile permissions:

| Permission | Can read metadata | Can download assets | Can launch/write | Can manage permissions |
| --- | --- | --- | --- | --- |
| `owner` | Yes | Yes | Yes | Yes |
| `editor` | Yes | Yes | Yes | No |
| `viewer` | Yes | Yes | No | No |
| `admin` role | Yes | Yes | Yes | Yes |

## Backend API Features

Current auth endpoints:

```http
POST /v1/auth/login
POST /v1/auth/logout
GET  /v1/me
```

Current admin endpoints:

```http
POST   /v1/admin/users
GET    /v1/admin/users
PATCH  /v1/admin/users/:id

POST   /v1/admin/bot-profiles
GET    /v1/admin/bot-profiles
DELETE /v1/admin/bot-profiles/:id

GET    /v1/admin/audit-logs
```

Current team profile endpoints:

```http
GET    /v1/team-profiles
POST   /v1/team-profiles
GET    /v1/team-profiles/:id
PATCH  /v1/team-profiles/:id
DELETE /v1/team-profiles/:id

POST   /v1/team-profiles/:id/permissions
DELETE /v1/team-profiles/:id/permissions/:userId

POST   /v1/team-profiles/:id/lock
POST   /v1/team-profiles/:id/lock/heartbeat
POST   /v1/team-profiles/:id/unlock
```

Current sync object endpoints:

```http
POST /v1/objects/stat
POST /v1/objects/list
POST /v1/objects/presign-upload
POST /v1/objects/presign-upload-batch
POST /v1/objects/presign-download
POST /v1/objects/presign-download-batch
POST /v1/objects/delete
POST /v1/objects/delete-prefix
GET  /v1/objects/subscribe
```

Important backend behavior:

- Object paths are scoped into `teams/{teamId}/...` in team mode.
- A user can only access profiles in their own team.
- A user can only see profiles they own, profiles shared with them, or all team profiles if admin.
- `viewer` cannot upload, delete, lock, or launch.
- `editor`, `owner`, and `admin` can launch/write when lock rules allow it.
- Uploading profile objects requires an active unexpired lock.
- BotBrowser template deletion is blocked when a live profile still references the template.
- Audit logs support `limit`, `action`, `targetType`, `targetId`, and `userId` filters.
- Admins can force unlock a stale or stuck profile lock.

## Desktop Client Features

The desktop app remains a Tauri app with a Next.js frontend and Rust backend.

Current desktop features:

- Self-hosted login with server URL, email, and password.
- Secure token storage through existing app token storage.
- `Donut Cloud` remains first priority when configured; otherwise self-hosted JWT mode is used.
- Team key prefix resolves to `teams/{teamId}/` after self-hosted login.
- Existing local profile list remains available.
- Wayfern/Chromium team profiles can be created without a template, added to local, preflighted, launched, synced, and shared.
- Advanced BotBrowser team profiles can still be created with `.enc` templates for teams that need that engine.

Current Tauri commands for team mode:

```text
team_list_users
team_create_user
team_update_user

team_list_bot_profiles
team_upload_bot_profile_asset
team_delete_bot_profile_asset

team_list_profiles
team_create_profile
team_update_profile
team_delete_profile

team_set_profile_permission
team_delete_profile_permission
team_unlock_profile

team_list_audit_logs
team_materialize_profile
team_preflight_botbrowser_profile
```

Current error mapping:

- Not logged in.
- Non-admin request.
- Permission denied.
- Lock conflict.
- Team API not reachable.
- S3 or presigned URL failure.
- Missing BotBrowser executable.
- Missing or unavailable `.enc` template.

## Admin UI Features

There are two admin surfaces in the current product shape:

| Surface | Purpose |
| --- | --- |
| Donut Desktop `Team Admin` | Main product admin entry. Use it when the desktop client is installed and logged into self-hosted mode as an admin. |
| Server `/admin` Web Admin | Lightweight bootstrap and fallback entry. Use it when the desktop client is not installed yet, when quickly creating users, or when an admin needs an emergency server-side management page. |

Both surfaces call the same `/v1/...` APIs and manage the same team data.

Admins see a `Team Admin` entry in Donut Desktop after logging into a self-hosted server.

Current `Team Admin` tabs:

| Tab | Current abilities |
| --- | --- |
| Users | List users, create users, reset password, switch `admin` or `member`, disable or enable users. |
| BotBrowser Templates | Upload `.enc` templates, list templates, delete templates when unused. |
| Profiles | List team profiles, edit name, edit engine/template, delete profiles, assign permissions, remove permissions, force unlock. |
| Audit Logs | View recent logs, filter by action, target type, target id, and user. |

All user-facing admin UI copy goes through the translation system and is present in all seven locale files.

The server `/admin` page currently supports:

- Admin login.
- User list, create, role change, password reset, disable, and enable.
- BotBrowser `.enc` template upload, list, and delete.
- Team profile create, list, delete, permission grant/removal, and force unlock.
- Audit log list and basic filters.

## Member Shared Profile Features

Members can use the `Shared Profiles` entry after self-hosted login.

Current member flow:

1. Login to the same self-hosted server.
2. Open `Shared Profiles`.
3. See shared team profiles and their permission, engine, template, lock state, and local status.
4. For Wayfern/Chromium profiles, click `Add to local` to download the server profile metadata and state.
5. For advanced BotBrowser profiles, optionally enter a local BotBrowser or Chromium executable path.
6. Run `Preflight`.
7. Click `Launch` after checks pass.

Current materialization behavior:

- `team_materialize_profile(profileId, executablePath?)` creates or updates a local `BrowserProfile`.
- The local profile keeps the same id as the team profile.
- Re-adding the same shared profile updates local metadata instead of creating a duplicate.
- Wayfern/Chromium profiles download their server metadata/profile state and use `engine: "wayfern"`, `browser: "wayfern"`, and `sync_mode: "Regular"`.
- BotBrowser profiles use `engine: "botbrowser"`, `browser: "botbrowser"`, `sync_mode: "Regular"`, and the server template id.

Current limitation:

- The member one-click shared profile launcher supports Wayfern/Chromium and advanced BotBrowser profiles.
- Camoufox team profile records remain compatible server data, but one-click member launch is intentionally disabled in this version.

## Shared Chromium Execution Features

Wayfern/Chromium is the default team execution engine for this MVP. When a self-hosted user creates a Wayfern profile, Donut registers it as a team profile, enables `Regular` sync, uploads the initial metadata/manifest under the team prefix, and then uses locks for every launch/write cycle.

BotBrowser remains available as an advanced engine for teams that already have `.enc` fingerprint templates.

Current BotBrowser profile fields:

```ts
engine: "botbrowser";
browser: "botbrowser";
botbrowser_config: {
  executable_path?: string;
  bot_profile_asset_id?: string;
  bot_profile_path?: string;
  extra_args?: string[];
  locale?: string;
  timezone?: string;
  languages?: string;
  noise_seed?: number;
  local_dns?: boolean;
  port_protection?: boolean;
};
```

Current launch arguments include:

```text
--user-data-dir={localProfileDir}
--bot-profile={localEncPath}
--remote-debugging-address=127.0.0.1
--remote-debugging-port={port}
--disable-blink-features=AutomationControlled
--no-first-run
--restore-last-session
--proxy-server={proxyUrl}
--bot-title={profile.name}
```

Current executable behavior:

- macOS auto-detects common Chromium locations such as `/Applications/Chromium.app/Contents/MacOS/Chromium`.
- Windows users can provide an executable path in the UI.
- Linux/server-worker launch is not the target of this MVP.

Current proxy behavior:

- Donut proxy settings are converted into BotBrowser `--proxy-server=scheme://user:pass@host:port`.
- HTTP, SOCKS5, and SOCKS5H are covered in the test plan.

## Preflight Features

Before launching a shared profile, the client runs `team_preflight_botbrowser_profile(profileId)`. The command name is kept for compatibility, but the checks now cover both Wayfern/Chromium and BotBrowser profiles.

Current checks:

| Check | Meaning |
| --- | --- |
| Self-hosted login | The user is logged into the self-hosted server. |
| Permission | The user is `admin`, `owner`, or `editor`. |
| Browser runtime | The Wayfern/Chromium runtime is available, or the BotBrowser executable path is valid. |
| Fingerprint data | Wayfern/Chromium has synced fingerprint metadata; BotBrowser has a local or downloadable `.enc` template. |
| Lock | The profile is not locked by another user. |

The UI shows readable pass or fail results before launch.

## Locking And Sync Features

The current version uses one writer lock per profile.

Launch and sync sequence:

```text
User clicks launch
Client checks permission
Client acquires profile lock
Client downloads latest profile state
Client downloads BotBrowser .enc template if missing
Client launches BotBrowser or Chromium
Client sends lock heartbeat while browser is running
Browser exits
Client waits for profile files to become stable
Client syncs local profile changes while still holding the lock
Client releases lock
```

Current lock behavior:

- Default lock duration is 30 minutes.
- Client heartbeat keeps the lock alive.
- Another user receives conflict while a profile is actively locked.
- Admin can force unlock.
- Stale locks can expire and then be acquired again.

Current close-sync behavior:

- After BotBrowser exits, the client waits for profile files to stabilize before upload.
- Stability means two consecutive samples of file size and modified time do not change.
- The wait covers common Chromium storage files, including SQLite/WAL, LocalStorage, Cookies, and related profile files.
- Maximum wait is 5 seconds.
- On timeout, the client still attempts sync and records a warning.
- If sync fails, the lock is still released and the local cache remains available for later retry.

## Deployment Features

Current supported deployment path:

- Docker Compose on a self-managed server.
- Postgres 16.
- MinIO S3-compatible object storage.
- `donut-sync` Node service.
- Nginx, Caddy, or Baota-managed Nginx for HTTPS.

Current recommended public endpoints:

```text
https://sync.example.com -> donut-sync API
https://s3.example.com   -> MinIO S3 API
```

Current Baota-compatible deployment behavior:

- Baota can keep control of public `80/443`.
- Docker services bind to local ports such as `127.0.0.1:12342`, `127.0.0.1:8987`, and `127.0.0.1:8988`.
- Postgres stays on the Docker network only.
- MinIO S3 API is exposed through HTTPS reverse proxy only when clients need presigned URL access.

Current Cloudflare guidance:

- DNS-only records are recommended for first deployment.
- Cloudflare can be used for DNS, HTTPS, WAF, Tunnel, and optionally R2.
- Full Workers + D1 migration is not part of this version.

## Current Deployed Server

The internal deployed server currently represents the server-side part of this MVP. The real domain, IP, panel URL, usernames, and passwords must stay outside this repository.

Documented public shape:

```text
https://sync.<team-domain> -> donut-sync API
https://s3.<team-domain>   -> MinIO S3 API
```

Verified on 2026-05-20:

```text
/health -> {"status":"ok"}
/readyz -> {"status":"ready","s3":true}
```

What the deployed server can do now:

- Serve the self-hosted team sync API over HTTPS.
- Store authoritative team profile metadata in Postgres.
- Store profile files, manifests, tombstones, and BotBrowser `.enc` templates in S3-compatible object storage.
- Use JWT team login when `MULTI_USER_ENABLED=true`.
- Support the bootstrapped admin account.
- Let admins create, disable, enable, and update users.
- Let admins upload BotBrowser `.enc` templates and block deleting templates that live profiles still reference.
- Let users and admins create default Wayfern/Chromium team profiles without uploading `.enc` templates.
- Let users and admins create advanced BotBrowser team profiles when a `.enc` template is available.
- Let admins and owners assign `owner`, `editor`, and `viewer` permissions.
- Enforce viewer read-only behavior.
- Enforce lock, heartbeat, upload-with-lock, conflict, unlock, and admin force-unlock behavior.
- Generate presigned upload and download URLs for desktop clients.
- Write audit logs for login, user, template, profile, permission, lock, and important object sync actions.
- Expose enough API surface for the current desktop app's `Team Admin` and `Shared Profiles` flows.
- Serve a lightweight `/admin` Web Admin page for bootstrap and fallback management after this version is deployed.

What the deployed server does not do by itself:

- It does not run BotBrowser or Chromium on the server.
- It does not stream browser screens through a web page.
- It does not automatically create real BotBrowser `.enc` templates; an admin must upload them.
- It does not replace the Mac or Windows desktop app.
- It does not provide signed Mac or Windows installers.
- It does not remove the need for each user to have a compatible local BotBrowser or Chromium executable.

Practical meaning:

- The deployed backend is ready for API-level team tests.
- Real team usage still needs the matching desktop client build installed on each user's machine.
- Real profile reuse still needs a real BotBrowser `.enc` template and a manual A/B desktop acceptance test.

## Desktop Packaging Status

Current macOS status:

- Apple Silicon internal `.dmg` can be built.
- An ad-hoc signed internal test `.dmg` exists locally under `release-artifacts/`.
- The artifact is intentionally ignored by Git.
- It is not Developer ID signed and not notarized.
- Users may need right-click `Open` or remove quarantine for internal testing.

Current Windows status:

- Windows installer build commands are documented.
- A real Windows `.exe` or `.msi` should be built on a Windows machine or Windows CI runner.
- Unsigned Windows builds can trigger Microsoft Defender SmartScreen.
- Windows needs a separate manual acceptance pass for executable path, launch arguments, close-sync, and path errors.

## Automated Test Coverage

Current automated checks include:

- `pnpm format`
- `pnpm lint`
- `pnpm test`
- `pnpm test:team-product`
- Rust unit tests for team materialization, preflight behavior, and file stability waiting.
- Product-level black-box API tests against a running self-hosted stack.

Current product test coverage includes:

- Health and readiness.
- Admin login and `/v1/me`.
- User create/list/update/disable.
- Non-admin admin API rejection.
- BotBrowser template upload/list/delete rules.
- Team profile create/list/get/update/delete.
- Profile permission grant and removal.
- Viewer read-only behavior.
- Editor lock and upload behavior.
- Lock conflict, heartbeat, unlock, and admin force unlock.
- Disabled user old token rejection.
- Audit log filtering.
- Shared profile materialization.
- Preflight failures for permission, browser runtime/fingerprint data, and lock conflict.

## Manual Acceptance Still Required

The following require real desktop/browser testing:

- Real Wayfern/Chromium runtime on macOS.
- Real BotBrowser executable and `.enc` template for advanced BotBrowser-only acceptance.
- A/B user flow with shared login state.
- Browser close followed by cookie/local storage sync.
- Second machine or clean user environment downloading the same shared profile.
- Windows executable path selection and Windows process behavior.
- Signed and notarized Mac release flow.
- Signed Windows installer flow.

## Known Limitations

Current limitations are intentional for the MVP:

- No polished standalone Web admin console. The server `/admin` page is a lightweight bootstrap and fallback tool; the main admin surface is still Donut Desktop `Team Admin`.
- No browser screen streaming.
- No remote browser execution on the server.
- No real-time collaborative editing of one profile.
- No one-click member launch for Camoufox team profiles.
- No public-grade signed Mac or Windows installer yet.
- No automatic backup and restore UI.
- No organization-level SSO.
- No per-profile storage quota UI.
- No built-in `.enc` generator for advanced BotBrowser profiles. The default Wayfern/Chromium team flow does not require `.enc`.

## Shortest Usable Path

For an internal team test:

1. Deploy `donut-sync`, Postgres, and MinIO with Docker Compose.
2. Configure HTTPS for `sync.example.com` and `s3.example.com`.
3. Build or install the desktop client on each user's machine.
4. Admin logs in through self-hosted sync.
5. Admin creates users.
6. Admin or owner creates a Wayfern/Chromium team profile from `Create Profile`.
7. Admin grants another user `editor`.
8. The second user opens `Shared Profiles`, adds the profile locally, runs preflight, and launches it.
9. Validate lock conflict, close-sync, and shared login state.
