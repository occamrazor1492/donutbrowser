"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DnsBlocklistDialog } from "@/components/dns-blocklist-dialog";
import { LoadingButton } from "@/components/loading-button";
import {
  AppearanceSettings,
  type CustomThemeState,
} from "@/components/settings/appearance-settings";
import { DnsBlocklistSettings } from "@/components/settings/dns-blocklist-settings";
import { EncryptionSettings } from "@/components/settings/encryption-settings";
import { PermissionSettings } from "@/components/settings/permission-settings";
import { useTheme } from "@/components/theme-provider";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/hooks/use-language";
import { getThemeByColors, getThemeById, THEME_VARIABLES } from "@/lib/themes";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import { RippleButton } from "./ui/ripple";

interface AppSettings {
  set_as_default_browser: boolean;
  theme: string;
  custom_theme?: Record<string, string>;
  api_enabled: boolean;
  api_port: number;
  api_token?: string;
  disable_auto_updates?: boolean;
  minimize_to_tray?: boolean;
}

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onIntegrationsOpen?: () => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  set_as_default_browser: false,
  theme: "system",
  custom_theme: undefined,
  api_enabled: false,
  api_port: 10108,
  api_token: undefined,
};

export function SettingsDialog({
  isOpen,
  onClose,
  onIntegrationsOpen,
}: SettingsDialogProps) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [originalSettings, setOriginalSettings] =
    useState<AppSettings>(DEFAULT_SETTINGS);
  const [customThemeState, setCustomThemeState] = useState<CustomThemeState>({
    selectedThemeId: null,
    colors: {},
  });
  const [isDefaultBrowser, setIsDefaultBrowser] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [isImportingBackup, setIsImportingBackup] = useState(false);
  const [isMacOS, setIsMacOS] = useState(false);
  const [dnsBlocklistDialogOpen, setDnsBlocklistDialogOpen] = useState(false);
  const [isLinux, setIsLinux] = useState(false);
  const [hasE2ePassword, setHasE2ePassword] = useState(false);
  const [systemInfo, setSystemInfo] = useState<{
    app_version: string;
    os: string;
    arch: string;
    portable: boolean;
  } | null>(null);

  const { t } = useTranslation();
  const { setTheme } = useTheme();
  const {
    currentLanguage,
    changeLanguage,
    supportedLanguages,
    isLoading: isLanguageLoading,
  } = useLanguage();
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [originalLanguage, setOriginalLanguage] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const appSettings = await invoke<AppSettings>("get_app_settings");
      const tokyoNightTheme = getThemeById("tokyo-night");
      if (!tokyoNightTheme) {
        throw new Error("Tokyo Night theme not found");
      }
      const merged: AppSettings = {
        ...appSettings,
        custom_theme:
          appSettings.custom_theme &&
          Object.keys(appSettings.custom_theme).length > 0
            ? appSettings.custom_theme
            : tokyoNightTheme.colors,
      };
      setSettings(merged);
      setOriginalSettings(merged);

      // Initialize custom theme state
      if (merged.theme === "custom" && merged.custom_theme) {
        const matchingTheme = getThemeByColors(merged.custom_theme);
        setCustomThemeState({
          selectedThemeId: matchingTheme?.id ?? null,
          colors: merged.custom_theme,
        });
      } else if (merged.theme === "custom") {
        // Initialize with Tokyo Night if no custom theme exists
        setCustomThemeState({
          selectedThemeId: "tokyo-night",
          colors: tokyoNightTheme.colors,
        });
      }
      // Check E2E password status
      try {
        const hasPassword = await invoke<boolean>("check_has_e2e_password");
        setHasE2ePassword(hasPassword);
      } catch {
        setHasE2ePassword(false);
      }
      // Load system info
      try {
        const info = await invoke<{
          app_version: string;
          os: string;
          arch: string;
          portable: boolean;
        }>("get_system_info");
        setSystemInfo(info);
      } catch {
        setSystemInfo(null);
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const applyCustomTheme = useCallback((vars: Record<string, string>) => {
    const root = document.documentElement;
    Object.entries(vars).forEach(([k, v]) => {
      root.style.setProperty(k, v, "important");
    });
  }, []);

  const clearCustomTheme = useCallback(() => {
    const root = document.documentElement;
    THEME_VARIABLES.forEach(({ key }) => {
      root.style.removeProperty(key as string);
    });
  }, []);

  const checkDefaultBrowserStatus = useCallback(async () => {
    try {
      const isDefault = await invoke<boolean>("is_default_browser");
      setIsDefaultBrowser(isDefault);
    } catch (error) {
      console.error("Failed to check default browser status:", error);
    }
  }, []);

  const handleSetDefaultBrowser = useCallback(async () => {
    setIsSettingDefault(true);
    try {
      await invoke("set_as_default_browser");
      await checkDefaultBrowserStatus();
    } catch (error) {
      console.error("Failed to set as default browser:", error);
    } finally {
      setIsSettingDefault(false);
    }
  }, [checkDefaultBrowserStatus]);

  const handleExportBackup = useCallback(async () => {
    setIsExportingBackup(true);
    try {
      // Lazy-load tauri-plugin-dialog so the dependency cost is paid only
      // when the user actually opens this panel.
      const { save } = await import("@tauri-apps/plugin-dialog");
      const filename = `donut-backup-${new Date()
        .toISOString()
        .slice(0, 10)}.donutbackup`;
      const destination = await save({
        defaultPath: filename,
        filters: [{ name: "Donut backup", extensions: ["donutbackup"] }],
      });
      if (!destination) return;
      const passphrase = window.prompt(
        t("settings.backup.passphrasePromptExport"),
        "",
      );
      const passArg =
        passphrase != null && passphrase.length > 0 ? passphrase : null;
      const size = await invoke<number>("export_backup_archive", {
        destinationPath: destination,
        passphrase: passArg,
      });
      showSuccessToast(t("settings.backup.exportSuccess", { bytes: size }));
    } catch (err) {
      showErrorToast(t("settings.backup.exportFailed"), {
        description: err instanceof Error ? err.message : String(err),
        duration: 5000,
      });
    } finally {
      setIsExportingBackup(false);
    }
  }, [t]);

  const handleImportBackup = useCallback(async () => {
    setIsImportingBackup(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const source = await open({
        multiple: false,
        filters: [{ name: "Donut backup", extensions: ["donutbackup"] }],
      });
      if (!source || typeof source !== "string") return;
      const passphrase = window.prompt(
        t("settings.backup.passphrasePromptImport"),
        "",
      );
      const passArg =
        passphrase != null && passphrase.length > 0 ? passphrase : null;
      const report = await invoke<{
        profiles_added: number;
        profiles_skipped: number;
        templates_added: number;
        templates_skipped: number;
        warnings: string[];
      }>("import_backup_archive", { sourcePath: source, passphrase: passArg });
      const desc =
        report.warnings.length > 0 ? report.warnings.join("\n") : undefined;
      showSuccessToast(
        t("settings.backup.importSuccess", {
          profiles: report.profiles_added,
          templates: report.templates_added,
          skipped: report.profiles_skipped + report.templates_skipped,
        }),
        desc ? { description: desc, duration: 8000 } : undefined,
      );
    } catch (err) {
      showErrorToast(t("settings.backup.importFailed"), {
        description: err instanceof Error ? err.message : String(err),
        duration: 5000,
      });
    } finally {
      setIsImportingBackup(false);
    }
  }, [t]);

  const handleClearCache = useCallback(async () => {
    setIsClearingCache(true);
    try {
      await invoke("clear_all_version_cache_and_refetch");
      // Also clear traffic stats cache
      await invoke("clear_all_traffic_stats");
      // Don't show immediate success toast - let the version update progress events handle it
    } catch (error) {
      console.error("Failed to clear cache:", error);
      showErrorToast(t("settings.advanced.clearCacheFailed"), {
        description:
          error instanceof Error ? error.message : t("common.errors.unknown"),
        duration: 4000,
      });
    } finally {
      setIsClearingCache(false);
    }
  }, [t]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      // Update settings with current custom theme state
      let settingsToSave: AppSettings = {
        ...settings,
        custom_theme:
          settings.theme === "custom"
            ? customThemeState.colors
            : settings.custom_theme,
      };

      console.log("[settings-dialog] Saving settings:", {
        theme: settingsToSave.theme,
        hasCustomTheme: !!settingsToSave.custom_theme,
        customThemeKeys: settingsToSave.custom_theme
          ? Object.keys(settingsToSave.custom_theme).length
          : 0,
      });

      const savedSettings = await invoke<AppSettings>("save_app_settings", {
        settings: settingsToSave,
      });

      console.log("[settings-dialog] Saved settings response:", {
        theme: savedSettings.theme,
        hasCustomTheme: !!savedSettings.custom_theme,
        customThemeKeys: savedSettings.custom_theme
          ? Object.keys(savedSettings.custom_theme).length
          : 0,
      });

      // Update settings with any generated tokens
      setSettings(savedSettings);
      settingsToSave = savedSettings;
      // Pass the actual theme value through. Calling setTheme("dark") here
      // when the user is on "custom" pushes the provider state to "dark",
      // which triggers its clear-custom-vars effect and wipes the CSS
      // variables we set just below — that's the bug where saving a custom
      // theme made it disappear until the app was restarted.
      setTheme(settings.theme);

      // Apply or clear custom variables only on Save
      if (settings.theme === "custom") {
        if (Object.keys(customThemeState.colors).length > 0) {
          try {
            const root = document.documentElement;
            // Clear any previous custom vars first
            THEME_VARIABLES.forEach(({ key }) => {
              root.style.removeProperty(key as string);
            });
            Object.entries(customThemeState.colors).forEach(([k, v]) => {
              root.style.setProperty(k, v, "important");
            });
          } catch {
            /* empty */
          }
        }
      } else {
        try {
          const root = document.documentElement;
          THEME_VARIABLES.forEach(({ key }) => {
            root.style.removeProperty(key as string);
          });
        } catch {
          /* empty */
        }
      }

      // Save language if changed
      if (selectedLanguage !== originalLanguage) {
        await changeLanguage(
          selectedLanguage === "system"
            ? null
            : (selectedLanguage as
                | "en"
                | "es"
                | "pt"
                | "fr"
                | "zh"
                | "ja"
                | "ru"),
        );
        setOriginalLanguage(selectedLanguage);
      }

      setOriginalSettings(settingsToSave);
      onClose();
    } catch (error) {
      console.error("Failed to save settings:", error);
    } finally {
      setIsSaving(false);
    }
  }, [
    onClose,
    setTheme,
    settings,
    customThemeState,
    selectedLanguage,
    originalLanguage,
    changeLanguage,
  ]);

  const updateSetting = useCallback(
    (
      key: keyof AppSettings,
      value: boolean | string | Record<string, string> | undefined,
    ) => {
      setSettings((prev) => ({ ...prev, [key]: value as unknown as never }));
    },
    [],
  );

  const handleClose = useCallback(() => {
    // Restore original theme when closing without saving
    if (originalSettings.theme === "custom" && originalSettings.custom_theme) {
      applyCustomTheme(originalSettings.custom_theme);
    } else {
      clearCustomTheme();
    }

    // Reset custom theme state to original
    if (originalSettings.theme === "custom" && originalSettings.custom_theme) {
      const matchingTheme = getThemeByColors(originalSettings.custom_theme);
      setCustomThemeState({
        selectedThemeId: matchingTheme?.id ?? null,
        colors: originalSettings.custom_theme,
      });
    }

    onClose();
  }, [
    originalSettings.theme,
    originalSettings.custom_theme,
    applyCustomTheme,
    clearCustomTheme,
    onClose,
  ]);

  // Only clear custom theme when switching away from custom, don't apply live changes
  useEffect(() => {
    if (settings.theme !== "custom") {
      clearCustomTheme();
    }
  }, [settings.theme, clearCustomTheme]);

  useEffect(() => {
    if (isOpen) {
      loadSettings().catch((err: unknown) => {
        console.error(err);
      });
      checkDefaultBrowserStatus().catch((err: unknown) => {
        console.error(err);
      });

      // Check if we're on macOS
      const userAgent = navigator.userAgent;
      const isMac = userAgent.includes("Mac");
      setIsMacOS(isMac);
      const isLin = !userAgent.includes("Mac") && !userAgent.includes("Win");
      setIsLinux(isLin);

      // Permission rows are derived from usePermissions inside the
      // PermissionSettings child; nothing async happens at the parent level.

      // Set up interval to check default browser status
      const intervalId = setInterval(() => {
        checkDefaultBrowserStatus().catch((err: unknown) => {
          console.error(err);
        });
      }, 2000);

      // Cleanup interval on component unmount or dialog close
      return () => {
        clearInterval(intervalId);
      };
    }
  }, [isOpen, checkDefaultBrowserStatus, loadSettings]);

  // Initialize language selection when dialog opens or language loads
  useEffect(() => {
    if (isOpen && !isLanguageLoading) {
      setSelectedLanguage(currentLanguage);
      setOriginalLanguage(currentLanguage);
    }
  }, [isOpen, currentLanguage, isLanguageLoading]);

  // Check if settings have changed (excluding default browser setting)
  const hasChanges =
    settings.theme !== originalSettings.theme ||
    settings.api_enabled !== originalSettings.api_enabled ||
    selectedLanguage !== originalLanguage ||
    (settings.theme === "custom" &&
      JSON.stringify(customThemeState.colors) !==
        JSON.stringify(originalSettings.custom_theme ?? {})) ||
    (settings.theme !== "custom" &&
      JSON.stringify(settings.custom_theme ?? {}) !==
        JSON.stringify(originalSettings.custom_theme ?? {})) ||
    settings.disable_auto_updates !== originalSettings.disable_auto_updates;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="my-8 flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>{t("settings.title")}</DialogTitle>
          </DialogHeader>

          <div className="grid overflow-y-auto flex-1 gap-6 py-4 min-h-0">
            <AppearanceSettings
              theme={settings.theme}
              onThemeChange={(value) => {
                updateSetting("theme", value);
              }}
              customThemeState={customThemeState}
              onCustomThemeStateChange={setCustomThemeState}
              selectedLanguage={selectedLanguage}
              onSelectedLanguageChange={setSelectedLanguage}
              supportedLanguages={supportedLanguages}
              isLanguageLoading={isLanguageLoading}
            />

            {/* Default Browser Section - hidden in portable mode */}
            {!systemInfo?.portable && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <Label className="text-base font-medium">
                    {t("settings.defaultBrowser.title")}
                  </Label>
                  <Badge variant={isDefaultBrowser ? "default" : "secondary"}>
                    {isDefaultBrowser
                      ? t("common.status.active")
                      : t("common.status.inactive")}
                  </Badge>
                </div>

                <LoadingButton
                  isLoading={isSettingDefault}
                  onClick={() => {
                    handleSetDefaultBrowser().catch((err: unknown) => {
                      console.error(err);
                    });
                  }}
                  disabled={isDefaultBrowser}
                  variant={isDefaultBrowser ? "outline" : "default"}
                  className="w-full"
                >
                  {isDefaultBrowser
                    ? t("settings.defaultBrowser.alreadyDefault")
                    : t("settings.defaultBrowser.setAsDefault")}
                </LoadingButton>

                <p className="text-xs text-muted-foreground">
                  {t("settings.defaultBrowser.description")}
                </p>
              </div>
            )}

            {isMacOS && <PermissionSettings />}

            {/* Integrations Section */}
            <div className="space-y-4">
              <Label className="text-base font-medium">
                {t("settings.integrations.title")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.integrations.description")}
              </p>
              <RippleButton
                variant="outline"
                className="w-full"
                onClick={onIntegrationsOpen}
              >
                {t("integrations.openSettings")}
              </RippleButton>
            </div>

            <DnsBlocklistSettings
              onManage={() => setDnsBlocklistDialogOpen(true)}
            />

            <EncryptionSettings
              hasE2ePassword={hasE2ePassword}
              onHasE2ePasswordChange={setHasE2ePassword}
            />

            {/* Advanced Section */}
            <div className="space-y-4">
              <Label className="text-base font-medium">
                {t("settings.advanced.title")}
              </Label>

              {!isLinux && (
                <div className="flex items-start space-x-3 p-3 rounded-lg border">
                  <Checkbox
                    id="disable-auto-updates"
                    checked={settings.disable_auto_updates ?? false}
                    onCheckedChange={(checked) => {
                      updateSetting("disable_auto_updates", checked as boolean);
                    }}
                  />
                  <div className="space-y-1">
                    <Label
                      htmlFor="disable-auto-updates"
                      className="text-sm font-medium"
                    >
                      {t("settings.disableAutoUpdates")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t("settings.disableAutoUpdatesDescription")}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-start space-x-3 p-3 rounded-lg border">
                <Checkbox
                  id="minimize-to-tray"
                  checked={settings.minimize_to_tray ?? false}
                  onCheckedChange={(checked) => {
                    updateSetting("minimize_to_tray", checked as boolean);
                  }}
                />
                <div className="space-y-1">
                  <Label
                    htmlFor="minimize-to-tray"
                    className="text-sm font-medium"
                  >
                    {t("settings.minimizeToTray")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.minimizeToTrayDescription")}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <LoadingButton
                  isLoading={isExportingBackup}
                  onClick={() => void handleExportBackup()}
                  variant="outline"
                >
                  {t("settings.backup.export")}
                </LoadingButton>
                <LoadingButton
                  isLoading={isImportingBackup}
                  onClick={() => void handleImportBackup()}
                  variant="outline"
                >
                  {t("settings.backup.import")}
                </LoadingButton>
              </div>

              <LoadingButton
                isLoading={isClearingCache}
                onClick={() => {
                  handleClearCache().catch((err: unknown) => {
                    console.error(err);
                  });
                }}
                variant="outline"
                className="w-full"
              >
                {t("settings.advanced.clearCache")}
              </LoadingButton>

              <p className="text-xs text-muted-foreground">
                {t("settings.advanced.clearCacheDescription")}
              </p>
            </div>

            {/* System Info */}
            {systemInfo && (
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground font-mono whitespace-pre-line select-all">
                  {`Donut Browser ${systemInfo.app_version}\n${systemInfo.os} ${systemInfo.arch}${systemInfo.portable ? " (portable)" : ""}`}
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0">
            <RippleButton variant="outline" onClick={handleClose}>
              {t("common.buttons.cancel")}
            </RippleButton>
            <LoadingButton
              isLoading={isSaving}
              onClick={() => {
                handleSave().catch((err: unknown) => {
                  console.error(err);
                });
              }}
              disabled={isLoading || !hasChanges}
            >
              {t("common.buttons.saveSettings")}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DnsBlocklistDialog
        isOpen={dnsBlocklistDialogOpen}
        onClose={() => setDnsBlocklistDialogOpen(false)}
      />
    </>
  );
}
