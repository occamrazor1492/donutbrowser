"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuPlay, LuRefreshCw, LuServer, LuShieldCheck } from "react-icons/lu";
import { LoadingButton } from "@/components/loading-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import type {
  BotBrowserPreflightResult,
  BrowserProfile,
  TeamProfilePermissionLevel,
  TeamProfileRecord,
} from "@/types";

interface SelfHostedAuthState {
  user: {
    id: string;
    email: string;
    role: "admin" | "member";
    teamId: string;
  };
}

interface TeamProfilesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  localProfiles: BrowserProfile[];
  onMaterialized: (profile: BrowserProfile) => void;
  onLaunchProfile: (profile: BrowserProfile) => Promise<void>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isActiveLock(profile: TeamProfileRecord) {
  if (!profile.lock) return false;
  return new Date(profile.lock.expiresAt).getTime() > Date.now();
}

function permissionForUser(
  profile: TeamProfileRecord,
  user: SelfHostedAuthState["user"] | null,
): TeamProfilePermissionLevel | "admin" | null {
  if (!user) return null;
  if (user.role === "admin") return "admin";
  if (profile.ownerUserId === user.id) return "owner";
  return (
    profile.permissions.find((permission) => permission.userId === user.id)
      ?.permission ?? null
  );
}

function canLaunchPermission(
  permission: TeamProfilePermissionLevel | "admin" | null,
) {
  return (
    permission === "admin" || permission === "owner" || permission === "editor"
  );
}

