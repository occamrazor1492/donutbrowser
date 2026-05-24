use crate::proxy_storage::{
  delete_proxy_config, generate_proxy_id, get_proxy_config, is_process_running, list_proxy_configs,
  save_proxy_config, ProxyConfig,
};
use std::path::{Path, PathBuf};
use std::process::Stdio;
lazy_static::lazy_static! {
  static ref PROXY_PROCESSES: std::sync::Mutex<std::collections::HashMap<String, u32>> =
    std::sync::Mutex::new(std::collections::HashMap::new());
}

/// Record `pid` as the worker process owned by proxy `id` in the in-memory map.
pub(crate) fn register_proxy_pid(id: &str, pid: u32) {
  let mut processes = PROXY_PROCESSES.lock().unwrap();
  processes.insert(id.to_string(), pid);
}

/// Look up the worker PID tracked for proxy `id`, if any.
#[cfg(test)]
pub(crate) fn lookup_proxy_pid(id: &str) -> Option<u32> {
  let processes = PROXY_PROCESSES.lock().unwrap();
  processes.get(id).copied()
}

/// Forget the tracked PID for `id`. Returns true if an entry was removed.
pub(crate) fn remove_proxy_pid(id: &str) -> bool {
  let mut processes = PROXY_PROCESSES.lock().unwrap();
  processes.remove(id).is_some()
}

/// Send a best-effort termination to `pid` using the platform's standard tool.
/// Never panics; failures (process already dead, permission denied, etc.) are
/// swallowed because stop_proxy_process treats kill as fire-and-forget.
pub(crate) fn kill_pid_best_effort(pid: u32) {
  #[cfg(unix)]
  {
    use std::process::Command;
    let _ = Command::new("kill")
      .arg("-TERM")
      .arg(pid.to_string())
      .output();
  }
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let _ = Command::new("taskkill")
      .args(["/F", "/PID", &pid.to_string()])
      .creation_flags(CREATE_NO_WINDOW)
      .output();
  }
}

fn target_binary_name(base_name: &str) -> Option<String> {
  let target = std::env::var("TARGET").ok()?;

  #[cfg(windows)]
  {
    Some(format!("{base_name}-{target}.exe"))
  }

  #[cfg(not(windows))]
  {
    Some(format!("{base_name}-{target}"))
  }
}

fn unsuffixed_binary_name(base_name: &str) -> String {
  #[cfg(windows)]
  {
    match base_name {
      "donut-proxy" => "donut-proxy.exe".to_string(),
      "donut-daemon" => "donut-daemon.exe".to_string(),
      _ => String::new(),
    }
  }

  #[cfg(not(windows))]
  {
    base_name.to_string()
  }
}

fn binary_matches_prefix(path: &Path, base_name: &str) -> bool {
  let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
    return false;
  };

  #[cfg(windows)]
  {
    file_name.starts_with(&format!("{base_name}-")) && file_name.ends_with(".exe")
  }

  #[cfg(not(windows))]
  {
    file_name.starts_with(&format!("{base_name}-"))
  }
}

fn push_candidate_dir(dirs: &mut Vec<PathBuf>, dir: Option<PathBuf>) {
  if let Some(dir) = dir {
    if !dirs.iter().any(|existing| existing == &dir) {
      dirs.push(dir);
    }
  }
}

