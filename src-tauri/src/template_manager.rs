//! Profile templates.
//!
//! A template is a re-usable bundle of profile configuration (browser engine,
//! fingerprint config, proxy / VPN refs, extension group, tags, note, sync
//! mode, etc.) that can be applied when creating a new profile so the user
//! doesn't have to refill the ~30 fingerprint fields each time.
//!
//! Persistence: a single `templates.json` file in the app settings dir,
//! shaped as `{ templates: [...] }`. We use an in-memory cache for the same
//! reason `SettingsManager` does (the UI lists templates frequently while
//! the user navigates the Create Profile wizard).

use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

use crate::camoufox_manager::CamoufoxConfig;
use crate::profile::types::{BotBrowserConfig, BrowserProfile, CloakConfig, SyncMode};
use crate::wayfern_manager::WayfernConfig;

/// User-visible template. `content` is the subset of profile state that
/// makes sense to copy from one profile to another — process IDs, last
/// launch timestamps, generated salts, and group memberships are
/// intentionally excluded.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileTemplate {
  pub id: String,
  pub name: String,
  #[serde(default)]
  pub description: Option<String>,
  /// Unix epoch seconds when the template was created.
  pub created_at: u64,
  /// Unix epoch seconds of the last update (initially equal to `created_at`).
  pub updated_at: u64,
  pub content: TemplateContent,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TemplateContent {
  pub browser: String,
  #[serde(default)]
  pub engine: Option<String>,
  pub release_type: String,
  #[serde(default)]
  pub camoufox_config: Option<CamoufoxConfig>,
  #[serde(default)]
  pub wayfern_config: Option<WayfernConfig>,
  #[serde(default)]
  pub cloak_config: Option<CloakConfig>,
  #[serde(default)]
  pub botbrowser_config: Option<BotBrowserConfig>,
  #[serde(default)]
  pub proxy_id: Option<String>,
  #[serde(default)]
  pub vpn_id: Option<String>,
  #[serde(default)]
  pub extension_group_id: Option<String>,
  #[serde(default)]
  pub tags: Vec<String>,
  #[serde(default)]
  pub note: Option<String>,
  #[serde(default)]
  pub sync_mode: SyncMode,
  #[serde(default)]
  pub proxy_bypass_rules: Vec<String>,
  #[serde(default)]
  pub dns_blocklist: Option<String>,
  #[serde(default)]
  pub launch_hook: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct StoredTemplates {
  #[serde(default)]
  templates: Vec<ProfileTemplate>,
}

pub struct TemplateManager {
  cache: RwLock<Option<Vec<ProfileTemplate>>>,
}

impl TemplateManager {
  pub(crate) fn new() -> Self {
    Self {
      cache: RwLock::new(None),
    }
  }

  pub fn instance() -> &'static TemplateManager {
    &TEMPLATE_MANAGER
  }

  fn file_path(&self) -> PathBuf {
    crate::app_dirs::settings_dir().join("templates.json")
  }

  fn read_disk(&self) -> Result<Vec<ProfileTemplate>, String> {
    let path = self.file_path();
    if !path.exists() {
      return Ok(Vec::new());
    }
    let body = fs::read_to_string(&path).map_err(|e| format!("read templates: {e}"))?;
    let parsed: StoredTemplates =
      serde_json::from_str(&body).map_err(|e| format!("parse templates: {e}"))?;
    Ok(parsed.templates)
  }

  fn write_disk(&self, items: &[ProfileTemplate]) -> Result<(), String> {
    let dir = crate::app_dirs::settings_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("create dir: {e}"))?;
    let payload = StoredTemplates {
      templates: items.to_vec(),
    };
    let body =
      serde_json::to_string_pretty(&payload).map_err(|e| format!("encode templates: {e}"))?;
    fs::write(self.file_path(), body).map_err(|e| format!("write templates: {e}"))?;
    Ok(())
  }

  pub fn list(&self) -> Result<Vec<ProfileTemplate>, String> {
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

  pub fn get(&self, id: &str) -> Result<Option<ProfileTemplate>, String> {
    Ok(self.list()?.into_iter().find(|t| t.id == id))
  }

  /// Insert a new template. Returns the persisted record (with assigned id
  /// and timestamps). The caller can pass a pre-built `content` (e.g. from
  /// `TemplateContent::from_profile`) or any custom configuration.
  pub fn create(
    &self,
    name: String,
    description: Option<String>,
    content: TemplateContent,
  ) -> Result<ProfileTemplate, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
      return Err("Template name cannot be empty".to_string());
    }
    let now = now_epoch_secs();
    let template = ProfileTemplate {
      id: uuid::Uuid::new_v4().to_string(),
      name: trimmed.to_string(),
      description: description
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty()),
      created_at: now,
      updated_at: now,
      content,
    };
    let mut current = self.list()?;
    current.push(template.clone());
    self.write_disk(&current)?;
    if let Ok(mut guard) = self.cache.write() {
      *guard = Some(current);
    }
    Ok(template)
  }

  /// Remove the template with the given id. Returns true if it existed.
  pub fn delete(&self, id: &str) -> Result<bool, String> {
    let mut current = self.list()?;
    let before = current.len();
    current.retain(|t| t.id != id);
    let removed = current.len() != before;
    if removed {
      self.write_disk(&current)?;
      if let Ok(mut guard) = self.cache.write() {
        *guard = Some(current);
      }
    }
    Ok(removed)
  }

  /// Force the next `list()` to re-read disk. Used in tests; also a public
  /// escape hatch if a sync engine ever writes templates from outside.
  #[allow(dead_code)]
  pub fn invalidate_cache(&self) {
    if let Ok(mut guard) = self.cache.write() {
      *guard = None;
    }
  }
}

