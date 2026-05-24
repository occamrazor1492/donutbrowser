"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Persisted profile-table view filter.
 *
 * Stored in localStorage (not the Tauri settings file) so it's per-device
 * by design — a user with very different workflows on laptop vs desktop
 * shouldn't have to re-set their saved views every time. Schema is
 * intentionally minimal and lives behind the hook so a future Rust-side
 * implementation can swap the storage without churning callers.
 */
export interface SavedView {
  id: string;
  name: string;
  /** Substring search applied to name/note/tags. */
  searchQuery: string;
  /** Group id filter, or null for "All groups". */
  selectedGroupId: string | null;
  createdAt: number;
}

const STORAGE_KEY = "donut.savedTableViews.v1";

function readStorage(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: drop entries that don't match the expected shape rather
    // than crashing the whole hook.
    return parsed.filter(
      (v: unknown): v is SavedView =>
        typeof v === "object" &&
        v != null &&
        typeof (v as SavedView).id === "string" &&
        typeof (v as SavedView).name === "string",
    );
  } catch {
    return [];
  }
}

function writeStorage(views: SavedView[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
  } catch (err) {
    // localStorage can throw QuotaExceededError; nothing actionable here
    // beyond logging — the user's just lost the most recent save.
    console.warn("[saved-views] failed to persist:", err);
  }
}

export interface UseSavedViewsApi {
  views: SavedView[];
  save: (
    name: string,
    spec: Pick<SavedView, "searchQuery" | "selectedGroupId">,
  ) => SavedView;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
}

export function useSavedViews(): UseSavedViewsApi {
  const [views, setViews] = useState<SavedView[]>([]);

  useEffect(() => {
    setViews(readStorage());
  }, []);

  const save = useCallback(
    (
      name: string,
      spec: Pick<SavedView, "searchQuery" | "selectedGroupId">,
    ): SavedView => {
      const trimmed = name.trim() || "Untitled view";
      const view: SavedView = {
        id: `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: trimmed,
        searchQuery: spec.searchQuery,
        selectedGroupId: spec.selectedGroupId,
        createdAt: Date.now(),
      };
      setViews((prev) => {
        const next = [...prev, view];
        writeStorage(next);
        return next;
      });
      return view;
    },
    [],
  );

  const remove = useCallback((id: string) => {
    setViews((prev) => {
      const next = prev.filter((v) => v.id !== id);
      writeStorage(next);
      return next;
    });
  }, []);

  const rename = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setViews((prev) => {
      const next = prev.map((v) => (v.id === id ? { ...v, name: trimmed } : v));
      writeStorage(next);
      return next;
    });
  }, []);

  return { views, save, remove, rename };
}
