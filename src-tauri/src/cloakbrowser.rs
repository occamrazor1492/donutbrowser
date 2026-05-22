use crate::browser::ProxySettings;
use crate::profile::types::{BrowserProfile, CloakConfig};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloakRuntimeStatus {
  pub available: bool,
  pub executable_path: Option<String>,
  pub platform: String,
  pub version: Option<String>,
  pub message: String,
}

#[derive(Debug, Serialize)]
pub struct CloakLaunchResult {
  pub process_id: u32,
  pub executable_path: String,
}

pub fn is_cloak_profile(profile: &BrowserProfile) -> bool {
  profile.browser == "cloak" || profile.engine.as_deref() == Some("cloak")
}

pub fn normalize_cloak_config(config: Option<CloakConfig>) -> Option<CloakConfig> {
  config.map(|mut config| {
    config.executable_path = clean_optional(config.executable_path);
    config.binary_version = clean_optional(config.binary_version);
    config.binary_sha256 = clean_optional(config.binary_sha256);
    config.locale = clean_optional(config.locale);
    config.timezone = clean_optional(config.timezone);
    config.languages = clean_optional(config.languages);
    config.extra_args = config
      .extra_args
      .into_iter()
      .filter_map(|arg| clean_optional(Some(arg)))
      .collect();
    config
  })
}

pub fn derived_fingerprint_seed(profile_id: &uuid::Uuid) -> u64 {
  let mut hasher = Sha256::new();
  hasher.update(profile_id.as_bytes());
  let digest = hasher.finalize();
  let mut bytes = [0u8; 8];
  bytes.copy_from_slice(&digest[..8]);
  10_000 + (u64::from_be_bytes(bytes) % 90_000)
}

pub fn get_runtime_status(
  app_handle: &tauri::AppHandle,
  profile: Option<&BrowserProfile>,
) -> CloakRuntimeStatus {
  match resolve_executable_path(app_handle, profile) {
    Ok(path) => CloakRuntimeStatus {
      available: true,
      executable_path: Some(path.to_string_lossy().to_string()),
      platform: current_platform_key(),
      version: profile
        .and_then(|profile| profile.cloak_config.as_ref())
        .and_then(|config| config.binary_version.clone()),
      message: "CloakBrowser runtime is available".to_string(),
    },
    Err(error) => CloakRuntimeStatus {
      available: false,
      executable_path: None,
      platform: current_platform_key(),
      version: profile
        .and_then(|profile| profile.cloak_config.as_ref())
        .and_then(|config| config.binary_version.clone()),
      message: error,
    },
  }
}

pub fn resolve_executable_path(
  app_handle: &tauri::AppHandle,
  profile: Option<&BrowserProfile>,
) -> Result<PathBuf, String> {
  if let Some(path) = profile
    .and_then(|profile| profile.cloak_config.as_ref())
    .and_then(|config| config.executable_path.as_deref())
    .filter(|path| !path.trim().is_empty())
  {
    let path = resolve_candidate_path(PathBuf::from(path))?;
    validate_sha256(profile, &path)?;
    return Ok(path);
  }

  if let Ok(path) = std::env::var("CLOAKBROWSER_BINARY_PATH") {
    if !path.trim().is_empty() {
      let path = resolve_candidate_path(PathBuf::from(path))?;
      validate_sha256(profile, &path)?;
      return Ok(path);
    }
  }

  let mut candidates = Vec::new();
  if let Ok(resource_dir) = app_handle.path().resource_dir() {
    candidates.push(resource_dir.join("resources").join("cloakbrowser"));
  }
  if let Ok(current_dir) = std::env::current_dir() {
    candidates.push(current_dir.join("vendor-private").join("cloakbrowser"));
    candidates.push(
      current_dir
        .join("src-tauri")
        .join("resources")
        .join("cloakbrowser"),
    );
  }

  for root in candidates {
    if let Some(path) = find_runtime_in_root(&root) {
      validate_sha256(profile, &path)?;
      return Ok(path);
    }
  }

  Err(format!(
    "CloakBrowser runtime was not found for {}. Place it under vendor-private/cloakbrowser/{}/ before building, or set cloak_config.executable_path.",
    current_platform_key(),
    current_platform_key()
  ))
}

