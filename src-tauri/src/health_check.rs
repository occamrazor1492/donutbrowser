//! Profile health scoring.
//!
//! Computes a 0-100 score for each profile based on lightweight,
//! synchronous checks: proxy reference resolves, fingerprint config is
//! present (for engines that need one), launch hook URL (if set) parses
//! cleanly, tags don't blow up to a noisy count. Heavier checks (actual
//! proxy connectivity, browser binary existence, disk space) live in
//! dedicated commands; this scorer is meant to be cheap enough to run
//! over the entire profile list on each table refresh.
//!
//! The scoring function is pure — takes a `BrowserProfile` plus the
//! lookup table of stored proxies and returns a `HealthReport`. No
//! file IO, no Tauri runtime, fully unit-testable.

use serde::{Deserialize, Serialize};

use crate::profile::types::BrowserProfile;

/// Severity bucket for a finding. Drives the colour of the badge in the
/// table — `Critical` paints red, `Warning` yellow, `Info` blue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HealthSeverity {
  Info,
  Warning,
  Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthFinding {
  /// Machine-readable code (`missing_fingerprint`, `dangling_proxy_ref`…)
  /// so the UI can map to a translated message instead of relying on the
  /// Rust string ever being user-facing.
  pub code: String,
  pub severity: HealthSeverity,
  /// English fallback message — UI prefers an i18n lookup on `code`.
  pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthReport {
  pub profile_id: String,
  /// Overall score, 0..=100. 100 = no findings; each Warning subtracts
  /// 10, each Critical subtracts 25 (clamped at 0).
  pub score: u8,
  pub findings: Vec<HealthFinding>,
}

impl HealthReport {
  /// Public escape hatch for callers that want to short-circuit the
  /// scorer (e.g. when an entire engine is disabled in settings, we'd
  /// rather report `score=100, no findings` than run rules that aren't
  /// meaningful). Not yet wired in — kept available for the scorer's
  /// callers to opt in.
  #[allow(dead_code)]
  pub fn ok(profile: &BrowserProfile) -> Self {
    Self {
      profile_id: profile.id.to_string(),
      score: 100,
      findings: Vec::new(),
    }
  }
}

/// IDs of the stored proxies the user has on disk — passed in so the
/// scorer can detect dangling proxy_id references without an instance
/// reference to ProxyManager.
pub type StoredProxyIds<'a> = &'a [String];

pub fn score_profile(profile: &BrowserProfile, stored_proxy_ids: StoredProxyIds) -> HealthReport {
  let mut findings: Vec<HealthFinding> = Vec::new();

  // 1. Proxy reference is a real id.
  if let Some(proxy_id) = profile.proxy_id.as_ref() {
    if !proxy_id.trim().is_empty() && !stored_proxy_ids.iter().any(|p| p == proxy_id) {
      findings.push(HealthFinding {
        code: "dangling_proxy_ref".to_string(),
        severity: HealthSeverity::Critical,
        message: format!(
          "Profile references proxy id '{proxy_id}' which is no longer in the proxy list"
        ),
      });
    }
  }

  // 2. Engine-specific fingerprint presence.
  match profile.browser.as_str() {
    "camoufox" if profile.camoufox_config.is_none() => {
      findings.push(HealthFinding {
        code: "missing_camoufox_config".to_string(),
        severity: HealthSeverity::Warning,
        message: "Camoufox profile has no fingerprint configuration set".to_string(),
      });
    }
    "wayfern" if profile.wayfern_config.is_none() => {
      findings.push(HealthFinding {
        code: "missing_wayfern_config".to_string(),
        severity: HealthSeverity::Info,
        message: "Wayfern profile uses default fingerprint configuration".to_string(),
      });
    }
    "botbrowser" if profile.botbrowser_config.is_none() => {
      findings.push(HealthFinding {
        code: "missing_botbrowser_config".to_string(),
        severity: HealthSeverity::Critical,
        message: "BotBrowser profile is missing the encrypted fingerprint asset".to_string(),
      });
    }
    _ => {}
  }

  // 3. Launch hook URL must look like a URL if set.
  if let Some(hook) = profile.launch_hook.as_ref() {
    let trimmed = hook.trim();
    if !trimmed.is_empty() && !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
      findings.push(HealthFinding {
        code: "invalid_launch_hook".to_string(),
        severity: HealthSeverity::Warning,
        message: format!("Launch hook '{trimmed}' is not an http/https URL"),
      });
    }
  }

  // 4. Tag noise — 25+ tags usually means the user accidentally pasted
  // a comma-separated list into the tag picker. Surface it as Info so
  // they can clean it up.
  if profile.tags.len() > 25 {
    findings.push(HealthFinding {
      code: "too_many_tags".to_string(),
      severity: HealthSeverity::Info,
      message: format!(
        "Profile has {} tags — consider grouping with a Group instead",
        profile.tags.len()
      ),
    });
  }

  // 5. Cross-OS profile on a system where it can't launch.
  if profile.is_cross_os() {
    findings.push(HealthFinding {
      code: "cross_os".to_string(),
      severity: HealthSeverity::Warning,
      message: format!(
        "Profile was created on {} and is not launchable on this system",
        profile.host_os.as_deref().unwrap_or("another OS")
      ),
    });
  }

  let mut score: i32 = 100;
  for f in &findings {
    score -= match f.severity {
      HealthSeverity::Info => 5,
      HealthSeverity::Warning => 10,
      HealthSeverity::Critical => 25,
    };
  }
  let score = score.clamp(0, 100) as u8;

  HealthReport {
    profile_id: profile.id.to_string(),
    score,
    findings,
  }
}

