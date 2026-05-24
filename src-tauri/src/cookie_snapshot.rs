//! Versioned cookie snapshots — file-level copies of a profile's cookie
//! database that the user can roll back to later.
//!
//! Why a separate module from `cookie_manager`: snapshots are an
//! orthogonal concern (backup/restore) and operate at the SQLite-file
//! level. They don't need to understand cookie schemas, encryption keys,
//! or domain grouping. Keeping the snapshot logic isolated also keeps
//! the cookie_manager file (already ~600 lines) from growing further.
//!
//! Storage layout:
//!   {app_data}/cookie_snapshots/{profile_id}/{snapshot_id}.bin   (file)
//!   {app_data}/cookie_snapshots/{profile_id}/{snapshot_id}.meta  (json)
//!
//! The bin file is a byte-for-byte copy of the live cookie SQLite, and
//! the meta sidecar carries the user-visible label + timestamp + size.
//! Splitting the metadata out keeps `list_snapshots` cheap (no need to
//! open SQLite to render a row) and lets a future commit add fields
//! without invalidating older snapshots.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::profile::types::BrowserProfile;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CookieSnapshot {
  pub id: String,
  pub profile_id: String,
  pub label: String,
  pub created_at: u64,
  pub size_bytes: u64,
}

fn snapshots_root() -> PathBuf {
  crate::app_dirs::data_dir().join("cookie_snapshots")
}

fn profile_snapshot_dir(profile_id: &str) -> PathBuf {
  snapshots_root().join(profile_id)
}

fn snapshot_paths(profile_id: &str, snapshot_id: &str) -> (PathBuf, PathBuf) {
  let dir = profile_snapshot_dir(profile_id);
  (
    dir.join(format!("{snapshot_id}.bin")),
    dir.join(format!("{snapshot_id}.meta")),
  )
}

fn now_epoch_secs() -> u64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0)
}

fn resolve_live_cookie_path(profile: &BrowserProfile) -> Result<PathBuf, String> {
  let profiles_dir = crate::app_dirs::profiles_dir();
  let profile_data_path = profile.get_profile_data_path(&profiles_dir);
  match profile.browser.as_str() {
    "wayfern" | "cloak" => {
      let default_dir = profile_data_path.join("Default");
      #[cfg(target_os = "windows")]
      let p = default_dir.join("Network").join("Cookies");
      #[cfg(not(target_os = "windows"))]
      let p = default_dir.join("Cookies");
      Ok(p)
    }
    "camoufox" => Ok(profile_data_path.join("cookies.sqlite")),
    other => Err(format!(
      "Unsupported browser '{other}' for cookie snapshots"
    )),
  }
}

/// Validate a user-supplied label and trim it. Labels go into filenames
/// (in metadata only — the snapshot id is generated) and on-screen, so
/// we trim whitespace and refuse empty / control-character payloads.
fn sanitize_label(raw: &str) -> Result<String, String> {
  let trimmed = raw.trim();
  if trimmed.is_empty() {
    return Err("Snapshot label cannot be empty".to_string());
  }
  if trimmed.chars().any(|c| c.is_control()) {
    return Err("Snapshot label contains control characters".to_string());
  }
  if trimmed.len() > 200 {
    return Err("Snapshot label is too long (max 200 chars)".to_string());
  }
  Ok(trimmed.to_string())
}

