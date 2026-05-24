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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import type { SyncSettings } from "@/types";

/**
 * Self-hosted sync configuration dialog.
 *
 * The upstream Donut Browser shows a tabbed UI here — cloud account
 * (device-code login) vs. self-hosted server. This fork strips cloud
 * out (see `cloud_auth.rs` stub), so the dialog is self-hosted-only:
 * point it at a `donut-sync` server URL and either log in with
 * email + password or paste a long-lived sync token.
 */
interface SyncConfigDialogProps {
  isOpen: boolean;
  onClose: (loginOccurred?: boolean) => void;
}

interface SelfHostedAuthState {
  server_url: string;
  user: {
    id: string;
    email: string;
    role: string;
    teamId: string;
    teamName?: string;
    prefix?: string;
    teamPrefix?: string;
  };
}

interface SelfHostedLoginResponse {
  token: string;
  user: SelfHostedAuthState["user"];
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

function cleanSelfHostedUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

async function getSelfHostedResponseMessage(
  response: Response,
): Promise<string> {
  const body = await response.text();
  if (!body) {
    return `${response.status} ${response.statusText}`.trim();
  }

  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown };
    if (typeof parsed.message === "string") {
      return parsed.message;
    }
    if (Array.isArray(parsed.message)) {
      return parsed.message.join(", ");
    }
    if (typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
    // Use the original response body below.
  }

  return body;
}

async function loginSelfHostedViaWebview(
  serverUrl: string,
  email: string,
  password: string,
): Promise<SelfHostedLoginResponse> {
  const response = await fetch(`${serverUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error(await getSelfHostedResponseMessage(response));
  }

  return response.json() as Promise<SelfHostedLoginResponse>;
}

export function SyncConfigDialog({ isOpen, onClose }: SyncConfigDialogProps) {
  const { t } = useTranslation();

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
  const [connectionStatus, setConnectionStatus] = useState<
    "unknown" | "testing" | "connected" | "error"
  >("unknown");
  const [teamAdminOpen, setTeamAdminOpen] = useState(false);
  const hasConfig = Boolean(serverUrl && (token || selfHostedUser));

  const testConnection = useCallback(async (url: string) => {
    setConnectionStatus("testing");
    try {
      const healthUrl = `${cleanSelfHostedUrl(url)}/health`;
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
    }
  }, [isOpen, loadSettings]);

  const handleTestConnection = useCallback(async () => {
    if (!serverUrl) {
      showErrorToast(t("sync.config.serverUrlRequired"));
      return;
    }

    setIsTesting(true);
    setConnectionStatus("testing");
    try {
      const healthUrl = `${cleanSelfHostedUrl(serverUrl)}/health`;
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
      const cleanServerUrl = cleanSelfHostedUrl(serverUrl);
      if (useAdvancedToken) {
        await invoke<SyncSettings>("save_sync_settings", {
          syncServerUrl: cleanServerUrl || null,
          syncToken: token || null,
        });
      } else {
        const loginResponse = await loginSelfHostedViaWebview(
          cleanServerUrl,
          email,
          password,
        );
        const authState = await invoke<SelfHostedAuthState>(
          "save_self_hosted_auth_state",
          {
            serverUrl: cleanServerUrl,
            token: loginResponse.token,
            user: loginResponse.user,
          },
        );
        setSelfHostedUser(authState.user);
        setToken("");
        setPassword("");
      }
      showSuccessToast(t("sync.config.settingsSaved"));
      onClose(true);
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

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("sync.title")}</DialogTitle>
            <DialogDescription>{t("sync.description")}</DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 rounded-full border-2 border-current animate-spin border-t-transparent" />
            </div>
          ) : (
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="sync-server-url">{t("sync.serverUrl")}</Label>
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
                    <Label htmlFor="self-hosted-email">{t("sync.email")}</Label>
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
                !serverUrl || (useAdvancedToken ? !token : !email || !password)
              }
            >
              {t("common.buttons.save")}
            </LoadingButton>
          </DialogFooter>
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
