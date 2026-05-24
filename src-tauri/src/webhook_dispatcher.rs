//! Outbound webhook notifications.
//!
//! Lets the user (or an LLM operating the app via MCP) wire profile
//! lifecycle events to an external HTTP endpoint. Fire-and-forget: we
//! never block a profile launch waiting on the webhook to respond, and
//! we never retry — if you need at-least-once delivery, point the URL
//! at a queue / serverless function you control.
//!
//! Configuration lives in the regular `AppSettings` so a backup/restore
//! round-trip carries the webhook URL with it. One URL, fired for every
//! event — finer per-event routing is something a 2.0 design can add
//! once we know which events users actually care about.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
// All variants share the `Profile` prefix on purpose — they all describe
// profile lifecycle events and the prefix matches the dotted event names
// emitted over the wire (`profile.launched` etc.). Clippy's
// enum_variant_names lint would have us strip the prefix, but doing so
// would make the variant identifiers ambiguous (a bare `Launched` could
// be anything).
#[allow(clippy::enum_variant_names)]
pub enum WebhookEvent {
  ProfileLaunched,
  ProfileStopped,
  ProfileSyncFailed,
}

impl WebhookEvent {
  fn as_str(self) -> &'static str {
    match self {
      WebhookEvent::ProfileLaunched => "profile.launched",
      WebhookEvent::ProfileStopped => "profile.stopped",
      WebhookEvent::ProfileSyncFailed => "profile.sync_failed",
    }
  }
}

#[derive(Debug, Clone, Serialize)]
pub struct WebhookPayload {
  pub event: &'static str,
  pub profile_id: String,
  pub profile_name: String,
  pub timestamp_ms: i64,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub extra: Option<serde_json::Value>,
}

static WEBHOOK_URL: OnceLock<std::sync::Mutex<Option<String>>> = OnceLock::new();

fn url_slot() -> &'static std::sync::Mutex<Option<String>> {
  WEBHOOK_URL.get_or_init(|| std::sync::Mutex::new(None))
}

/// Set the outbound URL (or `None` to disable). Persisted by the caller
/// in AppSettings; this function only updates the in-memory copy used
/// by `dispatch`.
pub fn set_url(url: Option<String>) {
  if let Ok(mut guard) = url_slot().lock() {
    *guard = url
      .map(|u| u.trim().to_string())
      .filter(|u| !u.is_empty() && (u.starts_with("http://") || u.starts_with("https://")));
  }
}

pub fn get_url() -> Option<String> {
  url_slot().lock().ok().and_then(|g| g.clone())
}

/// Build a payload struct. Pure — no IO — so tests can assert the
/// shape without touching the network.
pub fn build_payload(
  event: WebhookEvent,
  profile_id: &str,
  profile_name: &str,
  extra: Option<serde_json::Value>,
) -> WebhookPayload {
  WebhookPayload {
    event: event.as_str(),
    profile_id: profile_id.to_string(),
    profile_name: profile_name.to_string(),
    timestamp_ms: chrono::Utc::now().timestamp_millis(),
    extra,
  }
}

/// Fire a POST without waiting for the response. Spawns a detached
/// tokio task so the caller (typically `launch_browser_profile`) is
/// never blocked by webhook latency or failure.
pub fn dispatch(
  event: WebhookEvent,
  profile_id: &str,
  profile_name: &str,
  extra: Option<serde_json::Value>,
) {
  let Some(url) = get_url() else {
    return;
  };
  let payload = build_payload(event, profile_id, profile_name, extra);
  tokio::spawn(async move {
    let client = match reqwest::Client::builder()
      .timeout(std::time::Duration::from_secs(10))
      .build()
    {
      Ok(c) => c,
      Err(e) => {
        log::warn!("[webhook] failed to build client: {e}");
        return;
      }
    };
    match client.post(&url).json(&payload).send().await {
      Ok(resp) => {
        if !resp.status().is_success() {
          log::warn!(
            "[webhook] {} → {}: HTTP {}",
            payload.event,
            url,
            resp.status()
          );
        }
      }
      Err(e) => {
        log::warn!("[webhook] {} → {}: {}", payload.event, url, e);
      }
    }
  });
}

// ── Tauri commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn set_webhook_url(url: Option<String>) -> Result<Option<String>, String> {
  set_url(url);
  Ok(get_url())
}

#[tauri::command]
pub async fn get_webhook_url() -> Result<Option<String>, String> {
  Ok(get_url())
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn build_payload_includes_event_string_and_metadata() {
    let payload = build_payload(WebhookEvent::ProfileLaunched, "p1", "Work", None);
    assert_eq!(payload.event, "profile.launched");
    assert_eq!(payload.profile_id, "p1");
    assert_eq!(payload.profile_name, "Work");
    assert!(payload.timestamp_ms > 0);
    assert!(payload.extra.is_none());
  }

  #[test]
  fn payload_serializes_extra_when_present() {
    let extra = serde_json::json!({ "reason": "test" });
    let payload = build_payload(WebhookEvent::ProfileSyncFailed, "p", "n", Some(extra));
    let json = serde_json::to_string(&payload).unwrap();
    assert!(json.contains("\"event\":\"profile.sync_failed\""));
    assert!(json.contains("\"reason\":\"test\""));
  }

  #[test]
  fn payload_omits_extra_field_when_absent() {
    let payload = build_payload(WebhookEvent::ProfileStopped, "p", "n", None);
    let json = serde_json::to_string(&payload).unwrap();
    assert!(!json.contains("extra"));
  }

  #[test]
  fn set_url_rejects_non_http_schemes() {
    set_url(Some("file:///etc/passwd".to_string()));
    assert!(get_url().is_none());
    set_url(Some("javascript:alert(1)".to_string()));
    assert!(get_url().is_none());
    set_url(Some("https://example.com/hook".to_string()));
    assert_eq!(get_url().as_deref(), Some("https://example.com/hook"));
    set_url(None);
  }

  #[test]
  fn set_url_trims_whitespace_and_rejects_empty() {
    set_url(Some("   ".to_string()));
    assert!(get_url().is_none());
    set_url(Some("  https://e.com/h  ".to_string()));
    assert_eq!(get_url().as_deref(), Some("https://e.com/h"));
    set_url(Some("".to_string()));
    assert!(get_url().is_none());
    set_url(None);
  }

  #[test]
  fn dispatch_with_no_url_set_is_a_noop() {
    // Sanity: no panic when URL is None. We can't easily assert "no
    // network call happened" without a mock; the structure guarantees
    // it because dispatch() short-circuits before spawning.
    set_url(None);
    dispatch(WebhookEvent::ProfileLaunched, "p", "n", None);
  }

  #[test]
  fn webhook_event_serde_matches_documented_strings() {
    // Contract test — these strings are part of the public webhook
    // protocol, so changing them is a breaking change.
    assert_eq!(WebhookEvent::ProfileLaunched.as_str(), "profile.launched");
    assert_eq!(WebhookEvent::ProfileStopped.as_str(), "profile.stopped");
    assert_eq!(
      WebhookEvent::ProfileSyncFailed.as_str(),
      "profile.sync_failed"
    );
  }
}
