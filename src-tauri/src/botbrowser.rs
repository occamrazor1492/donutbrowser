use crate::browser::ProxySettings;
use crate::profile::types::{BotBrowserConfig, BrowserProfile};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};

#[derive(Debug, Serialize)]
pub struct BotBrowserLaunchResult {
  pub process_id: u32,
  pub bot_profile_path: String,
}

pub fn is_botbrowser_profile(profile: &BrowserProfile) -> bool {
  profile.browser == "botbrowser" || profile.engine.as_deref() == Some("botbrowser")
}

pub fn default_executable_path() -> Option<PathBuf> {
  let candidates: Vec<PathBuf> = if cfg!(target_os = "macos") {
    vec![
      PathBuf::from("/Applications/BotBrowser.app/Contents/MacOS/BotBrowser"),
      PathBuf::from("/Applications/Chromium.app/Contents/MacOS/Chromium"),
      PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ]
  } else if cfg!(target_os = "windows") {
    vec![
      PathBuf::from(r"C:\Program Files\BotBrowser\Application\chrome.exe"),
      PathBuf::from(r"C:\Program Files\Chromium\Application\chrome.exe"),
      PathBuf::from(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
      PathBuf::from(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    ]
  } else {
    vec![
      PathBuf::from("/usr/bin/botbrowser"),
      PathBuf::from("/usr/bin/chromium-browser-stable"),
      PathBuf::from("/usr/bin/chromium-browser"),
      PathBuf::from("/usr/bin/chromium"),
      PathBuf::from("/usr/bin/google-chrome"),
    ]
  };

  candidates.into_iter().find(|path| path.exists())
}

pub fn resolve_executable_path(profile: &BrowserProfile) -> Result<PathBuf, String> {
  if let Some(path) = profile
    .botbrowser_config
    .as_ref()
    .and_then(|config| config.executable_path.as_deref())
    .filter(|path| !path.trim().is_empty())
  {
    let path = PathBuf::from(path);
    return resolve_app_bundle_path(path);
  }

  default_executable_path()
    .ok_or_else(|| {
      "BotBrowser executable not found. Set botbrowser_config.executable_path in this profile."
        .to_string()
    })
    .and_then(resolve_app_bundle_path)
}

pub async fn ensure_bot_profile_asset(
  app_handle: &tauri::AppHandle,
  profile: &BrowserProfile,
) -> Result<PathBuf, String> {
  if let Some(path) = profile
    .botbrowser_config
    .as_ref()
    .and_then(|config| config.bot_profile_path.as_deref())
    .filter(|path| !path.trim().is_empty())
  {
    let path = PathBuf::from(path);
    if path.exists() {
      return Ok(path);
    }
    return Err(format!(
      "BotBrowser profile file does not exist: {}",
      path.display()
    ));
  }

  let asset_id = profile
    .botbrowser_config
    .as_ref()
    .and_then(|config| config.bot_profile_asset_id.as_deref())
    .filter(|id| !id.trim().is_empty())
    .ok_or_else(|| {
      "BotBrowser profile requires botbrowser_config.bot_profile_path or bot_profile_asset_id"
        .to_string()
    })?;

  let team_id =
    crate::self_hosted_auth::cached_team_id().unwrap_or_else(|| "default-team".to_string());
  let local_path = team_bot_profile_cache_path(&team_id, asset_id);
  if local_path.exists() {
    return Ok(local_path);
  }

  let parent = local_path
    .parent()
    .ok_or_else(|| "Invalid BotBrowser cache path".to_string())?;
  std::fs::create_dir_all(parent)
    .map_err(|e| format!("Failed to create BotBrowser cache directory: {e}"))?;

  let engine = crate::sync::SyncEngine::create_from_settings(app_handle)
    .await
    .map_err(|e| format!("Failed to create sync engine for BotBrowser asset download: {e}"))?;
  let key = format!("bot_profiles/{asset_id}.enc");
  engine
    .download_key_to_path(&key, &local_path)
    .await
    .map_err(|e| format!("Failed to download BotBrowser asset {asset_id}: {e}"))?;

  Ok(local_path)
}

pub fn team_profile_data_path(team_id: &str, profile_id: &str) -> PathBuf {
  crate::app_dirs::data_dir()
    .join("team-cache")
    .join(team_id)
    .join("profiles")
    .join(profile_id)
    .join("profile")
}

pub fn profile_data_path(profile: &BrowserProfile, profiles_dir: &Path) -> PathBuf {
  if is_botbrowser_profile(profile) {
    if let Some(team_id) = crate::self_hosted_auth::cached_team_id() {
      return team_profile_data_path(&team_id, &profile.id.to_string());
    }
  }
  crate::ephemeral_dirs::get_effective_profile_path(profile, profiles_dir)
}

pub fn team_bot_profile_cache_path(team_id: &str, asset_id: &str) -> PathBuf {
  crate::app_dirs::data_dir()
    .join("team-cache")
    .join(team_id)
    .join("bot-profiles")
    .join(format!("{asset_id}.enc"))
}

pub fn build_launch_args(
  profile: &BrowserProfile,
  user_data_dir: &Path,
  bot_profile_path: &Path,
  proxy: Option<&ProxySettings>,
  url: Option<&str>,
  remote_debugging_port: Option<u16>,
  headless: bool,
) -> Vec<String> {
  let mut args = vec![
    format!("--user-data-dir={}", user_data_dir.to_string_lossy()),
    format!("--bot-profile={}", bot_profile_path.to_string_lossy()),
    "--remote-debugging-address=127.0.0.1".to_string(),
    format!(
      "--remote-debugging-port={}",
      remote_debugging_port.unwrap_or(0)
    ),
    "--disable-blink-features=AutomationControlled".to_string(),
    "--no-first-run".to_string(),
    "--restore-last-session".to_string(),
    format!("--bot-title={}", profile.name),
  ];

  if headless {
    args.push("--headless=new".to_string());
  }

  if let Some(proxy_url) = proxy.and_then(proxy_to_url) {
    args.push(format!("--proxy-server={proxy_url}"));
  }

  if let Some(config) = &profile.botbrowser_config {
    append_config_args(&mut args, config);
  }

  if let Some(url) = url {
    args.push(url.to_string());
  }

  args
}

pub fn launch_process(
  executable_path: &Path,
  args: &[String],
  bot_profile_path: &Path,
) -> Result<(Child, BotBrowserLaunchResult), Box<dyn std::error::Error + Send + Sync>> {
  log::info!(
    "Launching BotBrowser executable: {} with args: {:?}",
    executable_path.display(),
    args
  );
  let child = Command::new(executable_path).args(args).spawn()?;
  let process_id = child.id();
  Ok((
    child,
    BotBrowserLaunchResult {
      process_id,
      bot_profile_path: bot_profile_path.to_string_lossy().to_string(),
    },
  ))
}

fn append_config_args(args: &mut Vec<String>, config: &BotBrowserConfig) {
  if let Some(locale) = config.locale.as_deref().filter(|v| !v.trim().is_empty()) {
    args.push(format!("--bot-config-locale={locale}"));
  }
  if let Some(timezone) = config.timezone.as_deref().filter(|v| !v.trim().is_empty()) {
    args.push(format!("--bot-config-timezone={timezone}"));
  }
  if let Some(languages) = config.languages.as_deref().filter(|v| !v.trim().is_empty()) {
    args.push(format!("--bot-config-languages={languages}"));
  }
  if let Some(noise_seed) = config.noise_seed {
    args.push(format!("--bot-noise-seed={noise_seed}"));
  }
  if config.local_dns {
    args.push("--bot-local-dns".to_string());
  }
  if config.port_protection {
    args.push("--bot-port-protection".to_string());
  }
  if config.network_info_override {
    args.push("--bot-network-info-override".to_string());
  }
  args.extend(config.extra_args.iter().cloned());
}

fn proxy_to_url(proxy: &ProxySettings) -> Option<String> {
  if proxy.host.trim().is_empty() {
    return None;
  }

  let proxy_type = proxy.proxy_type.to_lowercase();
  let auth = match (&proxy.username, &proxy.password) {
    (Some(username), Some(password)) if !username.is_empty() => {
      format!(
        "{}:{}@",
        escape_url_part(username),
        escape_url_part(password)
      )
    }
    (Some(username), None) if !username.is_empty() => format!("{}@", escape_url_part(username)),
    _ => String::new(),
  };

  Some(format!(
    "{}://{}{}:{}",
    proxy_type, auth, proxy.host, proxy.port
  ))
}

fn escape_url_part(value: &str) -> String {
  url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

fn resolve_app_bundle_path(path: PathBuf) -> Result<PathBuf, String> {
  if !path.exists() {
    return Err(format!(
      "Executable path does not exist: {}",
      path.display()
    ));
  }

  if cfg!(target_os = "macos") && path.extension().and_then(|ext| ext.to_str()) == Some("app") {
    let macos_dir = path.join("Contents").join("MacOS");
    let entries = std::fs::read_dir(&macos_dir)
      .map_err(|e| format!("Failed to read app bundle executable directory: {e}"))?;
    for entry in entries.flatten() {
      let candidate = entry.path();
      if candidate.is_file() {
        return Ok(candidate);
      }
    }
    return Err(format!(
      "No executable found inside app bundle: {}",
      path.display()
    ));
  }

  Ok(path)
}