pub(crate) fn find_sidecar_executable(
  base_name: &str,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
  let current_exe = std::env::current_exe()?;
  let current_dir = current_exe
    .parent()
    .ok_or("Failed to get parent directory of current executable")?;

  if current_exe
    .file_stem()
    .and_then(|stem| stem.to_str())
    .is_some_and(|stem| stem == base_name)
  {
    return Ok(current_exe);
  }

  let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  let mut search_dirs = Vec::new();

  push_candidate_dir(&mut search_dirs, Some(current_dir.to_path_buf()));
  push_candidate_dir(
    &mut search_dirs,
    current_dir.parent().map(std::path::Path::to_path_buf),
  );
  push_candidate_dir(
    &mut search_dirs,
    current_dir
      .parent()
      .and_then(|parent| parent.parent())
      .map(Path::to_path_buf),
  );
  push_candidate_dir(&mut search_dirs, Some(current_dir.join("binaries")));
  push_candidate_dir(
    &mut search_dirs,
    current_dir.parent().map(|parent| parent.join("binaries")),
  );
  push_candidate_dir(
    &mut search_dirs,
    current_dir
      .parent()
      .and_then(|parent| parent.parent())
      .map(|parent| parent.join("binaries")),
  );
  push_candidate_dir(&mut search_dirs, Some(manifest_dir.join("binaries")));
  push_candidate_dir(
    &mut search_dirs,
    Some(manifest_dir.join("target").join("debug")),
  );
  push_candidate_dir(
    &mut search_dirs,
    Some(manifest_dir.join("target").join("release")),
  );

  let mut exact_names = vec![unsuffixed_binary_name(base_name)];
  if let Some(target_name) = target_binary_name(base_name) {
    exact_names.push(target_name);
  }

  for dir in &search_dirs {
    for name in &exact_names {
      if name.is_empty() {
        continue;
      }

      let candidate = dir.join(name);
      if candidate.exists() {
        return Ok(candidate);
      }
    }

    if let Ok(entries) = std::fs::read_dir(dir) {
      for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && binary_matches_prefix(&path, base_name) {
          return Ok(path);
        }
      }
    }
  }

  Err(
    format!(
      "Failed to locate '{}' executable. Searched in: {}",
      base_name,
      search_dirs
        .iter()
        .map(|dir| dir.display().to_string())
        .collect::<Vec<_>>()
        .join(", ")
    )
    .into(),
  )
}

pub async fn start_proxy_process(
  upstream_url: Option<String>,
  port: Option<u16>,
) -> Result<ProxyConfig, Box<dyn std::error::Error>> {
  start_proxy_process_with_profile(upstream_url, port, None, Vec::new(), None).await
}