export function TeamProfilesDialog({
  isOpen,
  onClose,
  localProfiles,
  onMaterialized,
  onLaunchProfile,
}: TeamProfilesDialogProps) {
  const { t } = useTranslation();
  const [userState, setUserState] = useState<SelfHostedAuthState | null>(null);
  const [teamProfiles, setTeamProfiles] = useState<TeamProfileRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [busyProfileId, setBusyProfileId] = useState<string | null>(null);
  const [executablePath, setExecutablePath] = useState("");
  const [preflightResults, setPreflightResults] = useState<
    Record<string, BotBrowserPreflightResult>
  >({});

  const localProfileById = useMemo(
    () => new Map(localProfiles.map((profile) => [profile.id, profile])),
    [localProfiles],
  );
  const hasBotBrowserProfiles = useMemo(
    () => teamProfiles.some((profile) => profile.engine === "botbrowser"),
    [teamProfiles],
  );

  const isLaunchSupportedEngine = (engine: TeamProfileRecord["engine"]) =>
    engine === "wayfern" || engine === "botbrowser";

  const loadProfiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const [authState, profiles] = await Promise.all([
        invoke<SelfHostedAuthState | null>("get_self_hosted_user"),
        invoke<TeamProfileRecord[]>("team_list_profiles"),
      ]);
      setUserState(authState);
      setTeamProfiles(profiles);
    } catch (error) {
      showErrorToast(
        t("teamProfiles.toasts.loadFailed", { error: errorMessage(error) }),
      );
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (isOpen) {
      void loadProfiles();
    }
  }, [isOpen, loadProfiles]);

  const runPreflight = async (profileId: string) => {
    const result = await invoke<BotBrowserPreflightResult>(
      "team_preflight_botbrowser_profile",
      { profileId },
    );
    setPreflightResults((prev) => ({ ...prev, [profileId]: result }));
    if (result.canLaunch) {
      showSuccessToast(t("teamProfiles.toasts.preflightPassed"));
    } else {
      showErrorToast(t("teamProfiles.toasts.preflightFailed"));
    }
    return result;
  };

  const materializeProfile = async (profileId: string) => {
    const profile = await invoke<BrowserProfile>("team_materialize_profile", {
      profileId,
      executablePath: executablePath.trim() || null,
    });
    onMaterialized(profile);
    showSuccessToast(t("teamProfiles.toasts.materialized"));
    return profile;
  };

  const handleMaterialize = async (profileId: string) => {
    setBusyProfileId(profileId);
    try {
      await materializeProfile(profileId);
    } catch (error) {
      showErrorToast(
        t("teamProfiles.toasts.materializeFailed", {
          error: errorMessage(error),
        }),
      );
    } finally {
      setBusyProfileId(null);
    }
  };

  const handlePreflight = async (profileId: string) => {
    setBusyProfileId(profileId);
    try {
      await runPreflight(profileId);
    } catch (error) {
      showErrorToast(
        t("teamProfiles.toasts.preflightError", {
          error: errorMessage(error),
        }),
      );
    } finally {
      setBusyProfileId(null);
    }
  };

  const handleLaunch = async (teamProfile: TeamProfileRecord) => {
    setBusyProfileId(teamProfile.id);
    try {
      const localProfile =
        localProfileById.get(teamProfile.id) ??
        (await materializeProfile(teamProfile.id));
      const preflight = await runPreflight(teamProfile.id);
      if (!preflight.canLaunch) return;
      await onLaunchProfile(localProfile);
      onClose();
    } catch (error) {
      showErrorToast(
        t("teamProfiles.toasts.launchFailed", { error: errorMessage(error) }),
      );
    } finally {
      setBusyProfileId(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LuServer className="w-5 h-5" />
            {t("teamProfiles.title")}
          </DialogTitle>
          <DialogDescription>{t("teamProfiles.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {hasBotBrowserProfiles && (
            <div className="grid gap-2">
              <Label htmlFor="team-profile-executable">
                {t("teamProfiles.executablePath")}
              </Label>
              <Input
                id="team-profile-executable"
                value={executablePath}
                onChange={(event) => {
                  setExecutablePath(event.target.value);
                }}
                placeholder={t("teamProfiles.executablePathPlaceholder")}
              />
            </div>
          )}

          <div className="flex justify-between items-center">
            <div className="text-sm text-muted-foreground">
              {t("teamProfiles.count", { count: teamProfiles.length })}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void loadProfiles();
              }}
              disabled={isLoading}
            >
              <LuRefreshCw className="mr-2 w-4 h-4" />
              {t("common.buttons.refresh")}
            </Button>
          </div>

          <ScrollArea className="h-[520px] pr-3">
            {isLoading ? (
              <div className="py-10 text-sm text-center text-muted-foreground">
                {t("teamProfiles.loading")}
              </div>
            ) : teamProfiles.length === 0 ? (
              <div className="py-10 text-sm text-center text-muted-foreground">
                {t("teamProfiles.empty")}
              </div>
            ) : (
              <div className="space-y-3">
                {teamProfiles.map((teamProfile) => {
                  const localProfile = localProfileById.get(teamProfile.id);
                  const permission = permissionForUser(
                    teamProfile,
                    userState?.user ?? null,
                  );
                  const canLaunch =
                    canLaunchPermission(permission) &&
                    isLaunchSupportedEngine(teamProfile.engine);
                  const preflight = preflightResults[teamProfile.id];
                  const locked = isActiveLock(teamProfile);
                  const isBusy = busyProfileId === teamProfile.id;

                  return (
                    <div
                      key={teamProfile.id}
                      className="p-4 space-y-3 rounded-md border bg-card text-card-foreground"
                    >
                      <div className="flex flex-wrap gap-3 justify-between items-start">
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            {teamProfile.name}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {teamProfile.id}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 items-center">
                          <Badge variant="outline">
                            {t(`teamProfiles.engines.${teamProfile.engine}`)}
                          </Badge>
                          <Badge variant="secondary">
                            {permission
                              ? t(`teamProfiles.permissions.${permission}`)
                              : t("teamProfiles.permissions.none")}
                          </Badge>
                          <Badge variant={localProfile ? "default" : "outline"}>
                            {localProfile
                              ? t("teamProfiles.localStatus.added")
                              : t("teamProfiles.localStatus.notAdded")}
                          </Badge>
                          <Badge variant={locked ? "destructive" : "outline"}>
                            {locked
                              ? t("teamProfiles.lock.locked")
                              : t("teamProfiles.lock.available")}
                          </Badge>
                        </div>
                      </div>

                      <div className="grid gap-2 text-sm md:grid-cols-2">
                        <div>
                          <span className="text-muted-foreground">
                            {t("teamProfiles.template")}
                          </span>
                          <span className="ml-2">
                            {teamProfile.botProfileAsset?.name ??
                              (teamProfile.engine === "botbrowser"
                                ? t("teamProfiles.noTemplate")
                                : t("teamProfiles.templateNotRequired"))}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            {t("teamProfiles.syncMode")}
                          </span>
                          <span className="ml-2">{teamProfile.syncMode}</span>
                        </div>
                      </div>

                      {!isLaunchSupportedEngine(teamProfile.engine) && (
                        <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm text-warning-foreground">
                          {t("teamProfiles.unsupportedEngine")}
                        </div>
                      )}

                      {isLaunchSupportedEngine(teamProfile.engine) &&
                        !canLaunchPermission(permission) && (
                          <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm text-warning-foreground">
                            {t("teamProfiles.viewerCannotLaunch")}
                          </div>
                        )}

                      {preflight && (
                        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <LuShieldCheck className="w-4 h-4" />
                            {t("botbrowserPreflight.title")}
                          </div>
                          <div className="grid gap-2 md:grid-cols-2">
                            {preflight.checks.map((check) => (
                              <div
                                key={check.key}
                                className="flex gap-2 items-start text-sm"
                              >
                                <Badge
                                  variant={
                                    check.status === "passed"
                                      ? "secondary"
                                      : "destructive"
                                  }
                                >
                                  {t(
                                    `botbrowserPreflight.status.${check.status}`,
                                  )}
                                </Badge>
                                <div>
                                  <div className="font-medium">
                                    {t(
                                      `botbrowserPreflight.checks.${check.key}`,
                                    )}
                                  </div>
                                  <div className="text-muted-foreground">
                                    {t(
                                      `botbrowserPreflight.messages.${check.status}.${check.key}`,
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 justify-end">
                        {!localProfile && (
                          <LoadingButton
                            type="button"
                            variant="outline"
                            size="sm"
                            isLoading={isBusy}
                            disabled={!canLaunch || isBusy}
                            onClick={() => {
                              void handleMaterialize(teamProfile.id);
                            }}
                          >
                            {t("teamProfiles.actions.addToLocal")}
                          </LoadingButton>
                        )}
                        <LoadingButton
                          type="button"
                          variant="outline"
                          size="sm"
                          isLoading={isBusy}
                          disabled={
                            !isLaunchSupportedEngine(teamProfile.engine) ||
                            isBusy
                          }
                          onClick={() => {
                            void handlePreflight(teamProfile.id);
                          }}
                        >
                          <LuShieldCheck className="mr-2 w-4 h-4" />
                          {t("teamProfiles.actions.preflight")}
                        </LoadingButton>
                        <LoadingButton
                          type="button"
                          size="sm"
                          isLoading={isBusy}
                          disabled={!canLaunch || isBusy}
                          onClick={() => {
                            void handleLaunch(teamProfile);
                          }}
                        >
                          <LuPlay className="mr-2 w-4 h-4" />
                          {t("teamProfiles.actions.launch")}
                        </LoadingButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
