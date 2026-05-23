//! In-process system tray icon for the main Donut Browser window.
//!
//! This is intentionally separate from `daemon::tray` (which is part of the
//! standalone `donut-daemon` binary that's currently disabled — see
//! `daemon::services` for the unresolved API-server-without-AppHandle work).
//! Wiring tray support directly into the main Tauri process gives us the
//! "close window → hide to tray" behaviour without depending on that
//! refactor.
//!
//! Behaviour:
//!   - The tray icon is only installed when `AppSettings.minimize_to_tray`
//!     is true.
//!   - The menu has two items: "Show Donut Browser" (re-shows the main
//!     window and focuses it) and "Quit" (exits the app).
//!   - Left-clicking the tray icon on macOS/Linux toggles the main window
//!     (Tauri's default). On Windows it follows platform convention.
//!   - Window-close interception is wired separately in `lib.rs` so closing
//!     the window hides it instead of quitting when the setting is on.

use tauri::menu::{Menu, MenuEvent, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Runtime};

const TRAY_ICON_ID: &str = "donut-main-tray";
const MENU_ITEM_SHOW: &str = "tray-show-window";
const MENU_ITEM_QUIT: &str = "tray-quit";

/// Install the tray icon on the running app. Idempotent: re-calling with the
/// same `AppHandle` after a tray is already present is a no-op.
///
/// Returns `Ok(true)` when a new tray was installed, `Ok(false)` when one
/// already existed, and an error string when Tauri rejected the install
/// (typically because the platform doesn't support tray icons or the bundled
/// PNG failed to decode).
pub fn install_tray<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
  if app.tray_by_id(TRAY_ICON_ID).is_some() {
    return Ok(false);
  }

  let menu = build_menu(app).map_err(|e| format!("Failed to build tray menu: {e}"))?;

  let tray_builder = TrayIconBuilder::with_id(TRAY_ICON_ID)
    .tooltip("Donut Browser")
    .menu(&menu)
    .on_menu_event(|app, event| handle_menu_event(app, &event));

  // Use the bundled app icon. On macOS this is auto-templated by the system.
  let tray_builder = match app.default_window_icon() {
    Some(icon) => tray_builder.icon(icon.clone()),
    None => tray_builder,
  };

  tray_builder
    .build(app)
    .map_err(|e| format!("Failed to install tray icon: {e}"))?;

  Ok(true)
}

/// Remove the tray icon if it's installed. Used when the user toggles the
/// setting off without restarting the app.
pub fn uninstall_tray<R: Runtime>(app: &AppHandle<R>) -> bool {
  app.remove_tray_by_id(TRAY_ICON_ID).is_some()
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Menu<R>, tauri::Error> {
  let show_item = MenuItem::with_id(
    app,
    MENU_ITEM_SHOW,
    "Show Donut Browser",
    true,
    None::<&str>,
  )?;
  let quit_item = MenuItem::with_id(app, MENU_ITEM_QUIT, "Quit", true, None::<&str>)?;
  Menu::with_items(app, &[&show_item, &quit_item])
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: &MenuEvent) {
  match event.id().as_ref() {
    MENU_ITEM_SHOW => {
      if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = window.show() {
          log::warn!("[tray] Failed to show main window: {e}");
        }
        if let Err(e) = window.set_focus() {
          log::warn!("[tray] Failed to focus main window: {e}");
        }
      } else {
        log::warn!("[tray] Tray 'Show' clicked but main window is missing");
      }
    }
    MENU_ITEM_QUIT => {
      log::info!("[tray] Quit requested via tray menu");
      app.exit(0);
    }
    other => {
      log::debug!("[tray] Unhandled tray menu event: {other}");
    }
  }
}

/// IDs exported for tests / external probing. Keep these `pub(crate)` rather
/// than `pub` so downstream code can't accidentally hard-code them.
#[cfg(test)]
pub(crate) const TEST_TRAY_ICON_ID: &str = TRAY_ICON_ID;
#[cfg(test)]
pub(crate) const TEST_MENU_ITEM_SHOW: &str = MENU_ITEM_SHOW;
#[cfg(test)]
pub(crate) const TEST_MENU_ITEM_QUIT: &str = MENU_ITEM_QUIT;

#[cfg(test)]
mod tests {
  use super::*;

  // We can't easily instantiate a real AppHandle in a unit test (Tauri's
  // mock_builder requires a runtime and bundled resources), so these tests
  // focus on the small piece of logic that has no Tauri dependencies: the
  // menu IDs. The integration of install_tray / uninstall_tray / menu event
  // dispatch is verified manually via the dev build (and would benefit from
  // a Tauri WebDriver / webview-spec e2e harness in the future).

  #[test]
  fn tray_constants_are_stable() {
    // These IDs are part of the app's contract with itself — changing them
    // breaks any persistence we add later (e.g. remembering tray menu
    // open/close state). Pin them.
    assert_eq!(TEST_TRAY_ICON_ID, "donut-main-tray");
    assert_eq!(TEST_MENU_ITEM_SHOW, "tray-show-window");
    assert_eq!(TEST_MENU_ITEM_QUIT, "tray-quit");
  }

  #[test]
  fn menu_constants_are_distinct() {
    // If two menu items shared an ID, the menu event handler would dispatch
    // ambiguously and the user would see the wrong action on click.
    assert_ne!(TEST_MENU_ITEM_SHOW, TEST_MENU_ITEM_QUIT);
    assert_ne!(TEST_TRAY_ICON_ID, TEST_MENU_ITEM_SHOW);
    assert_ne!(TEST_TRAY_ICON_ID, TEST_MENU_ITEM_QUIT);
  }
}