pub async fn start_proxy_process_with_profile(
  upstream_url: Option<String>,
  port: Option<u16>,
  profile_id: Option<String>,
  bypass_rules: Vec<String>,
  blocklist_file: Option<String>,
) -> Result<ProxyConfig, Box<dyn std::error::Error>> {
  let id = generate_proxy_id();
  let upstream = upstream_url.unwrap_or_else(|| "DIRECT".to_string());

  // Get available port if not specified
  let local_port = port.unwrap_or_else(|| {
    // Find an available port
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.local_addr().unwrap().port()
  });

  let config = ProxyConfig::new(id.clone(), upstream, Some(local_port))
    .with_profile_id(profile_id.clone())
    .with_bypass_rules(bypass_rules)
    .with_blocklist_file(blocklist_file);
  save_proxy_config(&config)?;

  // Log profile_id for debugging
  if let Some(ref pid) = profile_id {
    log::info!("Saved proxy config {} with profile_id: {}", id, pid);
  } else {
    log::info!("Saved proxy config {} without profile_id", id);
  }

  // Spawn proxy worker process in the background using std::process::Command
  // This ensures proper process detachment on Unix systems
  let exe = find_sidecar_executable("donut-proxy")?;

  #[cfg(unix)]
  {
    use std::os::unix::process::CommandExt;
    use std::process::Command as StdCommand;

    let mut cmd = StdCommand::new(&exe);
    cmd.arg("proxy-worker");
    cmd.arg("start");
    cmd.arg("--id");
    cmd.arg(&id);

    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());

    // Always log to file for diagnostics (both debug and release builds)
    let log_path = std::env::temp_dir().join(format!("donut-proxy-{}.log", id));
    if let Ok(file) = std::fs::File::create(&log_path) {
      log::info!("Proxy worker stderr will be logged to: {:?}", log_path);
      cmd.stderr(Stdio::from(file));
    } else {
      cmd.stderr(Stdio::null());
    }

    // Properly detach the process on Unix by creating a new session
    unsafe {
      cmd.pre_exec(|| {
        // Create a new process group so the process survives parent exit
        libc::setsid();

        // Set high priority so the proxy is killed last under resource pressure
        // Negative nice value = higher priority. Try -10, fall back to -5 if it fails.
        if libc::setpriority(libc::PRIO_PROCESS, 0, -10) != 0 {
          let _ = libc::setpriority(libc::PRIO_PROCESS, 0, -5);
        }

        Ok(())
      });
    }

    // Spawn detached process
    let child = cmd.spawn()?;
    let pid = child.id();

    register_proxy_pid(&id, pid);

    // Update config with PID
    let mut config_with_pid = config.clone();
    config_with_pid.pid = Some(pid);
    save_proxy_config(&config_with_pid)?;

    // Don't wait for the child - it's detached
    drop(child);
  }

  #[cfg(windows)]
  {
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::process::CommandExt;
    use std::process::Command as StdCommand;
    use windows::Win32::Foundation::{CloseHandle, SetHandleInformation, HANDLE, HANDLE_FLAGS};
    use windows::Win32::System::Threading::{
      OpenProcess, SetPriorityClass, ABOVE_NORMAL_PRIORITY_CLASS, PROCESS_SET_INFORMATION,
    };

    // Mark current stdout/stderr as non-inheritable so the spawned worker process
    // does not inherit pipe handles from our parent (prevents blocking when parent exits).
    let stdout_handle = std::io::stdout().as_raw_handle();
    let stderr_handle = std::io::stderr().as_raw_handle();
    const HANDLE_FLAG_INHERIT: u32 = 0x00000001;
    unsafe {
      if !stdout_handle.is_null() {
        let _ = SetHandleInformation(HANDLE(stdout_handle), HANDLE_FLAG_INHERIT, HANDLE_FLAGS(0));
      }
      if !stderr_handle.is_null() {
        let _ = SetHandleInformation(HANDLE(stderr_handle), HANDLE_FLAG_INHERIT, HANDLE_FLAGS(0));
      }
    }

    let mut cmd = StdCommand::new(&exe);
    cmd.arg("proxy-worker");
    cmd.arg("start");
    cmd.arg("--id");
    cmd.arg(&id);

    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());

    // Log to file for diagnostics (matching Unix behavior)
    let log_path = std::env::temp_dir().join(format!("donut-proxy-{}.log", id));
    if let Ok(file) = std::fs::File::create(&log_path) {
      log::info!("Proxy worker stderr will be logged to: {:?}", log_path);
      cmd.stderr(Stdio::from(file));
    } else {
      cmd.stderr(Stdio::null());
    }

    // On Windows, use DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP for proper detachment.
    const DETACHED_PROCESS: u32 = 0x00000008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
    cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);

    let child = cmd.spawn()?;
    let pid = child.id();

    // Set high priority so the proxy is killed last under resource pressure
    unsafe {
      if let Ok(handle) = OpenProcess(PROCESS_SET_INFORMATION, false, pid) {
        let _ = SetPriorityClass(handle, ABOVE_NORMAL_PRIORITY_CLASS);
        let _ = CloseHandle(handle);
      }
    }

    register_proxy_pid(&id, pid);

    // Update config with PID
    let mut config_with_pid = config.clone();
    config_with_pid.pid = Some(pid);
    save_proxy_config(&config_with_pid)?;

    drop(child);
  }

  // Give the process a moment to start up before checking
  tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

  // Wait for the worker to bind to the port and update config
  // Since we pre-allocated the port, the worker should bind immediately
  // We check quickly with short intervals to make startup fast
  let mut attempts = 0;
  let max_attempts = 40; // 4 seconds max (40 * 100ms) - give it more time to start

  loop {
    // Use shorter sleep for faster startup
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    if let Some(updated_config) = get_proxy_config(&id) {
      // Check if local_url is set (worker has bound and updated config)
      if let Some(ref local_url) = updated_config.local_url {
        if !local_url.is_empty() {
          if let Some(port) = updated_config.local_port {
            // Try to connect immediately - port should be ready since we pre-allocated it
            match tokio::time::timeout(
              tokio::time::Duration::from_millis(100),
              tokio::net::TcpStream::connect(("127.0.0.1", port)),
            )
            .await
            {
              Ok(Ok(_stream)) => {
                // Port is listening and accepting connections!
                return Ok(updated_config);
              }
              Ok(Err(_)) | Err(_) => {
                // Port not ready yet, continue waiting
              }
            }
          }
        }
      }
    }

    attempts += 1;
    if attempts >= max_attempts {
      // Try to get the config one more time for better error message
      if let Some(config) = get_proxy_config(&id) {
        // Check if process is still running
        let process_running = config.pid.map(is_process_running).unwrap_or(false);
        return Err(
          format!(
            "Proxy worker failed to start in time. Config: id={}, local_url={:?}, local_port={:?}, pid={:?}, process_running={}",
            config.id, config.local_url, config.local_port, config.pid, process_running
          )
          .into(),
        );
      }
      return Err(
        format!(
          "Proxy worker failed to start in time. Config not found for id: {}",
          id
        )
        .into(),
      );
    }
  }
}