pub fn profile_data_path(profile: &BrowserProfile, profiles_dir: &Path) -> PathBuf {
  crate::ephemeral_dirs::get_effective_profile_path(profile, profiles_dir)
}

pub fn build_launch_args(
  profile: &BrowserProfile,
  user_data_dir: &Path,
  proxy: Option<&ProxySettings>,
  url: Option<&str>,
  remote_debugging_port: Option<u16>,
  headless: bool,
) -> Vec<String> {
  let config = profile.cloak_config.clone().unwrap_or_default();
  let fingerprint_seed = config
    .fingerprint_seed
    .unwrap_or_else(|| derived_fingerprint_seed(&profile.id));
  let port = remote_debugging_port.unwrap_or(0);
  let mut args = vec![
    format!("--user-data-dir={}", user_data_dir.to_string_lossy()),
    "--remote-debugging-address=127.0.0.1".to_string(),
    format!("--remote-debugging-port={port}"),
    "--no-first-run".to_string(),
    "--no-default-browser-check".to_string(),
    "--disable-background-mode".to_string(),
    "--disable-component-update".to_string(),
    "--disable-background-timer-throttling".to_string(),
    "--disable-session-crashed-bubble".to_string(),
    "--hide-crash-restore-bubble".to_string(),
    "--disable-infobars".to_string(),
    "--disable-features=DialMediaRouteProvider,DnsOverHttps,AsyncDns".to_string(),
    "--use-mock-keychain".to_string(),
    "--password-store=basic".to_string(),
    format!("--fingerprint={fingerprint_seed}"),
  ];

  if headless {
    args.push("--headless=new".to_string());
  }

  #[cfg(target_os = "linux")]
  {
    args.push("--no-sandbox".to_string());
    args.push("--disable-setuid-sandbox".to_string());
    args.push("--disable-dev-shm-usage".to_string());
  }

  if let Some(proxy_url) = proxy.and_then(proxy_to_url) {
    args.push(format!("--proxy-server={proxy_url}"));
    args.push("--dns-prefetch-disable".to_string());
    args.push("--disable-non-proxied-udp".to_string());
  }

  if let Some(locale) = config.locale.as_deref().filter(|value| !value.is_empty()) {
    args.push(format!("--fingerprint-locale={locale}"));
    args.push(format!("--lang={locale}"));
  }
  if let Some(timezone) = config.timezone.as_deref().filter(|value| !value.is_empty()) {
    args.push(format!("--fingerprint-timezone={timezone}"));
  }
  if let Some(languages) = config
    .languages
    .as_deref()
    .filter(|value| !value.is_empty())
  {
    args.push(format!("--accept-lang={languages}"));
  }

  args.extend(config.extra_args);

  if let Some(url) = url {
    args.push(url.to_string());
  }

  args
}

pub fn launch_process(
  executable_path: &Path,
  args: &[String],
) -> Result<(Child, CloakLaunchResult), Box<dyn std::error::Error + Send + Sync>> {
  log::info!(
    "Launching CloakBrowser executable: {} with args: {:?}",
    executable_path.display(),
    args
  );
  let child = Command::new(executable_path)
    .args(args)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()?;
  let process_id = child.id();
  Ok((
    child,
    CloakLaunchResult {
      process_id,
      executable_path: executable_path.to_string_lossy().to_string(),
    },
  ))
}

pub fn open_url_in_existing_process(
  app_handle: &tauri::AppHandle,
  profile: &BrowserProfile,
  url: &str,
) -> Result<(), String> {
  let profiles_dir = crate::profile::manager::ProfileManager::instance().get_profiles_dir();
  let profile_data_path = profile_data_path(profile, &profiles_dir);
  let executable_path = resolve_executable_path(app_handle, Some(profile))?;
  let output = Command::new(&executable_path)
    .arg(format!(
      "--user-data-dir={}",
      profile_data_path.to_string_lossy()
    ))
    .arg("--new-tab")
    .arg(url)
    .output()
    .map_err(|e| format!("Failed to execute CloakBrowser: {e}"))?;

  if output.status.success() {
    return Ok(());
  }
  let stderr = String::from_utf8_lossy(&output.stderr);
  Err(format!(
    "Failed to open URL in existing CloakBrowser instance: {stderr}"
  ))
}