pub fn take_snapshot_for_profile(
  profile: &BrowserProfile,
  label: &str,
) -> Result<CookieSnapshot, String> {
  let label = sanitize_label(label)?;
  let live_path = resolve_live_cookie_path(profile)?;
  if !live_path.exists() {
    return Err(format!(
      "No cookie database to snapshot at {}",
      live_path.display()
    ));
  }

  let id = format!(
    "snap-{}-{}",
    now_epoch_secs(),
    uuid::Uuid::new_v4().simple()
  );
  let profile_id = profile.id.to_string();
  let dir = profile_snapshot_dir(&profile_id);
  fs::create_dir_all(&dir).map_err(|e| format!("create snapshot dir: {e}"))?;

  let (bin_path, meta_path) = snapshot_paths(&profile_id, &id);
  fs::copy(&live_path, &bin_path).map_err(|e| format!("copy cookie db: {e}"))?;
  let size_bytes = fs::metadata(&bin_path).map(|m| m.len()).unwrap_or(0);

  let snapshot = CookieSnapshot {
    id,
    profile_id,
    label,
    created_at: now_epoch_secs(),
    size_bytes,
  };
  let json =
    serde_json::to_string_pretty(&snapshot).map_err(|e| format!("encode snapshot meta: {e}"))?;
  fs::write(&meta_path, json).map_err(|e| format!("write snapshot meta: {e}"))?;
  Ok(snapshot)
}

pub fn list_snapshots_for_profile(profile_id: &str) -> Result<Vec<CookieSnapshot>, String> {
  let dir = profile_snapshot_dir(profile_id);
  if !dir.exists() {
    return Ok(Vec::new());
  }
  let mut snapshots: Vec<CookieSnapshot> = Vec::new();
  let entries = fs::read_dir(&dir).map_err(|e| format!("read snapshot dir: {e}"))?;
  for entry in entries.flatten() {
    let path = entry.path();
    if path.extension().and_then(|s| s.to_str()) != Some("meta") {
      continue;
    }
    let body = match fs::read_to_string(&path) {
      Ok(s) => s,
      Err(e) => {
        log::warn!("skip unreadable snapshot meta {}: {e}", path.display());
        continue;
      }
    };
    match serde_json::from_str::<CookieSnapshot>(&body) {
      Ok(s) => snapshots.push(s),
      Err(e) => log::warn!("skip malformed snapshot meta {}: {e}", path.display()),
    }
  }
  // Newest first — the UI shows them in reverse chronological order.
  // `Reverse(created_at)` keeps the closure pure and lets clippy use
  // its faster sort_by_key path.
  snapshots.sort_by_key(|s| std::cmp::Reverse(s.created_at));
  Ok(snapshots)
}

pub fn restore_snapshot_for_profile(
  profile: &BrowserProfile,
  snapshot_id: &str,
) -> Result<(), String> {
  let profile_id = profile.id.to_string();
  let (bin_path, meta_path) = snapshot_paths(&profile_id, snapshot_id);
  if !bin_path.exists() || !meta_path.exists() {
    return Err(format!("Snapshot '{snapshot_id}' not found"));
  }
  let live_path = resolve_live_cookie_path(profile)?;
  if let Some(parent) = live_path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create cookie dir: {e}"))?;
  }
  // Safety: before overwriting the live cookie store, take a one-shot
  // "pre-restore" backup so the user can undo if they restored the wrong
  // snapshot. The backup gets the same `take_snapshot_for_profile`
  // treatment so it shows up in the list with a clear label.
  if live_path.exists() {
    let _ = take_snapshot_for_profile(profile, "auto: pre-restore");
  }
  fs::copy(&bin_path, &live_path).map_err(|e| format!("restore cookie db: {e}"))?;
  Ok(())
}

pub fn delete_snapshot(profile_id: &str, snapshot_id: &str) -> Result<bool, String> {
  let (bin_path, meta_path) = snapshot_paths(profile_id, snapshot_id);
  let mut removed = false;
  if bin_path.exists() {
    fs::remove_file(&bin_path).map_err(|e| format!("delete snapshot bin: {e}"))?;
    removed = true;
  }
  if meta_path.exists() {
    fs::remove_file(&meta_path).map_err(|e| format!("delete snapshot meta: {e}"))?;
    removed = true;
  }
  Ok(removed)
}

// ── Tauri commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn take_cookie_snapshot(
  profile: BrowserProfile,
  label: String,
) -> Result<CookieSnapshot, String> {
  take_snapshot_for_profile(&profile, &label)
}

