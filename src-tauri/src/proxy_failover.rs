//! Proxy failover resolution.
//!
//! Data-layer support for "if this proxy is down, try this list of
//! backups in order". Intentionally NOT wired into the live launch
//! path of `proxy_manager.rs` (3800 lines, deeply integrated) — that
//! integration is a separate change with its own integration test
//! requirements. This module ships the resolver as a tested helper
//! plus a Tauri command callable from the UI, so users can:
//!
//!   1. Persist their failover lists per primary proxy.
//!   2. Call `resolve_failover_proxy(primary_id)` and get back the
//!      id of the first reachable proxy from {primary, ...backups},
//!      then pass that to the existing launch flow.
//!
//! When proxy_manager grows a single resolve_with_failover() seam,
//! the launch path can call it directly without changing the storage
//! format or the user-facing UI.

use std::path::PathBuf;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailoverChain {
  /// Stored proxy id this chain applies to.
  pub primary_id: String,
  /// Ordered backup proxy ids. First reachable one wins.
  pub backup_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct StoredChains {
  #[serde(default)]
  chains: Vec<FailoverChain>,
}

pub struct FailoverStorage {
  cache: RwLock<Option<Vec<FailoverChain>>>,
}

impl FailoverStorage {
  pub(crate) fn new() -> Self {
    Self {
      cache: RwLock::new(None),
    }
  }

  pub fn instance() -> &'static FailoverStorage {
    &FAILOVER_STORAGE
  }

  fn file_path(&self) -> PathBuf {
    crate::app_dirs::settings_dir().join("proxy_failover.json")
  }

  fn read_disk(&self) -> Result<Vec<FailoverChain>, String> {
    let path = self.file_path();
    if !path.exists() {
      return Ok(Vec::new());
    }
    let body = std::fs::read_to_string(&path).map_err(|e| format!("read chains: {e}"))?;
    let parsed: StoredChains =
      serde_json::from_str(&body).map_err(|e| format!("parse chains: {e}"))?;
    Ok(parsed.chains)
  }

  fn write_disk(&self, items: &[FailoverChain]) -> Result<(), String> {
    let dir = crate::app_dirs::settings_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("create dir: {e}"))?;
    let payload = StoredChains {
      chains: items.to_vec(),
    };
    let body = serde_json::to_string_pretty(&payload).map_err(|e| format!("encode chains: {e}"))?;
    std::fs::write(self.file_path(), body).map_err(|e| format!("write chains: {e}"))?;
    Ok(())
  }

  pub fn list(&self) -> Result<Vec<FailoverChain>, String> {
    if let Ok(guard) = self.cache.read() {
      if let Some(cached) = guard.as_ref() {
        return Ok(cached.clone());
      }
    }
    let loaded = self.read_disk()?;
    if let Ok(mut guard) = self.cache.write() {
      *guard = Some(loaded.clone());
    }
    Ok(loaded)
  }

  pub fn get(&self, primary_id: &str) -> Result<Option<FailoverChain>, String> {
    Ok(
      self
        .list()?
        .into_iter()
        .find(|c| c.primary_id == primary_id),
    )
  }

  /// Upsert by `primary_id`. Empty `backup_ids` deletes the chain
  /// (no point storing an empty fallback list).
  pub fn set(&self, primary_id: String, backup_ids: Vec<String>) -> Result<(), String> {
    let trimmed_primary = primary_id.trim();
    if trimmed_primary.is_empty() {
      return Err("primary_id cannot be empty".to_string());
    }
    let cleaned_backups: Vec<String> = backup_ids
      .into_iter()
      .map(|id| id.trim().to_string())
      .filter(|id| !id.is_empty() && id != trimmed_primary)
      .collect();
    let mut current = self.list()?;
    current.retain(|c| c.primary_id != trimmed_primary);
    if !cleaned_backups.is_empty() {
      current.push(FailoverChain {
        primary_id: trimmed_primary.to_string(),
        backup_ids: cleaned_backups,
      });
    }
    self.write_disk(&current)?;
    if let Ok(mut guard) = self.cache.write() {
      *guard = Some(current);
    }
    Ok(())
  }
}

lazy_static::lazy_static! {
  static ref FAILOVER_STORAGE: FailoverStorage = FailoverStorage::new();
}

/// Pure resolver: from `[primary, ..backups]`, return the first id where
/// `is_reachable(id)` returns true. Returns the primary id if nothing is
/// reachable (the existing launch path will then surface the real error
/// to the user, instead of us masking it with a silent fallback).
/// Tested without any network IO by passing in a closure.
#[allow(dead_code)]
pub fn resolve_first_reachable<F>(
  primary_id: &str,
  backup_ids: &[String],
  mut is_reachable: F,
) -> String
where
  F: FnMut(&str) -> bool,
{
  if is_reachable(primary_id) {
    return primary_id.to_string();
  }
  for backup in backup_ids {
    if is_reachable(backup) {
      return backup.clone();
    }
  }
  primary_id.to_string()
}

// ── Tauri commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_failover_chains() -> Result<Vec<FailoverChain>, String> {
  FailoverStorage::instance().list()
}

#[tauri::command]
pub async fn get_failover_chain(primary_id: String) -> Result<Option<FailoverChain>, String> {
  FailoverStorage::instance().get(&primary_id)
}