impl TemplateContent {
  /// Capture the re-usable subset of a profile's configuration. Identity-y
  /// fields (id, name, process_id, last_launch, group_id, sync salts) are
  /// intentionally dropped — those don't make sense to apply to a fresh
  /// profile.
  pub fn from_profile(profile: &BrowserProfile) -> Self {
    Self {
      browser: profile.browser.clone(),
      engine: profile.engine.clone(),
      release_type: profile.release_type.clone(),
      camoufox_config: profile.camoufox_config.clone(),
      wayfern_config: profile.wayfern_config.clone(),
      cloak_config: profile.cloak_config.clone(),
      botbrowser_config: profile.botbrowser_config.clone(),
      proxy_id: profile.proxy_id.clone(),
      vpn_id: profile.vpn_id.clone(),
      extension_group_id: profile.extension_group_id.clone(),
      tags: profile.tags.clone(),
      note: profile.note.clone(),
      sync_mode: profile.sync_mode,
      proxy_bypass_rules: profile.proxy_bypass_rules.clone(),
      dns_blocklist: profile.dns_blocklist.clone(),
      launch_hook: profile.launch_hook.clone(),
    }
  }
}

fn now_epoch_secs() -> u64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0)
}

lazy_static::lazy_static! {
  static ref TEMPLATE_MANAGER: TemplateManager = TemplateManager::new();
}

// ── Tauri commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_profile_templates() -> Result<Vec<ProfileTemplate>, String> {
  TemplateManager::instance().list()
}

#[tauri::command]
pub async fn create_profile_template(
  name: String,
  description: Option<String>,
  content: TemplateContent,
) -> Result<ProfileTemplate, String> {
  TemplateManager::instance().create(name, description, content)
}

#[tauri::command]
pub async fn create_profile_template_from_profile(
  name: String,
  description: Option<String>,
  profile: BrowserProfile,
) -> Result<ProfileTemplate, String> {
  let content = TemplateContent::from_profile(&profile);
  TemplateManager::instance().create(name, description, content)
}

#[tauri::command]
pub async fn delete_profile_template(template_id: String) -> Result<bool, String> {
  TemplateManager::instance().delete(&template_id)
}

