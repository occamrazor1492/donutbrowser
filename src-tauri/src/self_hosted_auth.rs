use crate::settings_manager::SettingsManager;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelfHostedUser {
  pub id: String,
  pub email: String,
  pub role: String,
  #[serde(rename = "teamId")]
  pub team_id: String,
  #[serde(default)]
  pub prefix: Option<String>,
  #[serde(rename = "teamPrefix", default)]
  pub team_prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelfHostedAuthState {
  pub server_url: String,
  pub user: SelfHostedUser,
}

#[derive(Debug, Deserialize)]
struct LoginResponse {
  token: String,
  user: SelfHostedUser,
}

#[derive(Debug, Serialize)]
struct LoginRequest<'a> {
  email: &'a str,
  password: &'a str,
}

pub fn cached_user() -> Option<SelfHostedUser> {
  read_user_file().ok().flatten()
}

pub fn cached_team_id() -> Option<String> {
  cached_user().map(|user| user.team_id)
}

pub fn cached_team_prefix() -> Option<String> {
  cached_user().map(|user| {
    let team_id = user.team_id;
    user
      .team_prefix
      .unwrap_or_else(|| format!("teams/{team_id}/"))
  })
}

#[tauri::command]
pub async fn login_self_hosted(
  app_handle: tauri::AppHandle,
  server_url: String,
  email: String,
  password: String,
) -> Result<SelfHostedAuthState, String> {
  let clean_url = server_url.trim_end_matches('/').to_string();
  let response = reqwest::Client::new()
    .post(format!("{clean_url}/v1/auth/login"))
    .json(&LoginRequest {
      email: &email,
      password: &password,
    })
    .send()
    .await
    .map_err(|e| format!("Failed to login to self-hosted sync: {e}"))?;

  if !response.status().is_success() {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    return Err(format!("Self-hosted login failed ({status}): {body}"));
  }

  let result: LoginResponse = response
    .json()
    .await
    .map_err(|e| format!("Failed to parse self-hosted login response: {e}"))?;

  let manager = SettingsManager::instance();
  manager
    .save_sync_server_url(Some(clean_url.clone()))
    .map_err(|e| format!("Failed to save self-hosted server URL: {e}"))?;
  manager
    .store_sync_token(&app_handle, &result.token)
    .await
    .map_err(|e| format!("Failed to store self-hosted JWT: {e}"))?;

  write_user_file(&result.user)?;

  Ok(SelfHostedAuthState {
    server_url: clean_url,
    user: result.user,
  })
}

#[tauri::command]
pub async fn logout_self_hosted(app_handle: tauri::AppHandle) -> Result<(), String> {
  let manager = SettingsManager::instance();
  manager
    .remove_sync_token(&app_handle)
    .await
    .map_err(|e| format!("Failed to remove self-hosted JWT: {e}"))?;

  let path = user_file_path();
  if path.exists() {
    std::fs::remove_file(path)
      .map_err(|e| format!("Failed to remove self-hosted user cache: {e}"))?;
  }
  Ok(())
}

#[tauri::command]
pub async fn get_self_hosted_user() -> Result<Option<SelfHostedAuthState>, String> {
  let manager = SettingsManager::instance();
  let settings = manager
    .get_sync_settings()
    .map_err(|e| format!("Failed to load sync settings: {e}"))?;
  let Some(user) = read_user_file()? else {
    return Ok(None);
  };
  let server_url = settings.sync_server_url.unwrap_or_default();
  Ok(Some(SelfHostedAuthState { server_url, user }))
}

fn user_file_path() -> PathBuf {
  crate::app_dirs::settings_dir().join("self_hosted_user.json")
}

fn read_user_file() -> Result<Option<SelfHostedUser>, String> {
  let path = user_file_path();
  if !path.exists() {
    return Ok(None);
  }
  let content = std::fs::read_to_string(path)
    .map_err(|e| format!("Failed to read self-hosted user cache: {e}"))?;
  serde_json::from_str(&content)
    .map(Some)
    .map_err(|e| format!("Failed to parse self-hosted user cache: {e}"))
}

fn write_user_file(user: &SelfHostedUser) -> Result<(), String> {
  let path = user_file_path();
  if let Some(parent) = path.parent() {
    std::fs::create_dir_all(parent)
      .map_err(|e| format!("Failed to create self-hosted settings dir: {e}"))?;
  }
  let content = serde_json::to_string_pretty(user)
    .map_err(|e| format!("Failed to serialize self-hosted user cache: {e}"))?;
  std::fs::write(path, content).map_err(|e| format!("Failed to write self-hosted user cache: {e}"))
}
