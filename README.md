<div align="center">
  <img src="assets/logo.png" alt="Donut Browser Logo" width="150">
  <h1>Donut Browser — Internal Fork</h1>
  <strong>Self-hosted anti-detect browser, no cloud subscription</strong>
</div>
<br>

<p align="center">
  <a style="text-decoration: none;" href="https://github.com/zhom/donutbrowser/blob/main/LICENSE" target="_blank">
    <img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License">
  </a>
  <img src="https://img.shields.io/badge/status-internal--use-orange.svg" alt="Internal use">
  <img src="https://img.shields.io/badge/upstream-zhom%2Fdonutbrowser-lightgrey.svg" alt="Upstream">
</p>

<img alt="Donut Browser Preview" src="assets/donut-preview.png" />

---

This is an **internal-use fork** of [zhom/donutbrowser](https://github.com/zhom/donutbrowser) maintained for self-hosted team deployments. It strips every cloud-subscription touchpoint from the upstream build — no commercial trial modal, no cloud control plane, no Pro feature gates — and replaces them with a single self-hosted `donut-sync` server that you run yourself.

If you want the upstream commercial product (paid cloud sync, location proxies, BotBrowser fingerprint tokens), use [zhom/donutbrowser](https://github.com/zhom/donutbrowser) directly. This fork is for teams that prefer to own their own infrastructure end-to-end.

> **AGPL-3.0 notice:** all derivatives (including this fork) must stay open source under the same license. The CloakBrowser Chromium runtime is a separate proprietary asset and is **not** included in this repo or in any binary release — you fetch it yourself (see [Cloak runtime](#cloak-chromium-runtime) below).

## Table of contents

- [What's different from upstream](#whats-different-from-upstream)
- [Features](#features)
- [Quick start (running it)](#quick-start-running-it)
- [Self-hosted `donut-sync` server](#self-hosted-donut-sync-server)
- [Cloak Chromium runtime](#cloak-chromium-runtime)
- [Build the desktop app from source](#build-the-desktop-app-from-source)
- [Technical architecture](#technical-architecture)
- [Development](#development)
- [License](#license)

## What's different from upstream

| Area | Upstream `zhom/donutbrowser` | This fork |
|---|---|---|
| **Cloud control plane** | Paid cloud API for subscription, location proxies, Wayfern token | **Stubbed** — `cloud_auth.rs` returns no-ops, all gating predicates pass. No external HTTP calls. |
| **Commercial trial** | Trial-expiration modal counts down on every launch | **Removed** — `commercial_license.rs`, `commercial-trial-modal.tsx`, 12 i18n keys × 7 locales gone |
| **Pro feature gating** | "PRO" badges on cross-OS profiles, advanced fingerprint fields, encrypted sync, extensions, sync tabs | **Removed** — `crossOsUnlocked` / `syncUnlocked` / `limitedMode` / `canUseEncryption` props ripped from all 12 components; `ProBadge` component deleted |
| **Cloud login** | Device-code OAuth flow against `donutbrowser.com` | **Removed** — `device-code-verify-dialog.tsx` deleted, sync dialog is self-hosted-only |
| **Sync server** | Single shared bearer token, plain file blobs | **JWT + multi-user team mode** by default — Postgres-backed users / teams / permissions / locks / audit log; S3/MinIO for profile bundles |
| **CloakBrowser runtime** | Bundled in private internal builds only | **Not in repo, not in releases** — you drop the [CloakHQ release tarball](https://github.com/CloakHQ/CloakBrowser/releases) into `vendor-private/cloakbrowser/<platform>/` before building |
| **Sync token decryption** | Hard-fails launch if `DONUT_BROWSER_VAULT_PASSWORD` changes between builds | **Self-healing** — corrupt / undecryptable token is logged + discarded, app degrades to "logged out" instead of bricking |
| **Team-lock acquisition on launch** | Hard-fails launch if server is unreachable | **Best-effort** — logs warning, launches locally anyway |
| **Pro-only preflight on launch** | Runs for all sync-enabled engines (Cloak/Wayfern blocked when server disagrees) | **BotBrowser only** — Cloak/Wayfern launch locally without server roundtrip |

In code, the cleanest way to see the diff is `git log --oneline c0d1b8f^..HEAD` — every commit since the fork started has a self-contained explanation in the message body.

## Features

The fork keeps every feature of upstream Donut Browser, just without the commercial gating:

- **Unlimited browser profiles** — each fully isolated with its own fingerprint, cookies, extensions, storage
- **Four engines** — Wayfern (Chromium, default), Cloak (private Chromium with deeper fingerprint patches), Camoufox (Firefox), BotBrowser (legacy compat)
- **Per-profile proxies** — HTTP, HTTPS, SOCKS4, SOCKS5, dynamic URLs, optional WireGuard VPN per profile
- **Self-hosted team sync** — Postgres + S3/MinIO backend, JWT auth, permissions (owner/editor/viewer), profile locks with heartbeat, audit log
- **Local API & MCP** — REST API and [Model Context Protocol](https://modelcontextprotocol.io) server for Claude / automation / custom scripts
- **Profile groups, templates, bulk launch/stop, scheduled tasks, webhooks, cookie snapshots, proxy failover, profile compare** — every optimization from the recent functional pass is in

## Quick start (running it)

You need **two** moving parts:

1. **A self-hosted `donut-sync` server** (Postgres + MinIO + Nest API behind a reverse proxy)
2. **The Donut desktop app** built from this repo (you build it once per platform)

### 1. Start the sync server

```bash
cd donut-sync
cp .env.example .env  # then edit ADMIN_EMAIL / ADMIN_PASSWORD / JWT_SECRET
docker compose up -d
```

The default `docker-compose.yml` runs Postgres + MinIO + the NestJS API bound to `127.0.0.1:12342` and MinIO on `127.0.0.1:8987`. For production you put a reverse proxy (Caddy / Nginx / 宝塔) in front to terminate TLS. Full instructions live in [docs/self-hosting-donut-sync.md](docs/self-hosting-donut-sync.md) and [docs/team-deployment-guide.md](docs/team-deployment-guide.md).

### 2. Build and install the desktop app

```bash
pnpm install
# optional but recommended — bake your own vault password so a rebuild
# doesn't invalidate existing on-disk encrypted tokens
export DONUT_BROWSER_VAULT_PASSWORD="$(openssl rand -hex 32)"
pnpm tauri build
```

The bundled `.app` lands at `src-tauri/target/release/bundle/macos/Donut.app`. On macOS without an Apple Developer ID:

```bash
# ad-hoc sign so Gatekeeper allows local launch
codesign --force --deep --sign - src-tauri/target/release/bundle/macos/Donut.app
cp -R src-tauri/target/release/bundle/macos/Donut.app /Applications/
```

Linux / Windows packaging mirrors upstream — see [docs/team-deployment-guide.md](docs/team-deployment-guide.md).

### 3. Log in from the desktop app

1. Right-side dropdown menu (`···`) → **账户** (Sync Service)
2. **Server URL**: your sync server URL (e.g. `https://sync.example.com`)
3. **Email + Password**: the admin account you set in step 1 — additional users are created from **团队管理** (Team Admin) once logged in
4. **Save** — the team menu (`团队管理` / `共享 Profiles` / `分享 profile`) appears once you're authenticated

## Self-hosted `donut-sync` server

Three components:

```text
┌────────────────────┐    ┌──────────┐    ┌──────────────────────────┐
│ Donut desktop app  │───▶│ donut-   │───▶│ Postgres                 │
│ (macOS / Win / Lx) │    │ sync API │    │  users, teams, profiles, │
└────────────────────┘    │ (NestJS) │    │  permissions, locks,     │
                          │          │    │  audit log               │
                          │  JWT     │    └──────────────────────────┘
                          │  auth    │
                          │          │    ┌──────────────────────────┐
                          └──────────┤───▶│ S3 / MinIO               │
                                     │    │  profile bundles,        │
                                     │    │  Cookie snapshots,       │
                                     │    │  BotBrowser .enc assets, │
                                     │    │  extensions, tombstones  │
                                     │    └──────────────────────────┘
                                     ▼
                              (presigned upload/download URLs
                               so desktop pushes/pulls big
                               blobs directly to S3)
```

Required env vars (full list in [docs/self-hosting-donut-sync.md](docs/self-hosting-donut-sync.md)):

```env
MULTI_USER_ENABLED=true           # team JWT mode (recommended)
DATABASE_URL=postgresql://...
JWT_SECRET=<random 32+ bytes>
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<initial admin password>
S3_ENDPOINT=http://minio:9000     # server-to-S3
S3_PUBLIC_ENDPOINT=https://s3...  # client-to-S3 via presign
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_BUCKET=donut-sync
```

The legacy single-token mode (`MULTI_USER_ENABLED=false` + `SYNC_TOKEN`) still works but team features and the new UI assume JWT mode.

## Cloak Chromium runtime

Cloak is the optional anti-detect Chromium engine. It is **not** included in this repo or in any binary you'd get from this fork — it's a separately-maintained Chromium build.

**Quick path** (macOS Apple Silicon):

```bash
mkdir -p vendor-private/cloakbrowser/macos-aarch64
curl -fL -o /tmp/cloak.tgz \
  https://github.com/CloakHQ/CloakBrowser/releases/download/chromium-v142.0.7444.175/cloakbrowser-darwin-arm64.tar.gz
tar -xzf /tmp/cloak.tgz -C vendor-private/cloakbrowser/macos-aarch64
pnpm tauri build  # the binary gets copied into the .app bundle
```

For other platforms (Intel macOS, Linux x64, Windows x64) check the [CloakHQ releases page](https://github.com/CloakHQ/CloakBrowser/releases) for the matching `cloakbrowser-<platform>.tar.gz`. The platform folder names this fork looks for are:

```text
vendor-private/cloakbrowser/macos-aarch64/   ← Apple Silicon
vendor-private/cloakbrowser/macos-x64/       ← Intel Mac
vendor-private/cloakbrowser/linux-x64/       ← Linux 64-bit
vendor-private/cloakbrowser/windows-x64/     ← Windows 64-bit
```

`vendor-private/` is gitignored — don't commit the binary. If you skip this step Cloak profiles will fail to launch with "CloakBrowser runtime was not found"; Wayfern, Camoufox, BotBrowser profiles are unaffected.

> Note: CloakHQ's public macOS release lags Linux. As of writing, macOS arm64 is on Chromium 142, Linux on 146.

## Build the desktop app from source

```bash
pnpm install                         # JS + Rust deps + Tauri sidecars
pnpm tauri dev                       # hot-reload dev mode
pnpm tauri build                     # release .app / .dmg / .deb / .msi
```

Quality gate before committing (the pre-commit hook runs this automatically):

```bash
pnpm format && pnpm lint && pnpm test
```

Runs typos, biome, `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, the 459-test Rust unit suite, sync e2e (15), integration (15 + 14), and Jest for `donut-sync`. Adding a Tauri command requires at least one frontend `invoke()` call — `test_no_unused_tauri_commands` enforces that.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the upstream contribution flow if you intend to send patches upstream too.

## Technical architecture

Brief — see [docs/architecture.md](docs/architecture.md) for full diagrams + control flow.

- **Frontend**: Next.js 16 (App Router, React 19, Turbopack), Tailwind, biome lint, i18next (en / es / fr / ja / pt / ru / zh). UI in `src/components/`, page entry in `src/app/page.tsx`.
- **Backend**: Tauri 2 (Rust), ~100 Tauri commands registered in `src-tauri/src/lib.rs`. Each browser engine (`browser_runner.rs`, `cloakbrowser.rs`, `wayfern_manager.rs`, `camoufox_manager.rs`, `botbrowser.rs`) handles its own launch flags, fingerprint injection, and profile data path.
- **Sync engine**: `src-tauri/src/sync/engine.rs` runs delta sync (S3 manifests + per-file SHA256), profile-bundle round-trip, encrypted sync (Argon2 + AES-GCM with optional E2E password), scheduled background sync.
- **Team mode**: `src-tauri/src/self_hosted_auth.rs` caches JWT + user JSON, `self_hosted_team.rs` wraps REST calls, `team_lock.rs` manages distributed profile locks with heartbeat. All `CLOUD_AUTH.*` predicates in the rest of the code are stubs that return permissive defaults so the team-mode call sites never have to special-case "no cloud".
- **Vault encryption**: long-lived secrets (sync token, settings) are encrypted at rest with Argon2id + AES-256-GCM using `env!("DONUT_BROWSER_VAULT_PASSWORD")` baked at compile time. `build.rs` now sets `rerun-if-env-changed` so cargo actually rebuilds when the env changes, and `get_sync_token` self-heals if the password drifts (logs, discards, returns `None`).

## Development

- [AGENTS.md](AGENTS.md) (also `CLAUDE.md` — same file) — repository structure, lint rules, theming rules, i18n rules, security guardrails. Read this if you're sending patches.
- [CONTRIBUTING.md](CONTRIBUTING.md) — upstream contribution flow.
- [docs/team-deployment-guide.md](docs/team-deployment-guide.md) / [.zh.md](docs/team-deployment-guide.zh.md) — deployment runbook for VPS + 宝塔 / Caddy / Nginx setups.
- [docs/team-current-feature-overview.md](docs/team-current-feature-overview.md) / [.zh.md](docs/team-current-feature-overview.zh.md) — what the team mode actually does today.
- [docs/team-self-hosted-botbrowser.md](docs/team-self-hosted-botbrowser.md) / [.zh.md](docs/team-self-hosted-botbrowser.zh.md) — BotBrowser-specific runbook (legacy engine).
- [docs/team-product-test-plan.md](docs/team-product-test-plan.md) / [.zh.md](docs/team-product-test-plan.zh.md) — acceptance test plan.

## License

AGPL-3.0 — see [LICENSE](LICENSE). Any derivative must stay open source under the same license. The Cloak Chromium runtime you place under `vendor-private/cloakbrowser/` is a separate artifact governed by its own license from CloakHQ — this repo only knows how to load it.

Upstream Donut Browser is © the original [zhom/donutbrowser](https://github.com/zhom/donutbrowser) authors. This fork doesn't claim ownership of upstream work — only of the changes documented in the commit history since `c0d1b8f`.
