//! Lightweight recurring task scheduler.
//!
//! The user can persist "every N minutes, do X" rules. A background
//! tokio task ticks once per minute, walks the persisted set, and fires
//! due tasks via tauri events so the rest of the app can react without
//! coupling to this module. Persistence is a flat JSON file alongside
//! the other manager files (settings.json, templates.json) so a
//! backup/restore round-trip is straightforward.
//!
//! Intentionally NOT cron syntax: full crontab parsing is overkill for
//! the use cases this is meant to cover (sync every 4 hours, snapshot
//! cookies nightly). Interval-in-minutes is plenty, and easy to test.
//! If users start asking for "every Tuesday at 03:00", we can swap in a
//! real cron parser later — the type is opaque enough that the change
//! is local.

use std::path::PathBuf;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScheduledAction {
  /// Launch a profile (UUID stored in `target_id`).
  LaunchProfile,
  /// Trigger sync for a profile.
  SyncProfile,
  /// Take a cookie snapshot of a profile.
  SnapshotCookies,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTask {
  pub id: String,
  pub name: String,
  pub action: ScheduledAction,
  /// Profile id (or other action-specific target id).
  pub target_id: String,
  /// Recurrence in minutes. 1..=10080 (1 minute .. 1 week).
  pub interval_minutes: u32,
  pub enabled: bool,
  /// Epoch seconds of the last successful fire; None if never fired.
  #[serde(default)]
  pub last_run: Option<u64>,
  pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct StoredTasks {
  #[serde(default)]
  tasks: Vec<ScheduledTask>,
}

pub struct TaskScheduler {
  cache: RwLock<Option<Vec<ScheduledTask>>>,
}

impl TaskScheduler {
  pub(crate) fn new() -> Self {
    Self {
      cache: RwLock::new(None),
    }
  }

  pub fn instance() -> &'static TaskScheduler {
    &TASK_SCHEDULER
  }

  fn file_path(&self) -> PathBuf {
    crate::app_dirs::settings_dir().join("scheduled_tasks.json")
  }

  fn read_disk(&self) -> Result<Vec<ScheduledTask>, String> {
    let path = self.file_path();
    if !path.exists() {
      return Ok(Vec::new());
    }
    let body = std::fs::read_to_string(&path).map_err(|e| format!("read tasks: {e}"))?;
    let parsed: StoredTasks =
      serde_json::from_str(&body).map_err(|e| format!("parse tasks: {e}"))?;
    Ok(parsed.tasks)
  }

  fn write_disk(&self, items: &[ScheduledTask]) -> Result<(), String> {
    let dir = crate::app_dirs::settings_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("create dir: {e}"))?;
    let payload = StoredTasks {
      tasks: items.to_vec(),
    };
    let body = serde_json::to_string_pretty(&payload).map_err(|e| format!("encode tasks: {e}"))?;
    std::fs::write(self.file_path(), body).map_err(|e| format!("write tasks: {e}"))?;
    Ok(())
  }

  pub fn list(&self) -> Result<Vec<ScheduledTask>, String> {
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

  pub fn create(
    &self,
    name: String,
    action: ScheduledAction,
    target_id: String,
    interval_minutes: u32,
  ) -> Result<ScheduledTask, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
      return Err("Task name cannot be empty".to_string());
    }
    if target_id.trim().is_empty() {
      return Err("Task target id cannot be empty".to_string());
    }
    if !(1..=10080).contains(&interval_minutes) {
      return Err("interval_minutes must be between 1 and 10080 (1 min .. 1 week)".to_string());
    }
    let task = ScheduledTask {
      id: uuid::Uuid::new_v4().to_string(),
      name: trimmed_name.to_string(),
      action,
      target_id: target_id.trim().to_string(),
      interval_minutes,
      enabled: true,
      last_run: None,
      created_at: now_epoch_secs(),
    };
    let mut current = self.list()?;
    current.push(task.clone());
    self.write_disk(&current)?;
    if let Ok(mut guard) = self.cache.write() {
      *guard = Some(current);
    }
    Ok(task)
  }

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

  pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<bool, String> {
    let mut current = self.list()?;
    let mut changed = false;
    for task in current.iter_mut() {
      if task.id == id {
        task.enabled = enabled;
        changed = true;
        break;
      }
    }
    if changed {
      self.write_disk(&current)?;
      if let Ok(mut guard) = self.cache.write() {
        *guard = Some(current);
      }
    }
    Ok(changed)
  }

  /// Persist a `last_run` timestamp after a task fires successfully.
  /// Reserved for the tick loop in a follow-up commit; kept on the
  /// public API + unit-tested now so the loop doesn't need to re-touch
  /// the storage layer.
  #[allow(dead_code)]
  pub fn mark_fired(&self, id: &str, at: u64) -> Result<(), String> {
    let mut current = self.list()?;
    for task in current.iter_mut() {
      if task.id == id {
        task.last_run = Some(at);
        break;
      }
    }
    self.write_disk(&current)?;
    if let Ok(mut guard) = self.cache.write() {
      *guard = Some(current);
    }
    Ok(())
  }
}

