"use client";

import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuShare2, LuUsers } from "react-icons/lu";
import { LoadingButton } from "@/components/loading-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import type { BrowserProfile } from "@/types";

interface ShareProfileDialogProps {
  isOpen: boolean;
  profile: BrowserProfile | null;
  onClose: () => void;
  onPublished: (profile: BrowserProfile) => void;
  onOpenTeamAdmin?: () => void;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isWayfernProfile(profile: BrowserProfile | null) {
  return profile?.browser === "wayfern" || profile?.engine === "wayfern";
}

export function ShareProfileDialog({
  isOpen,
  profile,
  onClose,
  onPublished,
  onOpenTeamAdmin,
}: ShareProfileDialogProps) {
  const { t } = useTranslation();
  const [isPublishing, setIsPublishing] = useState(false);
  const canPublish = isWayfernProfile(profile) && profile?.ephemeral !== true;
  const alreadyShared = useMemo(
    () => profile?.sync_mode != null && profile.sync_mode !== "Disabled",
    [profile],
  );

  const handlePublish = async () => {
    if (!profile || !canPublish) return;
    setIsPublishing(true);
    try {
      const published = await invoke<BrowserProfile>(
        "team_publish_wayfern_profile",
        { profileId: profile.id },
      );
      onPublished(published);
      showSuccessToast(t("shareProfile.toasts.published"));
      onClose();
    } catch (error) {
      showErrorToast(
        t("shareProfile.toasts.publishFailed", {
          error: errorMessage(error),
        }),
      );
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LuShare2 className="h-5 w-5" />
            {t("shareProfile.title")}
          </DialogTitle>
          <DialogDescription>{t("shareProfile.description")}</DialogDescription>
        </DialogHeader>

        {profile && (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {profile.name}
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {profile.id}
                  </div>
                </div>
                <Badge variant={canPublish ? "secondary" : "outline"}>
                  {isWayfernProfile(profile)
                    ? t("shareProfile.engine.wayfern")
                    : t("shareProfile.engine.unsupported")}
                </Badge>
              </div>
            </div>

            {!canPublish && (
              <Alert className="border-warning/50 bg-warning/10">
                <AlertDescription>
                  {profile.ephemeral
                    ? t("shareProfile.errors.ephemeral")
                    : t("shareProfile.errors.wayfernOnly")}
                </AlertDescription>
              </Alert>
            )}

            {canPublish && (
              <Alert>
                <AlertDescription>
                  {alreadyShared
                    ? t("shareProfile.alreadySharedHint")
                    : t("shareProfile.publishHint")}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.buttons.cancel")}
          </Button>
          <div className="flex gap-2">
            {onOpenTeamAdmin && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onClose();
                  onOpenTeamAdmin();
                }}
              >
                <LuUsers className="mr-2 h-4 w-4" />
                {t("shareProfile.openTeamAdmin")}
              </Button>
            )}
            <LoadingButton
              type="button"
              isLoading={isPublishing}
              disabled={!canPublish}
              onClick={() => void handlePublish()}
            >
              <LuShare2 className="mr-2 h-4 w-4" />
              {alreadyShared
                ? t("shareProfile.actions.resync")
                : t("shareProfile.actions.publish")}
            </LoadingButton>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
