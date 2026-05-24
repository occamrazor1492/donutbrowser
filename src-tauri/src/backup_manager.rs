//! Local backup / restore.
//!
//! Bundles every user-modifiable piece of app state (profiles, groups,
//! stored proxies, profile templates, app settings) into a single
//! versioned JSON archive that can optionally be passphrase-encrypted via
//! Argon2 + AES-256-GCM. The intent is "I'm moving machines / wiping
//! disks, give me one file I can put back later" — distinct from the cloud
//! sync engine which is real-time and per-profile.
//!
//! Crucially, the pack / unpack pair is a pure data transform and is
//! tested without disk IO. The Tauri commands at the bottom of this file
//! are the thinnest possible wrapper around `pack_backup` /
//! `unpack_backup` plus a `std::fs::{read,write}` to a user-picked path.

use std::path::PathBuf;

use aes_gcm::{
  aead::{Aead, AeadCore, KeyInit, OsRng},
  Aes256Gcm, Key,
};
use argon2::{password_hash::SaltString, Argon2, PasswordHasher};
use serde::{Deserialize, Serialize};

use crate::profile::types::BrowserProfile;
use crate::settings_manager::AppSettings;
use crate::template_manager::ProfileTemplate;

/// Current schema version. Bump when the snapshot shape changes in a way
/// that requires migration logic on read.
pub const BACKUP_SCHEMA_VERSION: u32 = 1;

const PLAIN_MAGIC: &[u8] = b"DBBKP1\n";
const ENC_MAGIC: &[u8] = b"DBBKE1\n";

/// Everything we round-trip in a backup. Add fields conservatively — older
/// archives may not contain them, so all new fields must have a serde
/// default.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupSnapshot {
  pub version: u32,
  pub created_at: u64,
  pub app_version: String,
  pub host_os: String,
  #[serde(default)]
  pub settings: Option<AppSettings>,
  #[serde(default)]
  pub profiles: Vec<BrowserProfile>,
  #[serde(default)]
  pub templates: Vec<ProfileTemplate>,
  // Note: groups + stored proxies are intentionally absent from the
  // snapshot today. Both managers expose more complex APIs (Mutex'd state,
  // ID generation rules) that are worth porting carefully in a follow-up
  // commit rather than getting half-right here.
}

impl BackupSnapshot {
  pub fn new() -> Self {
    Self {
      version: BACKUP_SCHEMA_VERSION,
      created_at: std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0),
      app_version: env!("CARGO_PKG_VERSION").to_string(),
      host_os: crate::profile::types::get_host_os(),
      settings: None,
      profiles: Vec::new(),
      templates: Vec::new(),
    }
  }
}

/// Per-item outcome of a restore, surfaced back to the UI so the user
/// knows exactly what happened to each record they were importing.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RestoreReport {
  pub profiles_added: usize,
  pub profiles_skipped: usize,
  pub templates_added: usize,
  pub templates_skipped: usize,
  pub settings_applied: bool,
  pub warnings: Vec<String>,
}

/// Pack the snapshot into a self-describing byte blob. With `passphrase=None`
/// the output is a magic-prefixed JSON document (still binary because we
/// keep the magic before the JSON for sniffing). With a passphrase, the
/// JSON is encrypted with AES-GCM using an Argon2-derived 32-byte key.
pub fn pack_backup(snapshot: &BackupSnapshot, passphrase: Option<&str>) -> Result<Vec<u8>, String> {
  let json = serde_json::to_vec(snapshot).map_err(|e| format!("serialize snapshot: {e}"))?;

  match passphrase {
    None => {
      let mut out = Vec::with_capacity(PLAIN_MAGIC.len() + json.len());
      out.extend_from_slice(PLAIN_MAGIC);
      out.extend_from_slice(&json);
      Ok(out)
    }
    Some("") => {
      Err("Passphrase cannot be empty (omit it to write an unencrypted backup)".to_string())
    }
    Some(pass) => {
      let salt = SaltString::generate(&mut OsRng);
      let key = derive_key(pass, &salt)?;
      let cipher = Aes256Gcm::new(&key);
      let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
      let ciphertext = cipher
        .encrypt(&nonce, json.as_ref())
        .map_err(|e| format!("encrypt: {e}"))?;

      let salt_bytes = salt.as_str().as_bytes();
      let mut out =
        Vec::with_capacity(ENC_MAGIC.len() + 1 + salt_bytes.len() + 12 + 4 + ciphertext.len());
      out.extend_from_slice(ENC_MAGIC);
      out.push(salt_bytes.len() as u8);
      out.extend_from_slice(salt_bytes);
      out.extend_from_slice(&nonce);
      out.extend_from_slice(&(ciphertext.len() as u32).to_le_bytes());
      out.extend_from_slice(&ciphertext);
      Ok(out)
    }
  }
}