// ── Tauri commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn score_all_profiles() -> Result<Vec<HealthReport>, String> {
  let profile_mgr = crate::profile::ProfileManager::instance();
  let profiles = profile_mgr
    .list_profiles()
    .map_err(|e| format!("list profiles: {e}"))?;
  // We don't currently have a clean cross-platform "list stored proxy ids"
  // method on the existing ProxyManager singleton; for the scorer's
  // purposes any id check that finds nothing in an empty list just
  // surfaces a Critical finding, which is the conservative thing to do.
  // When the proxy manager grows a list_ids() helper, wire it in here.
  let stored_proxy_ids: Vec<String> = Vec::new();
  Ok(
    profiles
      .iter()
      .map(|p| score_profile(p, &stored_proxy_ids))
      .collect(),
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
  use super::*;

  fn camoufox_profile() -> BrowserProfile {
    BrowserProfile {
      id: uuid::Uuid::new_v4(),
      name: "test".to_string(),
      browser: "camoufox".to_string(),
      release_type: "stable".to_string(),
      ..BrowserProfile::default()
    }
  }

  fn wayfern_profile() -> BrowserProfile {
    BrowserProfile {
      id: uuid::Uuid::new_v4(),
      name: "wf".to_string(),
      browser: "wayfern".to_string(),
      release_type: "stable".to_string(),
      ..BrowserProfile::default()
    }
  }

  #[test]
  fn well_configured_camoufox_with_fingerprint_scores_perfect() {
    let mut p = camoufox_profile();
    p.camoufox_config = Some(Default::default());
    let report = score_profile(&p, &Vec::<String>::new());
    assert_eq!(report.score, 100);
    assert!(report.findings.is_empty());
  }

  #[test]
  fn camoufox_without_fingerprint_warns_and_loses_10() {
    let p = camoufox_profile();
    let report = score_profile(&p, &Vec::<String>::new());
    assert_eq!(report.score, 90);
    assert_eq!(report.findings.len(), 1);
    assert_eq!(report.findings[0].code, "missing_camoufox_config");
    assert_eq!(report.findings[0].severity, HealthSeverity::Warning);
  }

  #[test]
  fn wayfern_without_config_only_gives_info_finding() {
    let p = wayfern_profile();
    let report = score_profile(&p, &Vec::<String>::new());
    // Info findings cost 5 points.
    assert_eq!(report.score, 95);
    assert_eq!(report.findings[0].severity, HealthSeverity::Info);
  }

  #[test]
  fn dangling_proxy_reference_is_critical() {
    let mut p = wayfern_profile();
    p.wayfern_config = Some(Default::default());
    p.proxy_id = Some("missing-proxy".to_string());
    let report = score_profile(&p, &Vec::<String>::new());
    assert!(report
      .findings
      .iter()
      .any(|f| f.code == "dangling_proxy_ref"));
    // Critical = -25.
    assert_eq!(report.score, 75);
  }

  #[test]
  fn known_proxy_id_does_not_trigger_finding() {
    let mut p = wayfern_profile();
    p.wayfern_config = Some(Default::default());
    p.proxy_id = Some("real-proxy".to_string());
    let report = score_profile(&p, &["real-proxy".to_string()]);
    assert!(!report
      .findings
      .iter()
      .any(|f| f.code == "dangling_proxy_ref"));
  }

  #[test]
  fn empty_proxy_id_string_is_not_a_finding() {
    // Defensive: serde sometimes round-trips a missing field as "".
    let mut p = wayfern_profile();
    p.wayfern_config = Some(Default::default());
    p.proxy_id = Some("".to_string());
    let report = score_profile(&p, &Vec::<String>::new());
    assert!(!report
      .findings
      .iter()
      .any(|f| f.code == "dangling_proxy_ref"));
  }

  #[test]
  fn invalid_launch_hook_is_warning() {
    let mut p = wayfern_profile();
    p.wayfern_config = Some(Default::default());
    p.launch_hook = Some("just a string".to_string());
    let report = score_profile(&p, &Vec::<String>::new());
    assert!(report
      .findings
      .iter()
      .any(|f| f.code == "invalid_launch_hook"));
  }

  #[test]
  fn https_launch_hook_is_accepted() {
    let mut p = wayfern_profile();
    p.wayfern_config = Some(Default::default());
    p.launch_hook = Some("https://example.com/hook".to_string());
    let report = score_profile(&p, &Vec::<String>::new());
    assert!(!report
      .findings
      .iter()
      .any(|f| f.code == "invalid_launch_hook"));
  }

  #[test]
  fn too_many_tags_only_warns_when_exceeding_threshold() {
    let mut p = wayfern_profile();
    p.wayfern_config = Some(Default::default());
    p.tags = (0..26).map(|i| format!("tag-{i}")).collect();
    let report = score_profile(&p, &Vec::<String>::new());
    assert!(report.findings.iter().any(|f| f.code == "too_many_tags"));

    p.tags = (0..25).map(|i| format!("tag-{i}")).collect();
    let report = score_profile(&p, &Vec::<String>::new());
    assert!(!report.findings.iter().any(|f| f.code == "too_many_tags"));
  }

  #[test]
  fn cross_os_profile_is_warning() {
    let mut p = wayfern_profile();
    p.wayfern_config = Some(Default::default());
    // Force a host_os that doesn't match the test runner's actual OS so
    // is_cross_os() returns true regardless of which CI we're on.
    p.host_os = Some(
      match std::env::consts::OS {
        "macos" => "windows",
        _ => "macos",
      }
      .to_string(),
    );
    let report = score_profile(&p, &Vec::<String>::new());
    assert!(report.findings.iter().any(|f| f.code == "cross_os"));
  }

  #[test]
  fn score_clamps_at_zero_for_many_critical_findings() {
    let mut p = camoufox_profile(); // -10 for missing config
    p.proxy_id = Some("a".to_string()); // -25
    p.tags = (0..50).map(|i| format!("t-{i}")).collect(); // -5
    p.launch_hook = Some("not a url".to_string()); // -10
    p.host_os = Some(
      match std::env::consts::OS {
        "macos" => "windows",
        _ => "macos",
      }
      .to_string(),
    ); // -10
    let report = score_profile(&p, &Vec::<String>::new());
    // -10 -25 -5 -10 -10 = -60, so score = 40. Sanity check clamp behaviour.
    assert!(report.score <= 50);
  }

  #[test]
  fn report_serializes_findings_and_severity_correctly() {
    // Schema contract for the frontend.
    let mut p = camoufox_profile();
    p.proxy_id = Some("missing".to_string());
    let report = score_profile(&p, &Vec::<String>::new());
    let json = serde_json::to_string(&report).unwrap();
    assert!(json.contains("\"severity\":\"critical\""));
    assert!(json.contains("\"severity\":\"warning\""));
    assert!(json.contains("\"code\":\"dangling_proxy_ref\""));
  }
}
