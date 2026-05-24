//! Cloud authentication — STUBBED for the internal-use fork.
//!
//! The upstream Donut Browser ships a cloud control plane that handles
//! subscription validation, paid-feature gating, the Wayfern fingerprint
//! token, and location-proxy lookup. This fork doesn't use any of that:
//! authentication runs through `self_hosted_auth.rs` against the
//! self-hosted donut-sync server, and there's no commercial trial /
//! subscription concept.
//!
//! Rather than ripping the ~40 call sites of `CLOUD_AUTH` out across
//! `browser_runner.rs`, `team_lock.rs`, `wayfern_manager.rs`,
//! `mcp_server.rs`, etc., this module keeps the same `CLOUD_AUTH`
//! singleton + the same method names but returns benign no-op values:
//!
//! - `has_active_paid_subscription()` → `true` (gating becomes pass-through)
//! - `is_fingerprint_os_allowed()`     → `true` (no OS allowlist)
//! - `is_logged_in()`                  → `false` (no cloud user)
//! - `get_user()`                      → `None`
//! - `get_wayfern_token()`             → `None`
//!   (Wayfern still works, just without cross-OS fingerprint)
//! - `sync_cloud_proxy()`              → no-op
//! - `is_on_team_plan()`               → `false`
//!
//! This is intentionally a flat data structure (no HTTP client, no
//! disk-backed state) — anyone reading the file can immediately see
//! there's nothing to dig into.

use serde::{Deserialize, Serialize};

/// Compat constants. Not used by the stub, but other modules import
/// them and we keep them to avoid touching every import site. The
/// empty default makes it obvious in logs that no cloud endpoint is
/// configured on internal builds — the sync engine falls back to the
/// self-hosted URL the user configured in Settings → Sync.
#[allow(dead_code)]
pub const CLOUD_API_URL: &str = "";
#[allow(dead_code)]
pub const CLOUD_SYNC_URL: &str = "";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudUser {
  pub id: String,
  pub email: String,
  pub plan: String,
  #[serde(rename = "planPeriod")]
  pub plan_period: Option<String>,
  #[serde(rename = "subscriptionStatus")]
  pub subscription_status: String,
  #[serde(rename = "profileLimit")]
  pub profile_limit: i64,
  #[serde(rename = "cloudProfilesUsed")]
  pub cloud_profiles_used: i64,
  #[serde(rename = "proxyBandwidthLimitMb")]
  pub proxy_bandwidth_limit_mb: i64,
  #[serde(rename = "proxyBandwidthUsedMb")]
  pub proxy_bandwidth_used_mb: i64,
  #[serde(rename = "proxyBandwidthExtraMb", default)]
  pub proxy_bandwidth_extra_mb: i64,
  #[serde(rename = "teamId", default)]
  pub team_id: Option<String>,
  #[serde(rename = "teamName", default)]
  pub team_name: Option<String>,
  #[serde(rename = "teamRole", default)]
  pub team_role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudAuthState {
  pub user: CloudUser,
  pub logged_in_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocationItem {
  pub code: String,
  pub name: String,
}

pub struct CloudAuthManager;

impl CloudAuthManager {
  fn new() -> Self {
    Self
  }

  /// Always true — internal builds don't gate on subscription.
  pub async fn has_active_paid_subscription(&self) -> bool {
    true
  }

  /// Sync variant called from `sync/engine.rs` where holding the
  /// runtime to `.await` isn't available. Same result.
  pub fn has_active_paid_subscription_sync(&self) -> bool {
    true
  }

  /// No-op on internal builds — there's no cloud-side usage counter to
  /// report into. The self-hosted sync server has its own counters.
  pub async fn report_sync_profile_count(&self, _count: i64) -> Result<(), String> {
    Ok(())
  }

  /// Always true — no OS-allowlist enforcement on internal builds.
  pub async fn is_fingerprint_os_allowed(&self, _os: Option<&str>) -> bool {
    true
  }

  /// Always false — there's no cloud user concept on internal builds.
  /// Callers that ask "is cloud logged in?" should see "no" so they
  /// fall through to the self-hosted code path.
  pub async fn is_logged_in(&self) -> bool {
    false
  }

  pub async fn get_user(&self) -> Option<CloudAuthState> {
    None
  }

  pub async fn get_wayfern_token(&self) -> Option<String> {
    None
  }

  /// No-op. The upstream version refreshes a cloud-issued Wayfern
  /// fingerprint token; here Wayfern just runs without one and loses
  /// only the cross-OS fingerprint feature.
  pub async fn request_wayfern_token(&self) -> Result<(), String> {
    Ok(())
  }

  pub async fn get_or_refresh_sync_token(&self) -> Result<Option<String>, String> {
    Ok(None)
  }

  /// No-op — there's no cloud-managed proxy to sync.
  pub async fn sync_cloud_proxy(&self) {}

  /// Internal builds aren't on a "team plan" (that's a cloud
  /// subscription tier, not the self-hosted team feature).
  pub async fn is_on_team_plan(&self) -> bool {
    false
  }

  /// Spawned at startup in `lib.rs`. No-op on the stub — nothing to
  /// refresh.
  #[allow(dead_code)]
  pub async fn start_sync_token_refresh_loop(_app_handle: tauri::AppHandle) {}

  /// Compat shim called from `team_lock.rs` to authenticate cloud-team
  /// REST calls. Always returns `Ok(None)` on internal builds; the
  /// callers already handle the "not logged in" case (they map it to
  /// an error string) so cloud-team locking simply becomes inert.
  /// Self-hosted team locking (`self_hosted_team.rs`) is unaffected.
  pub fn load_access_token() -> Result<Option<String>, String> {
    Ok(None)
  }
}

lazy_static::lazy_static! {
  pub static ref CLOUD_AUTH: CloudAuthManager = CloudAuthManager::new();
}