pub async fn stop_proxy_process(id: &str) -> Result<bool, Box<dyn std::error::Error>> {
  let config = get_proxy_config(id);

  if let Some(config) = config {
    if let Some(pid) = config.pid {
      kill_pid_best_effort(pid);

      // Wait a bit for the process to exit
      tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

      remove_proxy_pid(id);

      // Delete the config file
      delete_proxy_config(id);
      return Ok(true);
    }
  }

  Ok(false)
}

pub async fn stop_all_proxy_processes() -> Result<(), Box<dyn std::error::Error>> {
  let configs = list_proxy_configs();
  for config in configs {
    let _ = stop_proxy_process(&config.id).await;
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::time::Duration;
  use tempfile::TempDir;

  // ============================================================
  // target_binary_name (env-driven cross-compile naming)
  // ============================================================

  // Env mutation is process-global; serialize the two tests that touch
  // TARGET so a parallel cargo-test run can't observe a half-swapped state.
  static TARGET_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

  #[test]
  fn target_binary_name_returns_none_without_env_var() {
    let _guard = TARGET_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let prev = std::env::var("TARGET").ok();
    std::env::remove_var("TARGET");
    let result = target_binary_name("donut-proxy");
    if let Some(v) = prev {
      std::env::set_var("TARGET", v);
    }
    assert!(
      result.is_none(),
      "without TARGET env var the helper must return None so the caller falls back to the unsuffixed name"
    );
  }

  #[test]
  fn target_binary_name_uses_env_var_with_target_suffix() {
    let _guard = TARGET_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let prev = std::env::var("TARGET").ok();
    std::env::set_var("TARGET", "x86_64-unknown-linux-gnu");
    let result = target_binary_name("donut-proxy");
    match prev {
      Some(v) => std::env::set_var("TARGET", v),
      None => std::env::remove_var("TARGET"),
    }
    let expected = if cfg!(windows) {
      "donut-proxy-x86_64-unknown-linux-gnu.exe"
    } else {
      "donut-proxy-x86_64-unknown-linux-gnu"
    };
    assert_eq!(result.as_deref(), Some(expected));
  }

  // ============================================================
  // unsuffixed_binary_name (platform-specific base name lookup)
  // ============================================================

  #[test]
  fn unsuffixed_binary_name_handles_known_base_names() {
    // On Unix the helper passes the base name through unchanged; on Windows
    // it appends .exe for known names. Both branches must accept the two
    // sidecars proxy_runner.rs actually ships.
    let proxy = unsuffixed_binary_name("donut-proxy");
    let daemon = unsuffixed_binary_name("donut-daemon");
    if cfg!(windows) {
      assert_eq!(proxy, "donut-proxy.exe");
      assert_eq!(daemon, "donut-daemon.exe");
    } else {
      assert_eq!(proxy, "donut-proxy");
      assert_eq!(daemon, "donut-daemon");
    }
  }

  #[test]
  #[cfg(windows)]
  fn unsuffixed_binary_name_returns_empty_for_unknown_base_on_windows() {
    // The Windows match arm has no _ => base.to_string() fallback, so any
    // unrecognised base name becomes an empty string. Lock that in so we
    // notice if someone "fixes" it without thinking about the search loop.
    assert_eq!(unsuffixed_binary_name("rando"), "");
  }

  #[test]
  #[cfg(not(windows))]
  fn unsuffixed_binary_name_passes_through_on_unix() {
    // On Unix any base name (including non-sidecars) is passed through; the
    // helper itself is not gatekeeping which binaries we look for.
    assert_eq!(unsuffixed_binary_name("rando"), "rando");
  }

  // ============================================================
  // binary_matches_prefix (search-dir filename matching)
  // ============================================================

  #[test]
  fn binary_matches_prefix_accepts_prefixed_name() {
    let path = PathBuf::from("/tmp/donut-proxy-x86_64-unknown-linux-gnu");
    #[cfg(not(windows))]
    assert!(binary_matches_prefix(&path, "donut-proxy"));
    #[cfg(windows)]
    {
      let path_exe = PathBuf::from("/tmp/donut-proxy-x86_64-pc-windows-msvc.exe");
      assert!(binary_matches_prefix(&path_exe, "donut-proxy"));
    }
  }

  #[test]
  fn binary_matches_prefix_rejects_exact_basename() {
    // Exact match has no trailing "-…" suffix, so the prefix helper rejects
    // it. find_sidecar_executable handles the exact-name case separately via
    // unsuffixed_binary_name; mixing them up would double-count the binary.
    let path = PathBuf::from("/tmp/donut-proxy");
    #[cfg(not(windows))]
    assert!(!binary_matches_prefix(&path, "donut-proxy"));
    #[cfg(windows)]
    {
      let path_exe = PathBuf::from("/tmp/donut-proxy.exe");
      assert!(!binary_matches_prefix(&path_exe, "donut-proxy"));
    }
  }

  #[test]
  fn binary_matches_prefix_rejects_unrelated_files() {
    // A file like "donut-proxyrc" superficially starts with "donut-proxy"
    // but is missing the "-" separator, so it must NOT match.
    let path = PathBuf::from("/tmp/donut-proxyrc");
    assert!(!binary_matches_prefix(&path, "donut-proxy"));
    let other = PathBuf::from("/tmp/some-other-tool");
    assert!(!binary_matches_prefix(&other, "donut-proxy"));
  }

  #[test]
  fn binary_matches_prefix_rejects_paths_without_filename() {
    // Paths that don't end in a file component (e.g. "/" or empty) must not
    // crash the helper — they return false cleanly.
    let root = PathBuf::from("/");
    assert!(!binary_matches_prefix(&root, "donut-proxy"));
  }

  // ============================================================
  // push_candidate_dir (search-path dedup helper)
  // ============================================================

  #[test]
  fn push_candidate_dir_skips_none() {
    let mut dirs = Vec::<PathBuf>::new();
    push_candidate_dir(&mut dirs, None);
    assert!(dirs.is_empty(), "None input must not push anything");
  }

  #[test]
  fn push_candidate_dir_appends_unique_dir() {
    let mut dirs = vec![PathBuf::from("/a"), PathBuf::from("/b")];
    push_candidate_dir(&mut dirs, Some(PathBuf::from("/c")));
    assert_eq!(
      dirs,
      vec![
        PathBuf::from("/a"),
        PathBuf::from("/b"),
        PathBuf::from("/c")
      ]
    );
  }

  #[test]
  fn push_candidate_dir_deduplicates() {
    // Real search builds visit `current_dir`, `current_dir.parent()`, etc.
    // which may overlap. The helper must keep the first occurrence and skip
    // later duplicates — otherwise the linear `read_dir` scan happens twice.
    let mut dirs = vec![PathBuf::from("/a")];
    push_candidate_dir(&mut dirs, Some(PathBuf::from("/a")));
    push_candidate_dir(&mut dirs, Some(PathBuf::from("/b")));
    push_candidate_dir(&mut dirs, Some(PathBuf::from("/a")));
    assert_eq!(dirs, vec![PathBuf::from("/a"), PathBuf::from("/b")]);
  }

  // ============================================================
  // find_sidecar_executable (lookup failure mode)
  // ============================================================

  #[test]
  fn find_sidecar_executable_errors_with_search_paths_for_missing_binary() {
    // A name that doesn't exist anywhere should bubble up an Err whose
    // message lists every search directory — that's the diagnostic the
    // caller surfaces to the user when the sidecar isn't installed.
    let result = find_sidecar_executable("this-binary-truly-does-not-exist-anywhere-12345");
    let err = result.expect_err("non-existent sidecar must Err");
    let msg = err.to_string();
    assert!(
      msg.contains("Failed to locate"),
      "error message must mention the failure: {msg}"
    );
    assert!(
      msg.contains("Searched in"),
      "error message must enumerate search paths so users can diagnose: {msg}"
    );
  }

  // ============================================================
  // register_proxy_pid / lookup_proxy_pid / remove_proxy_pid
  // ============================================================

  fn unique_id(label: &str) -> String {
    // The PROXY_PROCESSES map is process-global, so every test that touches
    // it needs a name that can't collide with any other concurrent test run.
    format!(
      "test-{label}-{}-{}",
      std::process::id(),
      rand::random::<u64>()
    )
  }

  #[test]
  fn register_proxy_pid_then_lookup_returns_pid() {
    let id = unique_id("reg-lookup");
    register_proxy_pid(&id, 4242);
    assert_eq!(lookup_proxy_pid(&id), Some(4242));
    // Cleanup so we don't litter the global map for downstream tests.
    remove_proxy_pid(&id);
  }

  #[test]
  fn register_proxy_pid_overwrites_previous_pid() {
    // If start_proxy_process is called twice for the same id (rare, but a
    // restart scenario), the new PID must win — otherwise stop_proxy_process
    // would try to kill the wrong worker.
    let id = unique_id("overwrite");
    register_proxy_pid(&id, 1);
    register_proxy_pid(&id, 2);
    assert_eq!(lookup_proxy_pid(&id), Some(2));
    remove_proxy_pid(&id);
  }

  #[test]
  fn remove_proxy_pid_returns_false_for_unknown_id() {
    // remove_proxy_pid must be safe to call on an id we never registered —
    // stop_proxy_process invokes it unconditionally and we don't want a
    // panic if the in-memory map lost the entry (e.g. process restart).
    let id = unique_id("never");
    assert!(!remove_proxy_pid(&id));
    assert_eq!(lookup_proxy_pid(&id), None);
  }

  #[test]
  fn lookup_proxy_pid_returns_none_for_unknown_id() {
    let id = unique_id("unknown");
    assert_eq!(lookup_proxy_pid(&id), None);
  }

  #[test]
  fn remove_proxy_pid_then_lookup_returns_none() {
    let id = unique_id("remove");
    register_proxy_pid(&id, 99);
    assert!(remove_proxy_pid(&id));
    assert_eq!(lookup_proxy_pid(&id), None);
    // Second remove is a no-op — entry already gone.
    assert!(!remove_proxy_pid(&id));
  }

  // ============================================================
  // kill_pid_best_effort + stop_proxy_process (real subprocess)
  // ============================================================

  fn spawn_long_running_child() -> std::process::Child {
    // tail -f /dev/null blocks forever and exists on every Unix CI runner.
    // We mirror the helper from browser_runner.rs::tests so the kill-path
    // pattern stays consistent across the codebase.
    #[cfg(unix)]
    {
      std::process::Command::new("tail")
        .args(["-f", "/dev/null"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("failed to spawn tail")
    }
    #[cfg(windows)]
    {
      std::process::Command::new("cmd")
        .args(["/C", "ping -n 60 127.0.0.1 > NUL"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("failed to spawn cmd")
    }
  }

  fn pid_is_alive(pid: u32) -> bool {
    use sysinfo::{Pid, System};
    let sys = System::new_all();
    sys.process(Pid::from(pid as usize)).is_some()
  }

  #[tokio::test(flavor = "current_thread")]
  #[cfg(any(target_os = "macos", target_os = "linux"))]
  async fn kill_pid_best_effort_terminates_a_live_subprocess() {
    let mut child = spawn_long_running_child();
    let pid = child.id();
    assert!(pid_is_alive(pid), "child must be alive after spawn");

    kill_pid_best_effort(pid);

    // SIGTERM is async; give the OS a moment to actually reap.
    for _ in 0..20 {
      if !pid_is_alive(pid) {
        break;
      }
      tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(!pid_is_alive(pid), "process must be dead after kill");
    let _ = child.wait();
  }

  #[tokio::test(flavor = "current_thread")]
  #[cfg(any(target_os = "macos", target_os = "linux"))]
  async fn kill_pid_best_effort_does_not_panic_on_dead_pid() {
    // Spawn-kill-wait, then call our helper. It must NOT panic on a stale
    // PID; the regression case is a proxy_workers/*.json file pointing at a
    // PID whose worker died sometime between save and stop.
    let mut child = spawn_long_running_child();
    let pid = child.id();
    let _ = child.kill();
    let _ = child.wait();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(!pid_is_alive(pid));

    kill_pid_best_effort(pid); // must not panic
  }

  #[tokio::test(flavor = "current_thread")]
  #[cfg(any(target_os = "macos", target_os = "linux"))]
  async fn kill_pid_best_effort_does_not_panic_on_never_existed_pid() {
    // u32::MAX is virtually guaranteed to never be a real PID on any
    // current OS, mirroring the never-existed-PID case in browser_runner.
    let pid: u32 = u32::MAX;
    assert!(!pid_is_alive(pid));
    kill_pid_best_effort(pid); // must not panic
  }

  // ---- stop_proxy_process via on-disk config + real PID ----

  /// Allocate a temp cache dir for this test so proxy_workers_dir() resolves
  /// to an isolated location. Returned guard restores the previous binding
  /// on drop. The temp dir itself is returned so the caller can keep it
  /// alive for the duration of the test.
  fn isolated_cache() -> (TempDir, crate::app_dirs::TestDirGuard) {
    let temp = TempDir::new().expect("tempdir");
    let guard = crate::app_dirs::set_test_cache_dir(temp.path().to_path_buf());
    (temp, guard)
  }

  #[tokio::test(flavor = "current_thread")]
  async fn stop_proxy_process_returns_false_for_unknown_id() {
    let (_t, _g) = isolated_cache();
    // No config saved — stop must report "nothing to stop" cleanly.
    let result = stop_proxy_process("definitely-not-a-real-proxy-id").await;
    assert!(matches!(result, Ok(false)), "got {result:?}");
  }

  #[tokio::test(flavor = "current_thread")]
  async fn stop_proxy_process_returns_false_when_config_has_no_pid() {
    let (_t, _g) = isolated_cache();
    let id = unique_id("nopid");
    let config = ProxyConfig::new(id.clone(), "DIRECT".to_string(), Some(0));
    save_proxy_config(&config).expect("save");
    assert!(config.pid.is_none());

    let result = stop_proxy_process(&id).await;
    assert!(matches!(result, Ok(false)), "got {result:?}");
    // Config without a PID is left alone — stop_proxy_process only removes
    // the file on the kill path. Lock that in so we notice if the contract
    // ever changes.
    assert!(get_proxy_config(&id).is_some());
  }

  #[tokio::test(flavor = "current_thread")]
  #[cfg(any(target_os = "macos", target_os = "linux"))]
  async fn stop_proxy_process_kills_subprocess_and_deletes_config() {
    let (_t, _g) = isolated_cache();
    let id = unique_id("kill");

    let child = spawn_long_running_child();
    let pid = child.id();
    // Detach: we let stop_proxy_process do the killing and reaping work
    // (a wait() race here would interfere with the kill verification).
    drop(child);
    assert!(pid_is_alive(pid));

    let mut config = ProxyConfig::new(id.clone(), "DIRECT".to_string(), Some(0));
    config.pid = Some(pid);
    save_proxy_config(&config).expect("save");
    register_proxy_pid(&id, pid);

    let result = stop_proxy_process(&id).await;
    assert!(matches!(result, Ok(true)), "got {result:?}");

    // Process must be dead, config file gone, in-memory PID forgotten.
    for _ in 0..20 {
      if !pid_is_alive(pid) {
        break;
      }
      tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(!pid_is_alive(pid));
    assert!(
      get_proxy_config(&id).is_none(),
      "config file should be deleted"
    );
    assert_eq!(
      lookup_proxy_pid(&id),
      None,
      "in-memory PID should be cleared"
    );
  }

  #[tokio::test(flavor = "current_thread")]
  #[cfg(any(target_os = "macos", target_os = "linux"))]
  async fn stop_proxy_process_is_ok_when_pid_is_already_dead() {
    // Regression scenario: app crashed, on next launch the proxy_workers
    // dir has a JSON pointing at a PID whose worker died long ago. stop
    // must NOT panic and SHOULD still clean up the file.
    let (_t, _g) = isolated_cache();
    let id = unique_id("stale");

    let mut child = spawn_long_running_child();
    let pid = child.id();
    let _ = child.kill();
    let _ = child.wait();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(!pid_is_alive(pid));

    let mut config = ProxyConfig::new(id.clone(), "DIRECT".to_string(), Some(0));
    config.pid = Some(pid);
    save_proxy_config(&config).expect("save");

    let result = stop_proxy_process(&id).await;
    assert!(matches!(result, Ok(true)), "got {result:?}");
    assert!(get_proxy_config(&id).is_none());
  }

  #[tokio::test(flavor = "current_thread")]
  async fn stop_proxy_process_is_ok_for_never_existed_pid_in_config() {
    // Another stale-config flavor: PID was never real (or has been reused
    // by some other unrelated process — we can't tell, so we just SIGTERM
    // and clean up the file). Must not panic regardless.
    let (_t, _g) = isolated_cache();
    let id = unique_id("phantom");

    let mut config = ProxyConfig::new(id.clone(), "DIRECT".to_string(), Some(0));
    config.pid = Some(u32::MAX);
    save_proxy_config(&config).expect("save");

    let result = stop_proxy_process(&id).await;
    assert!(matches!(result, Ok(true)), "got {result:?}");
    assert!(get_proxy_config(&id).is_none());
  }

  #[tokio::test(flavor = "current_thread")]
  async fn stop_all_proxy_processes_is_ok_on_empty_dir() {
    let (_t, _g) = isolated_cache();
    // Empty proxy_workers_dir — must return Ok and not even create the dir.
    let result = stop_all_proxy_processes().await;
    assert!(result.is_ok(), "got {result:?}");
  }
}
