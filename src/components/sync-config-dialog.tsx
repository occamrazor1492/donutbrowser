"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuEye, LuEyeOff } from "react-icons/lu";
import { LoadingButton } from "@/components/loading-button";
import { TeamAdminDialog } from "@/components/team-admin-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProBadge } from "@/components/ui/pro-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCloudAuth } from "@/hooks/use-cloud-auth";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import type { SyncSettings } from "@/types";

const DEVICE_LINK_URL = "https://donutbrowser.com/auth/link";

interface SyncConfigDialogProps {
  isOpen: boolean;
  onClose: (loginOccurred?: boolean) => void;
  /**
   * Called after the user clicks "Login" so the parent can open the
   * device-code verify dialog as a separate step. Implementations should
   * close this dialog and open the verify one — that keeps the verify
   * step visually independent and avoids stacking on top of other
   * dialogs (e.g. the profile selector triggered by deep links).
   */
  onLoginStarted?: () => void;
}

interface ProxyUsage {
  used_mb: number;
  limit_mb: number;
  remaining_mb: number;
  recurring_limit_mb: number;
  extra_limit_mb: number;
}

interface SelfHostedAuthState {
  server_url: string;
  user: {
    id: string;
    email: string;
    role: string;
    teamId: string;
    teamName?: string;
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  const serialized = JSON.stringify(error);
  return serialized ?? String(error);
}

export function SyncConfigDialog({
  isOpen,
  onClose,
  onLoginStarted,
}: SyncConfigDialogProps) {
  const { t } = useTranslation();

  // Self-hosted state
  const [serverUrl, setServerUrl] = useState("");
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selfHostedUser, setSelfHostedUser] = useState<
    SelfHostedAuthState["user"] | null
  >(null);
  const [useAdvancedToken, setUseAdvancedToken] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [showToken, setShowToken] = useState(false);

  // Cloud auth state
  const {
    user,
    isLoggedIn,
    isLoading: isCloudLoading,
    logout,
  } = useCloudAuth();

  const [activeTab, setActiveTab] = useState<string>("cloud");
  const [, setLiveProxyUsage] = useState<ProxyUsage | null>(null);

  const [connectionStatus, setConnectionStatus] = useState<
    "unknown" | "testing" | "connected" | "error"
  >("unknown");
  const [teamAdminOpen, setTeamAdminOpen] = useState(false);
  const hasConfig = Boolean(serverUrl && (token || selfHostedUser));

