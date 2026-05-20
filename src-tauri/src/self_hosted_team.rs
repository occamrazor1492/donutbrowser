use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{DateTime, Utc};
use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use uuid::Uuid;

use crate::profile::types::{get_host_os, BotBrowserConfig, BrowserProfile, SyncMode};
use crate::settings_manager::SettingsManager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamProfileInput {
  pub id: Option<String>,
  pub name: String,
  pub engine: Option<String>,
  pub bot_profile_asset_id: Option<String>,
  pub sync_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamProfileUpdateInput {
  pub name: Option<String>,
  pub engine: Option<String>,
  pub bot_profile_asset_id: Option<String>,
  pub sync_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamUserInput {
  pub email: String,
  pub password: String,
  pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamUserUpdateInput {
  pub password: Option<String>,
  pub role: Option<String>,
  pub disabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamPermissionInput {
  pub user_id: String,
  pub permission: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamBotProfileUploadInput {
  pub name: String,
  pub file_path: String,
  pub browser_major_version: Option<String>,
  pub platform: Option<String>,
}

struct TeamAuth {
  server_url: String,
  token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamProfilePermissionRecord {
  pub user_id: String,
  pub permission: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamProfileLockRecord {
  pub profile_id: String,
  pub locked_by_user_id: String,
  pub expires_at: String,
  pub heartbeat_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamProfileRecord {
  pub id: String,
  pub team_id: String,
  pub owner_user_id: String,
  pub name: String,
  pub engine: String,
  #[serde(default)]
  pub bot_profile_asset_id: Option<String>,
  #[serde(default)]
  pub sync_mode: Option<String>,
  #[serde(default)]
  pub permissions: Vec<TeamProfilePermissionRecord>,
  #[serde(default)]
  pub bot_profile_asset: Option<Value>,
  #[serde(default)]
  pub lock: Option<TeamProfileLockRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BotBrowserPreflightCheck {
  pub key: String,
  pub status: String,
  pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BotBrowserPreflightResult {
  pub can_launch: bool,
  pub checks: Vec<BotBrowserPreflightCheck>,
}

async fn auth(app_handle: &tauri::AppHandle) -> Result<TeamAuth, String> {
  let manager = SettingsManager::instance();
  let settings = manager
    .get_sync_settings()
    .map_err(|e| format!("Failed to load self-hosted sync settings: {e}"))?;
  let server_url = settings
    .sync_server_url
    .filter(|url| !url.trim().is_empty())
    .ok_or_else(|| "Self-hosted sync is not configured".to_string())?;
  let token = manager
    .get_sync_token(app_handle)
    .await
    .map_err(|e| format!("Failed to load self-hosted token: {e}"))?
    .filter(|token| !token.trim().is_empty())
    .ok_or_else(|| "Self-hosted user is not logged in".to_string())?;

  Ok(TeamAuth {
    server_url: server_url.trim_end_matches('/').to_string(),
    token,
  })
}

async fn team_request(
  app_handle: &tauri::AppHandle,
  method: Method,
  path: &str,
  body: Option<Value>,
) -> Result<Value, String> {
  let auth = auth(app_handle).await?;
  let url = format!("{}/v1/{}", auth.server_url, path.trim_start_matches('/'));
  let client = reqwest::Client::new();
  let mut request = client
    .request(method, url)
    .bearer_auth(auth.token)
    .header("Accept", "application/json");
  if let Some(body) = body {
    request = request.json(&body);
  }
  let response = request
    .send()
    .await
    .map_err(|e| format!("Self-hosted team API is not reachable: {e}"))?;
  let status = response.status();
  let text = response
    .text()
    .await
    .map_err(|e| format!("Failed to read self-hosted team API response: {e}"))?;
  if !status.is_success() {
    return Err(format_team_api_error(status, &text));
  }
  if text.trim().is_empty() {
    return Ok(Value::Null);
  }
  serde_json::from_str(&text)
    .map_err(|e| format!("Failed to parse self-hosted team API response: {e}"))
}

async fn fetch_team_profile(
  app_handle: &tauri::AppHandle,
  profile_id: &str,
) -> Result<TeamProfileRecord, String> {
  let value = team_request(
    app_handle,
    Method::GET,
    &format!("team-profiles/{profile_id}"),
    None,
  )
  .await?;
  serde_json::from_value(value)
    .map_err(|e| format!("Failed to parse self-hosted team profile: {e}"))
}

fn team_profile_permission(
  profile: &TeamProfileRecord,
  user: &crate::self_hosted_auth::SelfHostedUser,
) -> Option<String> {
  if user.role == "admin" {
    return Some("admin".to_string());
  }
  if profile.owner_user_id == user.id {
    return Some("owner".to_string());
  }
  profile
    .permissions
    .iter()
    .find(|permission| permission.user_id == user.id)
    .map(|permission| permission.permission.clone())
}

fn can_launch_permission(permission: Option<&str>) -> bool {
  matches!(permission, Some("admin" | "owner" | "editor"))
}

fn is_locked_by_another(
  profile: &TeamProfileRecord,
  user: &crate::self_hosted_auth::SelfHostedUser,
) -> bool {
  let Some(lock) = &profile.lock else {
    return false;
  };
  if lock.locked_by_user_id == user.id {
    return false;
  }
  DateTime::parse_from_rfc3339(&lock.expires_at)
    .map(|expires_at| expires_at.with_timezone(&Utc) > Utc::now())
    .unwrap_or(true)
}

fn preflight_check(
  key: &str,
  passed: bool,
  message: impl Into<String>,
) -> BotBrowserPreflightCheck {
  BotBrowserPreflightCheck {
    key: key.to_string(),
    status: if passed { "passed" } else { "failed" }.to_string(),
    message: message.into(),
  }
}

fn clean_optional(value: Option<String>) -> Option<String> {
  value.and_then(|value| (!value.trim().is_empty()).then(|| value.trim().to_string()))
}

pub fn build_materialized_botbrowser_profile(
  team_profile: &TeamProfileRecord,
  existing_profile: Option<BrowserProfile>,
  executable_path: Option<String>,
) -> Result<BrowserProfile, String> {
  if team_profile.engine != "botbrowser" {
    return Err("Only BotBrowser team profiles can be added locally in this version".to_string());
  }

  let profile_id = Uuid::parse_str(&team_profile.id)
    .map_err(|e| format!("Invalid team profile id {}: {e}", team_profile.id))?;
  let bot_profile_asset_id = team_profile
    .bot_profile_asset_id
    .as_deref()
    .filter(|value| !value.trim().is_empty())
    .ok_or_else(|| "BotBrowser team profile does not have a .enc template".to_string())?
    .to_string();

  let mut profile = existing_profile.unwrap_or_else(|| BrowserProfile {
    id: profile_id,
    name: team_profile.name.clone(),
    browser: "botbrowser".to_string(),
    engine: Some("botbrowser".to_string()),
    version: "system".to_string(),
    proxy_id: None,
    vpn_id: None,
    launch_hook: None,
    process_id: None,
    last_launch: None,
    release_type: "stable".to_string(),
    camoufox_config: None,
    wayfern_config: None,
    group_id: None,
    tags: Vec::new(),
    note: None,
    sync_mode: SyncMode::Regular,
    encryption_salt: None,
    last_sync: None,
    host_os: Some(get_host_os()),
    ephemeral: false,
    extension_group_id: None,
    proxy_bypass_rules: Vec::new(),
    created_by_id: None,
    created_by_email: None,
    dns_blocklist: None,
    botbrowser_config: None,
  });

  profile.id = profile_id;
  profile.name = team_profile.name.clone();
  profile.browser = "botbrowser".to_string();
  profile.engine = Some("botbrowser".to_string());
  if profile.version.trim().is_empty() {
    profile.version = "system".to_string();
  }
  if profile.release_type.trim().is_empty() {
    profile.release_type = "stable".to_string();
  }
  profile.sync_mode = SyncMode::Regular;
  profile.host_os = Some(get_host_os());
  profile.ephemeral = false;
  profile.camoufox_config = None;
  profile.wayfern_config = None;

  let mut config = profile.botbrowser_config.unwrap_or_default();
  if let Some(executable_path) = clean_optional(executable_path) {
    config.executable_path = Some(executable_path);
  } else {
    config.executable_path = clean_optional(config.executable_path);
  }
  config.bot_profile_asset_id = Some(bot_profile_asset_id);
  config.bot_profile_path = None;
  profile.botbrowser_config = Some(config);

  Ok(profile)
}

fn audit_query_path(
  limit: Option<u32>,
  action: Option<String>,
  target_type: Option<String>,
  target_id: Option<String>,
  user_id: Option<String>,
) -> String {
  let mut serializer = url::form_urlencoded::Serializer::new(String::new());
  if let Some(limit) = limit {
    serializer.append_pair("limit", &limit.to_string());
  }
  if let Some(action) = action.filter(|value| !value.trim().is_empty()) {
    serializer.append_pair("action", &action);
  }
  if let Some(target_type) = target_type.filter(|value| !value.trim().is_empty()) {
    serializer.append_pair("targetType", &target_type);
  }
  if let Some(target_id) = target_id.filter(|value| !value.trim().is_empty()) {
    serializer.append_pair("targetId", &target_id);
  }
  if let Some(user_id) = user_id.filter(|value| !value.trim().is_empty()) {
    serializer.append_pair("userId", &user_id);
  }
  let query = serializer.finish();
  if query.is_empty() {
    "admin/audit-logs".to_string()
  } else {
    format!("admin/audit-logs?{query}")
  }
}

pub fn format_team_api_error(status: StatusCode, body: &str) -> String {
  let message = serde_json::from_str::<Value>(body)
    .ok()
    .and_then(|value| value.get("message").cloned())
    .map(|value| match value {
      Value::Array(items) => items
        .into_iter()
        .filter_map(|item| item.as_str().map(ToString::to_string))
        .collect::<Vec<_>>()
        .join(", "),
      Value::String(message) => message,
      other => other.to_string(),
    })
    .filter(|message| !message.trim().is_empty())
    .unwrap_or_else(|| body.trim().to_string());

  let message = if message.is_empty() {
    status
      .canonical_reason()
      .unwrap_or("Self-hosted team API error")
      .to_string()
  } else {
    message
  };

  match status {
    StatusCode::UNAUTHORIZED => format!("Not logged in: {message}"),
    StatusCode::FORBIDDEN => format!("Permission denied: {message}"),
    StatusCode::CONFLICT => format!("Conflict: {message}"),
    _ => format!("Self-hosted team API failed ({status}): {message}"),
  }
}

pub fn encode_file_base64(path: &Path) -> Result<String, String> {
  let bytes = std::fs::read(path).map_err(|e| {
    format!(
      "Failed to read BotBrowser profile file {}: {e}",
      path.display()
    )
  })?;
  Ok(BASE64.encode(bytes))
}

pub async fn register_botbrowser_profile(
  app_handle: &tauri::AppHandle,
  profile: &BrowserProfile,
) -> Result<(), String> {
  if !crate::botbrowser::is_botbrowser_profile(profile) {
    return Ok(());
  }
  let bot_profile_asset_id = profile
    .botbrowser_config
    .as_ref()
    .and_then(|config| config.bot_profile_asset_id.clone());
  team_request(
    app_handle,
    Method::POST,
    "team-profiles",
    Some(json!({
      "id": profile.id.to_string(),
      "name": profile.name.clone(),
      "engine": "botbrowser",
      "botProfileAssetId": bot_profile_asset_id,
      "syncMode": "Regular",
    })),
  )
  .await
  .map(|_| ())
}

#[tauri::command]
pub async fn team_list_users(app_handle: tauri::AppHandle) -> Result<Value, String> {
  team_request(&app_handle, Method::GET, "admin/users", None).await
}

#[tauri::command]
pub async fn team_create_user(
  app_handle: tauri::AppHandle,
  input: TeamUserInput,
) -> Result<Value, String> {
  team_request(
    &app_handle,
    Method::POST,
    "admin/users",
    Some(serde_json::to_value(input).map_err(|e| e.to_string())?),
  )
  .await
}

#[tauri::command]
pub async fn team_update_user(
  app_handle: tauri::AppHandle,
  user_id: String,
  input: TeamUserUpdateInput,
) -> Result<Value, String> {
  team_request(
    &app_handle,
    Method::PATCH,
    &format!("admin/users/{user_id}"),
    Some(serde_json::to_value(input).map_err(|e| e.to_string())?),
  )
  .await
}

#[tauri::command]
pub async fn team_list_bot_profiles(app_handle: tauri::AppHandle) -> Result<Value, String> {
  team_request(&app_handle, Method::GET, "admin/bot-profiles", None).await
}

#[tauri::command]
pub async fn team_upload_bot_profile_asset(
  app_handle: tauri::AppHandle,
  input: TeamBotProfileUploadInput,
) -> Result<Value, String> {
  let content_base64 = encode_file_base64(Path::new(&input.file_path))?;
  team_request(
    &app_handle,
    Method::POST,
    "admin/bot-profiles",
    Some(json!({
      "name": input.name,
      "contentBase64": content_base64,
      "browserMajorVersion": input.browser_major_version,
      "platform": input.platform,
    })),
  )
  .await
}

#[tauri::command]
pub async fn team_delete_bot_profile_asset(
  app_handle: tauri::AppHandle,
  asset_id: String,
) -> Result<Value, String> {
  team_request(
    &app_handle,
    Method::DELETE,
    &format!("admin/bot-profiles/{asset_id}"),
    None,
  )
  .await
}

#[tauri::command]
pub async fn team_list_profiles(app_handle: tauri::AppHandle) -> Result<Value, String> {
  team_request(&app_handle, Method::GET, "team-profiles", None).await
}

#[tauri::command]
pub async fn team_materialize_profile(
  app_handle: tauri::AppHandle,
  profile_id: String,
  executable_path: Option<String>,
) -> Result<BrowserProfile, String> {
  let user = crate::self_hosted_auth::cached_user()
    .ok_or_else(|| "Self-hosted user is not logged in".to_string())?;
  let team_profile = fetch_team_profile(&app_handle, &profile_id).await?;
  let permission = team_profile_permission(&team_profile, &user);
  if !can_launch_permission(permission.as_deref()) {
    return Err("Viewer cannot launch shared team profiles".to_string());
  }

  let profile_uuid = Uuid::parse_str(&team_profile.id)
    .map_err(|e| format!("Invalid team profile id {}: {e}", team_profile.id))?;
  let manager = crate::profile::manager::ProfileManager::instance();
  let existing_profile = manager
    .list_profiles()
    .map_err(|e| format!("Failed to list local profiles: {e}"))?
    .into_iter()
    .find(|profile| profile.id == profile_uuid);
  let profile =
    build_materialized_botbrowser_profile(&team_profile, existing_profile, executable_path)?;

  manager
    .save_profile(&profile)
    .map_err(|e| format!("Failed to save shared team profile locally: {e}"))?;

  let profiles_dir = manager.get_profiles_dir();
  let profile_data_dir = crate::botbrowser::profile_data_path(&profile, &profiles_dir);
  std::fs::create_dir_all(&profile_data_dir).map_err(|e| {
    format!(
      "Failed to create local shared profile cache {}: {e}",
      profile_data_dir.display()
    )
  })?;

  if let Err(e) = crate::events::emit("profile-updated", &profile) {
    log::warn!("Failed to emit materialized profile update: {e}");
  }
  if let Err(e) = crate::events::emit_empty("profiles-changed") {
    log::warn!("Failed to emit profiles-changed after materializing profile: {e}");
  }

  Ok(profile)
}

#[tauri::command]
pub async fn team_preflight_botbrowser_profile(
  app_handle: tauri::AppHandle,
  profile_id: String,
) -> Result<BotBrowserPreflightResult, String> {
  let mut checks = Vec::new();
  let Some(user) = crate::self_hosted_auth::cached_user() else {
    checks.push(preflight_check(
      "selfHostedLogin",
      false,
      "Self-hosted user is not logged in",
    ));
    checks.push(preflight_check(
      "engine",
      false,
      "Team profile could not be loaded before login",
    ));
    checks.push(preflight_check(
      "permission",
      false,
      "Permission cannot be checked before login",
    ));
    checks.push(preflight_check(
      "executable",
      false,
      "BotBrowser executable cannot be checked before login",
    ));
    checks.push(preflight_check(
      "botProfile",
      false,
      "BotBrowser .enc template cannot be checked before login",
    ));
    checks.push(preflight_check(
      "lock",
      false,
      "Profile lock cannot be checked before login",
    ));
    return Ok(BotBrowserPreflightResult {
      can_launch: false,
      checks,
    });
  };

  checks.push(preflight_check(
    "selfHostedLogin",
    true,
    "Self-hosted user is logged in",
  ));

  let team_profile = match fetch_team_profile(&app_handle, &profile_id).await {
    Ok(team_profile) => team_profile,
    Err(error) => {
      checks.push(preflight_check("engine", false, error.clone()));
      checks.push(preflight_check("permission", false, error.clone()));
      checks.push(preflight_check("executable", false, error.clone()));
      checks.push(preflight_check("botProfile", false, error.clone()));
      checks.push(preflight_check("lock", false, error));
      return Ok(BotBrowserPreflightResult {
        can_launch: false,
        checks,
      });
    }
  };

  let is_botbrowser = team_profile.engine == "botbrowser";
  checks.push(preflight_check(
    "engine",
    is_botbrowser,
    if is_botbrowser {
      "Team profile uses BotBrowser"
    } else {
      "Only BotBrowser team profiles can be launched in this version"
    },
  ));

  let permission = team_profile_permission(&team_profile, &user);
  let has_launch_permission = can_launch_permission(permission.as_deref());
  checks.push(preflight_check(
    "permission",
    has_launch_permission,
    if has_launch_permission {
      "Current user can launch this profile"
    } else {
      "Current user needs owner, editor, or admin permission"
    },
  ));

  let manager = crate::profile::manager::ProfileManager::instance();
  let profile_uuid = Uuid::parse_str(&team_profile.id)
    .map_err(|e| format!("Invalid team profile id {}: {e}", team_profile.id))?;
  let existing_profile = manager
    .list_profiles()
    .map_err(|e| format!("Failed to list local profiles: {e}"))?
    .into_iter()
    .find(|profile| profile.id == profile_uuid);
  let materialized_profile =
    build_materialized_botbrowser_profile(&team_profile, existing_profile, None);

  match materialized_profile.as_ref() {
    Ok(profile) => match crate::botbrowser::resolve_executable_path(profile) {
      Ok(path) => checks.push(preflight_check(
        "executable",
        true,
        format!("BotBrowser executable found at {}", path.display()),
      )),
      Err(error) => checks.push(preflight_check("executable", false, error)),
    },
    Err(error) => checks.push(preflight_check("executable", false, error.clone())),
  }

  match materialized_profile.as_ref() {
    Ok(profile) => match crate::botbrowser::ensure_bot_profile_asset(&app_handle, profile).await {
      Ok(path) => checks.push(preflight_check(
        "botProfile",
        true,
        format!(
          "BotBrowser .enc template is available at {}",
          path.display()
        ),
      )),
      Err(error) => checks.push(preflight_check("botProfile", false, error)),
    },
    Err(error) => checks.push(preflight_check("botProfile", false, error.clone())),
  }

  let lock_conflict = is_locked_by_another(&team_profile, &user);
  checks.push(preflight_check(
    "lock",
    !lock_conflict,
    if lock_conflict {
      "Profile is locked by another user"
    } else {
      "Profile is not locked by another user"
    },
  ));

  Ok(BotBrowserPreflightResult {
    can_launch: checks.iter().all(|check| check.status == "passed"),
    checks,
  })
}

#[tauri::command]
pub async fn team_create_profile(
  app_handle: tauri::AppHandle,
  input: TeamProfileInput,
) -> Result<Value, String> {
  team_request(
    &app_handle,
    Method::POST,
    "team-profiles",
    Some(serde_json::to_value(input).map_err(|e| e.to_string())?),
  )
  .await
}

#[tauri::command]
pub async fn team_update_profile(
  app_handle: tauri::AppHandle,
  profile_id: String,
  input: TeamProfileUpdateInput,
) -> Result<Value, String> {
  team_request(
    &app_handle,
    Method::PATCH,
    &format!("team-profiles/{profile_id}"),
    Some(serde_json::to_value(input).map_err(|e| e.to_string())?),
  )
  .await
}

#[tauri::command]
pub async fn team_delete_profile(
  app_handle: tauri::AppHandle,
  profile_id: String,
) -> Result<Value, String> {
  team_request(
    &app_handle,
    Method::DELETE,
    &format!("team-profiles/{profile_id}"),
    None,
  )
  .await
}

#[tauri::command]
pub async fn team_set_profile_permission(
  app_handle: tauri::AppHandle,
  profile_id: String,
  input: TeamPermissionInput,
) -> Result<Value, String> {
  team_request(
    &app_handle,
    Method::POST,
    &format!("team-profiles/{profile_id}/permissions"),
    Some(serde_json::to_value(input).map_err(|e| e.to_string())?),
  )
  .await
}

#[tauri::command]
pub async fn team_delete_profile_permission(
  app_handle: tauri::AppHandle,
  profile_id: String,
  user_id: String,
) -> Result<Value, String> {
  team_request(
    &app_handle,
    Method::DELETE,
    &format!("team-profiles/{profile_id}/permissions/{user_id}"),
    None,
  )
  .await
}

#[tauri::command]
pub async fn team_unlock_profile(
  app_handle: tauri::AppHandle,
  profile_id: String,
) -> Result<Value, String> {
  team_request(
    &app_handle,
    Method::POST,
    &format!("team-profiles/{profile_id}/unlock"),
    None,
  )
  .await
}

#[tauri::command]
pub async fn team_list_audit_logs(
  app_handle: tauri::AppHandle,
  limit: Option<u32>,
  action: Option<String>,
  target_type: Option<String>,
  target_id: Option<String>,
  user_id: Option<String>,
) -> Result<Value, String> {
  let path = audit_query_path(limit, action, target_type, target_id, user_id);
  team_request(&app_handle, Method::GET, &path, None).await
}

pub fn normalize_botbrowser_config(config: Option<BotBrowserConfig>) -> Option<BotBrowserConfig> {
  config.map(|mut config| {
    config.executable_path = config
      .executable_path
      .and_then(|value| (!value.trim().is_empty()).then(|| value.trim().to_string()));
    config.bot_profile_asset_id = config
      .bot_profile_asset_id
      .and_then(|value| (!value.trim().is_empty()).then(|| value.trim().to_string()));
    config.bot_profile_path = config
      .bot_profile_path
      .and_then(|value| (!value.trim().is_empty()).then(|| value.trim().to_string()));
    config
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn formats_status_errors_with_json_message() {
    let error = format_team_api_error(StatusCode::FORBIDDEN, r#"{"message":"Admin required"}"#);
    assert_eq!(error, "Permission denied: Admin required");
  }

  #[test]
  fn formats_lock_conflicts() {
    let error = format_team_api_error(
      StatusCode::CONFLICT,
      r#"{"message":"Profile is already locked"}"#,
    );
    assert_eq!(error, "Conflict: Profile is already locked");
  }

  #[test]
  fn encodes_file_base64() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("profile.enc");
    std::fs::write(&path, b"bot-profile").expect("write fixture");
    assert_eq!(
      encode_file_base64(&path).expect("encoded"),
      "Ym90LXByb2ZpbGU="
    );
  }

  #[test]
  fn builds_audit_query_with_user_filter() {
    let path = audit_query_path(
      Some(25),
      Some("user.disable".to_string()),
      Some("user".to_string()),
      Some("user-1".to_string()),
      Some("actor-1".to_string()),
    );
    assert_eq!(
      path,
      "admin/audit-logs?limit=25&action=user.disable&targetType=user&targetId=user-1&userId=actor-1"
    );
  }

  fn botbrowser_team_profile() -> TeamProfileRecord {
    TeamProfileRecord {
      id: "8a9f31fc-45f6-4de7-a3e3-aefb0a25d8da".to_string(),
      team_id: "team-1".to_string(),
      owner_user_id: "user-1".to_string(),
      name: "Shared checkout".to_string(),
      engine: "botbrowser".to_string(),
      bot_profile_asset_id: Some("asset-1".to_string()),
      sync_mode: Some("Regular".to_string()),
      permissions: vec![],
      bot_profile_asset: None,
      lock: None,
    }
  }

  #[test]
  fn materializes_botbrowser_team_profile() {
    let team_profile = botbrowser_team_profile();
    let profile = build_materialized_botbrowser_profile(
      &team_profile,
      None,
      Some("/Applications/BotBrowser.app".to_string()),
    )
    .expect("materialized");

    assert_eq!(profile.id.to_string(), team_profile.id);
    assert_eq!(profile.name, "Shared checkout");
    assert_eq!(profile.browser, "botbrowser");
    assert_eq!(profile.engine.as_deref(), Some("botbrowser"));
    assert_eq!(profile.sync_mode, SyncMode::Regular);
    assert_eq!(
      profile
        .botbrowser_config
        .as_ref()
        .and_then(|config| config.bot_profile_asset_id.as_deref()),
      Some("asset-1")
    );
    assert_eq!(
      profile
        .botbrowser_config
        .as_ref()
        .and_then(|config| config.executable_path.as_deref()),
      Some("/Applications/BotBrowser.app")
    );
  }

  #[test]
  fn materialize_updates_existing_profile_without_replacing_local_fields() {
    let mut team_profile = botbrowser_team_profile();
    team_profile.name = "Renamed team profile".to_string();
    team_profile.bot_profile_asset_id = Some("asset-2".to_string());
    let existing = BrowserProfile {
      id: Uuid::parse_str(&team_profile.id).expect("uuid"),
      name: "Old local name".to_string(),
      browser: "botbrowser".to_string(),
      engine: Some("botbrowser".to_string()),
      version: "system".to_string(),
      proxy_id: Some("proxy-1".to_string()),
      vpn_id: None,
      launch_hook: Some("https://example.com/hook".to_string()),
      process_id: None,
      last_launch: Some(123),
      release_type: "stable".to_string(),
      camoufox_config: None,
      wayfern_config: None,
      group_id: Some("group-1".to_string()),
      tags: vec!["team".to_string()],
      note: Some("Keep this note".to_string()),
      sync_mode: SyncMode::Regular,
      encryption_salt: None,
      last_sync: Some(456),
      host_os: Some("macos".to_string()),
      ephemeral: false,
      extension_group_id: Some("extensions-1".to_string()),
      proxy_bypass_rules: vec!["localhost".to_string()],
      created_by_id: Some("user-1".to_string()),
      created_by_email: Some("a@example.com".to_string()),
      dns_blocklist: Some("ads".to_string()),
      botbrowser_config: Some(BotBrowserConfig {
        executable_path: Some("/Applications/Chromium.app".to_string()),
        bot_profile_asset_id: Some("asset-1".to_string()),
        ..BotBrowserConfig::default()
      }),
    };

    let profile =
      build_materialized_botbrowser_profile(&team_profile, Some(existing), None).expect("updated");

    assert_eq!(profile.name, "Renamed team profile");
    assert_eq!(profile.proxy_id.as_deref(), Some("proxy-1"));
    assert_eq!(profile.group_id.as_deref(), Some("group-1"));
    assert_eq!(
      profile
        .botbrowser_config
        .as_ref()
        .and_then(|config| config.executable_path.as_deref()),
      Some("/Applications/Chromium.app")
    );
    assert_eq!(
      profile
        .botbrowser_config
        .as_ref()
        .and_then(|config| config.bot_profile_asset_id.as_deref()),
      Some("asset-2")
    );
  }

  #[test]
  fn materialize_rejects_non_botbrowser_profiles() {
    let mut team_profile = botbrowser_team_profile();
    team_profile.engine = "wayfern".to_string();

    let error = build_materialized_botbrowser_profile(&team_profile, None, None)
      .expect_err("non-botbrowser profile rejected");

    assert!(error.contains("Only BotBrowser team profiles"));
  }

  #[test]
  fn detects_active_lock_by_another_user() {
    let mut team_profile = botbrowser_team_profile();
    team_profile.lock = Some(TeamProfileLockRecord {
      profile_id: team_profile.id.clone(),
      locked_by_user_id: "user-2".to_string(),
      expires_at: (Utc::now() + chrono::Duration::minutes(5)).to_rfc3339(),
      heartbeat_at: Utc::now().to_rfc3339(),
    });
    let user = crate::self_hosted_auth::SelfHostedUser {
      id: "user-1".to_string(),
      email: "a@example.com".to_string(),
      role: "member".to_string(),
      team_id: "team-1".to_string(),
      prefix: None,
      team_prefix: None,
    };

    assert!(is_locked_by_another(&team_profile, &user));
  }
}
