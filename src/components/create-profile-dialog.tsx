"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BotAssetSelector } from "@/components/create-profile/bot-asset-selector";
import { BrowserDownloadStatus } from "@/components/create-profile/browser-download-status";
import { BrowserSelectionStep } from "@/components/create-profile/browser-selection-step";
import {
  type CloakConfigFields,
  CloakRuntimeStatus,
  type CloakRuntimeStatusValue,
} from "@/components/create-profile/cloak-runtime-status";
import { ProxyVpnSelector } from "@/components/create-profile/proxy-vpn-selector";
import { RegularBrowserDownloadStatus } from "@/components/create-profile/regular-browser-download-status";
import { LoadingButton } from "@/components/loading-button";
import { ProxyFormDialog } from "@/components/proxy-form-dialog";
import { SharedCamoufoxConfigForm } from "@/components/shared-camoufox-config-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { WayfernConfigForm } from "@/components/wayfern-config-form";
import { useBrowserDownload } from "@/hooks/use-browser-download";
import { useProxyEvents } from "@/hooks/use-proxy-events";
import { useVpnEvents } from "@/hooks/use-vpn-events";
import type {
  BotBrowserConfig,
  BrowserReleaseTypes,
  BrowserTypeString,
  CamoufoxConfig,
  CamoufoxOS,
  CloakConfig,
  SelfHostedAuthState,
  TeamBotProfileAsset,
  WayfernConfig,
  WayfernOS,
} from "@/types";

const getCurrentOS = (): CamoufoxOS => {
  if (typeof navigator === "undefined") return "linux";
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("win")) return "windows";
  if (platform.includes("mac")) return "macos";
  return "linux";
};

import { RippleButton } from "./ui/ripple";

interface CreateProfileDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateProfile: (profileData: {
    name: string;
    browserStr: BrowserTypeString;
    version: string;
    releaseType: string;
    proxyId?: string;
    vpnId?: string;
    camoufoxConfig?: CamoufoxConfig;
    wayfernConfig?: WayfernConfig;
    botbrowserConfig?: BotBrowserConfig;
    cloakConfig?: CloakConfig;
    groupId?: string;
    extensionGroupId?: string;
    ephemeral?: boolean;
    dnsBlocklist?: string;
    launchHook?: string;
  }) => Promise<void>;
  selectedGroupId?: string;
}

interface BrowserOption {
  value: BrowserTypeString;
  labelKey: string;
}

const browserOptions: BrowserOption[] = [
  {
    value: "camoufox",
    labelKey: "createProfile.engines.camoufox",
  },
  {
    value: "wayfern",
    labelKey: "createProfile.engines.wayfern",
  },
];

