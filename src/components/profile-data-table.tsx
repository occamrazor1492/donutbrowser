"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { Dispatch, SetStateAction } from "react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { FaApple, FaLinux, FaWindows } from "react-icons/fa";
import { FiWifi } from "react-icons/fi";
import {
  LuCheck,
  LuChevronDown,
  LuChevronUp,
  LuCookie,
  LuInfo,
  LuLock,
  LuPlay,
  LuPuzzle,
  LuShare2,
  LuSquare,
  LuTrash2,
  LuTriangleAlert,
  LuUsers,
} from "react-icons/lu";
import { DeleteConfirmationDialog } from "@/components/delete-confirmation-dialog";
import {
  ProfileBypassRulesDialog,
  ProfileDnsBlocklistDialog,
  ProfileInfoDialog,
  ProfileLaunchHookDialog,
} from "@/components/profile-info-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBrowserState } from "@/hooks/use-browser-state";
import { useCloudAuth } from "@/hooks/use-cloud-auth";
import { useProxyEvents } from "@/hooks/use-proxy-events";
import { useTableSorting } from "@/hooks/use-table-sorting";
import { useTeamLocks } from "@/hooks/use-team-locks";
import { useVpnEvents } from "@/hooks/use-vpn-events";
import {
  getBrowserDisplayName,
  getOSDisplayName,
  getProfileIcon,
  isCrossOsProfile,
} from "@/lib/browser-utils";
import { useFormatDateTime } from "@/lib/datetime";
import { formatRelativeTime } from "@/lib/flag-utils";
import { trimName } from "@/lib/name-utils";
import { cn } from "@/lib/utils";
import type {
  BrowserProfile,
  LocationItem,
  ProxyCheckResult,
  StoredProxy,
  SyncSessionInfo,
  TrafficSnapshot,
  VpnConfig,
} from "@/types";
import { BandwidthMiniChart } from "./bandwidth-mini-chart";
import {
  DataTableActionBar,
  DataTableActionBarAction,
  DataTableActionBarSelection,
} from "./data-table-action-bar";
import { EmptyProfilesState } from "./profile-table/empty-state";
import { NonHoverableTooltip } from "./profile-table/non-hoverable-tooltip";
import { NoteCell } from "./profile-table/note-cell";
import { TagsCell } from "./profile-table/tags-cell";
import { ProxyCheckButton } from "./proxy-check-button";
import { TrafficDetailsDialog } from "./traffic-details-dialog";
import { Input } from "./ui/input";
import { RippleButton } from "./ui/ripple";

// Stable table meta type to pass volatile state/handlers into TanStack Table without
// causing column definitions to be recreated on every render.
interface TableMeta {
  t: (key: string, options?: Record<string, unknown>) => string;
  /**
   * Locale-aware datetime formatter bound to the current i18next language.
   * Use this instead of `toLocaleString()` so dates respect the in-app
   * language picker (Settings → Language) rather than only the OS locale.
   */
  formatDateTime: (date: Date | number | string) => string;
  selectedProfiles: string[];
  selectableCount: number;
  showCheckboxes: boolean;
  isClient: boolean;
  runningProfiles: Set<string>;
  launchingProfiles: Set<string>;
  stoppingProfiles: Set<string>;
  isUpdating: (browser: string) => boolean;
  browserState: ReturnType<typeof useBrowserState>;

  // Tags editor state
  tagsOverrides: Record<string, string[]>;
  allTags: string[];
  openTagsEditorFor: string | null;
  setAllTags: React.Dispatch<React.SetStateAction<string[]>>;
  setOpenTagsEditorFor: React.Dispatch<React.SetStateAction<string | null>>;
  setTagsOverrides: React.Dispatch<
    React.SetStateAction<Record<string, string[]>>
  >;

  // Note editor state
  noteOverrides: Record<string, string | null>;
  openNoteEditorFor: string | null;
  setOpenNoteEditorFor: React.Dispatch<React.SetStateAction<string | null>>;
  setNoteOverrides: React.Dispatch<
    React.SetStateAction<Record<string, string | null>>
  >;

  // Proxy selector state
  openProxySelectorFor: string | null;
  setOpenProxySelectorFor: React.Dispatch<React.SetStateAction<string | null>>;
  proxyOverrides: Record<string, string | null>;
  storedProxies: StoredProxy[];
  handleProxySelection: (
    profileId: string,
    proxyId: string | null,
  ) => void | Promise<void>;
  checkingProfileId: string | null;
  proxyCheckResults: Record<string, ProxyCheckResult>;

  // VPN selector state
  vpnConfigs: VpnConfig[];
  vpnOverrides: Record<string, string | null>;
  handleVpnSelection: (
    profileId: string,
    vpnId: string | null,
  ) => void | Promise<void>;

  // Selection helpers
  isProfileSelected: (id: string) => boolean;
  handleToggleAll: (checked: boolean) => void;
  handleCheckboxChange: (id: string, checked: boolean) => void;
  handleIconClick: (id: string) => void;

  // Rename helpers
  handleRename: () => void | Promise<void>;
  setProfileToRename: React.Dispatch<
    React.SetStateAction<BrowserProfile | null>
  >;
  setNewProfileName: React.Dispatch<React.SetStateAction<string>>;
  setRenameError: React.Dispatch<React.SetStateAction<string | null>>;
  profileToRename: BrowserProfile | null;
  newProfileName: string;
  isRenamingSaving: boolean;
  renameError: string | null;

  // Launch/stop helpers
  setLaunchingProfiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  setStoppingProfiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  onKillProfile: (profile: BrowserProfile) => void | Promise<void>;
  onLaunchProfile: (profile: BrowserProfile) => void | Promise<void>;

  // Overflow actions
  onAssignProfilesToGroup?: (profileIds: string[]) => void;
  onConfigureCamoufox?: (profile: BrowserProfile) => void;
  onCloneProfile?: (profile: BrowserProfile) => void;
  onCopyCookiesToProfile?: (profile: BrowserProfile) => void;
  onOpenCookieManagement?: (profile: BrowserProfile) => void;
  onPublishTeamProfile?: (profile: BrowserProfile) => void;

  // Traffic snapshots (lightweight real-time data)
  trafficSnapshots: Record<string, TrafficSnapshot>;
  onOpenTrafficDialog?: (profileId: string) => void;

  // Sync
  syncStatuses: Record<string, { status: string; error?: string }>;
  onOpenProfileSyncDialog?: (profile: BrowserProfile) => void;
  onToggleProfileSync?: (profile: BrowserProfile) => void;
  crossOsUnlocked?: boolean;
  syncUnlocked?: boolean;

  // Country proxy creation (inline in proxy dropdown)
  countries: LocationItem[];
  canCreateLocationProxy: boolean;
  loadCountries: () => Promise<void>;
  handleCreateCountryProxy: (
    profileId: string,
    country: LocationItem,
  ) => Promise<void>;

  // Team locks
  isProfileLockedByAnother: (profileId: string) => boolean;
  getProfileLockEmail: (profileId: string) => string | undefined;

  // Synchronizer
  getProfileSyncInfo: (profileId: string) =>
    | {
        session: SyncSessionInfo;
        isLeader: boolean;
        failedAtUrl: string | null;
      }
    | undefined;
  onLaunchWithSync: (profile: BrowserProfile) => void;
}

interface SyncStatusDot {
  color: string;
  tooltip: string;
  animate: boolean;
  encrypted: boolean;
}

function getProfileSyncStatusDot(
  profile: BrowserProfile,
  liveStatus:
    | "syncing"
    | "waiting"
    | "synced"
    | "error"
    | "disabled"
    | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
  errorMessage?: string,
  formatDateTime?: (date: Date | number | string) => string,
): SyncStatusDot | null {
  const encrypted = profile.sync_mode === "Encrypted";
  const status =
    liveStatus ??
    (profile.sync_mode && profile.sync_mode !== "Disabled"
      ? "synced"
      : "disabled");

  switch (status) {
    case "syncing":
      return {
        color: "bg-warning",
        tooltip: t("profileTable.syncTooltipSyncing"),
        animate: true,
        encrypted,
      };
    case "waiting":
      return {
        color: "bg-warning",
        tooltip: t("profileTable.syncTooltipCloseToSync"),
        animate: false,
        encrypted,
      };
    case "synced":
      return {
        color: "bg-success",
        tooltip: profile.last_sync
          ? t("profileTable.syncTooltipSyncedAt", {
              time: formatDateTime
                ? formatDateTime(profile.last_sync * 1000)
                : new Date(profile.last_sync * 1000).toLocaleString(),
            })
          : t("profileTable.syncTooltipSynced"),
        animate: false,
        encrypted,
      };
    case "error":
      return {
        color: "bg-destructive",
        tooltip: errorMessage
          ? t("profileTable.syncTooltipErrorWith", { error: errorMessage })
          : t("profileTable.syncTooltipError"),
        animate: false,
        encrypted,
      };
    case "disabled":
      if (profile.last_sync) {
        return {
          color: "bg-muted-foreground",
          tooltip: t("profileTable.syncTooltipDisabledWithLast", {
            time: formatRelativeTime(profile.last_sync),
          }),
          animate: false,
          encrypted: false,
        };
      }
      return null;
    default:
      return null;
  }
}