#[tauri::command]
pub async fn get_profile_template(template_id: String) -> Result<Option<ProfileTemplate>, String> {
  TemplateManager::instance().get(&template_id)
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
  use super::*;
  use tempfile::TempDir;

  fn fresh_manager() -> (TemplateManager, TempDir, crate::app_dirs::TestDirGuard) {
    let temp = TempDir::new().unwrap();
    let guard = crate::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    (TemplateManager::new(), temp, guard)
  }

  fn sample_content(browser: &str) -> TemplateContent {
    TemplateContent {
      browser: browser.to_string(),
      release_type: "stable".to_string(),
      tags: vec!["work".to_string()],
      note: Some("hello".to_string()),
      ..TemplateContent::default()
    }
  }

  #[test]
  fn list_is_empty_for_fresh_install() {
    let (mgr, _t, _g) = fresh_manager();
    let items = mgr.list().unwrap();
    assert!(items.is_empty());
  }

  #[test]
  fn create_returns_record_with_id_and_timestamps() {
    let (mgr, _t, _g) = fresh_manager();
    let created = mgr
      .create(
        "Default chromium".to_string(),
        None,
        sample_content("wayfern"),
      )
      .unwrap();
    assert!(!created.id.is_empty(), "id must be generated");
    assert_eq!(created.name, "Default chromium");
    assert!(created.created_at > 0);
    assert_eq!(created.created_at, created.updated_at);
  }

  #[test]
  fn create_rejects_empty_or_whitespace_name() {
    let (mgr, _t, _g) = fresh_manager();
    assert!(mgr
      .create("".to_string(), None, sample_content("wayfern"))
      .is_err());
    assert!(mgr
      .create("   ".to_string(), None, sample_content("wayfern"))
      .is_err());
  }

  #[test]
  fn create_trims_whitespace_in_name_and_description() {
    let (mgr, _t, _g) = fresh_manager();
    let created = mgr
      .create(
        "  Padded  ".to_string(),
        Some("   ".to_string()),
        sample_content("wayfern"),
      )
      .unwrap();
    assert_eq!(created.name, "Padded");
    // Whitespace-only description must collapse to None so the UI doesn't
    // render a meaningless blank line.
    assert!(created.description.is_none());
  }

  #[test]
  fn create_then_list_returns_persisted_template() {
    let (mgr, _t, _g) = fresh_manager();
    let created = mgr
      .create("Profile A".to_string(), None, sample_content("camoufox"))
      .unwrap();

    let listed = mgr.list().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, created.id);
    assert_eq!(listed[0].content.browser, "camoufox");
    assert_eq!(listed[0].content.tags, vec!["work".to_string()]);
  }

  #[test]
  fn create_then_get_returns_match() {
    let (mgr, _t, _g) = fresh_manager();
    let created = mgr
      .create("X".to_string(), None, sample_content("cloak"))
      .unwrap();
    let fetched = mgr.get(&created.id).unwrap();
    assert!(fetched.is_some());
    assert_eq!(fetched.unwrap().name, "X");
    assert!(mgr.get("nonexistent").unwrap().is_none());
  }

  #[test]
  fn delete_existing_returns_true_and_removes() {
    let (mgr, _t, _g) = fresh_manager();
    let created = mgr
      .create("X".to_string(), None, sample_content("wayfern"))
      .unwrap();
    assert!(mgr.delete(&created.id).unwrap());
    assert!(mgr.list().unwrap().is_empty());
    // Idempotent: second delete returns false instead of erroring.
    assert!(!mgr.delete(&created.id).unwrap());
  }

  #[test]
  fn templates_persist_across_manager_instances() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::app_dirs::set_test_data_dir(temp.path().to_path_buf());

    {
      let mgr = TemplateManager::new();
      mgr
        .create("Persisted".to_string(), None, sample_content("wayfern"))
        .unwrap();
    }

    // Fresh manager → reads from disk.
    let mgr2 = TemplateManager::new();
    let listed = mgr2.list().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, "Persisted");
  }

  #[test]
  fn list_uses_cache_after_first_read() {
    let (mgr, _t, _g) = fresh_manager();
    mgr
      .create("A".to_string(), None, sample_content("wayfern"))
      .unwrap();

    // Overwrite the file externally with different content; cache must keep
    // serving the original until invalidate_cache() is called.
    let alt = StoredTemplates {
      templates: vec![ProfileTemplate {
        id: "fake".to_string(),
        name: "Overwritten".to_string(),
        description: None,
        created_at: 1,
        updated_at: 1,
        content: TemplateContent::default(),
      }],
    };
    fs::write(mgr.file_path(), serde_json::to_string(&alt).unwrap()).unwrap();

    let cached = mgr.list().unwrap();
    assert_eq!(cached[0].name, "A", "should serve cached value");

    mgr.invalidate_cache();
    let reloaded = mgr.list().unwrap();
    assert_eq!(
      reloaded[0].name, "Overwritten",
      "should re-read after invalidate"
    );
  }

  #[test]
  fn from_profile_drops_identity_fields() {
    let mut profile = BrowserProfile {
      id: uuid::Uuid::new_v4(),
      name: "Should be dropped".to_string(),
      browser: "wayfern".to_string(),
      release_type: "stable".to_string(),
      tags: vec!["a".to_string(), "b".to_string()],
      note: Some("keep me".to_string()),
      ..BrowserProfile::default()
    };
    profile.process_id = Some(12345);
    profile.last_launch = Some(999);
    profile.group_id = Some("group-xyz".to_string());

    let content = TemplateContent::from_profile(&profile);

    // Configurable fields are copied.
    assert_eq!(content.browser, "wayfern");
    assert_eq!(content.release_type, "stable");
    assert_eq!(content.tags, vec!["a".to_string(), "b".to_string()]);
    assert_eq!(content.note.as_deref(), Some("keep me"));

    // Identity-y fields aren't represented at all on TemplateContent — the
    // type itself enforces that they can't leak into a template.
    // (Compile-time guarantee: if someone later adds e.g. `name: String` to
    // TemplateContent, this test will need updating to assert it's empty.)
  }

  #[test]
  fn create_from_profile_via_helper_yields_listable_template() {
    let (mgr, _t, _g) = fresh_manager();
    let profile = BrowserProfile {
      id: uuid::Uuid::new_v4(),
      name: "Original".to_string(),
      browser: "wayfern".to_string(),
      release_type: "stable".to_string(),
      tags: vec!["x".to_string()],
      ..BrowserProfile::default()
    };
    let template = mgr
      .create(
        "Cloned from profile".to_string(),
        Some("desc".to_string()),
        TemplateContent::from_profile(&profile),
      )
      .unwrap();
    assert_eq!(template.content.browser, "wayfern");
    assert_eq!(template.description.as_deref(), Some("desc"));
    assert_eq!(mgr.list().unwrap().len(), 1);
  }
}