  const testConnection = useCallback(async (url: string) => {
    setConnectionStatus("testing");
    try {
      const healthUrl = `${url.replace(/\/$/, "")}/health`;
      const response = await fetch(healthUrl);
      setConnectionStatus(response.ok ? "connected" : "error");
    } catch {
      setConnectionStatus("error");
    }
  }, []);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const settings = await invoke<SyncSettings>("get_sync_settings");
      const authState = await invoke<SelfHostedAuthState | null>(
        "get_self_hosted_user",
      ).catch(() => null);
      setServerUrl(settings.sync_server_url ?? "");
      setToken(settings.sync_token ?? "");
      setSelfHostedUser(authState?.user ?? null);
      setEmail(authState?.user.email ?? "");
      setUseAdvancedToken(Boolean(settings.sync_token && !authState?.user));
      if (settings.sync_server_url && settings.sync_token) {
        void testConnection(settings.sync_server_url);
      }
    } catch (error) {
      console.error("Failed to load sync settings:", error);
    } finally {
      setIsLoading(false);
    }
  }, [testConnection]);

  useEffect(() => {
    if (isOpen) {
      setConnectionStatus("unknown");
      void loadSettings();
      void invoke<ProxyUsage | null>("cloud_get_proxy_usage")
        .then(setLiveProxyUsage)
        .catch(() => {
          setLiveProxyUsage(null);
        });
    }
  }, [isOpen, loadSettings]);

  // Auto-select the appropriate tab based on connection state
  useEffect(() => {
    if (isCloudLoading) return;
    if (isLoggedIn) {
      setActiveTab("cloud");
    } else if (serverUrl && (token || selfHostedUser)) {
      setActiveTab("self-hosted");
    } else {
      setActiveTab("cloud");
    }
  }, [isCloudLoading, isLoggedIn, serverUrl, token, selfHostedUser]);

  const handleTestConnection = useCallback(async () => {
    if (!serverUrl) {
      showErrorToast(t("sync.config.serverUrlRequired"));
      return;
    }

    setIsTesting(true);
    setConnectionStatus("testing");
    try {
      const healthUrl = `${serverUrl.replace(/\/$/, "")}/health`;
      const response = await fetch(healthUrl);
      if (response.ok) {
        setConnectionStatus("connected");
        showSuccessToast(t("sync.config.connectionSuccess"));
      } else {
        setConnectionStatus("error");
        showErrorToast(t("sync.config.serverError"));
      }
    } catch {
      setConnectionStatus("error");
      showErrorToast(t("sync.config.connectFailed"));
    } finally {
      setIsTesting(false);
    }
  }, [serverUrl, t]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      if (useAdvancedToken) {
        await invoke<SyncSettings>("save_sync_settings", {
          syncServerUrl: serverUrl || null,
          syncToken: token || null,
        });
      } else {
        const authState = await invoke<SelfHostedAuthState>(
          "login_self_hosted",
          {
            serverUrl,
            email,
            password,
          },
        );
        setSelfHostedUser(authState.user);
        setToken("");
        setPassword("");
      }
      try {
        await invoke("restart_sync_service");
      } catch (e) {
        console.error("Failed to restart sync service:", e);
      }
      showSuccessToast(t("sync.config.settingsSaved"));
      onClose();
    } catch (error) {
      console.error("Failed to save sync settings:", error);
      showErrorToast(
        t("sync.config.saveFailedWithReason", {
          error: getErrorMessage(error),
        }),
      );
    } finally {
      setIsSaving(false);
    }
  }, [serverUrl, token, email, password, useAdvancedToken, onClose, t]);

  const handleDisconnect = useCallback(async () => {
    setIsSaving(true);
    try {
      await invoke<SyncSettings>("save_sync_settings", {
        syncServerUrl: null,
        syncToken: null,
      });
      await invoke("logout_self_hosted");
      try {
        await invoke("restart_sync_service");
      } catch (e) {
        console.error("Failed to restart sync service:", e);
      }
      setServerUrl("");
      setToken("");
      setEmail("");
      setPassword("");
      setSelfHostedUser(null);
      setConnectionStatus("unknown");
      showSuccessToast(t("sync.config.disconnected"));
    } catch (error) {
      console.error("Failed to disconnect:", error);
      showErrorToast(t("sync.config.disconnectFailed"));
    } finally {
      setIsSaving(false);
    }
  }, [t]);

  const handleOpenLogin = useCallback(async () => {
    try {
      await invoke("handle_url_open", { url: DEVICE_LINK_URL });
      // Hand off the verify step to its own dialog so the user has a
      // focused place to paste the code, and so it doesn't visually
      // stack with this dialog or any other modal currently on screen.
      onLoginStarted?.();
    } catch (error) {
      console.error("Failed to open login link:", error);
      showErrorToast(String(error));
    }
  }, [onLoginStarted]);

  const handleCloudLogout = useCallback(async () => {
    try {
      await logout();
      showSuccessToast(t("sync.cloud.logoutSuccess"));
      setServerUrl("");
      setToken("");
      try {
        await invoke("restart_sync_service");
      } catch (e) {
        console.error("Failed to restart sync service:", e);
      }
    } catch (error) {
      console.error("Failed to logout:", error);
      showErrorToast(String(error));
    }
  }, [logout, t]);

  const cloudBlocked = !isLoggedIn && hasConfig;
  const selfHostedBlocked = isLoggedIn;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sync.title")}</DialogTitle>
            <DialogDescription>{t("sync.description")}</DialogDescription>
          </DialogHeader>

          {isLoggedIn && user ? (
            <div className="grid gap-4 py-4">
              <div className="flex gap-2 items-center text-sm">
                <div className="w-2 h-2 rounded-full bg-success" />
                {t("sync.cloud.connected")}
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t("sync.cloud.email")}
                  </span>
                  <span>{user.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t("sync.cloud.plan")}
                  </span>
                  <span className="capitalize">
                    {user.plan}
                    {user.planPeriod ? ` (${user.planPeriod})` : ""}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t("sync.cloud.profiles")}
                  </span>
                  <span>
                    {t("sync.cloud.profileUsage", {
                      used: user.cloudProfilesUsed,
                      limit: user.profileLimit,
                    })}
                  </span>
                </div>
                {user.teamName && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("sync.team.name")}
                      </span>
                      <span>{user.teamName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("sync.team.role")}
                      </span>
                      <span className="capitalize">
                        {user.teamRole === "owner"
                          ? t("sync.team.roleOwner")
                          : user.teamRole === "admin"
                            ? t("sync.team.roleAdmin")
                            : t("sync.team.roleMember")}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground pt-1">
                      {t("sync.team.manageOnWeb")}
                    </p>
                  </>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" asChild>
                  <a
                    href="https://donutbrowser.com/account"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("sync.cloud.manageAccount")}
                  </a>
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => void handleCloudLogout()}
                >
                  {t("sync.cloud.logout")}
                </Button>
              </div>
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full">
                <TabsTrigger
                  value="cloud"
                  className="flex-1"
                  disabled={cloudBlocked}
                >
                  <span className="flex items-center gap-2">
                    {t("sync.cloud.tabLabel")}
                    {cloudBlocked && <ProBadge />}
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="self-hosted"
                  className="flex-1"
                  disabled={selfHostedBlocked}
                >
                  <span className="flex items-center gap-2">
                    {t("sync.cloud.selfHostedTabLabel")}
                    {selfHostedBlocked && <ProBadge />}
                  </span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="cloud">
                {isCloudLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="w-6 h-6 rounded-full border-2 border-current animate-spin border-t-transparent" />
                  </div>
                ) : (
                  <div className="grid gap-4 py-4">
                    <p className="text-sm text-muted-foreground">
                      {t("sync.cloud.deviceLinkInstructions")}
                    </p>
                    <Button
                      onClick={() => void handleOpenLogin()}
                      className="w-full"
                    >
                      {t("sync.cloud.openLogin")}
                    </Button>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="self-hosted">
                {isLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="w-6 h-6 rounded-full border-2 border-current animate-spin border-t-transparent" />
                  </div>
                ) : (
                  <div className="grid gap-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="sync-server-url">
                        {t("sync.serverUrl")}
                      </Label>
                      <Input
                        id="sync-server-url"
                        placeholder={t("sync.serverUrlPlaceholder")}
                        value={serverUrl}
                        onChange={(e) => {
                          setServerUrl(e.target.value);
                        }}
                      />
                    </div>

                    {selfHostedUser && !useAdvancedToken && (
                      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                        <div className="flex gap-2 items-center text-sm text-muted-foreground">
                          <div className="w-2 h-2 rounded-full bg-success" />
                          <span>{selfHostedUser.email}</span>
                          <BadgeLike>
                            {selfHostedUser.role === "admin"
                              ? t("sync.team.roleAdmin")
                              : t("sync.team.roleMember")}
                          </BadgeLike>
                        </div>
                        {selfHostedUser.role === "admin" && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setTeamAdminOpen(true);
                            }}
                          >
                            {t("sync.teamAdmin.open")}
                          </Button>
                        )}
                      </div>
                    )}

                    {!useAdvancedToken ? (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="self-hosted-email">
                            {t("sync.email")}
                          </Label>
                          <Input
                            id="self-hosted-email"
                            type="email"
                            autoComplete="username"
                            value={email}
                            onChange={(e) => {
                              setEmail(e.target.value);
                            }}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="self-hosted-password">
                            {t("sync.password")}
                          </Label>
                          <Input
                            id="self-hosted-password"
                            type="password"
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => {
                              setPassword(e.target.value);
                            }}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor="sync-token">{t("sync.token")}</Label>
                        <div className="relative">
                          <Input
                            id="sync-token"
                            type={showToken ? "text" : "password"}
                            placeholder={t("sync.tokenPlaceholder")}
                            value={token}
                            onChange={(e) => {
                              setToken(e.target.value);
                            }}
                            className="pr-10"
                          />
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowToken(!showToken);
                                }}
                                className="absolute right-3 top-1/2 p-1 rounded-sm transition-colors transform -translate-y-1/2 hover:bg-accent"
                                aria-label={
                                  showToken
                                    ? t("common.aria.hideToken")
                                    : t("common.aria.showToken")
                                }
                              >
                                {showToken ? (
                                  <LuEyeOff className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                                ) : (
                                  <LuEye className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                                )}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {showToken
                                ? t("common.aria.hideToken")
                                : t("common.aria.showToken")}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 items-center text-sm">
                      <Checkbox
                        id="self-hosted-advanced-token"
                        checked={useAdvancedToken}
                        onCheckedChange={(checked) => {
                          setUseAdvancedToken(checked === true);
                        }}
                      />
                      <Label
                        htmlFor="self-hosted-advanced-token"
                        className="font-normal cursor-pointer"
                      >
                        {t("sync.advancedTokenMode")}
                      </Label>
                    </div>

                    {connectionStatus === "testing" && (
                      <div className="flex gap-2 items-center text-sm text-muted-foreground">
                        <div className="w-4 h-4 rounded-full border-2 border-current animate-spin border-t-transparent" />
                        {t("sync.status.syncing")}
                      </div>
                    )}
                    {connectionStatus === "connected" && (
                      <div className="flex gap-2 items-center text-sm text-muted-foreground">
                        <div className="w-2 h-2 rounded-full bg-success" />
                        {t("sync.status.connected")}
                      </div>
                    )}
                    {connectionStatus === "error" && (
                      <div className="flex gap-2 items-center text-sm text-muted-foreground">
                        <div className="w-2 h-2 rounded-full bg-destructive" />
                        {t("sync.status.disconnected")}
                      </div>
                    )}
                  </div>
                )}

                <DialogFooter className="flex gap-2">
                  {hasConfig && (
                    <Button
                      variant="outline"
                      onClick={() => void handleDisconnect()}
                      disabled={isSaving}
                    >
                      {t("sync.actions.disconnect")}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => void handleTestConnection()}
                    disabled={isTesting || !serverUrl}
                  >
                    {isTesting
                      ? t("sync.actions.testingConnection")
                      : t("sync.actions.testConnection")}
                  </Button>
                  <LoadingButton
                    onClick={() => void handleSave()}
                    isLoading={isSaving}
                    disabled={
                      !serverUrl ||
                      (useAdvancedToken ? !token : !email || !password)
                    }
                  >
                    {t("common.buttons.save")}
                  </LoadingButton>
                </DialogFooter>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
      <TeamAdminDialog
        isOpen={teamAdminOpen}
        onClose={() => {
          setTeamAdminOpen(false);
        }}
      />
    </>
  );
}

function BadgeLike({ children }: { children: string }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-xs capitalize text-muted-foreground">
      {children}
    </span>
  );
}