interface ProfilesDataTableProps {
  className?: string;
  profiles: BrowserProfile[];
  onLaunchProfile: (profile: BrowserProfile) => void | Promise<void>;
  onKillProfile: (profile: BrowserProfile) => void | Promise<void>;
  onCloneProfile: (profile: BrowserProfile) => void | Promise<void>;
  onDeleteProfile: (profile: BrowserProfile) => void | Promise<void>;
  onRenameProfile: (profileId: string, newName: string) => Promise<void>;
  onConfigureCamoufox: (profile: BrowserProfile) => void;
  onCopyCookiesToProfile?: (profile: BrowserProfile) => void;
  onOpenCookieManagement?: (profile: BrowserProfile) => void;
  onPublishTeamProfile?: (profile: BrowserProfile) => void;
  runningProfiles: Set<string>;
  isUpdating: (browser: string) => boolean;
  onDeleteSelectedProfiles: (profileIds: string[]) => Promise<void>;
  onAssignProfilesToGroup: (profileIds: string[]) => void;
  selectedGroupId: string | null;
  selectedProfiles: string[];
  onSelectedProfilesChange: Dispatch<SetStateAction<string[]>>;
  onBulkDelete?: () => void;
  onBulkGroupAssignment?: () => void;
  onBulkProxyAssignment?: () => void;
  onBulkCopyCookies?: () => void;
  onBulkExtensionGroupAssignment?: () => void;
  onBulkLaunch?: () => void;
  onBulkStop?: () => void;
  /**
   * Total number of profiles in the underlying dataset (before group / search
   * filtering). Used to distinguish "no profiles exist at all" (onboarding
   * empty state) from "filter reduced the list to 0" (no-match empty state).
   * If omitted, the table falls back to assuming the visible list is the
   * whole dataset.
   */
  totalProfileCount?: number;
  /** Whether the current view has any active filter / search. */
  hasActiveFilter?: boolean;
  /** Open the Create Profile dialog from the empty-state CTA. */
  onOpenCreateProfile?: () => void;
  /** Reset all filters from the no-match empty-state CTA. */
  onClearFilters?: () => void;
  onAssignExtensionGroup?: (profileIds: string[]) => void;
  onOpenProfileSyncDialog?: (profile: BrowserProfile) => void;
  onToggleProfileSync?: (profile: BrowserProfile) => void;
  crossOsUnlocked?: boolean;
  syncUnlocked?: boolean;
  getProfileSyncInfo?: (profileId: string) =>
    | {
        session: SyncSessionInfo;
        isLeader: boolean;
        failedAtUrl: string | null;
      }
    | undefined;
  onLaunchWithSync?: (profile: BrowserProfile) => void;
  /** Launch in headless mode — wired through to profile-info-dialog. */
  onLaunchHeadless?: (profile: BrowserProfile) => void;
}

