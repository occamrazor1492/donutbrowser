# Team Self-Hosted Product Test Plan

Languages: [English](./team-product-test-plan.md) | [中文](./team-product-test-plan.zh.md)

This plan is for the team edition: self-hosted `donut-sync`, Postgres, MinIO/S3, Donut Desktop, and BotBrowser.

## Quick Run

Start the local product stack:

```bash
bash scripts/start-team-browser-stack.sh
```

Run the black-box product API suite:

```bash
pnpm test:team-product
```

Use non-default admin credentials or a remote server:

```bash
TEAM_TEST_BASE_URL=https://sync.example.com \
ADMIN_EMAIL=admin@example.com \
ADMIN_PASSWORD='your-password' \
pnpm test:team-product
```

Run the existing regression suite:

```bash
pnpm lint
pnpm test
```

## Automated Product Cases

`scripts/team-product-test.mjs` talks to the running API like a real desktop client. It does not use Nest internals.

| Area | Case | Expected result |
| --- | --- | --- |
| Health | `/health` and `/readyz` | Service is reachable and S3 is ready |
| Auth | Admin login and `/v1/me` | JWT is accepted and returns `mode: "team"` |
| Users | Admin creates A/B/C users and lists users | Created users are visible to admin |
| Admin security | Member calls admin user list | Request is rejected with 403 |
| BotBrowser assets | Admin uploads `.enc` bytes and lists assets through compatibility APIs | Asset is stored under `teams/{teamId}/bot_profiles/{id}.enc` for legacy or advanced BotBrowser records |
| Chromium profile creation | Member A creates a Wayfern/Chromium profile while logged into self-hosted | Profile engine is `wayfern`; sync mode is `Regular`; A receives owner permission; initial metadata/manifest is uploaded |
| Chromium share action | Member A clicks `Share to Team` for an existing local Wayfern profile | Profile is registered as a team profile, sync mode becomes `Regular`, and current local state is uploaded |
| Asset references | Admin deletes a template used by a live profile | Request is rejected with 409 |
| Isolation | Unshared B lists/gets/downloads/uploads/locks A profile | Profile is hidden or rejected with 403 |
| Viewer | Admin grants B viewer | B can read profile metadata; B cannot upload, lock, materialize for launch, or launch |
| Shared list | Admin grants B editor | B's `team_list_profiles` result includes the shared profile |
| Materialize Chromium | B adds shared Wayfern/Chromium profile locally | Local `BrowserProfile` uses the team profile id, `engine: "wayfern"`, browser `wayfern`, and sync mode `Regular` |
| Materialize idempotency | B adds the same shared profile again | Existing local profile metadata is updated; no duplicate profile is created |
| Preflight permission | Viewer runs shared profile preflight | Permission check fails with a readable result |
| Preflight runtime | Editor runs preflight with missing Chromium runtime | The failing check identifies the missing runtime |
| Asset permissions | Viewer tries to upload `bot_profiles/*.enc` | Request is rejected with 403 |
| Lock gate | Editor B uploads before lock | Upload presign is rejected with 403 |
| Editor sync | Editor B locks and uploads metadata through presigned URL | Upload succeeds and `stat` sees the object |
| Lock conflict | Owner A locks while B holds lock | Request is rejected with 409 |
| Preflight lock | B preflights while A holds lock | Lock check fails and launch is blocked before browser startup |
| Lock lifecycle | B heartbeats, unlocks; A locks afterward | Heartbeat, unlock, and takeover succeed |
| Admin unlock | Admin force unlocks another user's lock | Lock is released and another user can acquire it |
| Download/delete | A downloads B's profile upload and deletes it with tombstone | Downloaded bytes match; object is deleted; tombstone is created |
| Permission revoke | Admin removes B permission | B can no longer get the profile |
| Disabled user | Admin disables C | C can no longer log in or reuse an old JWT |
| Soft delete | A deletes profile | Profile disappears from A's list and direct get is rejected |
| Audit | Admin reads and filters audit log | Critical actions are present, action filters work, and user filters narrow results to one actor/target user |

## Manual Desktop Acceptance

These cases require the real Donut Desktop app. The default Chromium flow does not require a `.enc` file; BotBrowser-specific cases are compatibility-only for this MVP.

| Area | Case | Expected result |
| --- | --- | --- |
| Desktop login | Open Donut, configure self-hosted URL, email, password | Login survives app restart |
| Team Admin UI | Admin opens the main Team menu and clicks Team Admin | Users, Wayfern profiles, permissions, locks, and audit logs are manageable in desktop UI |
| Share action | A clicks Share to Team on a local Wayfern profile | Publish dialog explains server authority, sync is enabled, and the profile appears in Team Admin |
| Shared Profiles UI | B opens Team → Shared Profiles | B sees every profile shared with their account, with permission, engine, lock, and local status |
| Shared Chromium add | B clicks Add to local for a Wayfern/Chromium profile | The local profile appears in the main list, keeps the same profile id, and uses sync mode `Regular` |
| Shared unsupported engine | B sees a BotBrowser or Camoufox team profile | UI shows it as not supported for one-click launch |
| Preflight UI | Run preflight from Shared Profiles | Login, permission, browser runtime/fingerprint data, and lock checks are displayed with readable pass/fail text |
| Chromium profile create | Create Wayfern/Chromium profile while logged into self-hosted | Profile appears locally and in team list without selecting a template |
| Launch args | Start shared Wayfern profile | Process uses the shared local profile data dir and normal Wayfern Chromium launch arguments |
| Lock UI | A starts profile; B starts same profile | B sees conflict and cannot start |
| State sync | A logs into a test site, closes browser; B starts after unlock | B sees A's persisted login state |
| Close-time stability | A closes a shared Chromium/BotBrowser profile after writing cookies/local storage | Donut waits for stable profile files before uploading; timeout logs a warning but still attempts sync |
| Cross machine | B signs in on another machine | Profile and `.enc` download into local cache and launch |
| Proxy | Test HTTP, SOCKS5, SOCKS5H proxies | BotBrowser receives valid `--proxy-server` URL and traffic exits through proxy |
| Crash recovery | Kill browser process or app while lock is active | Lock expires or admin can unlock; later launch succeeds |
| Viewer UX | Viewer opens shared profile | Viewer can inspect metadata but cannot launch/write |

## Release Gate

For a product-grade internal release, require all of these before handing it to the team:

1. `pnpm lint` passes.
2. `pnpm test` passes.
3. `pnpm test:team-product` passes against the same server build that users will run.
4. Manual desktop acceptance passes on at least one macOS machine.
5. Cross-machine acceptance passes on a second clean machine or VM.
6. A real BotBrowser `.enc` template is uploaded by admin and downloaded by a non-admin editor.
7. A test profile survives close, re-open, and another user's launch with expected Cookie/LocalStorage state.

## Notes

Set `S3_PUBLIC_ENDPOINT` on deployed servers to the URL that desktop clients can reach. The internal `S3_ENDPOINT` can point at `http://minio:9000`, but presigned URLs must be signed with the public endpoint.