pub fn is_cloak_process_name(name: &str) -> bool {
  let name = name.to_lowercase();
  name.contains("cloak")
    || name.contains("chromium")
    || name.contains("chrome")
    || name.contains("browser")
}

fn find_runtime_in_root(root: &Path) -> Option<PathBuf> {
  let dirs = platform_directory_candidates()
    .into_iter()
    .map(|dir| root.join(dir))
    .chain(std::iter::once(root.to_path_buf()));

  for dir in dirs {
    if !dir.exists() {
      continue;
    }
    if let Ok(path) = resolve_candidate_path(dir) {
      return Some(path);
    }
  }
  None
}

fn resolve_candidate_path(path: PathBuf) -> Result<PathBuf, String> {
  if path.is_file() {
    return Ok(path);
  }

  #[cfg(target_os = "macos")]
  if path.extension().is_some_and(|ext| ext == "app") {
    return resolve_macos_app_bundle(path);
  }

  if path.is_dir() {
    #[cfg(target_os = "macos")]
    {
      for entry in std::fs::read_dir(&path)
        .map_err(|e| {
          format!(
            "Failed to read CloakBrowser directory {}: {e}",
            path.display()
          )
        })?
        .flatten()
      {
        let candidate = entry.path();
        if candidate.extension().is_some_and(|ext| ext == "app") {
          if let Ok(executable) = resolve_macos_app_bundle(candidate) {
            return Ok(executable);
          }
        }
      }
    }

    let executable_names = executable_name_candidates();
    let mut stack = vec![path.clone()];
    while let Some(dir) = stack.pop() {
      for entry in std::fs::read_dir(&dir)
        .map_err(|e| {
          format!(
            "Failed to read CloakBrowser directory {}: {e}",
            dir.display()
          )
        })?
        .flatten()
      {
        let candidate = entry.path();
        if candidate.is_dir() {
          stack.push(candidate);
          continue;
        }
        let Some(file_name) = candidate.file_name().and_then(|name| name.to_str()) else {
          continue;
        };
        if executable_names
          .iter()
          .any(|name| file_name.eq_ignore_ascii_case(name))
        {
          return Ok(candidate);
        }
      }
    }
  }

  Err(format!(
    "No CloakBrowser executable found in {}",
    path.display()
  ))
}

#[cfg(target_os = "macos")]
fn resolve_macos_app_bundle(path: PathBuf) -> Result<PathBuf, String> {
  let macos_dir = path.join("Contents").join("MacOS");
  let executable_names = executable_name_candidates();
  let entries = std::fs::read_dir(&macos_dir)
    .map_err(|e| format!("Failed to read app bundle executable directory: {e}"))?;
  for entry in entries.flatten() {
    let candidate = entry.path();
    let Some(file_name) = candidate.file_name().and_then(|name| name.to_str()) else {
      continue;
    };
    if executable_names
      .iter()
      .any(|name| file_name.eq_ignore_ascii_case(name))
      || file_name.to_lowercase().contains("cloak")
      || file_name.to_lowercase().contains("chromium")
    {
      return Ok(candidate);
    }
  }
  Err(format!(
    "No executable found inside CloakBrowser app bundle: {}",
    path.display()
  ))
}

fn executable_name_candidates() -> Vec<&'static str> {
  if cfg!(target_os = "windows") {
    vec![
      "cloakbrowser.exe",
      "cloak-browser.exe",
      "cloak.exe",
      "chrome.exe",
      "chromium.exe",
    ]
  } else if cfg!(target_os = "macos") {
    vec!["CloakBrowser", "Cloak Browser", "Cloak", "Chromium"]
  } else {
    vec![
      "cloakbrowser",
      "cloak-browser",
      "cloak",
      "chrome",
      "chromium",
    ]
  }
}

fn platform_directory_candidates() -> Vec<String> {
  let os = if cfg!(target_os = "macos") {
    "macos"
  } else if cfg!(target_os = "windows") {
    "windows"
  } else {
    "linux"
  };
  let arch = if cfg!(target_arch = "aarch64") {
    "aarch64"
  } else if cfg!(target_arch = "x86_64") {
    "x64"
  } else {
    std::env::consts::ARCH
  };

  vec![
    format!("{os}-{arch}"),
    if arch == "aarch64" {
      format!("{os}-arm64")
    } else {
      format!("{os}-x86_64")
    },
    os.to_string(),
  ]
}