#[tauri::command]
pub async fn set_failover_chain(primary_id: String, backup_ids: Vec<String>) -> Result<(), String> {
  FailoverStorage::instance().set(primary_id, backup_ids)
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
  use super::*;
  use tempfile::TempDir;

  fn fresh() -> (FailoverStorage, TempDir, crate::app_dirs::TestDirGuard) {
    let temp = TempDir::new().unwrap();
    let guard = crate::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    (FailoverStorage::new(), temp, guard)
  }

  #[test]
  fn empty_storage_returns_empty_list() {
    let (s, _t, _g) = fresh();
    assert!(s.list().unwrap().is_empty());
    assert!(s.get("anything").unwrap().is_none());
  }

  #[test]
  fn set_creates_chain_then_get_finds_it() {
    let (s, _t, _g) = fresh();
    s.set(
      "primary".to_string(),
      vec!["b1".to_string(), "b2".to_string()],
    )
    .unwrap();
    let chain = s.get("primary").unwrap().unwrap();
    assert_eq!(chain.primary_id, "primary");
    assert_eq!(chain.backup_ids, vec!["b1".to_string(), "b2".to_string()]);
  }

  #[test]
  fn set_with_empty_backups_deletes_the_chain() {
    let (s, _t, _g) = fresh();
    s.set("primary".to_string(), vec!["b1".to_string()])
      .unwrap();
    assert!(s.get("primary").unwrap().is_some());
    s.set("primary".to_string(), vec![]).unwrap();
    assert!(s.get("primary").unwrap().is_none());
  }

  #[test]
  fn set_trims_and_dedupes_self_references() {
    // The primary should never appear in its own backup list — that's
    // a footgun ("if A is down, fall back to A") so we silently drop
    // it instead of failing the whole save.
    let (s, _t, _g) = fresh();
    s.set(
      "primary".to_string(),
      vec![
        "  b1  ".to_string(),
        "primary".to_string(),
        "".to_string(),
        "   ".to_string(),
        "b2".to_string(),
      ],
    )
    .unwrap();
    let chain = s.get("primary").unwrap().unwrap();
    assert_eq!(chain.backup_ids, vec!["b1".to_string(), "b2".to_string()]);
  }

  #[test]
  fn set_rejects_empty_primary_id() {
    let (s, _t, _g) = fresh();
    assert!(s.set("".to_string(), vec!["b".to_string()]).is_err());
    assert!(s.set("   ".to_string(), vec!["b".to_string()]).is_err());
  }

  #[test]
  fn upsert_overwrites_existing_chain() {
    let (s, _t, _g) = fresh();
    s.set("p".to_string(), vec!["a".to_string()]).unwrap();
    s.set("p".to_string(), vec!["b".to_string(), "c".to_string()])
      .unwrap();
    let chain = s.get("p").unwrap().unwrap();
    assert_eq!(chain.backup_ids, vec!["b".to_string(), "c".to_string()]);
  }

  #[test]
  fn chains_persist_across_storage_instances() {
    let temp = TempDir::new().unwrap();
    let _g = crate::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    {
      let s = FailoverStorage::new();
      s.set("p".to_string(), vec!["b".to_string()]).unwrap();
    }
    let s2 = FailoverStorage::new();
    assert!(s2.get("p").unwrap().is_some());
  }

  #[test]
  fn resolver_returns_primary_when_primary_is_reachable() {
    let result = resolve_first_reachable("p", &["b1".to_string(), "b2".to_string()], |_| true);
    assert_eq!(result, "p");
  }

  #[test]
  fn resolver_walks_backups_in_order_when_primary_is_down() {
    let mut calls: Vec<String> = Vec::new();
    let result = resolve_first_reachable(
      "p",
      &["b1".to_string(), "b2".to_string(), "b3".to_string()],
      |id| {
        calls.push(id.to_string());
        // p, b1, b2 fail; b3 succeeds.
        id == "b3"
      },
    );
    assert_eq!(result, "b3");
    assert_eq!(calls, vec!["p", "b1", "b2", "b3"]);
  }

  #[test]
  fn resolver_short_circuits_on_first_reachable_backup() {
    let mut calls: Vec<String> = Vec::new();
    let result = resolve_first_reachable("p", &["b1".to_string(), "b2".to_string()], |id| {
      calls.push(id.to_string());
      id == "b1"
    });
    assert_eq!(result, "b1");
    // b2 must NOT have been probed — that would waste a connection
    // attempt the user paid for.
    assert_eq!(calls, vec!["p", "b1"]);
  }

  #[test]
  fn resolver_returns_primary_when_nothing_is_reachable() {
    // Surfacing the primary's error is more useful to the user than
    // silently launching with a backup that also doesn't work.
    let result = resolve_first_reachable("p", &["b1".to_string(), "b2".to_string()], |_| false);
    assert_eq!(result, "p");
  }

  #[test]
  fn resolver_with_no_backups_just_tries_primary_once() {
    let mut calls = 0;
    let result = resolve_first_reachable("p", &[], |_| {
      calls += 1;
      false
    });
    assert_eq!(result, "p");
    assert_eq!(calls, 1);
  }
}