fn now_epoch_secs() -> u64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0)
}

/// Pure decision: should the task fire at `now`? Encapsulates the
/// last_run + interval arithmetic so the scheduler loop stays tiny
/// and the rule is unit-testable without spinning up tokio.
/// Reserved for the tick loop in a follow-up commit.
#[allow(dead_code)]
pub fn is_due(task: &ScheduledTask, now: u64) -> bool {
  if !task.enabled {
    return false;
  }
  let interval_secs = (task.interval_minutes as u64) * 60;
  match task.last_run {
    None => now.saturating_sub(task.created_at) >= interval_secs,
    Some(last) => now.saturating_sub(last) >= interval_secs,
  }
}

lazy_static::lazy_static! {
  static ref TASK_SCHEDULER: TaskScheduler = TaskScheduler::new();
}

// ── Tauri commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_scheduled_tasks() -> Result<Vec<ScheduledTask>, String> {
  TaskScheduler::instance().list()
}

#[tauri::command]
pub async fn create_scheduled_task(
  name: String,
  action: ScheduledAction,
  target_id: String,
  interval_minutes: u32,
) -> Result<ScheduledTask, String> {
  TaskScheduler::instance().create(name, action, target_id, interval_minutes)
}

#[tauri::command]
pub async fn delete_scheduled_task(task_id: String) -> Result<bool, String> {
  TaskScheduler::instance().delete(&task_id)
}