export function ProfilesDataTable({
  className,
  profiles,
  onLaunchProfile,
  onKillProfile,
  onCloneProfile,
  onDeleteProfile,
  onRenameProfile,
  onConfigureCamoufox,
  onCopyCookiesToProfile,
  onOpenCookieManagement,
  onPublishTeamProfile,
  runningProfiles,
  isUpdating,
  onAssignProfilesToGroup,
  selectedProfiles,
  onSelectedProfilesChange,
  onBulkDelete,
  onBulkGroupAssignment,
  onBulkProxyAssignment,
  onBulkCopyCookies,
  onBulkExtensionGroupAssignment,
  onBulkLaunch,
  onBulkStop,
  totalProfileCount,
  hasActiveFilter = false,
  onOpenCreateProfile,
  onClearFilters,
  onAssignExtensionGroup,
  onOpenProfileSyncDialog,
  onToggleProfileSync,
  crossOsUnlocked = false,
  syncUnlocked = false,
  getProfileSyncInfo,
  onLaunchWithSync,
  onLaunchHeadless,
}: ProfilesDataTableProps) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const { getTableSorting, updateSorting, isLoaded } = useTableSorting();
  const [sorting, setSorting] = React.useState<SortingState>([]);

  // Sync external selectedProfiles with table's row selection state
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const prevSelectedProfilesRef = React.useRef<string[]>(selectedProfiles);

  // Update row selection when external selectedProfiles changes
  React.useEffect(() => {
    // Only update if selectedProfiles actually changed
    if (
      prevSelectedProfilesRef.current.length !== selectedProfiles.length ||
      !prevSelectedProfilesRef.current.every((id) =>
        selectedProfiles.includes(id),
      )
    ) {
      const newSelection: RowSelectionState = {};
      for (const profileId of selectedProfiles) {
        newSelection[profileId] = true;
      }
      setRowSelection(newSelection);
      prevSelectedProfilesRef.current = selectedProfiles;
      // When the parent clears the selection (e.g. after a bulk action like
      // delete / move-to-group), collapse the checkbox column back to icons.
      // Otherwise the row checkboxes stay visible and only revert after the
      // user clicks one — which the per-checkbox handler resets.
      if (selectedProfiles.length === 0) {
        setShowCheckboxes(false);
      }
    }
  }, [selectedProfiles]);

  // Update external selectedProfiles when table selection changes
  const handleRowSelectionChange = React.useCallback(
    (updater: React.SetStateAction<RowSelectionState>) => {
      setRowSelection((prevSelection) => {
        const newSelection =
          typeof updater === "function" ? updater(prevSelection) : updater;

        const selectedIds = Object.keys(newSelection).filter(
          (id) => newSelection[id],
        );

        // Only update external state if selection actually changed
        const prevIds = Object.keys(prevSelection).filter(
          (id) => prevSelection[id],
        );

        if (
          selectedIds.length !== prevIds.length ||
          !selectedIds.every((id) => prevIds.includes(id))
        ) {
          onSelectedProfilesChange(selectedIds);
        }

        return newSelection;
      });
    },
    [onSelectedProfilesChange],
  );
  const [profileToRename, setProfileToRename] =
    React.useState<BrowserProfile | null>(null);
  const [newProfileName, setNewProfileName] = React.useState("");
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [isRenamingSaving, setIsRenamingSaving] = React.useState(false);
  const renameContainerRef = React.useRef<HTMLDivElement | null>(null);
  const [profileToDelete, setProfileToDelete] =
    React.useState<BrowserProfile | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [profileForInfoDialog, setProfileForInfoDialog] =
    React.useState<BrowserProfile | null>(null);
  const [bypassRulesProfile, setBypassRulesProfile] =
    React.useState<BrowserProfile | null>(null);
  const [dnsBlocklistProfile, setDnsBlocklistProfile] =
    React.useState<BrowserProfile | null>(null);
  const [launchHookProfile, setLaunchHookProfile] =
    React.useState<BrowserProfile | null>(null);
  const [launchingProfiles, setLaunchingProfiles] = React.useState<Set<string>>(
    new Set(),
  );
  const [stoppingProfiles, setStoppingProfiles] = React.useState<Set<string>>(
    new Set(),
  );

  const { storedProxies } = useProxyEvents();
  const { vpnConfigs } = useVpnEvents();
  const { user } = useCloudAuth();
  const { isProfileLocked, getLockInfo } = useTeamLocks(user?.id);

  const [proxyOverrides, setProxyOverrides] = React.useState<
    Record<string, string | null>
  >({});
  const [vpnOverrides, setVpnOverrides] = React.useState<
    Record<string, string | null>
  >({});
  const [showCheckboxes, setShowCheckboxes] = React.useState(false);
  const [tagsOverrides, setTagsOverrides] = React.useState<
    Record<string, string[]>
  >({});
  const [allTags, setAllTags] = React.useState<string[]>([]);
  const [openTagsEditorFor, setOpenTagsEditorFor] = React.useState<
    string | null
  >(null);
  const [openProxySelectorFor, setOpenProxySelectorFor] = React.useState<
    string | null
  >(null);
  const [checkingProfileId, setCheckingProfileId] = React.useState<
    string | null
  >(null);
  const [proxyCheckResults, setProxyCheckResults] = React.useState<
    Record<string, ProxyCheckResult>
  >({});
  const [noteOverrides, setNoteOverrides] = React.useState<
    Record<string, string | null>
  >({});
  const [openNoteEditorFor, setOpenNoteEditorFor] = React.useState<
    string | null
  >(null);
  const [trafficSnapshots, setTrafficSnapshots] = React.useState<
    Record<string, TrafficSnapshot>
  >({});
  const [trafficDialogProfile, setTrafficDialogProfile] = React.useState<{
    id: string;
    name?: string;
  } | null>(null);
  const [syncStatuses, setSyncStatuses] = React.useState<
    Record<string, { status: string; error?: string }>
  >({});

  // Country proxy creation state (for inline proxy creation in dropdown)
  const [countries, setCountries] = React.useState<LocationItem[]>([]);
  const [countriesLoaded, setCountriesLoaded] = React.useState(false);
  const canCreateLocationProxy = false;

  const loadCountries = React.useCallback(async () => {
    if (countriesLoaded || !canCreateLocationProxy) return;
    try {
      const data = await invoke<LocationItem[]>("cloud_get_countries");
      setCountries(data);
      setCountriesLoaded(true);
    } catch (e) {
      console.error("Failed to load countries:", e);
    }
  }, [countriesLoaded]);

  // Load cached check results for proxies
  React.useEffect(() => {
    const loadCachedResults = async () => {
      const results: Record<string, ProxyCheckResult> = {};
      const proxyIds = new Set<string>();
      for (const profile of profiles) {
        if (profile.proxy_id) {
          proxyIds.add(profile.proxy_id);
        }
      }
      for (const proxyId of proxyIds) {
        try {
          const cached = await invoke<ProxyCheckResult | null>(
            "get_cached_proxy_check",
            { proxyId },
          );
          if (cached) {
            results[proxyId] = cached;
          }
        } catch (_error) {
          // Ignore errors
        }
      }
      setProxyCheckResults(results);
    };
    if (profiles.length > 0) {
      void loadCachedResults();
    }
  }, [profiles]);

  const loadAllTags = React.useCallback(async () => {
    try {
      const tags = await invoke<string[]>("get_all_tags");
      setAllTags(tags);
    } catch (error) {
      console.error("Failed to load tags:", error);
    }
  }, []);

  const handleProxySelection = React.useCallback(
    async (profileId: string, proxyId: string | null) => {
      try {
        await invoke("update_profile_proxy", {
          profileId,
          proxyId,
        });
        setProxyOverrides((prev) => ({ ...prev, [profileId]: proxyId }));
        setVpnOverrides((prev) => ({ ...prev, [profileId]: null }));
        await emit("profile-updated");
      } catch (error) {
        console.error("Failed to update proxy settings:", error);
      } finally {
        setOpenProxySelectorFor(null);
      }
    },
    [],
  );

  const handleVpnSelection = React.useCallback(
    async (profileId: string, vpnId: string | null) => {
      try {
        await invoke("update_profile_vpn", {
          profileId,
          vpnId,
        });
        setVpnOverrides((prev) => ({ ...prev, [profileId]: vpnId }));
        setProxyOverrides((prev) => ({ ...prev, [profileId]: null }));
        await emit("profile-updated");
      } catch (error) {
        console.error("Failed to update VPN settings:", error);
      } finally {
        setOpenProxySelectorFor(null);
      }
    },
    [],
  );

  const handleCreateCountryProxy = React.useCallback(
    async (profileId: string, country: LocationItem) => {
      try {
        await invoke("create_cloud_location_proxy", {
          name: country.name,
          country: country.code,
          region: null,
          city: null,
          isp: null,
        });
        await emit("stored-proxies-changed");
        // Wait briefly for proxy list to update, then find and assign the new proxy
        await new Promise((r) => setTimeout(r, 200));
        const updatedProxies =
          await invoke<StoredProxy[]>("get_stored_proxies");
        const newProxy = updatedProxies.find(
          (p: StoredProxy) =>
            p.is_cloud_derived && p.geo_country === country.code,
        );
        if (newProxy) {
          await handleProxySelection(profileId, newProxy.id);
        }
        setOpenProxySelectorFor(null);
      } catch (error) {
        console.error("Failed to create country proxy:", error);
      }
    },
    [handleProxySelection],
  );

  // Use shared browser state hook
  const browserState = useBrowserState(
    profiles,
    runningProfiles,
    isUpdating,
    launchingProfiles,
    stoppingProfiles,
  );

  // Listen for sync status events
  React.useEffect(() => {
    if (!browserState.isClient) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen<{
          profile_id: string;
          status: string;
          error?: string;
        }>("profile-sync-status", (event) => {
          const { profile_id, status, error } = event.payload;
          setSyncStatuses((prev) => ({
            ...prev,
            [profile_id]: { status, error },
          }));
        });
      } catch (error) {
        console.error("Failed to listen for sync status events:", error);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [browserState.isClient]);

  // Fetch traffic snapshots for running profiles (lightweight, real-time data)
  // Convert Set to sorted array to avoid Set reference comparison issues in dependencies
  const runningProfileIds = React.useMemo(
    () => Array.from(runningProfiles).sort(),
    [runningProfiles],
  );
  const runningCount = runningProfileIds.length;
  React.useEffect(() => {
    if (!browserState.isClient) return;

    if (runningCount === 0) {
      setTrafficSnapshots({});
      return;
    }

    const fetchTrafficSnapshots = async () => {
      try {
        const allSnapshots = await invoke<TrafficSnapshot[]>(
          "get_all_traffic_snapshots",
        );
        const newSnapshots: Record<string, TrafficSnapshot> = {};
        for (const snapshot of allSnapshots) {
          if (snapshot.profile_id) {
            // Only keep snapshots for profiles that are currently running
            if (runningProfileIds.includes(snapshot.profile_id)) {
              const existing = newSnapshots[snapshot.profile_id];
              if (!existing || snapshot.last_update > existing.last_update) {
                newSnapshots[snapshot.profile_id] = snapshot;
              }
            }
          }
        }
        setTrafficSnapshots(newSnapshots);
      } catch (error) {
        console.error("Failed to fetch traffic snapshots:", error);
      }
    };

    void fetchTrafficSnapshots();
    const interval = setInterval(() => {
      void fetchTrafficSnapshots();
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [browserState.isClient, runningCount, runningProfileIds]);

  // Clean up snapshots for profiles that are no longer running
  React.useEffect(() => {
    if (!browserState.isClient) return;

    setTrafficSnapshots((prev) => {
      const cleaned: Record<string, TrafficSnapshot> = {};
      for (const [profileId, snapshot] of Object.entries(prev)) {
        // Only keep snapshots for profiles that are currently running
        if (runningProfileIds.includes(profileId)) {
          cleaned[profileId] = snapshot;
        }
      }
      // Only update if something was removed
      if (Object.keys(cleaned).length !== Object.keys(prev).length) {
        return cleaned;
      }
      return prev;
    });
  }, [browserState.isClient, runningProfileIds]);

  // Clear launching/stopping spinners when backend reports running status changes
  React.useEffect(() => {
    if (!browserState.isClient) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen<{ id: string; is_running: boolean }>(
          "profile-running-changed",
          (event) => {
            const { id } = event.payload;
            // Clear launching state for this profile if present
            setLaunchingProfiles((prev) => {
              if (!prev.has(id)) return prev;
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
            // Clear stopping state for this profile if present
            setStoppingProfiles((prev) => {
              if (!prev.has(id)) return prev;
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          },
        );
      } catch (error) {
        console.error("Failed to listen for profile running changes:", error);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [browserState.isClient]);

  // Keep stored proxies up-to-date by listening for changes emitted elsewhere in the app
  React.useEffect(() => {
    if (!browserState.isClient) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen("stored-proxies-changed", () => {
          // Also refresh tags on profile updates
          void loadAllTags();
        });
      } catch (_err) {
        // Best-effort only
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [browserState.isClient, loadAllTags]);

  // Automatically deselect profiles that become running, updating, launching, or stopping
  React.useEffect(() => {
    const newSet = new Set(selectedProfiles);
    let hasChanges = false;

    for (const profileId of selectedProfiles) {
      const profile = profiles.find((p) => p.id === profileId);
      if (profile) {
        const isRunning =
          browserState.isClient && runningProfiles.has(profile.id);
        const isLaunching = launchingProfiles.has(profile.id);
        const isStopping = stoppingProfiles.has(profile.id);

        if (isRunning || isLaunching || isStopping) {
          newSet.delete(profileId);
          hasChanges = true;
        }
      }
    }

    if (hasChanges) {
      onSelectedProfilesChange(Array.from(newSet));
    }
  }, [
    profiles,
    runningProfiles,
    launchingProfiles,
    stoppingProfiles,
    browserState.isClient,
    onSelectedProfilesChange,
    selectedProfiles,
  ]);

  // Update local sorting state when settings are loaded
  React.useEffect(() => {
    if (isLoaded && browserState.isClient) {
      setSorting(getTableSorting());
    }
  }, [isLoaded, getTableSorting, browserState.isClient]);

  // Handle sorting changes
  const handleSortingChange = React.useCallback(
    (updater: React.SetStateAction<SortingState>) => {
      if (!browserState.isClient) return;
      const newSorting =
        typeof updater === "function" ? updater(sorting) : updater;
      setSorting(newSorting);
      updateSorting(newSorting);
    },
    [browserState.isClient, sorting, updateSorting],
  );

  const handleRename = React.useCallback(async () => {
    if (!profileToRename || !newProfileName.trim()) return;

    try {
      setIsRenamingSaving(true);
      await onRenameProfile(profileToRename.id, newProfileName.trim());
      setProfileToRename(null);
      setNewProfileName("");
      setRenameError(null);
    } catch (error) {
      setRenameError(
        error instanceof Error
          ? error.message
          : t("errors.renameProfileFailed", { error: String(error) }),
      );
    } finally {
      setIsRenamingSaving(false);
    }
  }, [profileToRename, newProfileName, onRenameProfile, t]);

  // Cancel inline rename on outside click
  React.useEffect(() => {
    if (!profileToRename) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        renameContainerRef.current &&
        !renameContainerRef.current.contains(target)
      ) {
        setProfileToRename(null);
        setNewProfileName("");
        setRenameError(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [profileToRename]);

  const handleDelete = async () => {
    if (!profileToDelete) return;

    setIsDeleting(true);
    // Minimum loading time for visual feedback
    const minLoadingTime = new Promise((r) => setTimeout(r, 300));
    try {
      await Promise.all([onDeleteProfile(profileToDelete), minLoadingTime]);
      setProfileToDelete(null);
    } catch (error) {
      console.error("Failed to delete profile:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle icon/checkbox click
  const handleIconClick = React.useCallback(
    (profileId: string) => {
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) return;

      // Prevent selection of profiles whose browsers are updating
      if (!browserState.canSelectProfile(profile)) {
        return;
      }

      setShowCheckboxes(true);
      const newSet = new Set(selectedProfiles);
      if (newSet.has(profileId)) {
        newSet.delete(profileId);
      } else {
        newSet.add(profileId);
      }

      // Hide checkboxes if no profiles are selected
      if (newSet.size === 0) {
        setShowCheckboxes(false);
      }

      onSelectedProfilesChange(Array.from(newSet));
    },
    [profiles, browserState, onSelectedProfilesChange, selectedProfiles],
  );

  React.useEffect(() => {
    if (browserState.isClient) {
      void loadAllTags();
    }
  }, [browserState.isClient, loadAllTags]);

  // Handle checkbox change
  const handleCheckboxChange = React.useCallback(
    (profileId: string, checked: boolean) => {
      const newSet = new Set(selectedProfiles);
      if (checked) {
        newSet.add(profileId);
      } else {
        newSet.delete(profileId);
      }

      // Hide checkboxes if no profiles are selected
      if (newSet.size === 0) {
        setShowCheckboxes(false);
      }

      onSelectedProfilesChange(Array.from(newSet));
    },
    [onSelectedProfilesChange, selectedProfiles],
  );

  // Handle select all checkbox
  const handleToggleAll = React.useCallback(
    (checked: boolean) => {
      const newSet = checked
        ? new Set(
            profiles
              .filter((profile) => {
                const isRunning =
                  browserState.isClient && runningProfiles.has(profile.id);
                const isLaunching = launchingProfiles.has(profile.id);
                const isStopping = stoppingProfiles.has(profile.id);
                return !isRunning && !isLaunching && !isStopping;
              })
              .map((profile) => profile.id),
          )
        : new Set<string>();

      setShowCheckboxes(checked);
      onSelectedProfilesChange(Array.from(newSet));
    },
    [
      profiles,
      onSelectedProfilesChange,
      browserState.isClient,
      runningProfiles,
      launchingProfiles,
      stoppingProfiles,
    ],
  );

  // Memoize selectableProfiles calculation
  const selectableProfiles = React.useMemo(() => {
    return profiles.filter((profile) => {
      const isRunning =
        browserState.isClient && runningProfiles.has(profile.id);
      const isLaunching = launchingProfiles.has(profile.id);
      const isStopping = stoppingProfiles.has(profile.id);
      return !isRunning && !isLaunching && !isStopping;
    });
  }, [
    profiles,
    browserState.isClient,
    runningProfiles,
    launchingProfiles,
    stoppingProfiles,
  ]);

  // Build table meta from volatile state so columns can stay stable
  const tableMeta = React.useMemo<TableMeta>(
    () => ({
      t,
      formatDateTime,
      selectedProfiles,
      selectableCount: selectableProfiles.length,
      showCheckboxes,
      isClient: browserState.isClient,
      runningProfiles,
      launchingProfiles,
      stoppingProfiles,
      isUpdating,
      browserState,

      // Tags editor state
      tagsOverrides,
      allTags,
      openTagsEditorFor,
      setAllTags,
      setOpenTagsEditorFor,
      setTagsOverrides,

      // Note editor state
      noteOverrides,
      openNoteEditorFor,
      setOpenNoteEditorFor,
      setNoteOverrides,

      // Proxy selector state
      openProxySelectorFor,
      setOpenProxySelectorFor,
      proxyOverrides,
      storedProxies,
      handleProxySelection,
      checkingProfileId,
      proxyCheckResults,

      // VPN selector state
      vpnConfigs,
      vpnOverrides,
      handleVpnSelection,

      // Selection helpers
      isProfileSelected: (id: string) => selectedProfiles.includes(id),
      handleToggleAll,
      handleCheckboxChange,
      handleIconClick,

      // Rename helpers
      handleRename,
      setProfileToRename,
      setNewProfileName,
      setRenameError,
      profileToRename,
      newProfileName,
      isRenamingSaving,
      renameError,

      // Launch/stop helpers
      setLaunchingProfiles,
      setStoppingProfiles,
      onKillProfile,
      onLaunchProfile,

      // Overflow actions
      onAssignProfilesToGroup,
      onCloneProfile: onCloneProfile
        ? (profile: BrowserProfile) => {
            void onCloneProfile(profile);
          }
        : undefined,
      onConfigureCamoufox,
      onCopyCookiesToProfile,
      onOpenCookieManagement,
      onPublishTeamProfile,

      // Traffic snapshots (lightweight real-time data)
      trafficSnapshots,
      onOpenTrafficDialog: (profileId: string) => {
        const profile = profiles.find((p) => p.id === profileId);
        setTrafficDialogProfile({ id: profileId, name: profile?.name });
      },

      // Sync
      syncStatuses,
      onOpenProfileSyncDialog,
      onToggleProfileSync,
      crossOsUnlocked,
      syncUnlocked,

      // Country proxy creation
      countries,
      canCreateLocationProxy,
      loadCountries,
      handleCreateCountryProxy,

      // Team locks
      isProfileLockedByAnother: isProfileLocked,
      getProfileLockEmail: (profileId: string) =>
        getLockInfo(profileId)?.lockedByEmail,

      // Synchronizer
      getProfileSyncInfo: getProfileSyncInfo ?? (() => undefined),
      onLaunchWithSync:
        onLaunchWithSync ??
        (() => {
          /* empty */
        }),
    }),
    [
      t,
      selectedProfiles,
      selectableProfiles.length,
      showCheckboxes,
      browserState.isClient,
      runningProfiles,
      launchingProfiles,
      stoppingProfiles,
      isUpdating,
      browserState,
      tagsOverrides,
      allTags,
      openTagsEditorFor,
      noteOverrides,
      openNoteEditorFor,
      openProxySelectorFor,
      proxyOverrides,
      storedProxies,
      handleProxySelection,
      checkingProfileId,
      proxyCheckResults,
      vpnConfigs,
      vpnOverrides,
      handleVpnSelection,
      handleToggleAll,
      handleCheckboxChange,
      handleIconClick,
      handleRename,
      profileToRename,
      newProfileName,
      isRenamingSaving,
      trafficSnapshots,
      profiles,
      renameError,
      onKillProfile,
      onLaunchProfile,
      onAssignProfilesToGroup,
      onCloneProfile,
      onConfigureCamoufox,
      onCopyCookiesToProfile,
      onOpenCookieManagement,
      onPublishTeamProfile,
      syncStatuses,
      onOpenProfileSyncDialog,
      onToggleProfileSync,
      crossOsUnlocked,
      syncUnlocked,
      countries,
      loadCountries,
      handleCreateCountryProxy,
      isProfileLocked,
      getLockInfo,
      getProfileSyncInfo,
      onLaunchWithSync,
      formatDateTime,
    ],
  );

  const columns: ColumnDef<BrowserProfile>[] = React.useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => {
          const meta = table.options.meta as TableMeta;
          return (
            <span>
              <Checkbox
                checked={
                  meta.selectedProfiles.length === meta.selectableCount &&
                  meta.selectableCount !== 0
                }
                onCheckedChange={(value) => {
                  meta.handleToggleAll(!!value);
                }}
                aria-label={t("common.aria.selectAll")}
                className="cursor-pointer"
              />
            </span>
          );
        },
        cell: ({ row, table }) => {
          const meta = table.options.meta as TableMeta;
          const profile = row.original;
          const browser = profile.browser;
          const IconComponent = getProfileIcon(profile);
          const isCrossOs = isCrossOsProfile(profile);

          const isSelected = meta.isProfileSelected(profile.id);
          const isRunning =
            meta.isClient && meta.runningProfiles.has(profile.id);
          const isLaunching = meta.launchingProfiles.has(profile.id);
          const isStopping = meta.stoppingProfiles.has(profile.id);
          const isDisabled = isRunning || isLaunching || isStopping;

          // Cross-OS profiles: show OS icon when checkboxes aren't visible, show checkbox when they are
          if (isCrossOs && !meta.showCheckboxes && !isSelected) {
            const resolvedOs =
              profile.host_os ||
              profile.camoufox_config?.os ||
              profile.wayfern_config?.os;
            const osName = resolvedOs
              ? getOSDisplayName(resolvedOs)
              : t("crossOs.unknownOs");
            const crossOsTooltip = t("crossOs.viewOnly", { os: osName });
            const OsIcon =
              resolvedOs === "macos"
                ? FaApple
                : resolvedOs === "windows"
                  ? FaWindows
                  : FaLinux;
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex justify-center items-center w-4 h-4">
                    <button
                      type="button"
                      className="flex justify-center items-center p-0 border-none cursor-pointer"
                      onClick={() => {
                        meta.handleIconClick(profile.id);
                      }}
                      aria-label={t("common.aria.selectProfile")}
                    >
                      <span className="w-4 h-4 group">
                        <OsIcon className="w-4 h-4 text-muted-foreground group-hover:hidden" />
                        <span className="peer border-input dark:bg-input/30 dark:data-[state=checked]:bg-primary size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none w-4 h-4 hidden group-hover:block pointer-events-none items-center justify-center duration-200" />
                      </span>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{crossOsTooltip}</p>
                </TooltipContent>
              </Tooltip>
            );
          }

          // Cross-OS profiles with checkboxes visible: show checkbox (selectable for bulk delete)
          if (isCrossOs && (meta.showCheckboxes || isSelected)) {
            const resolvedOs =
              profile.host_os ||
              profile.camoufox_config?.os ||
              profile.wayfern_config?.os;
            const osName = resolvedOs
              ? getOSDisplayName(resolvedOs)
              : t("crossOs.unknownOs");
            const crossOsTooltip = t("crossOs.viewOnly", { os: osName });
            return (
              <NonHoverableTooltip
                content={<p>{crossOsTooltip}</p>}
                sideOffset={4}
                horizontalOffset={8}
              >
                <span className="flex justify-center items-center w-4 h-4">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(value) => {
                      meta.handleCheckboxChange(profile.id, !!value);
                    }}
                    aria-label={t("common.aria.selectRow")}
                    className="w-4 h-4"
                  />
                </span>
              </NonHoverableTooltip>
            );
          }

          if (isDisabled) {
            const tooltipMessage = isRunning
              ? t("profileTable.cannotModifyRunning")
              : isLaunching
                ? t("profileTable.cannotModifyLaunching")
                : isStopping
                  ? t("profileTable.cannotModifyStopping")
                  : t("profileTable.cannotModifyUpdating");

            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex justify-center items-center w-4 h-4 cursor-not-allowed">
                    {IconComponent && (
                      <IconComponent className="w-4 h-4 opacity-50" />
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{tooltipMessage}</p>
                </TooltipContent>
              </Tooltip>
            );
          }

          const browserName = getBrowserDisplayName(browser);

          if (meta.showCheckboxes || isSelected) {
            return (
              <NonHoverableTooltip
                content={<p>{browserName}</p>}
                sideOffset={4}
                horizontalOffset={8}
              >
                <span className="flex justify-center items-center w-4 h-4">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(value) => {
                      meta.handleCheckboxChange(profile.id, !!value);
                    }}
                    aria-label={t("common.aria.selectRow")}
                    className="w-4 h-4"
                  />
                </span>
              </NonHoverableTooltip>
            );
          }

          return (
            <NonHoverableTooltip
              content={<p>{browserName}</p>}
              sideOffset={4}
              horizontalOffset={8}
            >
              <span className="flex relative justify-center items-center w-4 h-4">
                <button
                  type="button"
                  className="flex justify-center items-center p-0 border-none cursor-pointer"
                  onClick={() => {
                    meta.handleIconClick(profile.id);
                  }}
                  aria-label={t("common.aria.selectProfile")}
                >
                  <span className="w-4 h-4 group">
                    {IconComponent && (
                      <IconComponent className="w-4 h-4 group-hover:hidden" />
                    )}
                    <span className="peer border-input dark:bg-input/30 dark:data-[state=checked]:bg-primary size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none w-4 h-4 hidden group-hover:block pointer-events-none items-center justify-center duration-200" />
                  </span>
                </button>
              </span>
            </NonHoverableTooltip>
          );
        },
        enableSorting: false,
        enableHiding: false,
        size: 40,
      },
      {
        id: "actions",
        size: 100,
        cell: ({ row, table }) => {
          const meta = table.options.meta as TableMeta;
          const profile = row.original;
          const isRunning =
            meta.isClient && meta.runningProfiles.has(profile.id);
          const isLaunching = meta.launchingProfiles.has(profile.id);
          const isStopping = meta.stoppingProfiles.has(profile.id);
          const isLockedByAnother = meta.isProfileLockedByAnother(profile.id);
          const isSyncing = meta.syncStatuses[profile.id]?.status === "syncing";
          const canLaunch =
            meta.browserState.canLaunchProfile(profile) &&
            !isLockedByAnother &&
            !isSyncing;
          const lockEmail = meta.getProfileLockEmail(profile.id);
          const tooltipContent = isLockedByAnother
            ? meta.t("sync.team.cannotLaunchLocked", { email: lockEmail })
            : meta.browserState.getLaunchTooltipContent(profile);

          const handleProfileStop = async (profile: BrowserProfile) => {
            meta.setStoppingProfiles((prev: Set<string>) =>
              new Set(prev).add(profile.id),
            );
            try {
              await meta.onKillProfile(profile);
            } catch (error) {
              meta.setStoppingProfiles((prev: Set<string>) => {
                const next = new Set(prev);
                next.delete(profile.id);
                return next;
              });
              throw error;
            }
          };

          const handleProfileLaunch = async (profile: BrowserProfile) => {
            meta.setLaunchingProfiles((prev: Set<string>) =>
              new Set(prev).add(profile.id),
            );
            try {
              await meta.onLaunchProfile(profile);
            } finally {
              // Always clear launching state — the running state is tracked
              // separately via profile-running-changed events
              meta.setLaunchingProfiles((prev: Set<string>) => {
                const next = new Set(prev);
                next.delete(profile.id);
                return next;
              });
            }
          };

          const syncInfo = meta.getProfileSyncInfo(profile.id);
          const isLeader = syncInfo?.isLeader === true;
          const isFollower = syncInfo?.isLeader === false;
          const isDesynced = isFollower && syncInfo.failedAtUrl != null;
          const stopTooltip = isLeader
            ? meta.t("profiles.synchronizer.stopLeader")
            : isFollower
              ? meta.t("profiles.synchronizer.stopFollower", {
                  leaderName: syncInfo.session.leader_profile_name ?? "",
                })
              : tooltipContent;

          const handleStop = async () => {
            if (isLeader && syncInfo) {
              // Stop leader: invoke stop_sync_session which kills leader + all followers
              try {
                await invoke("stop_sync_session", {
                  sessionId: syncInfo.session.id,
                });
              } catch (error) {
                console.error("Failed to stop sync session:", error);
              }
            } else if (isFollower && syncInfo) {
              // Stop follower: remove from session
              try {
                await invoke("remove_sync_follower", {
                  sessionId: syncInfo.session.id,
                  followerProfileId: profile.id,
                });
              } catch (error) {
                console.error("Failed to remove sync follower:", error);
              }
            } else {
              await handleProfileStop(profile);
            }
          };

          const buttonVariant = isRunning
            ? isFollower
              ? "secondary"
              : "destructive"
            : "default";

          return (
            <div className="flex gap-2 items-center">
              {isDesynced && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <LuTriangleAlert className="w-4 h-4 text-warning" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {meta.t("profiles.synchronizer.desyncedTooltip", {
                      url: syncInfo?.failedAtUrl ?? "",
                    })}
                  </TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <RippleButton
                      variant={buttonVariant}
                      size="sm"
                      disabled={!canLaunch || isLaunching || isStopping}
                      className={cn(
                        "min-w-[80px] h-7 px-3",
                        !canLaunch && "opacity-50 cursor-not-allowed",
                        canLaunch && "cursor-pointer",
                        isFollower && "border-accent",
                      )}
                      onClick={() =>
                        isRunning
                          ? void handleStop()
                          : void handleProfileLaunch(profile)
                      }
                    >
                      {isLaunching || isStopping ? (
                        <div className="flex gap-1 items-center">
                          <div className="w-3 h-3 rounded-full border border-current animate-spin border-t-transparent" />
                        </div>
                      ) : isRunning ? (
                        meta.t("profiles.actions.stop")
                      ) : (
                        meta.t("profiles.actions.launch")
                      )}
                    </RippleButton>
                  </span>
                </TooltipTrigger>
                {(stopTooltip || tooltipContent) && (
                  <TooltipContent>
                    {isRunning ? stopTooltip : tooltipContent}
                  </TooltipContent>
                )}
              </Tooltip>
            </div>
          );
        },
      },
      {
        accessorKey: "name",
        size: 130,
        header: ({ column, table }) => {
          const meta = table.options.meta as TableMeta;
          return (
            <Button
              variant="ghost"
              onClick={() => {
                column.toggleSorting(column.getIsSorted() === "asc");
              }}
              className="justify-start p-0 h-auto font-semibold text-left cursor-pointer"
            >
              {meta.t("common.labels.name")}
              {column.getIsSorted() === "asc" ? (
                <LuChevronUp className="ml-2 w-4 h-4" />
              ) : column.getIsSorted() === "desc" ? (
                <LuChevronDown className="ml-2 w-4 h-4" />
              ) : null}
            </Button>
          );
        },
        enableSorting: true,
        sortingFn: "alphanumeric",
        cell: ({ row, table }) => {
          const meta = table.options.meta as TableMeta;
          const profile = row.original as BrowserProfile;
          const rawName: string = row.getValue("name");
          const name = getBrowserDisplayName(rawName);
          const isEditing = meta.profileToRename?.id === profile.id;

          if (isEditing) {
            return (
              <div
                ref={renameContainerRef}
                className="overflow-visible relative"
              >
                <Input
                  autoFocus
                  value={meta.newProfileName}
                  onChange={(e) => {
                    meta.setNewProfileName(e.target.value);
                    if (meta.renameError) meta.setRenameError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) {
                      void meta.handleRename();
                    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      void meta.handleRename();
                    } else if (e.key === "Escape") {
                      meta.setProfileToRename(null);
                      meta.setNewProfileName("");
                      meta.setRenameError(null);
                    }
                  }}
                  onBlur={() => {
                    if (
                      meta.newProfileName.trim().length > 0 &&
                      meta.newProfileName.trim() !== profile.name
                    ) {
                      void meta.handleRename();
                    } else {
                      meta.setProfileToRename(null);
                      meta.setNewProfileName("");
                      meta.setRenameError(null);
                    }
                  }}
                  className="w-30 h-6 px-2 py-1 text-sm font-medium leading-none border-0 shadow-none focus-visible:ring-0"
                />
              </div>
            );
          }

          const display =
            name.length < 14 ? (
              <div className="font-medium text-left leading-none">{name}</div>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="leading-none">{trimName(name, 14)}</span>
                </TooltipTrigger>
                <TooltipContent>{name}</TooltipContent>
              </Tooltip>
            );

          const isCrossOs = isCrossOsProfile(profile);
          const isCrossOsBlocked = isCrossOs;
          const isRunning =
            meta.isClient && meta.runningProfiles.has(profile.id);
          const isLaunching = meta.launchingProfiles.has(profile.id);
          const isStopping = meta.stoppingProfiles.has(profile.id);
          const isDisabled =
            isRunning || isLaunching || isStopping || isCrossOsBlocked;
          const lockedEmail = meta.getProfileLockEmail(profile.id);
          const isLocked = meta.isProfileLockedByAnother(profile.id);

          return (
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={cn(
                  "px-2 py-1 mr-auto text-left bg-transparent rounded border-none w-30 h-6",
                  isDisabled
                    ? "opacity-60 cursor-not-allowed"
                    : "cursor-pointer hover:bg-accent/50",
                )}
                onClick={() => {
                  if (isDisabled) return;
                  meta.setProfileToRename(profile);
                  meta.setNewProfileName(profile.name);
                  meta.setRenameError(null);
                }}
                onKeyDown={(e) => {
                  if (isDisabled) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    meta.setProfileToRename(profile);
                    meta.setNewProfileName(profile.name);
                    meta.setRenameError(null);
                  }
                }}
              >
                {display}
              </button>
              {isLocked && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <LuLock className="w-3 h-3 text-muted-foreground" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {meta.t("sync.team.profileLocked", { email: lockedEmail })}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          );
        },
      },
      {
        id: "tags",
        size: 110,
        header: ({ table }) => {
          const meta = table.options.meta as TableMeta;
          return meta.t("profileTable.tagsHeader");
        },
        cell: ({ row, table }) => {
          const meta = table.options.meta as TableMeta;
          const profile = row.original;
          const isCrossOs = isCrossOsProfile(profile);
          const isCrossOsBlocked = isCrossOs;
          const isRunning =
            meta.isClient && meta.runningProfiles.has(profile.id);
          const isLaunching = meta.launchingProfiles.has(profile.id);
          const isStopping = meta.stoppingProfiles.has(profile.id);
          const isDisabled =
            isRunning || isLaunching || isStopping || isCrossOsBlocked;

          return (
            <TagsCell
              profile={profile}
              isDisabled={isDisabled}
              tagsOverrides={meta.tagsOverrides ?? {}}
              allTags={meta.allTags ?? []}
              setAllTags={meta.setAllTags}
              openTagsEditorFor={meta.openTagsEditorFor ?? null}
              setOpenTagsEditorFor={meta.setOpenTagsEditorFor}
              setTagsOverrides={meta.setTagsOverrides}
            />
          );
        },
      },
      {
        id: "note",
        size: 110,
        header: ({ table }) => {
          const meta = table.options.meta as TableMeta;
          return meta.t("profileTable.noteHeader");
        },
        cell: ({ row, table }) => {
          const meta = table.options.meta as TableMeta;
          const profile = row.original;
          const isCrossOs = isCrossOsProfile(profile);
          const isCrossOsBlocked = isCrossOs;
          const isRunning =
            meta.isClient && meta.runningProfiles.has(profile.id);
          const isLaunching = meta.launchingProfiles.has(profile.id);
          const isStopping = meta.stoppingProfiles.has(profile.id);
          const isDisabled =
            isRunning || isLaunching || isStopping || isCrossOsBlocked;

          return (
            <NoteCell
              profile={profile}
              isDisabled={isDisabled}
              noteOverrides={meta.noteOverrides ?? {}}
              openNoteEditorFor={meta.openNoteEditorFor ?? null}
              setOpenNoteEditorFor={meta.setOpenNoteEditorFor}
              setNoteOverrides={meta.setNoteOverrides}
            />
          );
        },
      },
      {
        id: "proxy",
        size: 130,
        header: ({ table }) => {
          const meta = table.options.meta as TableMeta;
          return meta.t("profiles.table.proxy");
        },
        cell: ({ row, table }) => {
          const meta = table.options.meta as TableMeta;
          const profile = row.original;
          const isCrossOs = isCrossOsProfile(profile);
          const isCrossOsBlocked = isCrossOs;
          const isRunning =
            meta.isClient && meta.runningProfiles.has(profile.id);
          const isLaunching = meta.launchingProfiles.has(profile.id);
          const isStopping = meta.stoppingProfiles.has(profile.id);
          const isDisabled =
            isRunning || isLaunching || isStopping || isCrossOsBlocked;

          const hasProxyOverride = Object.hasOwn(
            meta.proxyOverrides,
            profile.id,
          );
          const effectiveProxyId = hasProxyOverride
            ? meta.proxyOverrides[profile.id]
            : (profile.proxy_id ?? null);
          const effectiveProxy = effectiveProxyId
            ? (meta.storedProxies.find((p) => p.id === effectiveProxyId) ??
              null)
            : null;

          const hasVpnOverride = Object.hasOwn(meta.vpnOverrides, profile.id);
          const effectiveVpnId = hasVpnOverride
            ? meta.vpnOverrides[profile.id]
            : (profile.vpn_id ?? null);
          const effectiveVpn = effectiveVpnId
            ? (meta.vpnConfigs.find((v) => v.id === effectiveVpnId) ?? null)
            : null;

          const hasAssignment = Boolean(effectiveProxy || effectiveVpn);
          const displayName = effectiveVpn
            ? effectiveVpn.name
            : effectiveProxy
              ? effectiveProxy.name
              : meta.t("profiles.table.notSelected");
          const vpnBadge = effectiveVpn ? "WG" : null;
          const tooltipText = hasAssignment ? displayName : null;
          const isSelectorOpen = meta.openProxySelectorFor === profile.id;
          const selectedId = effectiveVpnId ?? effectiveProxyId ?? null;

          // When profile is running, show bandwidth chart instead of proxy selector
          if (isRunning && meta.trafficSnapshots) {
            const snapshot = meta.trafficSnapshots[profile.id];
            const bandwidthData = snapshot?.recent_bandwidth
              ? [...snapshot.recent_bandwidth]
              : [];
            const currentBandwidth =
              (snapshot?.current_bytes_sent ?? 0) +
              (snapshot?.current_bytes_received ?? 0);

            return (
              <BandwidthMiniChart
                key={`${profile.id}-${snapshot?.last_update ?? 0}-${bandwidthData.length}`}
                data={bandwidthData}
                currentBandwidth={currentBandwidth}
                onClick={() => meta.onOpenTrafficDialog?.(profile.id)}
              />
            );
          }

          return (
            <div className="flex gap-2 items-center">
              <Popover
                open={isSelectorOpen}
                onOpenChange={(open) => {
                  meta.setOpenProxySelectorFor(open ? profile.id : null);
                }}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <span
                        className={cn(
                          "flex gap-2 items-center px-2 py-1 rounded",
                          isDisabled
                            ? "opacity-60 cursor-not-allowed pointer-events-none"
                            : "cursor-pointer hover:bg-accent/50",
                        )}
                      >
                        {vpnBadge && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1 py-0 leading-tight"
                          >
                            {vpnBadge}
                          </Badge>
                        )}
                        <span
                          className={cn(
                            "text-sm",
                            !hasAssignment && "text-muted-foreground",
                          )}
                        >
                          {hasAssignment
                            ? trimName(displayName, 10)
                            : displayName}
                        </span>
                      </span>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  {tooltipText && (
                    <TooltipContent>{tooltipText}</TooltipContent>
                  )}
                </Tooltip>

                {!isDisabled && (
                  <PopoverContent
                    className="w-[240px] p-0"
                    align="end"
                    sideOffset={8}
                  >
                    <Command>
                      <CommandInput
                        placeholder={
                          meta.canCreateLocationProxy
                            ? t("createProfile.proxy.searchWithCountries")
                            : t("createProfile.proxy.search")
                        }
                        onFocus={() => {
                          if (meta.canCreateLocationProxy)
                            void meta.loadCountries();
                        }}
                      />
                      <CommandList>
                        <CommandEmpty>
                          {t("createProfile.proxy.notFound")}
                        </CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="__none__"
                            onSelect={() =>
                              void meta.handleProxySelection(profile.id, null)
                            }
                          >
                            <LuCheck
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedId === null
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            {t("common.labels.none")}
                          </CommandItem>
                          {meta.storedProxies
                            .filter(
                              (proxy: StoredProxy) =>
                                !proxy.is_cloud_managed &&
                                !proxy.is_cloud_derived,
                            )
                            .map((proxy: StoredProxy) => (
                              <CommandItem
                                key={proxy.id}
                                value={proxy.name}
                                onSelect={() =>
                                  void meta.handleProxySelection(
                                    profile.id,
                                    proxy.id,
                                  )
                                }
                              >
                                <LuCheck
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    effectiveProxyId === proxy.id &&
                                      !effectiveVpn
                                      ? "opacity-100"
                                      : "opacity-0",
                                  )}
                                />
                                {proxy.name}
                              </CommandItem>
                            ))}
                        </CommandGroup>
                        {meta.vpnConfigs.length > 0 && (
                          <CommandGroup heading={t("profileTable.vpnsHeading")}>
                            {meta.vpnConfigs.map((vpn) => (
                              <CommandItem
                                key={vpn.id}
                                value={`vpn-${vpn.name}`}
                                onSelect={() =>
                                  void meta.handleVpnSelection(
                                    profile.id,
                                    vpn.id,
                                  )
                                }
                              >
                                <LuCheck
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    effectiveVpnId === vpn.id
                                      ? "opacity-100"
                                      : "opacity-0",
                                  )}
                                />
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1 py-0 leading-tight mr-1"
                                >
                                  WG
                                </Badge>
                                {vpn.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        )}
                        {meta.canCreateLocationProxy &&
                          meta.countries.length > 0 && (
                            <CommandGroup
                              heading={t("profileTable.createByCountryHeading")}
                            >
                              {meta.countries
                                .filter(
                                  (c) =>
                                    !meta.storedProxies.some(
                                      (p) =>
                                        p.is_cloud_derived &&
                                        p.geo_country === c.code,
                                    ),
                                )
                                .map((country) => (
                                  <CommandItem
                                    key={`country-${country.code}`}
                                    value={`create-${country.name}`}
                                    onSelect={() =>
                                      void meta.handleCreateCountryProxy(
                                        profile.id,
                                        country,
                                      )
                                    }
                                  >
                                    <span className="mr-2 h-4 w-4" />+{" "}
                                    {country.name}
                                  </CommandItem>
                                ))}
                            </CommandGroup>
                          )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                )}
              </Popover>
              {effectiveProxy && !effectiveVpn && !isDisabled && (
                <ProxyCheckButton
                  proxy={effectiveProxy}
                  profileId={profile.id}
                  checkingProfileId={meta.checkingProfileId}
                  cachedResult={meta.proxyCheckResults[effectiveProxy.id]}
                  setCheckingProfileId={setCheckingProfileId}
                  onCheckComplete={(result) => {
                    setProxyCheckResults((prev) => ({
                      ...prev,
                      [effectiveProxy.id]: result,
                    }));
                  }}
                  onCheckFailed={(result) => {
                    setProxyCheckResults((prev) => ({
                      ...prev,
                      [effectiveProxy.id]: result,
                    }));
                  }}
                />
              )}
            </div>
          );
        },
      },
      {
        id: "sync",
        header: "",
        size: 24,
        cell: ({ row, table }) => {
          const profile = row.original;
          const meta = table.options.meta as TableMeta;
          const syncEntry = meta.syncStatuses[profile.id];
          const liveStatus = syncEntry?.status as
            | "syncing"
            | "waiting"
            | "synced"
            | "error"
            | "disabled"
            | undefined;

          const dot = getProfileSyncStatusDot(
            profile,
            liveStatus,
            meta.t,
            syncEntry?.error,
            meta.formatDateTime,
          );
          if (!dot) return null;

          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex justify-center items-center w-3 h-3">
                  {dot.encrypted ? (
                    <LuLock
                      className={`w-3 h-3 ${dot.color.replace("bg-", "text-")}${dot.animate ? " animate-pulse" : ""}`}
                    />
                  ) : (
                    <span
                      className={`w-2 h-2 rounded-full ${dot.color}${dot.animate ? " animate-pulse" : ""}`}
                    />
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent>{dot.tooltip}</TooltipContent>
            </Tooltip>
          );
        },
      },
      {
        id: "settings",
        size: 40,
        cell: ({ row, table }) => {
          const meta = table.options.meta as TableMeta;
          const profile = row.original;
          const canShareToTeam =
            !!meta.onPublishTeamProfile &&
            (profile.browser === "wayfern" ||
              profile.engine === "wayfern" ||
              profile.browser === "cloak" ||
              profile.engine === "cloak") &&
            profile.ephemeral !== true;

          return (
            <div className="flex justify-end items-center gap-1">
              {canShareToTeam && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      disabled={!meta.isClient}
                      onClick={() => {
                        meta.onPublishTeamProfile?.(profile);
                      }}
                    >
                      <span className="sr-only">
                        {t("profiles.actions.shareToTeam")}
                      </span>
                      <LuShare2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("profiles.actions.shareToTeam")}
                  </TooltipContent>
                </Tooltip>
              )}
              <Button
                variant="ghost"
                className="p-0 w-8 h-8"
                disabled={!meta.isClient}
                onClick={() => {
                  setProfileForInfoDialog(profile);
                }}
              >
                <span className="sr-only">
                  {t("profiles.aria.profileInfo")}
                </span>
                <LuInfo className="w-4 h-4" />
              </Button>
            </div>
          );
        },
      },
    ],
    [t],
  );

  const table = useReactTable({
    data: profiles,
    columns,
    state: {
      sorting,
      rowSelection,
    },
    onSortingChange: handleSortingChange,
    onRowSelectionChange: handleRowSelectionChange,
    enableRowSelection: (row) => {
      const profile = row.original;
      const isRunning =
        browserState.isClient && runningProfiles.has(profile.id);
      const isLaunching = launchingProfiles.has(profile.id);
      const isStopping = stoppingProfiles.has(profile.id);
      return !isRunning && !isLaunching && !isStopping;
    },
    getSortedRowModel: getSortedRowModel(),
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    meta: tableMeta,
  });

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <ScrollArea className="min-h-0 flex-1 rounded-md border [&>div[data-slot='scroll-area-viewport']>div]:overflow-visible">
        <Table className="overflow-visible table-fixed">
          <TableHeader className="sticky top-0 z-10 overflow-visible bg-background">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="overflow-visible">
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead
                      key={header.id}
                      style={{
                        width: header.column.columnDef.size
                          ? `${header.column.getSize()}px`
                          : undefined,
                      }}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className="overflow-visible">
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => {
                const rowIsCrossOs = isCrossOsProfile(row.original);
                const crossOsTitle = rowIsCrossOs
                  ? t("crossOs.viewOnly", {
                      os: getOSDisplayName(
                        row.original.host_os ||
                          row.original.camoufox_config?.os ||
                          row.original.wayfern_config?.os ||
                          "",
                      ),
                    })
                  : undefined;
                return (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    title={crossOsTitle}
                    className={cn(
                      "overflow-visible hover:bg-accent/50",
                      rowIsCrossOs && "opacity-60",
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className="overflow-visible"
                        style={{
                          width: cell.column.columnDef.size
                            ? `${cell.column.getSize()}px`
                            : undefined,
                        }}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="p-0 align-middle"
                >
                  <EmptyProfilesState
                    isFreshInstall={
                      (totalProfileCount ?? profiles.length) === 0 &&
                      !hasActiveFilter
                    }
                    hasActiveFilter={hasActiveFilter}
                    onCreateProfile={onOpenCreateProfile}
                    onClearFilters={onClearFilters}
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollArea>
      <DeleteConfirmationDialog
        isOpen={profileToDelete !== null}
        onClose={() => {
          setProfileToDelete(null);
        }}
        onConfirm={handleDelete}
        title={t("profiles.delete.title")}
        description={t("profiles.delete.description", {
          profileName: profileToDelete?.name ?? "",
        })}
        confirmButtonText={t("profiles.delete.confirmButton")}
        isLoading={isDeleting}
      />
      {profileForInfoDialog &&
        (() => {
          const infoProfile = profileForInfoDialog;
          const infoIsRunning =
            browserState.isClient && runningProfiles.has(infoProfile.id);
          const infoIsLaunching = launchingProfiles.has(infoProfile.id);
          const infoIsStopping = stoppingProfiles.has(infoProfile.id);
          const infoIsCrossOs = isCrossOsProfile(infoProfile);
          const infoIsDisabled =
            infoIsRunning || infoIsLaunching || infoIsStopping || infoIsCrossOs;
          return (
            <ProfileInfoDialog
              isOpen={profileForInfoDialog !== null}
              onClose={() => {
                setProfileForInfoDialog(null);
              }}
              profile={infoProfile}
              storedProxies={storedProxies}
              vpnConfigs={vpnConfigs}
              onOpenTrafficDialog={(profileId) => {
                const profile = profiles.find((p) => p.id === profileId);
                setTrafficDialogProfile({ id: profileId, name: profile?.name });
              }}
              onOpenProfileSyncDialog={onOpenProfileSyncDialog}
              onAssignProfilesToGroup={onAssignProfilesToGroup}
              onConfigureCamoufox={onConfigureCamoufox}
              onCopyCookiesToProfile={onCopyCookiesToProfile}
              onOpenCookieManagement={onOpenCookieManagement}
              onPublishTeamProfile={onPublishTeamProfile}
              onAssignExtensionGroup={onAssignExtensionGroup}
              onOpenBypassRules={(profile) => {
                setBypassRulesProfile(profile);
              }}
              onOpenDnsBlocklist={(profile) => {
                setDnsBlocklistProfile(profile);
              }}
              onOpenLaunchHook={(profile) => {
                setLaunchHookProfile(profile);
              }}
              onCloneProfile={onCloneProfile}
              onLaunchWithSync={onLaunchWithSync}
              onLaunchHeadless={onLaunchHeadless}
              onDeleteProfile={(profile) => {
                setProfileForInfoDialog(null);
                setProfileToDelete(profile);
              }}
              crossOsUnlocked={crossOsUnlocked}
              isRunning={infoIsRunning}
              isDisabled={infoIsDisabled}
              isCrossOs={infoIsCrossOs}
              syncStatuses={syncStatuses}
            />
          );
        })()}
      <DataTableActionBar table={table}>
        <DataTableActionBarSelection table={table} />
        {onBulkLaunch && (
          <DataTableActionBarAction
            tooltip={t("profiles.actionBar.launchSelected")}
            onClick={onBulkLaunch}
            size="icon"
          >
            <LuPlay />
          </DataTableActionBarAction>
        )}
        {onBulkStop && (
          <DataTableActionBarAction
            tooltip={t("profiles.actionBar.stopSelected")}
            onClick={onBulkStop}
            size="icon"
          >
            <LuSquare />
          </DataTableActionBarAction>
        )}
        {onBulkGroupAssignment && (
          <DataTableActionBarAction
            tooltip={t("profiles.actionBar.assignToGroup")}
            onClick={onBulkGroupAssignment}
            size="icon"
          >
            <LuUsers />
          </DataTableActionBarAction>
        )}
        {onBulkProxyAssignment && (
          <DataTableActionBarAction
            tooltip={t("profiles.actionBar.assignProxy")}
            onClick={onBulkProxyAssignment}
            size="icon"
          >
            <FiWifi />
          </DataTableActionBarAction>
        )}
        {onBulkExtensionGroupAssignment && (
          <DataTableActionBarAction
            tooltip={t("profiles.actionBar.assignExtensionGroup")}
            onClick={onBulkExtensionGroupAssignment}
            size="icon"
          >
            <LuPuzzle />
          </DataTableActionBarAction>
        )}
        {onBulkCopyCookies && (
          <DataTableActionBarAction
            tooltip={t("profiles.actionBar.copyCookies")}
            onClick={onBulkCopyCookies}
            size="icon"
          >
            <LuCookie />
          </DataTableActionBarAction>
        )}
        {onBulkDelete && (
          <DataTableActionBarAction
            tooltip={t("common.buttons.delete")}
            onClick={onBulkDelete}
            size="icon"
            variant="destructive"
            className="border-destructive bg-destructive/50 hover:bg-destructive/70"
          >
            <LuTrash2 />
          </DataTableActionBarAction>
        )}
      </DataTableActionBar>
      {trafficDialogProfile && (
        <TrafficDetailsDialog
          isOpen={trafficDialogProfile !== null}
          onClose={() => {
            setTrafficDialogProfile(null);
          }}
          profileId={trafficDialogProfile.id}
          profileName={trafficDialogProfile.name}
        />
      )}
      <ProfileBypassRulesDialog
        isOpen={bypassRulesProfile !== null}
        onClose={() => {
          setBypassRulesProfile(null);
        }}
        profileId={bypassRulesProfile?.id ?? null}
        initialRules={bypassRulesProfile?.proxy_bypass_rules ?? []}
      />
      <ProfileDnsBlocklistDialog
        isOpen={dnsBlocklistProfile !== null}
        onClose={() => {
          setDnsBlocklistProfile(null);
        }}
        profileId={dnsBlocklistProfile?.id ?? null}
        currentLevel={dnsBlocklistProfile?.dns_blocklist ?? null}
      />
      <ProfileLaunchHookDialog
        isOpen={launchHookProfile !== null}
        onClose={() => {
          setLaunchHookProfile(null);
        }}
        profileId={launchHookProfile?.id ?? null}
        currentLaunchHook={launchHookProfile?.launch_hook ?? null}
      />
    </div>
  );
}
