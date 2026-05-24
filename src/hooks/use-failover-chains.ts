"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

/**
 * Failover proxy chains — mirror of `src-tauri/src/proxy_failover.rs`.
 *
 * A chain says "if `primary_id` is down, try `backup_ids` in order".
 * Used by the upcoming launch-path integration. Today the hook just
 * surfaces the storage so the proxy-management UI can edit chains.
 */
export interface FailoverChain {
  primary_id: string;
  backup_ids: string[];
}

export function useFailoverChains(): {
  chains: FailoverChain[];
  refresh: () => Promise<void>;
  getFor: (primaryId: string) => Promise<FailoverChain | null>;
  save: (primaryId: string, backupIds: string[]) => Promise<void>;
} {
  const [chains, setChains] = useState<FailoverChain[]>([]);

  const refresh = useCallback(async () => {
    try {
      const items = await invoke<FailoverChain[]>("list_failover_chains");
      setChains(items);
    } catch (err) {
      // Likely outside Tauri (dev browser mode); leave the list empty
      // rather than spamming a toast.
      console.debug("[failover] list failed:", err);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const getFor = useCallback(
    async (primaryId: string): Promise<FailoverChain | null> => {
      try {
        return await invoke<FailoverChain | null>("get_failover_chain", {
          primaryId,
        });
      } catch (err) {
        console.debug("[failover] get failed:", err);
        return null;
      }
    },
    [],
  );

  const save = useCallback(
    async (primaryId: string, backupIds: string[]): Promise<void> => {
      await invoke("set_failover_chain", {
        primaryId,
        backupIds,
      });
      await refresh();
    },
    [refresh],
  );

  return { chains, refresh, getFor, save };
}