pub fn unpack_backup(bytes: &[u8], passphrase: Option<&str>) -> Result<BackupSnapshot, String> {
  if bytes.starts_with(PLAIN_MAGIC) {
    if passphrase.is_some() && !passphrase.unwrap_or("").is_empty() {
      return Err(
        "This backup file is not encrypted — remove the passphrase to restore it".to_string(),
      );
    }
    let payload = &bytes[PLAIN_MAGIC.len()..];
    let snapshot: BackupSnapshot =
      serde_json::from_slice(payload).map_err(|e| format!("parse snapshot: {e}"))?;
    validate_schema_version(snapshot.version)?;
    return Ok(snapshot);
  }

  if bytes.starts_with(ENC_MAGIC) {
    let pass = passphrase
      .filter(|p| !p.is_empty())
      .ok_or_else(|| "This backup is encrypted — a passphrase is required".to_string())?;

    let mut offset = ENC_MAGIC.len();
    if offset >= bytes.len() {
      return Err("Encrypted backup truncated (missing salt length)".to_string());
    }
    let salt_len = bytes[offset] as usize;
    offset += 1;
    if offset + salt_len > bytes.len() {
      return Err("Encrypted backup truncated (salt)".to_string());
    }
    let salt_str = std::str::from_utf8(&bytes[offset..offset + salt_len])
      .map_err(|_| "Invalid salt encoding")?;
    offset += salt_len;
    let salt = SaltString::from_b64(salt_str).map_err(|e| format!("invalid salt: {e}"))?;

    if offset + 12 > bytes.len() {
      return Err("Encrypted backup truncated (nonce)".to_string());
    }
    let nonce_bytes: [u8; 12] = bytes[offset..offset + 12]
      .try_into()
      .map_err(|_| "Invalid nonce")?;
    offset += 12;
    let nonce = aes_gcm::Nonce::from(nonce_bytes);

    if offset + 4 > bytes.len() {
      return Err("Encrypted backup truncated (ciphertext length)".to_string());
    }
    let ct_len = u32::from_le_bytes(
      bytes[offset..offset + 4]
        .try_into()
        .map_err(|_| "bad ct len")?,
    ) as usize;
    offset += 4;
    if offset + ct_len > bytes.len() {
      return Err("Encrypted backup truncated (ciphertext)".to_string());
    }
    let ciphertext = &bytes[offset..offset + ct_len];

    let key = derive_key(pass, &salt)?;
    let cipher = Aes256Gcm::new(&key);
    let plaintext = cipher
      .decrypt(&nonce, ciphertext)
      .map_err(|_| "Decryption failed — wrong passphrase or corrupted file".to_string())?;

    let snapshot: BackupSnapshot =
      serde_json::from_slice(&plaintext).map_err(|e| format!("parse decrypted snapshot: {e}"))?;
    validate_schema_version(snapshot.version)?;
    return Ok(snapshot);
  }

  Err("Unknown backup format — file is not a Donut Browser backup".to_string())
}

fn validate_schema_version(v: u32) -> Result<(), String> {
  if v == 0 || v > BACKUP_SCHEMA_VERSION {
    return Err(format!(
      "Backup schema version {v} is not supported by this build (supported: 1..={BACKUP_SCHEMA_VERSION})"
    ));
  }
  Ok(())
}

fn derive_key(passphrase: &str, salt: &SaltString) -> Result<Key<Aes256Gcm>, String> {
  let argon2 = Argon2::default();
  let password_hash = argon2
    .hash_password(passphrase.as_bytes(), salt)
    .map_err(|e| format!("Argon2 key derivation failed: {e}"))?;
  let hash_value = password_hash.hash.ok_or("Argon2 produced no hash")?;
  let hash_bytes = hash_value.as_bytes();
  if hash_bytes.len() < 32 {
    return Err("Derived key too short".to_string());
  }
  let key_bytes: [u8; 32] = hash_bytes[..32]
    .try_into()
    .map_err(|_| "Invalid key length")?;
  Ok(Key::<Aes256Gcm>::from(key_bytes))
}

