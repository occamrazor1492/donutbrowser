//! Panic-aware spawn helper.
//!
//! Replaces bare `tauri::async_runtime::spawn(async move { ... })` calls
//! whose JoinHandle was being dropped on the floor. If the spawned
//! future panicked the runtime swallowed it and nothing reached the
//! logs — silent task leakage. With `spawn_logged` the future is run
//! through `tokio::spawn` (which catches panics and surfaces them as
//! `JoinError`), the panic / cancellation is logged with the call-site
//! label, and the result still flows back via the returned JoinHandle.
//!
//! Most callers fire-and-forget, same shape as before, just safer:
//! ```ignore
//! task_supervisor::spawn_logged("delete_proxy::s3_delete", async move {
//!   sync_engine.delete_proxy(&id).await
//! });
//! ```

use std::future::Future;

use tauri::async_runtime::{spawn, JoinHandle};

/// Spawn `future` on the Tauri async runtime, logging any panic with
/// `label` as the source tag. The returned `JoinHandle` resolves once
/// the inner future finishes (or panics); the panic is intercepted by
/// `tokio::spawn` inside and gets logged before the handle resolves to
/// `()`, so even fire-and-forget callers don't lose the signal.
pub fn spawn_logged<F>(label: &'static str, future: F) -> JoinHandle<()>
where
  F: Future<Output = ()> + Send + 'static,
{
  spawn(async move {
    match tokio::spawn(future).await {
      Ok(()) => {}
      Err(err) if err.is_panic() => {
        log::error!(
          "background task `{label}` panicked: {err}; check stderr above for the unwind trace"
        );
      }
      Err(err) if err.is_cancelled() => {
        log::warn!("background task `{label}` was cancelled");
      }
      Err(err) => {
        log::error!("background task `{label}` failed: {err}");
      }
    }
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::atomic::{AtomicBool, Ordering};
  use std::sync::Arc;

  #[tokio::test]
  async fn spawn_logged_runs_to_completion() {
    let ran = Arc::new(AtomicBool::new(false));
    let ran_clone = Arc::clone(&ran);
    let handle = spawn_logged("test_completion", async move {
      ran_clone.store(true, Ordering::SeqCst);
    });
    handle.await.expect("outer join");
    assert!(ran.load(Ordering::SeqCst));
  }

  #[tokio::test]
  async fn spawn_logged_catches_panic_without_unwinding_the_caller() {
    // If the panic weren't caught, this `.await` would propagate the
    // unwind and fail the test. The point is that it doesn't.
    let handle = spawn_logged("test_panic_capture", async {
      panic!("intentional");
    });
    handle
      .await
      .expect("outer join completes despite inner panic");
  }
}