export function CreateProfileDialog({
  isOpen,
  onClose,
  onCreateProfile,
  selectedGroupId,
}: CreateProfileDialogProps) {
  const { t } = useTranslation();
  const browserDisplayName = useCallback(
    (browser?: BrowserTypeString | string | null) => {
      switch (browser) {
        case "botbrowser":
          return t("createProfile.engines.botbrowser");
        case "wayfern":
          return t("createProfile.engines.wayfern");
        case "cloak":
          return t("createProfile.engines.cloak");
        case "camoufox":
          return t("createProfile.engines.camoufox");
        default:
          return "";
      }
    },
    [t],
  );
  const [profileName, setProfileName] = useState("");
  const [currentStep, setCurrentStep] = useState<
    "browser-selection" | "browser-config"
  >("browser-selection");
  const [activeTab, setActiveTab] = useState("anti-detect");

  // Browser selection states
  const [selectedBrowser, setSelectedBrowser] =
    useState<BrowserTypeString | null>(null);
  const [selectedProxyId, setSelectedProxyId] = useState<string>();
  const [proxyPopoverOpen, setProxyPopoverOpen] = useState(false);
  const [dnsBlocklist, setDnsBlocklist] = useState<string>("");
  const [launchHook, setLaunchHook] = useState("");
  const [selfHostedUser, setSelfHostedUser] = useState<
    SelfHostedAuthState["user"] | null
  >(null);
  const [botProfileAssets, setBotProfileAssets] = useState<
    TeamBotProfileAsset[]
  >([]);
  const [selectedBotProfileAssetId, setSelectedBotProfileAssetId] =
    useState<string>("__none__");
  const [botProfilePath, setBotProfilePath] = useState("");
  const [botExecutablePath, setBotExecutablePath] = useState("");
  const [cloakExecutablePath, setCloakExecutablePath] = useState("");
  const [cloakFingerprintSeed, setCloakFingerprintSeed] = useState("");
  const [cloakLocale, setCloakLocale] = useState("");
  const [cloakTimezone, setCloakTimezone] = useState("");
  const [cloakLanguages, setCloakLanguages] = useState("");
  const [cloakExtraArgs, setCloakExtraArgs] = useState("");
  const [cloakRuntimeStatus, setCloakRuntimeStatus] =
    useState<CloakRuntimeStatusValue | null>(null);
  const [isLoadingCloakRuntime, setIsLoadingCloakRuntime] = useState(false);

  // Camoufox anti-detect states
  const [camoufoxConfig, setCamoufoxConfig] = useState<CamoufoxConfig>(() => ({
    geoip: true, // Default to automatic geoip
    os: getCurrentOS(), // Default to current OS
  }));

  // Wayfern anti-detect states
  const [wayfernConfig, setWayfernConfig] = useState<WayfernConfig>(() => ({
    os: getCurrentOS() as WayfernOS, // Default to current OS
  }));

  // Handle browser selection from the initial screen
  const handleBrowserSelect = (browser: BrowserTypeString) => {
    setSelectedBrowser(browser);
    setCurrentStep("browser-config");
  };

  // Handle back button
  const handleBack = () => {
    setCurrentStep("browser-selection");
    setSelectedBrowser(null);
    setProfileName("");
    setSelectedProxyId(undefined);
    setLaunchHook("");
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setCurrentStep("browser-selection");
    setSelectedBrowser(null);
    setProfileName("");
    setSelectedProxyId(undefined);
    setLaunchHook("");
  };

  const [supportedBrowsers, setSupportedBrowsers] = useState<string[]>([]);
  const { storedProxies } = useProxyEvents();
  const { vpnConfigs } = useVpnEvents();
  const [showProxyForm, setShowProxyForm] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [ephemeral, setEphemeral] = useState(false);
  const [selectedExtensionGroupId, setSelectedExtensionGroupId] =
    useState<string>();
  const [extensionGroups, setExtensionGroups] = useState<
    { id: string; name: string; extension_ids: string[] }[]
  >([]);

  useEffect(() => {
    if (isOpen) {
      void invoke<{ id: string; name: string; extension_ids: string[] }[]>(
        "list_extension_groups",
      )
        .then(setExtensionGroups)
        .catch(() => {
          setExtensionGroups([]);
        });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    void invoke<SelfHostedAuthState | null>("get_self_hosted_user")
      .then((state) => {
        setSelfHostedUser(state?.user ?? null);
        if (state?.user) {
          void invoke<TeamBotProfileAsset[]>("team_list_bot_profiles")
            .then(setBotProfileAssets)
            .catch(() => {
              setBotProfileAssets([]);
            });
        } else {
          setBotProfileAssets([]);
        }
      })
      .catch(() => {
        setSelfHostedUser(null);
        setBotProfileAssets([]);
      });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || selectedBrowser !== "cloak") {
      setCloakRuntimeStatus(null);
      setIsLoadingCloakRuntime(false);
      return;
    }

    let cancelled = false;
    setIsLoadingCloakRuntime(true);
    void invoke<CloakRuntimeStatusValue>("cloak_get_runtime_status")
      .then(async (status) => {
        if (!cancelled) {
          setCloakRuntimeStatus(status);
        }
        try {
          const validated = await invoke<CloakRuntimeStatusValue>(
            "cloak_validate_runtime",
            {
              profile: null,
            },
          );
          if (!cancelled) {
            setCloakRuntimeStatus(validated);
          }
        } catch {
          if (!cancelled) {
            setCloakRuntimeStatus(status);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCloakRuntimeStatus(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingCloakRuntime(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedBrowser]);

  const [releaseTypes, setReleaseTypes] = useState<BrowserReleaseTypes>();
  const [isLoadingReleaseTypes, setIsLoadingReleaseTypes] = useState(false);
  const [releaseTypesError, setReleaseTypesError] = useState<string | null>(
    null,
  );
  const loadingBrowserRef = useRef<string | null>(null);

  // Use the browser download hook
  const {
    isBrowserDownloading,
    downloadBrowser,
    loadDownloadedVersions,
    isVersionDownloaded,
    downloadedVersionsMap,
  } = useBrowserDownload();

  const loadSupportedBrowsers = useCallback(async () => {
    try {
      const browsers = await invoke<string[]>("get_supported_browsers");
      setSupportedBrowsers(browsers);
    } catch (error) {
      console.error("Failed to load supported browsers:", error);
    }
  }, []);

  const checkAndDownloadGeoIPDatabase = useCallback(async () => {
    try {
      const isAvailable = await invoke<boolean>("is_geoip_database_available");
      if (!isAvailable) {
        console.log("GeoIP database not available, downloading...");
        await invoke("download_geoip_database");
        console.log("GeoIP database downloaded successfully");
      }
    } catch (error) {
      console.error("Failed to check/download GeoIP database:", error);
      // Don't show error to user as this is not critical for profile creation
    }
  }, []);

  const loadReleaseTypes = useCallback(
    async (browser: string) => {
      // Set loading state
      loadingBrowserRef.current = browser;
      setIsLoadingReleaseTypes(true);
      setReleaseTypesError(null);

      try {
        const rawReleaseTypes = await invoke<BrowserReleaseTypes>(
          "get_browser_release_types",
          { browserStr: browser },
        );

        await loadDownloadedVersions(browser);

        // Only update state if this browser is still the one we're loading
        if (loadingBrowserRef.current === browser) {
          const filtered: BrowserReleaseTypes = {};
          if (rawReleaseTypes.stable) filtered.stable = rawReleaseTypes.stable;
          setReleaseTypes(filtered);
          setReleaseTypesError(null);
        }
      } catch (error) {
        console.error(`Failed to load release types for ${browser}:`, error);

        // Fallback: still load downloaded versions and derive release type from them if possible
        try {
          const downloaded = await loadDownloadedVersions(browser);
          if (loadingBrowserRef.current === browser && downloaded.length > 0) {
            const latest = downloaded[0];
            const fallback: BrowserReleaseTypes = {};
            fallback.stable = latest;
            setReleaseTypes(fallback);
            setReleaseTypesError(null);
          } else if (loadingBrowserRef.current === browser) {
            // No downloaded versions and API failed - show error
            setReleaseTypesError(t("createProfile.version.fetchError"));
          }
        } catch (e) {
          console.error(
            `Failed to load downloaded versions for ${browser}:`,
            e,
          );
          if (loadingBrowserRef.current === browser) {
            setReleaseTypesError(t("createProfile.version.fetchError"));
          }
        }
      } finally {
        // Clear loading state only if we're still loading this browser
        if (loadingBrowserRef.current === browser) {
          loadingBrowserRef.current = null;
          setIsLoadingReleaseTypes(false);
        }
      }
    },
    [loadDownloadedVersions, t],
  );

  // Load data when dialog opens
  useEffect(() => {
    if (isOpen) {
      void loadSupportedBrowsers();
      // Load release types when a browser is selected
      if (
        selectedBrowser &&
        selectedBrowser !== "botbrowser" &&
        selectedBrowser !== "cloak"
      ) {
        void loadReleaseTypes(selectedBrowser);
      }
      // Check and download GeoIP database if needed for Camoufox or Wayfern
      if (selectedBrowser === "camoufox" || selectedBrowser === "wayfern") {
        void checkAndDownloadGeoIPDatabase();
      }
    }
  }, [
    isOpen,
    loadSupportedBrowsers,
    loadReleaseTypes,
    checkAndDownloadGeoIPDatabase,
    selectedBrowser,
  ]);

  // Load release types when browser selection changes
  useEffect(() => {
    if (
      selectedBrowser &&
      selectedBrowser !== "botbrowser" &&
      selectedBrowser !== "cloak"
    ) {
      // Cancel any previous loading
      loadingBrowserRef.current = null;
      // Clear previous release types immediately to prevent showing stale data
      setReleaseTypes({});
      void loadReleaseTypes(selectedBrowser);
    }
  }, [selectedBrowser, loadReleaseTypes]);

  // Helper function to get the best available version respecting rules
  const getBestAvailableVersion = useCallback(
    (_browserType?: string) => {
      if (!releaseTypes) return null;

      if (releaseTypes.stable) {
        return { version: releaseTypes.stable, releaseType: "stable" as const };
      }
      return null;
    },
    [releaseTypes],
  );

  const getCreatableVersion = useCallback(
    (browserType?: string) => {
      const bestVersion = getBestAvailableVersion(browserType);
      if (bestVersion && isVersionDownloaded(bestVersion.version)) {
        return bestVersion;
      }
      const browserDownloaded = downloadedVersionsMap[browserType ?? ""] ?? [];
      if (browserDownloaded.length > 0) {
        const fallbackVersion = browserDownloaded[0];
        return {
          version: fallbackVersion,
          releaseType: "stable" as const,
        };
      }
      return null;
    },
    [getBestAvailableVersion, isVersionDownloaded, downloadedVersionsMap],
  );

  const handleDownload = async (browserStr: string) => {
    const bestVersion = getBestAvailableVersion(browserStr);

    if (!bestVersion) {
      console.error("No version available for download");
      return;
    }

    try {
      await downloadBrowser(browserStr, bestVersion.version);
    } catch (error) {
      console.error("Failed to download browser:", error);
    }
  };

  const handleCreate = async () => {
    if (!profileName.trim()) return;

    setIsCreating(true);

    const isVpnSelection = selectedProxyId?.startsWith("vpn-") ?? false;
    const resolvedProxyId = isVpnSelection ? undefined : selectedProxyId;
    const resolvedVpnId =
      isVpnSelection && selectedProxyId ? selectedProxyId.slice(4) : undefined;
    try {
      if (activeTab === "anti-detect") {
        // Anti-detect browser - check if BotBrowser, Wayfern, or Camoufox is selected
        if (selectedBrowser === "botbrowser") {
          const botbrowserConfig: BotBrowserConfig = {
            executable_path: botExecutablePath.trim() || undefined,
            bot_profile_asset_id:
              selectedBotProfileAssetId !== "__none__"
                ? selectedBotProfileAssetId
                : undefined,
            bot_profile_path: botProfilePath.trim() || undefined,
          };

          await onCreateProfile({
            name: profileName.trim(),
            browserStr: "botbrowser",
            version: "system",
            releaseType: "stable",
            proxyId: resolvedProxyId,
            vpnId: resolvedVpnId,
            botbrowserConfig,
            groupId:
              selectedGroupId !== "default" ? selectedGroupId : undefined,
            extensionGroupId: selectedExtensionGroupId,
            ephemeral,
            dnsBlocklist: dnsBlocklist || undefined,
            launchHook: launchHook.trim() || undefined,
          });
        } else if (selectedBrowser === "cloak") {
          const fingerprintSeed = Number(cloakFingerprintSeed);
          const cloakConfig: CloakConfig = {
            executable_path: cloakExecutablePath.trim() || undefined,
            fingerprint_seed:
              Number.isFinite(fingerprintSeed) && fingerprintSeed > 0
                ? fingerprintSeed
                : undefined,
            locale: cloakLocale.trim() || undefined,
            timezone: cloakTimezone.trim() || undefined,
            languages: cloakLanguages.trim() || undefined,
            extra_args: cloakExtraArgs
              .split(/\s+/)
              .map((arg) => arg.trim())
              .filter(Boolean),
          };

          await onCreateProfile({
            name: profileName.trim(),
            browserStr: "cloak",
            version: "bundled",
            releaseType: "stable",
            proxyId: resolvedProxyId,
            vpnId: resolvedVpnId,
            cloakConfig,
            groupId:
              selectedGroupId !== "default" ? selectedGroupId : undefined,
            extensionGroupId: selectedExtensionGroupId,
            ephemeral,
            dnsBlocklist: dnsBlocklist || undefined,
            launchHook: launchHook.trim() || undefined,
          });
        } else if (selectedBrowser === "wayfern") {
          const bestWayfernVersion = getCreatableVersion("wayfern");
          if (!bestWayfernVersion) {
            console.error("No Wayfern version available");
            return;
          }

          // The fingerprint will be generated at launch time by the Rust backend
          const finalWayfernConfig = { ...wayfernConfig };

          await onCreateProfile({
            name: profileName.trim(),
            browserStr: "wayfern" as BrowserTypeString,
            version: bestWayfernVersion.version,
            releaseType: bestWayfernVersion.releaseType,
            proxyId: resolvedProxyId,
            vpnId: resolvedVpnId,
            wayfernConfig: finalWayfernConfig,
            groupId:
              selectedGroupId !== "default" ? selectedGroupId : undefined,
            extensionGroupId: selectedExtensionGroupId,
            ephemeral,
            dnsBlocklist: dnsBlocklist || undefined,
            launchHook: launchHook.trim() || undefined,
          });
        } else {
          // Default to Camoufox
          const bestCamoufoxVersion = getCreatableVersion("camoufox");
          if (!bestCamoufoxVersion) {
            console.error("No Camoufox version available");
            return;
          }

          // The fingerprint will be generated at launch time by the Rust backend
          // We don't need to generate it here during profile creation
          const finalCamoufoxConfig = { ...camoufoxConfig };

          await onCreateProfile({
            name: profileName.trim(),
            browserStr: "camoufox" as BrowserTypeString,
            version: bestCamoufoxVersion.version,
            releaseType: bestCamoufoxVersion.releaseType,
            proxyId: resolvedProxyId,
            vpnId: resolvedVpnId,
            camoufoxConfig: finalCamoufoxConfig,
            groupId:
              selectedGroupId !== "default" ? selectedGroupId : undefined,
            extensionGroupId: selectedExtensionGroupId,
            ephemeral,
            dnsBlocklist: dnsBlocklist || undefined,
            launchHook: launchHook.trim() || undefined,
          });
        }
      } else {
        // Regular browser
        if (!selectedBrowser) {
          console.error("Missing required browser selection");
          return;
        }

        // Use the best available version (stable preferred, nightly as fallback)
        const bestVersion = getCreatableVersion(selectedBrowser);
        if (!bestVersion) {
          console.error("No version available");
          return;
        }

        await onCreateProfile({
          name: profileName.trim(),
          browserStr: selectedBrowser,
          version: bestVersion.version,
          releaseType: bestVersion.releaseType,
          proxyId: selectedProxyId,
          groupId: selectedGroupId !== "default" ? selectedGroupId : undefined,
          dnsBlocklist: dnsBlocklist || undefined,
          launchHook: launchHook.trim() || undefined,
        });
      }

      handleClose();
    } catch (error) {
      console.error("Failed to create profile:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    // Cancel any ongoing loading
    loadingBrowserRef.current = null;

    // Reset all states
    setProfileName("");
    setCurrentStep("browser-selection");
    setActiveTab("anti-detect");
    setSelectedBrowser(null);
    setSelectedProxyId(undefined);
    setLaunchHook("");
    setSelectedBotProfileAssetId("__none__");
    setBotProfilePath("");
    setBotExecutablePath("");
    setCloakExecutablePath("");
    setCloakFingerprintSeed("");
    setCloakLocale("");
    setCloakTimezone("");
    setCloakLanguages("");
    setCloakExtraArgs("");
    setReleaseTypes({});
    setIsLoadingReleaseTypes(false);
    setReleaseTypesError(null);
    setCamoufoxConfig({
      geoip: true, // Reset to automatic geoip
      os: getCurrentOS(), // Reset to current OS
    });
    setWayfernConfig({
      os: getCurrentOS() as WayfernOS, // Reset to current OS
    });
    setEphemeral(false);
    onClose();
  };

  const updateCamoufoxConfig = (key: keyof CamoufoxConfig, value: unknown) => {
    setCamoufoxConfig((prev) => ({ ...prev, [key]: value }));
  };

  const updateWayfernConfig = (key: keyof WayfernConfig, value: unknown) => {
    setWayfernConfig((prev) => ({ ...prev, [key]: value }));
  };

  const cloakFields = useMemo<CloakConfigFields>(
    () => ({
      executablePath: cloakExecutablePath,
      fingerprintSeed: cloakFingerprintSeed,
      locale: cloakLocale,
      timezone: cloakTimezone,
      languages: cloakLanguages,
      extraArgs: cloakExtraArgs,
    }),
    [
      cloakExecutablePath,
      cloakFingerprintSeed,
      cloakLocale,
      cloakTimezone,
      cloakLanguages,
      cloakExtraArgs,
    ],
  );

  const setCloakField = useCallback(
    (field: keyof CloakConfigFields, value: string) => {
      switch (field) {
        case "executablePath":
          setCloakExecutablePath(value);
          break;
        case "fingerprintSeed":
          setCloakFingerprintSeed(value);
          break;
        case "locale":
          setCloakLocale(value);
          break;
        case "timezone":
          setCloakTimezone(value);
          break;
        case "languages":
          setCloakLanguages(value);
          break;
        case "extraArgs":
          setCloakExtraArgs(value);
          break;
      }
    },
    [],
  );

  // Check if browser version is downloaded and available
  const isBrowserVersionAvailable = useCallback(
    (browserStr: string) => {
      const bestVersion = getBestAvailableVersion(browserStr);
      return bestVersion && isVersionDownloaded(bestVersion.version);
    },
    [isVersionDownloaded, getBestAvailableVersion],
  );

  // Check if browser is currently downloading
  const isBrowserCurrentlyDownloading = useCallback(
    (browserStr: string) => {
      return isBrowserDownloading(browserStr);
    },
    [isBrowserDownloading],
  );

  const isCreateDisabled = useMemo(() => {
    if (!profileName.trim()) return true;
    if (!selectedBrowser) return true;
    if (selectedBrowser === "botbrowser") {
      if (!selfHostedUser) return true;
      if (selectedBotProfileAssetId === "__none__" && !botProfilePath.trim()) {
        return true;
      }
      return false;
    }
    if (selectedBrowser === "cloak") return false;
    if (isBrowserCurrentlyDownloading(selectedBrowser)) return true;
    if (!getCreatableVersion(selectedBrowser)) return true;

    return false;
  }, [
    profileName,
    selectedBrowser,
    selfHostedUser,
    selectedBotProfileAssetId,
    botProfilePath,
    isBrowserCurrentlyDownloading,
    getCreatableVersion,
  ]);

  // Filter supported browsers for regular browsers
  const regularBrowsers = browserOptions.filter((browser) =>
    supportedBrowsers.includes(browser.value),
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>
            {currentStep === "browser-selection"
              ? t("createProfile.title")
              : t("createProfile.configureTitle", {
                  browser:
                    selectedBrowser === "wayfern"
                      ? t("createProfile.chromiumLabel")
                      : selectedBrowser === "camoufox"
                        ? t("createProfile.firefoxLabel")
                        : browserDisplayName(selectedBrowser),
                })}
          </DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="flex flex-col flex-1 w-full min-h-0"
        >
          {/* Tab list hidden - only anti-detect browsers are supported */}

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2">
            <div className="w-full">
              <div className="mx-auto w-full max-w-2xl space-y-6 py-4">
                {currentStep === "browser-selection" ? (
                  <BrowserSelectionStep
                    regularBrowsers={regularBrowsers}
                    onSelect={handleBrowserSelect}
                  />
                ) : (
                  <>
                    <TabsContent value="anti-detect" className="mt-0">
                      {/* Anti-Detect Configuration */}
                      <div className="space-y-6">
                        {/* Profile Name */}
                        <div className="space-y-2">
                          <Label htmlFor="profile-name">
                            {t("createProfile.profileName")}
                          </Label>
                          <Input
                            id="profile-name"
                            value={profileName}
                            onChange={(e) => {
                              setProfileName(e.target.value);
                            }}
                            onKeyDown={(e) => {
                              if (
                                e.key === "Enter" &&
                                !isCreateDisabled &&
                                !isCreating
                              ) {
                                void handleCreate();
                              }
                            }}
                            placeholder={t(
                              "createProfile.profileNamePlaceholder",
                            )}
                          />
                        </div>

                        {/* Ephemeral Option */}
                        <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="ephemeral"
                              checked={ephemeral}
                              onCheckedChange={(checked) => {
                                setEphemeral(checked === true);
                              }}
                            />
                            <Label htmlFor="ephemeral" className="font-medium">
                              {t("profiles.ephemeral")}
                            </Label>
                            <span className="px-1 py-0.5 text-[10px] leading-none rounded bg-muted text-muted-foreground font-medium">
                              {t("profiles.ephemeralAlpha")}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground ml-6">
                            {t("profiles.ephemeralDescription")}
                          </p>
                        </div>

                        {selectedBrowser === "botbrowser" ? (
                          <BotAssetSelector
                            selfHostedUser={selfHostedUser}
                            botProfileAssets={botProfileAssets}
                            selectedBotProfileAssetId={
                              selectedBotProfileAssetId
                            }
                            onSelectedBotProfileAssetIdChange={
                              setSelectedBotProfileAssetId
                            }
                            botProfilePath={botProfilePath}
                            onBotProfilePathChange={setBotProfilePath}
                            botExecutablePath={botExecutablePath}
                            onBotExecutablePathChange={setBotExecutablePath}
                          />
                        ) : selectedBrowser === "cloak" ? (
                          <CloakRuntimeStatus
                            runtime={cloakRuntimeStatus}
                            isLoadingRuntime={isLoadingCloakRuntime}
                            fields={cloakFields}
                            onFieldChange={setCloakField}
                          />
                        ) : selectedBrowser === "wayfern" ? (
                          // Wayfern Configuration
                          <div className="space-y-6">
                            <BrowserDownloadStatus
                              engineLabel={browserDisplayName("wayfern")}
                              bestVersion={
                                getBestAvailableVersion("wayfern")?.version
                              }
                              isLoadingReleaseTypes={isLoadingReleaseTypes}
                              releaseTypesError={releaseTypesError}
                              isDownloading={isBrowserCurrentlyDownloading(
                                "wayfern",
                              )}
                              isVersionAvailable={Boolean(
                                isBrowserVersionAvailable("wayfern"),
                              )}
                              onRetry={() => {
                                if (selectedBrowser) {
                                  void loadReleaseTypes(selectedBrowser);
                                }
                              }}
                              onDownload={() => {
                                void handleDownload("wayfern");
                              }}
                            />

                            <WayfernConfigForm
                              config={wayfernConfig}
                              onConfigChange={updateWayfernConfig}
                              isCreating
                              profileVersion={
                                getBestAvailableVersion("wayfern")?.version
                              }
                              profileBrowser="wayfern"
                            />
                          </div>
                        ) : selectedBrowser === "camoufox" ? (
                          // Camoufox Configuration
                          <div className="space-y-6">
                            <BrowserDownloadStatus
                              engineLabel={browserDisplayName("camoufox")}
                              bestVersion={
                                getBestAvailableVersion("camoufox")?.version
                              }
                              isLoadingReleaseTypes={isLoadingReleaseTypes}
                              releaseTypesError={releaseTypesError}
                              isDownloading={isBrowserCurrentlyDownloading(
                                "camoufox",
                              )}
                              isVersionAvailable={Boolean(
                                isBrowserVersionAvailable("camoufox"),
                              )}
                              onRetry={() => {
                                if (selectedBrowser) {
                                  void loadReleaseTypes(selectedBrowser);
                                }
                              }}
                              onDownload={() => {
                                void handleDownload("camoufox");
                              }}
                            />

                            <Alert className="border-warning/50 bg-warning/10">
                              <AlertDescription className="text-sm">
                                {t("createProfile.camoufoxWarning")}
                              </AlertDescription>
                            </Alert>

                            <SharedCamoufoxConfigForm
                              config={camoufoxConfig}
                              onConfigChange={updateCamoufoxConfig}
                              isCreating
                              browserType="camoufox"
                              profileVersion={
                                getBestAvailableVersion("camoufox")?.version
                              }
                              profileBrowser="camoufox"
                            />
                          </div>
                        ) : (
                          // Regular Browser Configuration (should not happen in anti-detect tab)
                          <div className="space-y-4">
                            {selectedBrowser && (
                              <RegularBrowserDownloadStatus
                                bestVersion={
                                  getBestAvailableVersion(selectedBrowser)
                                    ?.version
                                }
                                isLoadingReleaseTypes={isLoadingReleaseTypes}
                                releaseTypesError={releaseTypesError}
                                isDownloading={isBrowserCurrentlyDownloading(
                                  selectedBrowser,
                                )}
                                isVersionAvailable={Boolean(
                                  isBrowserVersionAvailable(selectedBrowser),
                                )}
                                fetchingLabel={t(
                                  "createProfile.version.fetching",
                                )}
                                retryLabel="Retry"
                                onRetry={() => {
                                  if (selectedBrowser) {
                                    void loadReleaseTypes(selectedBrowser);
                                  }
                                }}
                                onDownload={() => {
                                  void handleDownload(selectedBrowser);
                                }}
                              />
                            )}
                          </div>
                        )}

                        <ProxyVpnSelector
                          storedProxies={storedProxies}
                          vpnConfigs={vpnConfigs}
                          selectedProxyId={selectedProxyId}
                          onSelectedProxyIdChange={setSelectedProxyId}
                          popoverOpen={proxyPopoverOpen}
                          onPopoverOpenChange={setProxyPopoverOpen}
                          onAddProxyClick={() => {
                            setShowProxyForm(true);
                          }}
                        />

                        <div className="space-y-2">
                          <Label htmlFor="launch-hook-url">
                            {t("createProfile.launchHook.label")}
                          </Label>
                          <Input
                            id="launch-hook-url"
                            value={launchHook}
                            onChange={(e) => {
                              setLaunchHook(e.target.value);
                            }}
                            placeholder={t(
                              "createProfile.launchHook.placeholder",
                            )}
                            disabled={isCreating}
                          />
                        </div>

                        {/* DNS Blocklist */}
                        <div className="space-y-2">
                          <Label>{t("dnsBlocklist.title")}</Label>
                          <Select
                            value={dnsBlocklist || "none"}
                            onValueChange={(val) => {
                              setDnsBlocklist(val === "none" ? "" : val);
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue
                                placeholder={t("dnsBlocklist.none")}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">
                                {t("dnsBlocklist.none")}
                              </SelectItem>
                              <SelectItem value="light">
                                {t("dnsBlocklist.light")}
                              </SelectItem>
                              <SelectItem value="normal">
                                {t("dnsBlocklist.normal")}
                              </SelectItem>
                              <SelectItem value="pro">
                                {t("dnsBlocklist.pro")}
                              </SelectItem>
                              <SelectItem value="pro_plus">
                                {t("dnsBlocklist.proPlus")}
                              </SelectItem>
                              <SelectItem value="ultimate">
                                {t("dnsBlocklist.ultimate")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Extension Group */}
                        {extensionGroups.length > 0 && (
                          <div className="space-y-2">
                            <Label>{t("extensions.extensionGroup")}</Label>
                            <Select
                              value={selectedExtensionGroupId ?? "none"}
                              onValueChange={(val) => {
                                setSelectedExtensionGroupId(
                                  val === "none" ? undefined : val,
                                );
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={t("profileInfo.values.none")}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">
                                  {t("profileInfo.values.none")}
                                </SelectItem>
                                {extensionGroups.map((g) => (
                                  <SelectItem key={g.id} value={g.id}>
                                    {g.name} ({g.extension_ids.length})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="regular" className="mt-0">
                      {/* Regular Browser Configuration */}
                      <div className="space-y-6">
                        {/* Profile Name */}
                        <div className="space-y-2">
                          <Label htmlFor="profile-name">
                            {t("createProfile.profileName")}
                          </Label>
                          <Input
                            id="profile-name"
                            value={profileName}
                            onChange={(e) => {
                              setProfileName(e.target.value);
                            }}
                            onKeyDown={(e) => {
                              if (
                                e.key === "Enter" &&
                                !isCreateDisabled &&
                                !isCreating
                              ) {
                                void handleCreate();
                              }
                            }}
                            placeholder={t(
                              "createProfile.profileNamePlaceholder",
                            )}
                          />
                        </div>

                        {/* Regular Browser Configuration */}
                        <div className="space-y-4">
                          {selectedBrowser && (
                            <RegularBrowserDownloadStatus
                              bestVersion={
                                getBestAvailableVersion(selectedBrowser)
                                  ?.version
                              }
                              isLoadingReleaseTypes={isLoadingReleaseTypes}
                              releaseTypesError={releaseTypesError}
                              isDownloading={isBrowserCurrentlyDownloading(
                                selectedBrowser,
                              )}
                              isVersionAvailable={Boolean(
                                isBrowserVersionAvailable(selectedBrowser),
                              )}
                              fetchingLabel="Fetching available versions..."
                              retryLabel={t("common.buttons.retry")}
                              onRetry={() => {
                                if (selectedBrowser) {
                                  void loadReleaseTypes(selectedBrowser);
                                }
                              }}
                              onDownload={() => {
                                void handleDownload(selectedBrowser);
                              }}
                            />
                          )}
                        </div>

                        <ProxyVpnSelector
                          storedProxies={storedProxies}
                          vpnConfigs={vpnConfigs}
                          selectedProxyId={selectedProxyId}
                          onSelectedProxyIdChange={setSelectedProxyId}
                          popoverOpen={proxyPopoverOpen}
                          onPopoverOpenChange={setProxyPopoverOpen}
                          onAddProxyClick={() => {
                            setShowProxyForm(true);
                          }}
                        />

                        <div className="space-y-2">
                          <Label htmlFor="launch-hook-url-regular">
                            {t("createProfile.launchHook.label")}
                          </Label>
                          <Input
                            id="launch-hook-url-regular"
                            value={launchHook}
                            onChange={(e) => {
                              setLaunchHook(e.target.value);
                            }}
                            placeholder={t(
                              "createProfile.launchHook.placeholder",
                            )}
                            disabled={isCreating}
                          />
                        </div>
                      </div>
                    </TabsContent>
                  </>
                )}
              </div>
            </div>
          </div>
        </Tabs>

        <DialogFooter className="flex-shrink-0 pt-4 border-t">
          {currentStep === "browser-config" ? (
            <>
              <RippleButton variant="outline" onClick={handleBack}>
                {t("common.buttons.back")}
              </RippleButton>
              <LoadingButton
                onClick={handleCreate}
                isLoading={isCreating}
                disabled={isCreateDisabled}
              >
                {t("common.buttons.create")}
              </LoadingButton>
            </>
          ) : (
            <RippleButton variant="outline" onClick={handleClose}>
              {t("common.buttons.cancel")}
            </RippleButton>
          )}
        </DialogFooter>
      </DialogContent>
      <ProxyFormDialog
        isOpen={showProxyForm}
        onClose={() => {
          setShowProxyForm(false);
        }}
      />
    </Dialog>
  );
}
