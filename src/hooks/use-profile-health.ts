"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

/**
 * Profile health scoring (mirrors `src-tauri/src/health_check.rs`). Pure
 * data — no business logic on the frontend side. The hook computes a
 * full report each time the profile list changes and exposes a
 * `byProfileId` map for fast lookups in the table cell.
 */
export interface HealthFinding {
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface HealthReport {
  profile_id: string;
  score: number;
  findings: HealthFinding[];
}

interface UseProfileHealthOptions {
  /** Re-fetch trigger; pass `profiles.length` or similar. */
  invalidateKey: unknown;
  /** Skip the call entirely (e.g. while we're outside a Tauri runtime). */
  enabled?: boolean;
}

export function useProfileHealth(opts: UseProfileHealthOptions): {
  byProfileId: Map<string, HealthReport>;
  refresh: () => Promise<void>;
} {
  const [byProfileId, setByProfileId] = useState<Map<string, HealthReport>>(
    () => new Map(),
  );

  const refresh = useCallback(async () => {
    try {
      const reports = await invoke<HealthReport[]>("score_all_profiles");
      const next = new Map<string, HealthReport>();
      for (const r of reports) {
        next.set(r.profile_id, r);
      }
      setByProfileId(next);
    } catch (err) {
      // Outside Tauri (e.g. browser-only dev mode) this throws — log and
      // leave the map empty; the badge component treats absence as
      // "unknown" rather than rendering anything.
      console.debug("[health] score_all_profiles failed:", err);
    }
  }, []);

  // We intentionally depend on `invalidateKey` so the caller controls
  // refetching by mutating it (typically `profiles.length`). biome's
  // exhaustive-deps lint considers it unnecessary because the function
  // body doesn't read it directly — silence the rule.
  // biome-ignore lint/correctness/useExhaustiveDependencies: invalidateKey is the refetch trigger
  useEffect(() => {
    if (opts.enabled === false) return;
    void refresh();
  }, [opts.invalidateKey, opts.enabled, refresh]);

  return { byProfileId, refresh };
}
