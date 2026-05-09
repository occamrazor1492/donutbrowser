use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;

use crate::profile::types::{BotBrowserConfig, BrowserProfile};
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

fn audit_query_path(
  limit: Option<u32>,
  action: Option<String>,
  target_type: Option<String>,
  target_id: Option<String>,
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
) -> Result<Value, String> {
  let path = audit_query_path(limit, action, target_type, target_id);
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
}
