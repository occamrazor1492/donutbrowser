# Technical architecture

Languages: [English](./architecture.md) | [中文](./architecture.zh.md)

How this fork actually works under the hood — what runs where, what the data shapes are, what's different from upstream, and where each subsystem lives in the source tree.

If you want a higher-level "what's different from upstream" summary, see [README.md § What's different from upstream](../README.md#whats-different-from-upstream). This doc is the deeper drilldown.

## High-level shape

```text
┌─────────────────────────────────────────────────────────────────┐
│ Donut desktop app  (one process per user, runs locally)         │
│                                                                 │
│ ┌─────────────────────────┐    ┌────────────────────────────┐   │
│ │ Next.js 16 frontend     │◀──▶│ Tauri 2 Rust backend       │   │
│ │  React 19 + Turbopack   │ IPC│  ~100 #[tauri::command]s   │   │
│ │  Tailwind, biome lint   │    │  src-tauri/src/lib.rs      │   │
│ └─────────────────────────┘    └────┬───────────────────────┘   │
│                                     │ spawns                    │
│                                     ▼                           │
│      ┌──────────┬──────────┬──────────┬──────────┐              │
│      │ Wayfern  │ Cloak    │ Camoufox │ BotBrws  │              │
│      │ Chromium │ Chromium │ Firefox  │ Chromium │              │
│      └──────────┴──────────┴──────────┴──────────┘              │
│       (each profile = its own process + user-data-dir)          │
└─────────────────────────────────────────────────────────────────┘
                    │
              REST / WebSocket-ish polling
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│ donut-sync server (you run this on a VPS, see self-hosting doc) │
│                                                                 │
│ ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐  │
│ │ NestJS API   │──▶│ Postgres     │   │ S3 / MinIO           │  │
│ │ JWT auth     │   │ users, teams │◀──│ profile bundles,     │  │
│ │ team admin   │   │ profiles,    │   │ .enc templates,      │  │
│ │ permissions  │   │ permissions, │   │ extensions,          │  │
│ │ profile-lock │   │ locks, audit │   │ tombstones           │  │
│ │ presign URLs │   └──────────────┘   └──────────────────────┘  │
│ └──────────────┘                                                │
└─────────────────────────────────────────────────────────────────┘
```

The desktop app is fully usable offline — every browser engine runs locally and every profile's data lives on the local disk. The sync server is the **authoritative copy** for team-shared profiles, but a single-user setup never needs to talk to it (sync is per-profile opt-in).

## Why this fork removed the cloud control plane

Upstream `zhom/donutbrowser` has a **second** server (`donutbrowser.com`) on top of `donut-sync` that handles:

- subscription validation ("does this user have an active Pro plan?")
- location proxy rentals
- a cloud-issued Wayfern fingerprint token (for cross-OS fingerprinting)
- device-code OAuth login

This fork doesn't run that infrastructure. Instead of removing the ~40 call sites of `CLOUD_AUTH.*` scattered across `browser_runner.rs`, `team_lock.rs`, `wayfern_manager.rs`, `mcp_server.rs`, `sync/engine.rs`, etc., the fork replaces `src-tauri/src/cloud_auth.rs` with a 160-line stub that keeps the same `CLOUD_AUTH` singleton + method names but returns permissive defaults:

| Method | Stub returns | Effect |
|---|---|---|
| `has_active_paid_subscription()` | `true` | Every "is the user paying?" gate becomes pass-through |
| `is_fingerprint_os_allowed(os)` | `true` | No OS allowlist |
| `is_logged_in()` | `false` | "Is the cloud user logged in?" always says no — call sites fall through to the self-hosted code path |
| `get_user()` | `None` | No cloud user to report |
| `get_wayfern_token()` | `None` | Wayfern still works, just without the cross-OS fingerprint feature |
| `sync_cloud_proxy()` | no-op | No cloud-managed proxy to sync |
| `is_on_team_plan()` | `false` | The "team plan" tier doesn't exist here — self-hosted team is a separate concept (see below) |

The point of the stub is **call-site invariance**: nothing else in the codebase had to be edited. The Pro-feature gating UI (badges, blur overlays, encrypted-sync paywall) was a separate sweep — those props (`crossOsUnlocked`, `syncUnlocked`, `limitedMode`, `canUseEncryption`) were ripped from every component because they all read `cloudUser?.plan` and would have been permanently `false` post-stub.

## Browser engines

Four engines live side-by-side. Each one knows how to:

1. Locate its runtime binary
2. Generate launch flags (fingerprint, proxy, user-data-dir)
3. Manage its per-profile data directory

| Engine | Source | Runtime location | Fingerprint mechanism |
|---|---|---|---|
| **Wayfern** | [wayfern.com](https://wayfern.com) Chromium fork | Auto-downloaded into `~/Library/Application Support/DonutBrowser/binaries/wayfern/<version>/Chromium.app` | Per-profile `wayfern_config` — UA, platform, screen size, accept-language, timezone, WebGL, etc. |
| **Cloak** | [github.com/CloakHQ/CloakBrowser](https://github.com/CloakHQ/CloakBrowser) Chromium fork | Bundled at build time from `vendor-private/cloakbrowser/<platform>/Chromium.app` → app bundle `Contents/Resources/resources/cloakbrowser/` | Single `--fingerprint=<seed>` flag → a custom Chromium patch derives every property from a deterministic seed. Seed defaults to a hash of the profile UUID. |
| **Camoufox** | [camoufox.com](https://camoufox.com) Firefox fork | Auto-downloaded under `binaries/camoufox/<version>/Camoufox.app` | Bayesian-network fingerprint generation in `src-tauri/src/camoufox/`; per-profile `camoufox_config` controls OS / locale / WebGL / fonts |
| **BotBrowser** | Legacy Chromium fork — kept for compat only | Per-profile `botbrowser_config.executable_path`, plus `.enc` fingerprint template downloaded from team server | `.enc` template baked at create time on the team server; desktop only consumes it |

**Engine selection happens at profile create time** (`create-profile-dialog.tsx`) and is immutable per profile. The launch path (`browser_runner.rs`) dispatches on `profile.browser` / `profile.engine` to the right per-engine module.

### Cloak vs Wayfern

Both are Chromium forks with anti-detect patches, but the patch surface is different:

- **Wayfern** exposes ~30 individual fingerprint properties as Chromium command-line flags. Public binary, frequent updates.
- **Cloak** exposes one deterministic `--fingerprint=<seed>` flag that the Chromium patch internally expands to a coherent fingerprint. Smaller flag surface, but the binary is harder to acquire (macOS public release lags Linux). Better stealth against fingerprint correlation attacks.

Pick Wayfern unless you specifically need Cloak's stealth profile. Both share the same `chromium-launcher` code path (`src-tauri/src/browser_runner.rs`) and the same proxy / extension / cookie machinery.

## Vault encryption

Some on-disk state needs to be encrypted because it carries credentials:

- `~/.../DonutBrowser/settings/sync_token.dat` — the self-hosted JWT, AES-256-GCM encrypted
- `~/.../DonutBrowser/settings/<various>.enc` — settings secrets (per-feature) using the same scheme

The encryption key is derived (Argon2id) from the compile-time **vault password** baked into the binary:

```rust
// src-tauri/src/settings_manager.rs
fn get_vault_password() -> String {
  env!("DONUT_BROWSER_VAULT_PASSWORD").to_string()
}
```

`build.rs` sets `cargo:rerun-if-env-changed=DONUT_BROWSER_VAULT_PASSWORD` so cargo actually rebuilds when the env changes (this was a real bug in upstream — without that line, cargo cached the old `rustc-env` value and the binary kept using the previous password even after the env var changed).

### Self-healing on password drift

If the vault password changes between builds, every previously-saved encrypted file becomes undecryptable. Upstream propagated the AES error all the way up through `acquire_team_lock_if_needed` and **bricked browser launch** with a useless `Decryption failed` toast. This fork's `get_sync_token`:

1. Tries to decrypt
2. On any "unusable file" condition (bad magic, wrong version, truncated framing, AES failure), logs a warning, **deletes the bad file**, returns `Ok(None)`
3. The caller sees "not logged in" and degrades gracefully — the user is prompted to re-login

`settings_manager::tests::read_sync_token_discards_file_encrypted_with_wrong_vault_password` is the regression test for this.

## Team-mode auth flow

```text
Desktop                         donut-sync                Postgres
  │                                 │                        │
  │── POST /v1/auth/login ─────────▶│                        │
  │   { email, password }           │── SELECT user ────────▶│
  │                                 │◀──── user row ─────────│
  │                                 │── verify bcrypt        │
  │                                 │── sign JWT             │
  │◀── { token, user } ─────────────│                        │
  │                                                          │
  │── store_sync_token(token) ──┐                            │
  │   AES-GCM(vault_password)   │ → settings/sync_token.dat  │
  │   write self_hosted_user.json (plain JSON cache)         │
  │                                                          │
  │── invoke "get_team_locks" ────▶│── SELECT locks ────────▶│
  │   (every team action carries   │                         │
  │    the JWT in Authorization)   │                         │
```

Two on-disk files matter:

- `self_hosted_user.json` — plain JSON cache of `{id, email, role, teamId, ...}` so `cached_user()` is synchronous and never needs to decrypt. Read by `home-header.tsx` to decide whether to show the **团队** menu.
- `sync_token.dat` — encrypted JWT. Read on every authenticated team REST call.

If `self_hosted_user.json` exists but `sync_token.dat` is missing or undecryptable, the app *thinks* the user is logged in (so the team menu shows) but every team REST call fails with 401. The user has to re-login. The self-heal in `get_sync_token` (above) covers this case automatically.

## Profile sync engine

`src-tauri/src/sync/engine.rs` is the largest module in the Rust backend. It runs in the background and handles:

1. **Per-profile manifest sync** — each profile has a `manifest.json` listing every file + SHA256. Sync compares local vs remote, uploads new + changed files via presigned URLs, downloads remote-new files, propagates `tombstones/` for deletions.
2. **Encrypted sync** — optional E2E password (Argon2 + AES-GCM) wraps each file before upload so even the sync server can't read it.
3. **Group + proxy sync** — small JSON blobs uploaded as single objects.
4. **Profile-bundle round-trip** — when sharing a profile to a team, the whole user-data-dir is tarred + uploaded.
5. **Scheduled background sync** — `src-tauri/src/task_scheduler.rs` triggers periodic syncs without user action.

## Profile lock model (team mode)

`src-tauri/src/team_lock.rs` maintains a write-lock per profile so two users can't simultaneously edit the same shared profile.

```text
acquire_team_lock_if_needed(profile)
  │
  ▼ profile is sync-enabled?
  no  ──▶ return Ok(())
  yes
  │
  ▼ user is self-hosted logged in?
  no  ──▶ return Ok(())  (no team to lock against)
  yes
  │
  ▼ self_hosted_team::register_team_profile(profile)
  │   POST/PATCH /v1/team-profiles/{id}
  │   ── on Err: log warning, return Ok(())  ◀── new in this fork
  │
  ▼ acquire_self_hosted_lock(profile)
  │   POST /v1/team-profiles/{id}/lock
  │   ── on Err: log warning, return Ok(())  ◀── new in this fork
  │
  return Ok(())
```

The `── on Err: log warning, return Ok(())` is **new** in this fork. Upstream used `?` for both calls, which meant any team-server problem (DNS down, 5xx, expired token) bricked the local browser launch. Now the launch goes through with a logged warning and sync retries on the next launch.

A held lock heartbeats every 30s. If the desktop process dies, the heartbeat stops, and the next user that tries to launch the profile waits out the lease (~90s) before stealing it. The profile's own filesystem isn't physically locked — this is purely a coordination signal.

## Pro-feature preflight (BotBrowser only)

`src/app/page.tsx` runs a launch-time preflight only for **BotBrowser** profiles:

```ts
if (selfHostedSyncConfigured && profile.sync_mode !== "Disabled" && isBotBrowser) {
  const preflight = await invoke("team_preflight_botbrowser_profile", { profileId });
  if (!preflight.canLaunch) { showErrorToast(...); return; }
}
```

Why only BotBrowser:

- BotBrowser **needs** a server-side `.enc` fingerprint template to launch. Missing template → guaranteed crash. Worth blocking the launch and showing a clear error.
- Cloak / Wayfern / Camoufox are locally self-contained. The team server only stores their config + cookies, never the runtime. Pre-fix this fork also ran the preflight for them, which made launch fail whenever the server had a stale / 404 row for that profile id. Now they go straight to `launch_browser_profile` and the team-lock failure mode (above) is the only sync touchpoint on the hot path.

## Source layout cheatsheet

```text
src/                                # Next.js frontend
├── app/page.tsx                    # entrypoint: orchestrates every dialog + the data table
├── components/                     # ~50 dialogs / UI pieces
│   ├── home-header.tsx             # the team-menu dropdown lives here (controlled by selfHostedUser)
│   ├── sync-config-dialog.tsx      # self-hosted login (this fork: dropped the cloud tab)
│   ├── team-admin-dialog.tsx       # admin: user CRUD, profile permissions
│   ├── team-profiles-dialog.tsx    # shared-profile browser + preflight
│   ├── share-profile-dialog.tsx    # publish a local profile to the team
│   └── profile-data-table.tsx      # the main profile list (currentUserId drives team-lock display)
├── hooks/                          # event-driven React hooks (use-browser-state, use-proxy-events, ...)
├── i18n/locales/                   # en, es, fr, ja, pt, ru, zh — every UI string
└── lib/                            # themes (semantic CSS vars), datetime, toast helpers

src-tauri/                          # Rust / Tauri backend
├── src/
│   ├── lib.rs                      # generate_handler! registration for ~100 Tauri commands
│   ├── cloud_auth.rs               # ★ stubbed in this fork — see "Why this fork removed..." above
│   ├── self_hosted_auth.rs         # JWT login + cached_user() reading self_hosted_user.json
│   ├── self_hosted_team.rs         # team REST wrapper (auth, profile CRUD, preflight, share)
│   ├── team_lock.rs                # distributed write-lock per shared profile
│   ├── browser_runner.rs           # generic launch/kill orchestration
│   ├── browser.rs                  # Browser trait
│   ├── cloakbrowser.rs             # Cloak-specific runtime resolution + launch args
│   ├── wayfern_manager.rs          # Wayfern download + launch
│   ├── camoufox/                   # Bayesian fingerprint generator (own module tree)
│   ├── camoufox_manager.rs         # Camoufox download + launch
│   ├── botbrowser.rs               # BotBrowser launch + .enc template handling
│   ├── profile/                    # profile CRUD (manager.rs, types.rs)
│   ├── proxy_manager.rs            # proxy lifecycle, geo-targeted proxies, dynamic URL resolution
│   ├── proxy_storage.rs            # proxy JSON persistence
│   ├── proxy_server.rs             # local proxy binary (donut-proxy sidecar)
│   ├── sync/                       # the sync engine (engine.rs is the big one)
│   ├── settings_manager.rs         # AES-encrypted on-disk settings, cache, vault-password handling
│   ├── api_server.rs               # local REST API (utoipa + axum)
│   ├── mcp_server.rs               # local MCP protocol server
│   ├── vpn/                        # WireGuard tunnels
│   ├── daemon/                     # background daemon + tray icon
│   ├── webhook_dispatcher.rs       # outbound webhooks for profile lifecycle events
│   ├── backup_manager.rs           # full local backup + restore
│   ├── template_manager.rs         # profile templates
│   ├── cookie_snapshot.rs          # versioned cookie snapshots
│   ├── task_scheduler.rs           # scheduled sync / launch / snapshot
│   ├── proxy_failover.rs           # proxy chain with health-based failover
│   └── ... (and ~20 more — see lib.rs imports)
├── build.rs                        # bakes DONUT_BROWSER_VAULT_PASSWORD + BUILD_VERSION into the binary
└── Cargo.toml

donut-sync/                         # NestJS sync server
├── src/
│   ├── main.ts                     # entrypoint + env validation
│   ├── auth/                       # JWT login, password hashing, admin bootstrap
│   ├── team/                       # team CRUD, profile permissions, locks, audit log
│   ├── sync/                       # manifest sync, presigned URLs, tombstone propagation
│   ├── admin-web.controller.ts     # legacy admin REST (kept for compat)
│   └── config/env-validator.js     # fail-fast on missing critical env (added in this fork)
├── prisma/
│   └── schema.prisma               # source of truth for Postgres schema
└── docker-compose.yml              # postgres + minio + donut-sync stack

docs/                               # this directory
├── architecture.md                 # ← you are here
├── self-hosting-donut-sync.md      # how to run the sync server
├── team-deployment-guide.md|.zh.md # VPS + reverse-proxy walkthrough
├── team-current-feature-overview.md|.zh.md
├── team-self-hosted-botbrowser.md|.zh.md
└── team-product-test-plan.md|.zh.md
```

## Test surface

```text
Rust unit tests              459    `cargo test --lib`
Sync e2e (with real server)   15    `pnpm test:sync-e2e` → spins docker stack + drives sync APIs
Backend integration           15    `pnpm test:integration`
donut-sync Jest               14    `cd donut-sync && pnpm test`
```

Pre-commit hook runs `typos + biome + cargo fmt + cargo clippy --all-targets -- -D warnings + cargo test --lib` on every commit; CI replays the full test grid before merge. There's a meta-test (`test_no_unused_tauri_commands`) that fails the build if you add a `#[tauri::command]` that isn't called from the frontend — every new backend command has to have at least one `invoke()` somewhere in `src/`.

## Further reading

- [README.md](../README.md) — install, quick start, top-level feature list, license
- [self-hosting-donut-sync.md](./self-hosting-donut-sync.md) — sync server setup, env vars, S3 providers, Caddy/Nginx
- [team-deployment-guide.md](./team-deployment-guide.md) ([中文](./team-deployment-guide.zh.md)) — production VPS deployment, 宝塔 panel, HTTPS, Cloak runtime packaging
- [team-current-feature-overview.md](./team-current-feature-overview.md) ([中文](./team-current-feature-overview.zh.md)) — what the team mode actually does today
- [team-self-hosted-botbrowser.md](./team-self-hosted-botbrowser.md) ([中文](./team-self-hosted-botbrowser.zh.md)) — BotBrowser-specific runbook
- [team-product-test-plan.md](./team-product-test-plan.md) ([中文](./team-product-test-plan.zh.md)) — acceptance test plan
- [AGENTS.md](../AGENTS.md) (= `CLAUDE.md`) — repo conventions, lint rules, theming, i18n strictness
