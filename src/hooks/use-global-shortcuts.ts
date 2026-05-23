"use client";

import * as React from "react";

/**
 * Pure shortcut matcher — exported separately from the React hook so we can
 * unit-test the rules without a DOM. Returns the id of the matched shortcut
 * or null. Modifier semantics: `mod` matches Cmd on macOS and Ctrl
 * everywhere else (the standard "the OS primary modifier" convention).
 *
 * The shape of `ev` is the structural subset of `KeyboardEvent` we actually
 * read; using a structural type keeps the helper trivially testable from
 * Node without jsdom.
 */
export interface ShortcutKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type ShortcutId = "focus-search" | "create-profile" | "close-or-clear";

export interface ShortcutPlatform {
  isMac: boolean;
}

export function matchShortcut(
  ev: ShortcutKeyEvent,
  platform: ShortcutPlatform,
): ShortcutId | null {
  const primary = platform.isMac ? ev.metaKey : ev.ctrlKey;
  // Reject combos that include the *other* primary modifier — on macOS we
  // don't want Ctrl+K to also match, otherwise muscle-memory from one OS
  // fires shortcuts on the other and confuses users who switch.
  const wrongPrimary = platform.isMac ? ev.ctrlKey : ev.metaKey;
  if (wrongPrimary) return null;

  if (primary && !ev.altKey && !ev.shiftKey) {
    const key = ev.key.toLowerCase();
    if (key === "k") return "focus-search";
    if (key === "n") return "create-profile";
  }

  if (
    !primary &&
    !ev.altKey &&
    !ev.shiftKey &&
    !ev.metaKey &&
    !ev.ctrlKey &&
    ev.key === "Escape"
  ) {
    return "close-or-clear";
  }

  return null;
}

/**
 * Returns true when the event originated inside a text-entry control. We
 * don't intercept shortcuts while the user is typing — Cmd+K should still
 * open the OS-level command palette in a `<textarea>`, and Cmd+N inside a
 * form field is a no-op rather than "create new profile".
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.getAttribute("contenteditable") === "true") return true;
  if (target.getAttribute("role") === "textbox") return true;
  return false;
}

export interface UseGlobalShortcutsOptions {
  onFocusSearch?: () => void;
  onCreateProfile?: () => void;
  /**
   * Override platform detection. Defaults to `navigator.platform.includes("Mac")`.
   * Exposed for tests / explicit control; almost no caller should need this.
   */
  isMac?: boolean;
  /**
   * Skip installing the listener (e.g. while a modal is intentionally
   * capturing all input). Defaults to true.
   */
  enabled?: boolean;
}

/**
 * App-wide keyboard shortcuts. Currently:
 *   - Cmd/Ctrl+K → focus the search input
 *   - Cmd/Ctrl+N → open the Create Profile dialog
 *
 * Esc is handled by the action bar / individual dialogs (Radix already wires
 * it up), so it's recognised by `matchShortcut` for completeness but the
 * hook does not bind a handler for it.
 */
export function useGlobalShortcuts(opts: UseGlobalShortcutsOptions): void {
  const { onFocusSearch, onCreateProfile, isMac, enabled = true } = opts;

  // Stash handlers in a ref so the listener doesn't get re-bound on every
  // render — the parent typically passes inline arrow functions.
  const handlersRef = React.useRef({ onFocusSearch, onCreateProfile });
  React.useEffect(() => {
    handlersRef.current = { onFocusSearch, onCreateProfile };
  }, [onFocusSearch, onCreateProfile]);

  React.useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const platform: ShortcutPlatform = {
      isMac:
        typeof isMac === "boolean"
          ? isMac
          : typeof navigator !== "undefined" &&
            navigator.platform.toLowerCase().includes("mac"),
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const matched = matchShortcut(event, platform);
      if (!matched) return;
      if (matched !== "close-or-clear" && isTypingTarget(event.target)) {
        return;
      }
      const handlers = handlersRef.current;
      if (matched === "focus-search" && handlers.onFocusSearch) {
        event.preventDefault();
        handlers.onFocusSearch();
      } else if (matched === "create-profile" && handlers.onCreateProfile) {
        event.preventDefault();
        handlers.onCreateProfile();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled, isMac]);
}

/**
 * Convenience helper: focus the search input by its well-known DOM id.
 * Used by the default Cmd/Ctrl+K handler and by the empty-state CTA.
 */
export function focusGlobalSearch(): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById("donut-search-input");
  if (el instanceof HTMLInputElement) {
    el.focus();
    el.select();
  }
}
