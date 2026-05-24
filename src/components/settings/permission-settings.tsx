"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BsCamera, BsMic } from "react-icons/bs";
import { LoadingButton } from "@/components/loading-button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import type { PermissionType } from "@/hooks/use-permissions";
import { usePermissions } from "@/hooks/use-permissions";
import { showSuccessToast } from "@/lib/toast-utils";

/**
 * macOS-only camera / microphone permission rows. Owns the derived row list
 * and the per-row "requesting" spinner state; the parent just decides whether
 * to render this section at all.
 */
export function PermissionSettings() {
  const { t } = useTranslation();
  const {
    requestPermission,
    isMicrophoneAccessGranted,
    isCameraAccessGranted,
  } = usePermissions();
  const [requestingPermission, setRequestingPermission] =
    useState<PermissionType | null>(null);

  const getPermissionIcon = useCallback((type: PermissionType) => {
    switch (type) {
      case "microphone":
        return <BsMic className="w-4 h-4" />;
      case "camera":
        return <BsCamera className="w-4 h-4" />;
    }
  }, []);

  const getPermissionDisplayName = useCallback(
    (type: PermissionType) => {
      switch (type) {
        case "microphone":
          return t("settings.permissions.microphone");
        case "camera":
          return t("settings.permissions.camera");
      }
    },
    [t],
  );

  const getPermissionDescription = useCallback(
    (type: PermissionType) => {
      switch (type) {
        case "microphone":
          return t("settings.permissions.microphoneDescription");
        case "camera":
          return t("settings.permissions.cameraDescription");
      }
    },
    [t],
  );

  const getStatusBadge = useCallback(
    (isGranted: boolean) => {
      if (isGranted) {
        return (
          <Badge
            variant="default"
            className="text-success-foreground bg-success"
          >
            {t("common.status.granted")}
          </Badge>
        );
      }
      return <Badge variant="secondary">{t("common.status.notGranted")}</Badge>;
    },
    [t],
  );

  const handleRequestPermission = useCallback(
    async (permissionType: PermissionType) => {
      setRequestingPermission(permissionType);
      try {
        await requestPermission(permissionType);
        showSuccessToast(
          t("settings.permissions.accessRequested", {
            permission: getPermissionDisplayName(permissionType),
          }),
        );
      } catch (error) {
        console.error("Failed to request permission:", error);
      } finally {
        setRequestingPermission(null);
      }
    },
    [getPermissionDisplayName, requestPermission, t],
  );

  const permissions = useMemo(
    () => [
      {
        permission_type: "microphone" as PermissionType,
        isGranted: isMicrophoneAccessGranted,
        description: getPermissionDescription("microphone"),
      },
      {
        permission_type: "camera" as PermissionType,
        isGranted: isCameraAccessGranted,
        description: getPermissionDescription("camera"),
      },
    ],
    [
      isMicrophoneAccessGranted,
      isCameraAccessGranted,
      getPermissionDescription,
    ],
  );

  return (
    <div className="space-y-4">
      <Label className="text-base font-medium">
        {t("settings.permissions.title")}
      </Label>

      <div className="space-y-3">
        {permissions.map((permission) => (
          <div
            key={permission.permission_type}
            className="flex justify-between items-center p-3 rounded-lg border"
          >
            <div className="flex items-center space-x-3">
              {getPermissionIcon(permission.permission_type)}
              <div>
                <div className="text-sm font-medium">
                  {getPermissionDisplayName(permission.permission_type)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {permission.description}
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              {getStatusBadge(permission.isGranted)}
              {!permission.isGranted && (
                <LoadingButton
                  size="sm"
                  isLoading={
                    requestingPermission === permission.permission_type
                  }
                  onClick={() => {
                    handleRequestPermission(permission.permission_type).catch(
                      (err: unknown) => {
                        console.error(err);
                      },
                    );
                  }}
                >
                  Grant
                </LoadingButton>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        These permissions allow browsers launched from Donut Browser to access
        system resources. Each website will still ask for your permission
        individually.
      </p>
    </div>
  );
}