#[tauri::command]
pub async fn list_cookie_snapshots(profile_id: String) -> Result<Vec<CookieSnapshot>, String> {
  list_snapshots_for_profile(&profile_id)
}

#[tauri::command]
pub async fn restore_cookie_snapshot(
  profile: BrowserProfile,
  snapshot_id: String,
) -> Result<(), String> {
  restore_snapshot_for_profile(&profile, &snapshot_id)
}

#[tauri::command]
pub async fn delete_cookie_snapshot(
  profile_id: String,
  snapshot_id: String,
) -> Result<bool, String> {
  delete_snapshot(&profile_id, &snapshot_id)
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
  use super::*;
  use std::path::Path;
  use tempfile::TempDir;

  fn fresh_env() -> (TempDir, crate::app_dirs::TestDirGuard) {
    let temp = TempDir::new().unwrap();
    let guard = crate::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    (temp, guard)
  }

  fn make_profile_with_cookie_file(temp: &Path, browser: &str, body: &[u8]) -> BrowserProfile {
    let profile_id = uuid::Uuid::new_v4();
    let profile_dir = temp.join("profiles").join(profile_id.to_string());
    // For wayfern: data_path/Default/Cookies; for camoufox: data_path/cookies.sqlite.
    // We use the same structure ProfileManager uses (profiles/<id>/data).
    let data_dir = profile_dir.join("profile");
    let cookie_path = match browser {
      "wayfern" | "cloak" => {
        let d = data_dir.join("Default");
        fs::create_dir_all(&d).unwrap();
        d.join("Cookies")
      }
      "camoufox" => {
        fs::create_dir_all(&data_dir).unwrap();
        data_dir.join("cookies.sqlite")
      }
      _ => unreachable!(),
    };
    fs::write(&cookie_path, body).unwrap();
    BrowserProfile {
      id: profile_id,
      name: "test".to_string(),
      browser: browser.to_string(),
      release_type: "stable".to_string(),
      ..BrowserProfile::default()
    }
  }

  #[test]
  fn sanitize_label_rejects_empty_and_control_chars() {
    assert!(sanitize_label("").is_err());
    assert!(sanitize_label("   ").is_err());
    assert!(sanitize_label("bad\nnewline").is_err());
    assert!(sanitize_label("bad\tlabel").is_err());
    assert_eq!(sanitize_label("  ok label  ").unwrap(), "ok label");
  }

  #[test]
  fn sanitize_label_rejects_overly_long_strings() {
    let huge = "x".repeat(201);
    assert!(sanitize_label(&huge).is_err());
    let max = "x".repeat(200);
    assert_eq!(sanitize_label(&max).unwrap().len(), 200);
  }

  #[test]
  fn take_snapshot_persists_metadata_and_bin() {
    let (temp, _g) = fresh_env();
    let profile = make_profile_with_cookie_file(temp.path(), "camoufox", b"hello");
    let snap = take_snapshot_for_profile(&profile, "before login").unwrap();
    assert_eq!(snap.label, "before login");
    assert_eq!(snap.size_bytes, 5);
    let (bin, meta) = snapshot_paths(&snap.profile_id, &snap.id);
    assert!(bin.exists());
    assert!(meta.exists());
    let back = fs::read(&bin).unwrap();
    assert_eq!(back, b"hello");
  }

  #[test]
  fn take_snapshot_fails_when_no_live_db_exists() {
    let (_t, _g) = fresh_env();
    let profile = BrowserProfile {
      id: uuid::Uuid::new_v4(),
      name: "no-db".to_string(),
      browser: "camoufox".to_string(),
      release_type: "stable".to_string(),
      ..BrowserProfile::default()
    };
    let err = take_snapshot_for_profile(&profile, "x").unwrap_err();
    assert!(err.to_lowercase().contains("no cookie database"));
  }

  #[test]
  fn list_snapshots_returns_newest_first() {
    let (temp, _g) = fresh_env();
    let profile = make_profile_with_cookie_file(temp.path(), "camoufox", b"a");
    let first = take_snapshot_for_profile(&profile, "first").unwrap();
    // Force a 1-second tick so the second snapshot has a strictly later
    // timestamp than the first (the id includes the epoch).
    std::thread::sleep(std::time::Duration::from_secs(1));
    fs::write(resolve_live_cookie_path(&profile).unwrap(), b"second body").unwrap();
    let second = take_snapshot_for_profile(&profile, "second").unwrap();

    let listed = list_snapshots_for_profile(&profile.id.to_string()).unwrap();
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].id, second.id);
    assert_eq!(listed[1].id, first.id);
  }

  #[test]
  fn list_snapshots_returns_empty_when_dir_missing() {
    let (_t, _g) = fresh_env();
    let listed = list_snapshots_for_profile(&uuid::Uuid::new_v4().to_string()).unwrap();
    assert!(listed.is_empty());
  }

  #[test]
  fn restore_snapshot_overwrites_live_db() {
    let (temp, _g) = fresh_env();
    let profile = make_profile_with_cookie_file(temp.path(), "camoufox", b"original");
    let snap = take_snapshot_for_profile(&profile, "v1").unwrap();
    // User does something destructive — overwrite the live cookies.
    fs::write(resolve_live_cookie_path(&profile).unwrap(), b"oops broken").unwrap();
    restore_snapshot_for_profile(&profile, &snap.id).unwrap();
    let live = fs::read(resolve_live_cookie_path(&profile).unwrap()).unwrap();
    assert_eq!(live, b"original");
  }

  #[test]
  fn restore_takes_safety_snapshot_of_current_state() {
    let (temp, _g) = fresh_env();
    let profile = make_profile_with_cookie_file(temp.path(), "camoufox", b"v1");
    let snap = take_snapshot_for_profile(&profile, "v1 saved").unwrap();
    fs::write(resolve_live_cookie_path(&profile).unwrap(), b"v2 in-flight").unwrap();
    let before = list_snapshots_for_profile(&profile.id.to_string()).unwrap();
    assert_eq!(before.len(), 1);
    restore_snapshot_for_profile(&profile, &snap.id).unwrap();
    // Restore should have saved v2 first.
    let after = list_snapshots_for_profile(&profile.id.to_string()).unwrap();
    assert_eq!(after.len(), 2);
    assert!(after.iter().any(|s| s.label == "auto: pre-restore"));
  }

  #[test]
  fn restore_rejects_unknown_snapshot_id() {
    let (temp, _g) = fresh_env();
    let profile = make_profile_with_cookie_file(temp.path(), "camoufox", b"x");
    let err = restore_snapshot_for_profile(&profile, "not-real").unwrap_err();
    assert!(err.contains("not-real"));
  }

  #[test]
  fn delete_snapshot_is_idempotent() {
    let (temp, _g) = fresh_env();
    let profile = make_profile_with_cookie_file(temp.path(), "camoufox", b"x");
    let snap = take_snapshot_for_profile(&profile, "v1").unwrap();
    assert!(delete_snapshot(&snap.profile_id, &snap.id).unwrap());
    assert!(!delete_snapshot(&snap.profile_id, &snap.id).unwrap());
    let listed = list_snapshots_for_profile(&snap.profile_id).unwrap();
    assert!(listed.is_empty());
  }

  #[test]
  fn unsupported_browser_returns_clear_error() {
    let (_t, _g) = fresh_env();
    let profile = BrowserProfile {
      id: uuid::Uuid::new_v4(),
      name: "x".to_string(),
      browser: "botbrowser".to_string(),
      release_type: "stable".to_string(),
      ..BrowserProfile::default()
    };
    let err = take_snapshot_for_profile(&profile, "label").unwrap_err();
    assert!(err.to_lowercase().contains("unsupported"));
  }
}
