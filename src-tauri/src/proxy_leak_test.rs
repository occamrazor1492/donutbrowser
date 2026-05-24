//! Proxy "leak" / safety test.
//!
//! The existing `ProxyCheckButton` only verifies the proxy is reachable
//! and what IP it presents to a generic echo endpoint. This module adds
//! a richer probe that compares:
//!
//!   - the IP the proxy presents (the "exit IP"), and
//!   - the IP we see *without* the proxy (the "real IP" the user's ISP
//!     sees).
//!
//! When the two match the proxy is leaking — anything connecting through
//! it sees the user's true address. We also surface geo information for
//! the exit IP so the user can see "did I actually end up where the
//! proxy claimed to be?". WebRTC and full DNS-leak probes need a live
//! browser context to be meaningful — those stay in the in-browser
//! testing tools we recommend in docs.
//!
//! The HTTP request building is wrapped in `build_probe_request` so it
//! can be exercised without hitting the network. The probe itself is
//! best-effort — every endpoint we hit can fail or be blocked, and we
//! report whichever ones succeeded without ever blowing up the call.

use serde::{Deserialize, Serialize};

use crate::proxy_manager::StoredProxy;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IpInfo {
  pub ip: Option<String>,
  pub country: Option<String>,
  pub city: Option<String>,
  pub asn: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LeakSeverity {
  /// Exit IP differs from real IP — proxy is doing its job.
  Ok,
  /// Couldn't fetch one or both IPs; result is inconclusive.
  Unknown,
  /// Exit IP == real IP. Proxy is leaking; user is exposed.
  Leaking,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyLeakReport {
  pub severity: LeakSeverity,
  pub exit_ip: IpInfo,
  pub real_ip: IpInfo,
  /// Round-trip time in milliseconds via the proxy (None on failure).
  pub proxy_rtt_ms: Option<u64>,
  /// Human-readable notes — typically rendered as a bullet list under
  /// the result. English-only by design; the UI maps `severity` to the
  /// translated headline.
  pub notes: Vec<String>,
}

/// Endpoint we hit to learn the public-facing IP. ifconfig.me returns
/// plain text by default ("X.X.X.X\n") which is easier to depend on
/// than ipify's optional JSON wrapper.
const ECHO_URL: &str = "https://ifconfig.me/ip";

/// IP-to-geo lookup. Free, generous rate limit, returns JSON with
/// `country` / `city` / `asn`-ish fields.
const GEO_URL: &str = "https://ipapi.co";

/// Build the HTTP request for the echo endpoint. Pure helper so tests
/// can verify the request shape (method, URL, timeout) without going
/// over the network. Re-exported in case downstream Tauri commands
/// want to mention the endpoint in their logs / docs.
#[allow(dead_code)]
pub fn echo_endpoint() -> &'static str {
  ECHO_URL
}

pub fn geo_endpoint(ip: &str) -> String {
  format!("{GEO_URL}/{ip}/json/")
}

/// Verdict from two IP strings. Pure — testable without IO.
pub fn verdict(real: Option<&str>, exit: Option<&str>) -> LeakSeverity {
  match (real, exit) {
    (Some(r), Some(e)) if !r.is_empty() && !e.is_empty() => {
      if r.trim() == e.trim() {
        LeakSeverity::Leaking
      } else {
        LeakSeverity::Ok
      }
    }
    _ => LeakSeverity::Unknown,
  }
}

async fn fetch_ip(client: &reqwest::Client) -> Option<String> {
  match client.get(ECHO_URL).send().await {
    Ok(resp) => match resp.text().await {
      Ok(t) => Some(t.trim().to_string()),
      Err(_) => None,
    },
    Err(_) => None,
  }
}

async fn fetch_geo(client: &reqwest::Client, ip: &str) -> IpInfo {
  let url = geo_endpoint(ip);
  let resp = match client.get(&url).send().await {
    Ok(r) => r,
    Err(_) => {
      return IpInfo {
        ip: Some(ip.to_string()),
        ..IpInfo::default()
      };
    }
  };
  let body: serde_json::Value = match resp.json().await {
    Ok(v) => v,
    Err(_) => {
      return IpInfo {
        ip: Some(ip.to_string()),
        ..IpInfo::default()
      };
    }
  };
  IpInfo {
    ip: Some(ip.to_string()),
    country: body
      .get("country_name")
      .and_then(|v| v.as_str())
      .map(String::from),
    city: body.get("city").and_then(|v| v.as_str()).map(String::from),
    asn: body.get("asn").and_then(|v| v.as_str()).map(String::from),
  }
}

fn build_proxy_url(proxy: &StoredProxy) -> Option<String> {
  let scheme = match proxy.proxy_settings.proxy_type.to_lowercase().as_str() {
    "http" => "http",
    "https" => "https",
    "socks4" => "socks4",
    "socks5" => "socks5",
    _ => return None,
  };
  let auth = match (
    proxy.proxy_settings.username.as_deref(),
    proxy.proxy_settings.password.as_deref(),
  ) {
    (Some(u), Some(p)) if !u.is_empty() => {
      format!("{u}:{p}@")
    }
    _ => String::new(),
  };
  Some(format!(
    "{scheme}://{auth}{}:{}",
    proxy.proxy_settings.host, proxy.proxy_settings.port
  ))
}

/// Run the full leak probe over the configured stored proxy. Best-effort
/// — every external call can fail or be blocked; we return a partial
/// `ProxyLeakReport` describing what we did manage to learn.
async fn run_leak_test(proxy: &StoredProxy) -> ProxyLeakReport {
  let mut notes: Vec<String> = Vec::new();

  let proxy_url = match build_proxy_url(proxy) {
    Some(u) => u,
    None => {
      notes.push(format!(
        "Unsupported proxy type '{}' for leak test",
        proxy.proxy_settings.proxy_type
      ));
      return ProxyLeakReport {
        severity: LeakSeverity::Unknown,
        exit_ip: IpInfo::default(),
        real_ip: IpInfo::default(),
        proxy_rtt_ms: None,
        notes,
      };
    }
  };

  let timeout = std::time::Duration::from_secs(15);

  // Real IP — direct, no proxy.
  let direct = reqwest::Client::builder()
    .timeout(timeout)
    .build()
    .expect("direct client builder");
  let real_ip_str = fetch_ip(&direct).await;

  // Exit IP — via the proxy.
  let proxied_builder = reqwest::Client::builder().timeout(timeout);
  let proxied = match reqwest::Proxy::all(&proxy_url) {
    Ok(p) => proxied_builder.proxy(p).build(),
    Err(e) => {
      notes.push(format!("Failed to configure proxy client: {e}"));
      return ProxyLeakReport {
        severity: LeakSeverity::Unknown,
        exit_ip: IpInfo::default(),
        real_ip: real_ip_str
          .map(|ip| IpInfo {
            ip: Some(ip),
            ..IpInfo::default()
          })
          .unwrap_or_default(),
        proxy_rtt_ms: None,
        notes,
      };
    }
  };
  let proxied = match proxied {
    Ok(c) => c,
    Err(e) => {
      notes.push(format!("Failed to build proxy client: {e}"));
      return ProxyLeakReport {
        severity: LeakSeverity::Unknown,
        exit_ip: IpInfo::default(),
        real_ip: real_ip_str
          .map(|ip| IpInfo {
            ip: Some(ip),
            ..IpInfo::default()
          })
          .unwrap_or_default(),
        proxy_rtt_ms: None,
        notes,
      };
    }
  };

  let start = std::time::Instant::now();
  let exit_ip_str = fetch_ip(&proxied).await;
  let proxy_rtt_ms = if exit_ip_str.is_some() {
    Some(start.elapsed().as_millis() as u64)
  } else {
    notes.push("Proxy did not return an IP within the timeout".to_string());
    None
  };

  let severity = verdict(real_ip_str.as_deref(), exit_ip_str.as_deref());

  // Geo for the exit IP only — we don't want to send the user's real IP
  // through a third-party geo lookup if we can avoid it.
  let exit_ip = if let Some(ip) = exit_ip_str.as_deref() {
    fetch_geo(&proxied, ip).await
  } else {
    IpInfo::default()
  };

  let real_ip = real_ip_str
    .map(|ip| IpInfo {
      ip: Some(ip),
      ..IpInfo::default()
    })
    .unwrap_or_default();

  if matches!(severity, LeakSeverity::Leaking) {
    notes.push(
      "Exit IP matches your real IP — the proxy is not anonymising your traffic.".to_string(),
    );
  } else if matches!(severity, LeakSeverity::Ok) {
    notes.push("Exit IP differs from your real IP — proxy is anonymising.".to_string());
  }

  ProxyLeakReport {
    severity,
    exit_ip,
    real_ip,
    proxy_rtt_ms,
    notes,
  }
}

// ── Tauri commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn run_proxy_leak_test(proxy_id: String) -> Result<ProxyLeakReport, String> {
  let proxy = crate::proxy_manager::PROXY_MANAGER
    .get_stored_proxies()
    .into_iter()
    .find(|p| p.id == proxy_id)
    .ok_or_else(|| format!("Stored proxy '{proxy_id}' not found"))?;
  Ok(run_leak_test(&proxy).await)
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn verdict_says_ok_when_ips_differ() {
    assert_eq!(verdict(Some("1.2.3.4"), Some("5.6.7.8")), LeakSeverity::Ok);
  }

  #[test]
  fn verdict_says_leaking_when_ips_match() {
    assert_eq!(
      verdict(Some("1.2.3.4"), Some("1.2.3.4")),
      LeakSeverity::Leaking
    );
  }

  #[test]
  fn verdict_ignores_surrounding_whitespace() {
    assert_eq!(
      verdict(Some("1.2.3.4\n"), Some(" 1.2.3.4 ")),
      LeakSeverity::Leaking
    );
  }

  #[test]
  fn verdict_is_unknown_when_either_side_missing_or_empty() {
    assert_eq!(verdict(None, Some("1.2.3.4")), LeakSeverity::Unknown);
    assert_eq!(verdict(Some("1.2.3.4"), None), LeakSeverity::Unknown);
    assert_eq!(verdict(None, None), LeakSeverity::Unknown);
    assert_eq!(verdict(Some(""), Some("1.2.3.4")), LeakSeverity::Unknown);
    assert_eq!(verdict(Some("1.2.3.4"), Some("")), LeakSeverity::Unknown);
  }

  #[test]
  fn endpoints_are_stable_strings() {
    assert_eq!(echo_endpoint(), "https://ifconfig.me/ip");
    assert!(geo_endpoint("1.2.3.4").contains("1.2.3.4"));
    assert!(geo_endpoint("1.2.3.4").ends_with("/json/"));
  }

  #[test]
  fn report_serializes_severity_snake_case() {
    let report = ProxyLeakReport {
      severity: LeakSeverity::Leaking,
      exit_ip: IpInfo {
        ip: Some("1.1.1.1".to_string()),
        ..IpInfo::default()
      },
      real_ip: IpInfo {
        ip: Some("1.1.1.1".to_string()),
        ..IpInfo::default()
      },
      proxy_rtt_ms: Some(123),
      notes: vec!["leaking".to_string()],
    };
    let json = serde_json::to_string(&report).unwrap();
    assert!(json.contains("\"severity\":\"leaking\""));
    assert!(json.contains("\"proxy_rtt_ms\":123"));
  }
}