#[tauri::command]
pub async fn set_scheduled_task_enabled(task_id: String, enabled: bool) -> Result<bool, String> {
  TaskScheduler::instance().set_enabled(&task_id, enabled)
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
  use super::*;
  use tempfile::TempDir;

  fn fresh() -> (TaskScheduler, TempDir, crate::app_dirs::TestDirGuard) {
    let temp = TempDir::new().unwrap();
    let guard = crate::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    (TaskScheduler::new(), temp, guard)
  }

  #[test]
  fn create_returns_record_with_id_and_defaults() {
    let (s, _t, _g) = fresh();
    let task = s
      .create(
        "nightly sync".to_string(),
        ScheduledAction::SyncProfile,
        "profile-uuid".to_string(),
        60,
      )
      .unwrap();
    assert!(!task.id.is_empty());
    assert_eq!(task.name, "nightly sync");
    assert_eq!(task.interval_minutes, 60);
    assert!(task.enabled);
    assert!(task.last_run.is_none());
  }

  #[test]
  fn create_rejects_empty_name_or_target_or_bad_interval() {
    let (s, _t, _g) = fresh();
    assert!(s
      .create(
        "".to_string(),
        ScheduledAction::SyncProfile,
        "x".to_string(),
        60
      )
      .is_err());
    assert!(s
      .create(
        "n".to_string(),
        ScheduledAction::SyncProfile,
        "".to_string(),
        60
      )
      .is_err());
    assert!(s
      .create(
        "n".to_string(),
        ScheduledAction::SyncProfile,
        "x".to_string(),
        0
      )
      .is_err());
    assert!(s
      .create(
        "n".to_string(),
        ScheduledAction::SyncProfile,
        "x".to_string(),
        10081,
      )
      .is_err());
  }

  #[test]
  fn list_then_delete_round_trip() {
    let (s, _t, _g) = fresh();
    let t1 = s
      .create(
        "a".to_string(),
        ScheduledAction::SyncProfile,
        "p1".to_string(),
        30,
      )
      .unwrap();
    let _t2 = s
      .create(
        "b".to_string(),
        ScheduledAction::LaunchProfile,
        "p2".to_string(),
        60,
      )
      .unwrap();
    assert_eq!(s.list().unwrap().len(), 2);
    assert!(s.delete(&t1.id).unwrap());
    assert_eq!(s.list().unwrap().len(), 1);
    assert!(!s.delete(&t1.id).unwrap());
  }

  #[test]
  fn set_enabled_toggles_the_flag() {
    let (s, _t, _g) = fresh();
    let task = s
      .create(
        "x".to_string(),
        ScheduledAction::SyncProfile,
        "p".to_string(),
        5,
      )
      .unwrap();
    assert!(s.set_enabled(&task.id, false).unwrap());
    let listed = s.list().unwrap();
    assert!(!listed[0].enabled);
    assert!(s.set_enabled(&task.id, true).unwrap());
    let listed2 = s.list().unwrap();
    assert!(listed2[0].enabled);
    assert!(!s.set_enabled("nonexistent", true).unwrap());
  }

  #[test]
  fn mark_fired_persists_timestamp() {
    let (s, _t, _g) = fresh();
    let task = s
      .create(
        "x".to_string(),
        ScheduledAction::SyncProfile,
        "p".to_string(),
        5,
      )
      .unwrap();
    s.mark_fired(&task.id, 1_700_000_000).unwrap();
    let listed = s.list().unwrap();
    assert_eq!(listed[0].last_run, Some(1_700_000_000));
  }

  fn task_with(interval: u32, last_run: Option<u64>, enabled: bool) -> ScheduledTask {
    ScheduledTask {
      id: "t".to_string(),
      name: "n".to_string(),
      action: ScheduledAction::SyncProfile,
      target_id: "p".to_string(),
      interval_minutes: interval,
      enabled,
      last_run,
      created_at: 1_000_000,
    }
  }

  #[test]
  fn is_due_false_when_disabled() {
    let t = task_with(5, None, false);
    assert!(!is_due(&t, 9_999_999_999));
  }

  #[test]
  fn is_due_false_before_interval_elapses() {
    // never fired, created at 1_000_000, interval 5min = 300s.
    let t = task_with(5, None, true);
    assert!(!is_due(&t, 1_000_100));
    assert!(is_due(&t, 1_000_300));
  }

  #[test]
  fn is_due_uses_last_run_when_present() {
    let t = task_with(10, Some(2_000_000), true);
    assert!(!is_due(&t, 2_000_300));
    assert!(is_due(&t, 2_000_600));
  }

  #[test]
  fn is_due_handles_clock_skew_without_panic() {
    // If `now` is somehow before created_at / last_run (clock skew,
    // restored backup, etc.), saturating_sub keeps us at 0 so the
    // task simply isn't due rather than panicking on subtraction
    // overflow.
    let t = task_with(5, Some(5_000_000), true);
    assert!(!is_due(&t, 1_000_000));
    let t2 = task_with(5, None, true);
    assert!(!is_due(&t2, 0));
  }

  #[test]
  fn tasks_persist_across_scheduler_instances() {
    let temp = TempDir::new().unwrap();
    let _g = crate::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    {
      let s = TaskScheduler::new();
      s.create(
        "persisted".to_string(),
        ScheduledAction::SyncProfile,
        "p".to_string(),
        15,
      )
      .unwrap();
    }
    let s2 = TaskScheduler::new();
    let listed = s2.list().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, "persisted");
  }
}