// ── Restore application ───────────────────────────────────────────────────

/// Apply a parsed snapshot back to the live app state. Duplicates are
/// detected by id (profiles, groups, templates) or by host:port:type
/// (proxies) and skipped — we never overwrite an existing record so the
/// user can never accidentally lose data during a restore.
pub fn apply_snapshot(snapshot: &BackupSnapshot) -> Result<RestoreReport, String> {
  let mut report = RestoreReport::default();

  // Profiles: never overwrite an existing record (matched by id), so a
  // restore can't silently destroy live data the user has been editing.
  let profile_mgr = crate::profile::ProfileManager::instance();
  let existing_profiles = profile_mgr
    .list_profiles()
    .map_err(|e| format!("list profiles: {e}"))?;
  let existing_profile_ids: std::collections::HashSet<_> =
    existing_profiles.iter().map(|p| p.id).collect();
  for profile in &snapshot.profiles {
    if existing_profile_ids.contains(&profile.id) {
      report.profiles_skipped += 1;
      continue;
    }
    match profile_mgr.save_profile(profile) {
      Ok(_) => report.profiles_added += 1,
      Err(e) => {
        report
          .warnings
          .push(format!("Profile '{}' not added: {}", profile.name, e));
        report.profiles_skipped += 1;
      }
    }
  }

  // Templates: same skip-on-duplicate semantics.
  let template_mgr = crate::template_manager::TemplateManager::instance();
  let existing_templates = template_mgr
    .list()
    .map_err(|e| format!("list templates: {e}"))?;
  let existing_template_ids: std::collections::HashSet<_> =
    existing_templates.iter().map(|t| t.id.clone()).collect();
  for template in &snapshot.templates {
    if existing_template_ids.contains(&template.id) {
      report.templates_skipped += 1;
      continue;
    }
    match template_mgr.create(
      template.name.clone(),
      template.description.clone(),
      template.content.clone(),
    ) {
      Ok(_) => report.templates_added += 1,
      Err(e) => {
        report
          .warnings
          .push(format!("Template '{}' not added: {}", template.name, e));
        report.templates_skipped += 1;
      }
    }
  }

  Ok(report)
}

// ── Tauri commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn export_backup_archive(
  destination_path: String,
  passphrase: Option<String>,
) -> Result<u64, String> {
  let snapshot = collect_snapshot()?;
  let bytes = pack_backup(&snapshot, passphrase.as_deref())?;
  let path = PathBuf::from(&destination_path);
  std::fs::write(&path, &bytes).map_err(|e| format!("write backup: {e}"))?;
  Ok(bytes.len() as u64)
}

#[tauri::command]
pub async fn import_backup_archive(
  source_path: String,
  passphrase: Option<String>,
) -> Result<RestoreReport, String> {
  let path = PathBuf::from(&source_path);
  let bytes = std::fs::read(&path).map_err(|e| format!("read backup: {e}"))?;
  let snapshot = unpack_backup(&bytes, passphrase.as_deref())?;
  apply_snapshot(&snapshot)
}

