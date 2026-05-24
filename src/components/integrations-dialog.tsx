"use client";

import { invoke } from "@tauri-apps/api/core";
import { Eye, EyeOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWayfernTerms } from "@/hooks/use-wayfern-terms";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import { McpToolsReferenceDialog } from "./mcp-tools-reference-dialog";
import { CopyToClipboard } from "./ui/copy-to-clipboard";

interface AppSettings {
  api_enabled: boolean;
  api_port: number;
  api_token?: string;
  mcp_enabled: boolean;
  mcp_port?: number;
  mcp_token?: string;
}

interface McpConfig {
  port: number;
  token: string;
}

interface IntegrationsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function IntegrationsDialog({
  isOpen,
  onClose,
}: IntegrationsDialogProps) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AppSettings>({
    api_enabled: false,
    api_port: 10108,
    api_token: undefined,
    mcp_enabled: false,
    mcp_port: undefined,
    mcp_token: undefined,
  });
  const [apiServerPort, setApiServerPort] = useState<number | null>(null);
  const [mcpConfig, setMcpConfig] = useState<McpConfig | null>(null);
  // `mcpServerPort` mirrors `apiServerPort` — both come from a
  // `get_<x>_server_status` Tauri command that returns `Option<u16>`
  // (null when the server isn't running). The dialog only uses these
  // to gate the "running on port X" copy and the start/stop button
  // state; the canonical "should this server be on?" preference lives
  // in `settings.mcp_enabled` / `settings.api_server_enabled`.
  const [mcpServerPort, setMcpServerPort] = useState<number | null>(null);
  const [showApiToken, setShowApiToken] = useState(false);
  const [showMcpToken, setShowMcpToken] = useState(false);
  const [mcpToolsDialogOpen, setMcpToolsDialogOpen] = useState(false);
  const [webhookUrlInput, setWebhookUrlInput] = useState("");
  const [webhookUrlSaved, setWebhookUrlSaved] = useState<string | null>(null);
  const [isApiStarting, setIsApiStarting] = useState(false);
  const [isMcpStarting, setIsMcpStarting] = useState(false);
  const [mcpInClaudeDesktop, setMcpInClaudeDesktop] = useState(false);
  const [mcpInClaudeCode, setMcpInClaudeCode] = useState(false);

  const { termsAccepted } = useWayfernTerms();

  const loadSettings = useCallback(async () => {
    try {
      const loaded = await invoke<AppSettings>("get_app_settings");
      setSettings(loaded);
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  }, []);

  const loadMcpConfig = useCallback(async () => {
    try {
      const config = await invoke<McpConfig | null>("get_mcp_config");
      setMcpConfig(config);
    } catch (e) {
      console.error("Failed to get MCP config:", e);
    }
  }, []);

  const loadMcpServerStatus = useCallback(async () => {
    try {
      const port = await invoke<number | null>("get_mcp_server_status");
      setMcpServerPort(port);
    } catch (e) {
      console.error("Failed to get MCP server status:", e);
    }
  }, []);

  const loadApiServerStatus = useCallback(async () => {
    try {
      const port = await invoke<number | null>("get_api_server_status");
      setApiServerPort(port);
    } catch (e) {
      console.error("Failed to get API server status:", e);
    }
  }, []);

  const loadClaudeDesktopStatus = useCallback(async () => {
    try {
      const exists = await invoke<boolean>("is_mcp_in_claude_desktop");
      setMcpInClaudeDesktop(exists);
    } catch {
      // Not critical
    }
  }, []);

  const loadClaudeCodeStatus = useCallback(async () => {
    try {
      const exists = await invoke<boolean>("is_mcp_in_claude_code");
      setMcpInClaudeCode(exists);
    } catch {
      // Claude CLI may not be installed
    }
  }, []);

  const loadWebhookUrl = useCallback(async () => {
    try {
      const url = await invoke<string | null>("get_webhook_url");
      setWebhookUrlSaved(url);
      setWebhookUrlInput(url ?? "");
    } catch (e) {
      console.error("Failed to load webhook URL:", e);
    }
  }, []);

  const handleSaveWebhookUrl = useCallback(async () => {
    try {
      const trimmed = webhookUrlInput.trim();
      const stored = await invoke<string | null>("set_webhook_url", {
        url: trimmed.length > 0 ? trimmed : null,
      });
      setWebhookUrlSaved(stored);
      if (stored == null && trimmed.length > 0) {
        showErrorToast(t("integrations.webhook.invalidUrl"));
      } else if (stored != null) {
        showSuccessToast(t("integrations.webhook.saved"));
      } else {
        showSuccessToast(t("integrations.webhook.cleared"));
      }
    } catch (e) {
      showErrorToast(
        e instanceof Error ? e.message : t("integrations.apiUnknownError"),
      );
    }
  }, [webhookUrlInput, t]);

  useEffect(() => {
    if (isOpen) {
      void loadSettings();
      void loadApiServerStatus();
      void loadMcpConfig();
      void loadMcpServerStatus();
      void loadClaudeDesktopStatus();
      void loadClaudeCodeStatus();
      void loadWebhookUrl();
    }
  }, [
    isOpen,
    loadSettings,
    loadApiServerStatus,
    loadMcpConfig,
    loadMcpServerStatus,
    loadClaudeDesktopStatus,
    loadClaudeCodeStatus,
    loadWebhookUrl,
  ]);

  const handleApiToggle = async (enabled: boolean) => {
    setIsApiStarting(true);
    try {
      if (enabled) {
        const port = await invoke<number>("start_api_server", {
          port: settings.api_port,
        });
        setApiServerPort(port);
        const next = await invoke<AppSettings>("save_app_settings", {
          settings: { ...settings, api_enabled: true },
        });
        setSettings(next);
        showSuccessToast(t("integrations.apiStarted", { port }));
      } else {
        await invoke("stop_api_server");
        setApiServerPort(null);
        const next = await invoke<AppSettings>("save_app_settings", {
          settings: { ...settings, api_enabled: false, api_token: null },
        });
        setSettings(next);
        showSuccessToast(t("integrations.apiStopped"));
      }
    } catch (e) {
      console.error("Failed to toggle API:", e);
      showErrorToast(t("integrations.apiToggleFailed"), {
        description:
          e instanceof Error ? e.message : t("integrations.apiUnknownError"),
      });
    } finally {
      setIsApiStarting(false);
    }
  };

  const handleMcpToggle = async (enabled: boolean) => {
    setIsMcpStarting(true);
    try {
      if (enabled) {
        const port = await invoke<number>("start_mcp_server");
        const next = await invoke<AppSettings>("save_app_settings", {
          settings: { ...settings, mcp_enabled: true, mcp_port: port },
        });
        setSettings(next);
        setMcpServerPort(port);
        void loadMcpConfig();
        showSuccessToast(t("integrations.mcpStarted", { port }));
      } else {
        await invoke("stop_mcp_server");
        const next = await invoke<AppSettings>("save_app_settings", {
          settings: { ...settings, mcp_enabled: false },
        });
        setSettings(next);
        setMcpConfig(null);
        setMcpServerPort(null);
        showSuccessToast(t("integrations.mcpStopped"));
      }
    } catch (e) {
      console.error("Failed to toggle MCP server:", e);
      showErrorToast(t("integrations.mcpToggleFailed"), {
        description:
          e instanceof Error ? e.message : t("integrations.apiUnknownError"),
      });
    } finally {
      setIsMcpStarting(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-xl max-h-[80vh] my-8 flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("integrations.title")}</DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 min-h-0">
          <Tabs defaultValue="api" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="api">{t("integrations.tabApi")}</TabsTrigger>
              <TabsTrigger value="mcp">{t("integrations.tabMcp")}</TabsTrigger>
              <TabsTrigger value="webhooks">
                {t("integrations.tabWebhooks")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="webhooks" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="webhook-url" className="text-sm font-medium">
                  {t("integrations.webhook.urlLabel")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("integrations.webhook.description")}
                </p>
                <div className="flex gap-2">
                  <Input
                    id="webhook-url"
                    type="url"
                    placeholder="https://example.com/webhook"
                    value={webhookUrlInput}
                    onChange={(e) => setWebhookUrlInput(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleSaveWebhookUrl()}
                  >
                    {t("common.buttons.save")}
                  </Button>
                </div>
                {webhookUrlSaved && (
                  <p className="text-xs text-success">
                    {t("integrations.webhook.activeAt", {
                      url: webhookUrlSaved,
                    })}
                  </p>
                )}
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">
                    {t("integrations.webhook.eventsTitle")}
                  </summary>
                  <ul className="mt-2 list-disc list-inside space-y-1 font-mono">
                    <li>profile.launched</li>
                    <li>profile.stopped</li>
                    <li>profile.sync_failed</li>
                  </ul>
                </details>
              </div>
            </TabsContent>

            <TabsContent value="api" className="space-y-4 mt-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="api-enabled"
                  checked={apiServerPort !== null}
                  disabled={isApiStarting}
                  onCheckedChange={(checked) => void handleApiToggle(!!checked)}
                />
                <div className="grid gap-1.5 leading-none">
                  <Label
                    htmlFor="api-enabled"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {t("integrations.apiEnableLabel")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("integrations.apiEnableDescription")}
                  </p>
                </div>
              </div>

              {settings.api_enabled && (
                <div className="space-y-4 p-4 rounded-md border bg-muted/40">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      {t("integrations.apiPortLabel")}
                    </Label>
                    <div className="flex items-center space-x-2">
                      <Button
                        size="sm"
                        disabled={
                          isApiStarting || apiServerPort === settings.api_port
                        }
                        onClick={async () => {
                          const port = settings.api_port;
                          if (port < 1 || port > 65535) {
                            showErrorToast(t("integrations.apiInvalidPort"), {
                              description: t(
                                "integrations.apiInvalidPortDescription",
                              ),
                            });
                            return;
                          }
                          setIsApiStarting(true);
                          try {
                            await invoke("stop_api_server");
                            const next = await invoke<AppSettings>(
                              "save_app_settings",
                              { settings },
                            );
                            setSettings(next);
                            const actualPort = await invoke<number>(
                              "start_api_server",
                              { port },
                            );
                            setApiServerPort(actualPort);
                            if (actualPort !== port) {
                              showErrorToast(
                                t("integrations.apiPortInUse", { port }),
                                {
                                  description: t(
                                    "integrations.apiFallbackPort",
                                    { port: actualPort },
                                  ),
                                },
                              );
                            } else {
                              showSuccessToast(
                                t("integrations.apiRunning", {
                                  port: actualPort,
                                }),
                              );
                            }
                          } catch (e) {
                            showErrorToast(t("integrations.apiStartFailed"), {
                              description:
                                e instanceof Error
                                  ? e.message
                                  : t("integrations.apiUnknownError"),
                            });
                          } finally {
                            setIsApiStarting(false);
                          }
                        }}
                      >
                        {t("common.buttons.save")}
                      </Button>
                      <Input
                        type="number"
                        value={settings.api_port}
                        onChange={(e) => {
                          const val = Number.parseInt(e.target.value, 10);
                          if (!Number.isNaN(val)) {
                            setSettings({ ...settings, api_port: val });
                          }
                        }}
                        className="w-24 font-mono"
                        min={1}
                        max={65535}
                      />
                      {apiServerPort && (
                        <span className="text-xs text-muted-foreground">
                          {t("common.status.running")}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      {t("integrations.apiTokenLabel")}
                    </Label>
                    <div className="flex items-center space-x-2">
                      <div className="relative flex-1">
                        <Input
                          type={showApiToken ? "text" : "password"}
                          value={settings.api_token ?? ""}
                          readOnly
                          className="font-mono pr-10"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                          onClick={() => {
                            setShowApiToken(!showApiToken);
                          }}
                        >
                          {showApiToken ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <CopyToClipboard
                        text={settings.api_token ?? ""}
                        successMessage={t("integrations.tokenCopied")}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("integrations.apiTokenHint", {
                        tokenSlot: "<token>",
                      })}
                    </p>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="mcp" className="space-y-4 mt-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="mcp-enabled"
                  checked={settings.mcp_enabled && mcpConfig !== null}
                  disabled={!termsAccepted || isMcpStarting}
                  onCheckedChange={(checked) => void handleMcpToggle(!!checked)}
                />
                <div className="grid gap-1.5 leading-none">
                  <Label
                    htmlFor="mcp-enabled"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {t("integrations.mcpEnableLabel")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("integrations.mcpEnableDescription")}
                    {!termsAccepted && (
                      <span className="ml-1 text-warning">
                        {t("integrations.mcpAcceptTermsFirst")}
                      </span>
                    )}
                    {mcpServerPort !== null && (
                      <span className="ml-1">
                        {t("integrations.mcpRunningOnPort", {
                          port: mcpServerPort,
                        })}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {mcpConfig && (
                <div className="space-y-4 p-4 rounded-md border bg-muted/40">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      {t("integrations.mcp.url")}
                    </Label>
                    <div className="flex items-center space-x-2">
                      <div className="relative flex-1">
                        <Input
                          type={showMcpToken ? "text" : "password"}
                          value={`http://127.0.0.1:${mcpConfig.port}/mcp/${mcpConfig.token}`}
                          readOnly
                          className="font-mono text-xs pr-10"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                          onClick={() => {
                            setShowMcpToken(!showMcpToken);
                          }}
                        >
                          {showMcpToken ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <CopyToClipboard
                        text={`http://127.0.0.1:${mcpConfig.port}/mcp/${mcpConfig.token}`}
                        successMessage={t("integrations.mcp.urlCopied")}
                      />
                    </div>
                  </div>

                  <div className="space-y-2 pt-1 border-t">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t("integrations.mcp.claudeDesktopTitle")}
                    </p>
                    {mcpInClaudeDesktop ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={async () => {
                          try {
                            await invoke("remove_mcp_from_claude_desktop");
                            setMcpInClaudeDesktop(false);
                            showSuccessToast(
                              t("integrations.mcp.removedFromClaudeDesktop"),
                            );
                          } catch (e) {
                            showErrorToast(String(e));
                          }
                        }}
                      >
                        {t("integrations.mcp.removeFromClaudeDesktop")}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={async () => {
                          try {
                            await invoke("add_mcp_to_claude_desktop");
                            setMcpInClaudeDesktop(true);
                            showSuccessToast(
                              t("integrations.mcp.addedToClaudeDesktop"),
                            );
                          } catch (e) {
                            showErrorToast(String(e));
                          }
                        }}
                      >
                        {t("integrations.mcp.addToClaudeDesktop")}
                      </Button>
                    )}
                  </div>

                  <div className="space-y-2 pt-1 border-t">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t("integrations.mcp.claudeCodeTitle")}
                    </p>
                    {mcpInClaudeCode ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={async () => {
                          try {
                            await invoke("remove_mcp_from_claude_code");
                            setMcpInClaudeCode(false);
                            showSuccessToast(
                              t("integrations.mcp.removedFromClaudeCode"),
                            );
                          } catch (e) {
                            showErrorToast(String(e));
                          }
                        }}
                      >
                        {t("integrations.mcp.removeFromClaudeCode")}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={async () => {
                          try {
                            await invoke("add_mcp_to_claude_code");
                            setMcpInClaudeCode(true);
                            showSuccessToast(
                              t("integrations.mcp.addedToClaudeCode"),
                            );
                          } catch (e) {
                            showErrorToast(String(e));
                          }
                        }}
                      >
                        {t("integrations.mcp.addToClaudeCode")}
                      </Button>
                    )}
                  </div>

                  <div className="pt-1 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() => setMcpToolsDialogOpen(true)}
                    >
                      {t("integrations.mcp.openToolsReference")}
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
      <McpToolsReferenceDialog
        isOpen={mcpToolsDialogOpen}
        onClose={() => setMcpToolsDialogOpen(false)}
      />
    </Dialog>
  );
}