fn current_platform_key() -> String {
  platform_directory_candidates()
    .into_iter()
    .next()
    .unwrap_or_else(|| format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH))
}

fn validate_sha256(profile: Option<&BrowserProfile>, path: &Path) -> Result<(), String> {
  let Some(expected) = profile
    .and_then(|profile| profile.cloak_config.as_ref())
    .and_then(|config| config.binary_sha256.as_deref())
    .filter(|value| !value.trim().is_empty())
  else {
    return Ok(());
  };

  let bytes = std::fs::read(path).map_err(|e| {
    format!(
      "Failed to read CloakBrowser runtime {}: {e}",
      path.display()
    )
  })?;
  let digest = Sha256::digest(&bytes);
  let actual = digest
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect::<String>();
  if actual.eq_ignore_ascii_case(expected.trim()) {
    Ok(())
  } else {
    Err(format!(
      "CloakBrowser runtime checksum mismatch for {}",
      path.display()
    ))
  }
}

fn proxy_to_url(proxy: &ProxySettings) -> Option<String> {
  if proxy.host.trim().is_empty() {
    return None;
  }
  Some(format!(
    "{}://{}:{}",
    proxy.proxy_type.to_lowercase(),
    proxy.host,
    proxy.port
  ))
}

fn clean_optional(value: Option<String>) -> Option<String> {
  value.and_then(|value| (!value.trim().is_empty()).then(|| value.trim().to_string()))
}

#[tauri::command]
pub fn cloak_get_runtime_status(app_handle: tauri::AppHandle) -> CloakRuntimeStatus {
  get_runtime_status(&app_handle, None)
}

#[tauri::command]
pub fn cloak_validate_runtime(
  app_handle: tauri::AppHandle,
  profile: Option<BrowserProfile>,
) -> Result<CloakRuntimeStatus, String> {
  let status = get_runtime_status(&app_handle, profile.as_ref());
  if status.available {
    Ok(status)
  } else {
    Err(status.message)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn derived_fingerprint_seed_is_stable_and_five_digits() {
    let id = uuid::Uuid::parse_str("c0a8012a-9f21-4f66-9db8-dad9d0a59767").expect("uuid");
    let first = derived_fingerprint_seed(&id);
    let second = derived_fingerprint_seed(&id);
    assert_eq!(first, second);
    assert!((10_000..=99_999).contains(&first));
  }

  #[test]
  fn build_launch_args_uses_deterministic_fingerprint_and_profile_path() {
    let id = uuid::Uuid::parse_str("c0a8012a-9f21-4f66-9db8-dad9d0a59767").expect("uuid");
    let profile = BrowserProfile {
      id,
      name: "Cloak".to_string(),
      browser: "cloak".to_string(),
      engine: Some("cloak".to_string()),
      cloak_config: Some(CloakConfig {
        locale: Some("en-US".to_string()),
        timezone: Some("America/New_York".to_string()),
        languages: Some("en-US,en".to_string()),
        ..CloakConfig::default()
      }),
      ..BrowserProfile::default()
    };

    let args = build_launch_args(
      &profile,
      Path::new("/tmp/profile"),
      Some(&ProxySettings {
        proxy_type: "http".to_string(),
        host: "127.0.0.1".to_string(),
        port: 8888,
        username: None,
        password: None,
      }),
      Some("https://example.com"),
      Some(9222),
      false,
    );

    assert!(args.contains(&"--user-data-dir=/tmp/profile".to_string()));
    assert!(args.contains(&"--remote-debugging-port=9222".to_string()));
    assert!(args.iter().any(|arg| arg.starts_with("--fingerprint=")));
    assert!(args.contains(&"--fingerprint-locale=en-US".to_string()));
    assert!(args.contains(&"--fingerprint-timezone=America/New_York".to_string()));
    assert!(args.contains(&"--accept-lang=en-US,en".to_string()));
    assert!(args.contains(&"--proxy-server=http://127.0.0.1:8888".to_string()));
  }
}