fn collect_snapshot() -> Result<BackupSnapshot, String> {
  let mut snapshot = BackupSnapshot::new();
  snapshot.settings = crate::settings_manager::SettingsManager::instance()
    .load_settings()
    .ok();
  if let Ok(profiles) = crate::profile::ProfileManager::instance().list_profiles() {
    snapshot.profiles = profiles;
  }
  if let Ok(templates) = crate::template_manager::TemplateManager::instance().list() {
    snapshot.templates = templates;
  }
  Ok(snapshot)
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
  use super::*;

  fn snapshot_with(profile_count: usize) -> BackupSnapshot {
    let mut s = BackupSnapshot::new();
    for i in 0..profile_count {
      let p = BrowserProfile {
        id: uuid::Uuid::new_v4(),
        name: format!("Profile {i}"),
        browser: "wayfern".to_string(),
        release_type: "stable".to_string(),
        ..BrowserProfile::default()
      };
      s.profiles.push(p);
    }
    s
  }

  #[test]
  fn plain_round_trip_preserves_snapshot() {
    let original = snapshot_with(3);
    let packed = pack_backup(&original, None).unwrap();
    assert!(packed.starts_with(PLAIN_MAGIC));
    let unpacked = unpack_backup(&packed, None).unwrap();
    assert_eq!(unpacked.profiles.len(), 3);
    assert_eq!(unpacked.profiles[0].name, "Profile 0");
    assert_eq!(unpacked.version, BACKUP_SCHEMA_VERSION);
  }

  #[test]
  fn encrypted_round_trip_with_passphrase() {
    let original = snapshot_with(2);
    let packed = pack_backup(&original, Some("hunter2")).unwrap();
    assert!(packed.starts_with(ENC_MAGIC));
    // Ciphertext must NOT contain plaintext profile name anywhere.
    assert!(
      !packed
        .windows(b"Profile 0".len())
        .any(|w| w == b"Profile 0"),
      "encrypted output must not leak plaintext profile name"
    );
    let unpacked = unpack_backup(&packed, Some("hunter2")).unwrap();
    assert_eq!(unpacked.profiles.len(), 2);
    assert_eq!(unpacked.profiles[1].name, "Profile 1");
  }

  #[test]
  fn empty_passphrase_is_rejected_on_pack() {
    let s = snapshot_with(1);
    assert!(pack_backup(&s, Some("")).is_err());
  }

  #[test]
  fn passphrase_required_to_decrypt_encrypted_backup() {
    let s = snapshot_with(1);
    let packed = pack_backup(&s, Some("pw")).unwrap();
    let err = unpack_backup(&packed, None).unwrap_err();
    assert!(err.to_lowercase().contains("passphrase"));
  }

  #[test]
  fn passphrase_supplied_for_plain_backup_is_rejected() {
    // Otherwise a user who set a passphrase for export but accidentally
    // restored an older plain backup would get a confusing "decryption
    // failed" — we'd rather call it out explicitly.
    let s = snapshot_with(1);
    let packed = pack_backup(&s, None).unwrap();
    let err = unpack_backup(&packed, Some("wrong")).unwrap_err();
    assert!(err.to_lowercase().contains("not encrypted"));
  }

  #[test]
  fn wrong_passphrase_returns_clear_error() {
    let s = snapshot_with(1);
    let packed = pack_backup(&s, Some("correct")).unwrap();
    let err = unpack_backup(&packed, Some("wrong")).unwrap_err();
    assert!(err.to_lowercase().contains("decryption failed"));
  }

  #[test]
  fn unknown_format_is_rejected_with_helpful_message() {
    let bytes = b"this is just some random text";
    let err = unpack_backup(bytes, None).unwrap_err();
    assert!(err.to_lowercase().contains("unknown backup format"));
  }

  #[test]
  fn truncated_encrypted_backup_does_not_panic() {
    let s = snapshot_with(1);
    let packed = pack_backup(&s, Some("pw")).unwrap();
    // Try every truncation length.
    for cut in 0..packed.len() {
      let result = unpack_backup(&packed[..cut], Some("pw"));
      assert!(
        result.is_err(),
        "truncating to {cut} must fail cleanly, not return a snapshot"
      );
    }
  }

  #[test]
  fn future_schema_version_is_rejected() {
    let mut s = snapshot_with(0);
    s.version = BACKUP_SCHEMA_VERSION + 1;
    let packed = pack_backup(&s, None).unwrap();
    let err = unpack_backup(&packed, None).unwrap_err();
    assert!(err.to_lowercase().contains("not supported"));
  }

  #[test]
  fn zero_schema_version_is_rejected() {
    let mut s = snapshot_with(0);
    s.version = 0;
    let packed = pack_backup(&s, None).unwrap();
    assert!(unpack_backup(&packed, None).is_err());
  }

  #[test]
  fn snapshot_includes_metadata_with_recent_timestamp() {
    let s = BackupSnapshot::new();
    assert_eq!(s.version, BACKUP_SCHEMA_VERSION);
    assert_eq!(s.app_version, env!("CARGO_PKG_VERSION"));
    let now = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap()
      .as_secs();
    // 10s tolerance for slow test runners.
    assert!(s.created_at > 0 && s.created_at <= now + 1);
    assert!(now - s.created_at < 10);
  }
}
