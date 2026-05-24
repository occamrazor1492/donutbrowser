"use client";

import { useTranslation } from "react-i18next";
import { LoadingButton } from "@/components/loading-button";
import { RippleButton } from "@/components/ui/ripple";

interface BrowserDownloadStatusProps {
  engineLabel: string;
  bestVersion: string | undefined;
  isLoadingReleaseTypes: boolean;
  releaseTypesError: string | null;
  isDownloading: boolean;
  isVersionAvailable: boolean;
  onRetry: () => void;
  onDownload: () => void;
}

/**
 * Per-engine download / availability status block used by Wayfern and Camoufox
 * configuration screens in the create-profile dialog.
 *
 * Renders one of (mutually exclusive): loading spinner, fetch error with retry,
 * "platform unavailable" warning, "needs download" prompt with download button,
 * "downloading" message, or "available" check.
 */
export function BrowserDownloadStatus({
  engineLabel,
  bestVersion,
  isLoadingReleaseTypes,
  releaseTypesError,
  isDownloading,
  isVersionAvailable,
  onRetry,
  onDownload,
}: BrowserDownloadStatusProps) {
  const { t } = useTranslation();

  if (isLoadingReleaseTypes) {
    return (
      <div className="flex gap-3 items-center p-3 rounded-md border">
        <div className="w-4 h-4 rounded-full border-2 animate-spin border-muted/40 border-t-primary" />
        <p className="text-sm text-muted-foreground">
          {t("createProfile.version.fetching")}
        </p>
      </div>
    );
  }

  if (releaseTypesError) {
    return (
      <div className="flex gap-3 items-center p-3 rounded-md border border-destructive/50 bg-destructive/10">
        <p className="flex-1 text-sm text-destructive">{releaseTypesError}</p>
        <RippleButton onClick={onRetry} size="sm" variant="outline">
          {t("common.buttons.retry")}
        </RippleButton>
      </div>
    );
  }

  if (!bestVersion) {
    return (
      <div className="flex gap-3 items-center p-3 rounded-md border border-warning/50 bg-warning/10">
        <p className="text-sm text-warning">
          {t("createProfile.platformUnavailable", { browser: engineLabel })}
        </p>
      </div>
    );
  }

  if (isDownloading) {
    return (
      <div className="p-3 text-sm rounded-md border text-muted-foreground">
        {t("createProfile.version.downloading", {
          browser: engineLabel,
          version: bestVersion,
        })}
      </div>
    );
  }

  if (!isVersionAvailable) {
    return (
      <div className="flex gap-3 items-center p-3 rounded-md border">
        <p className="text-sm text-muted-foreground">
          {t("createProfile.version.needsDownload", {
            browser: engineLabel,
            version: bestVersion,
          })}
        </p>
        <LoadingButton
          onClick={onDownload}
          isLoading={false}
          size="sm"
          disabled={false}
        >
          {t("common.buttons.download")}
        </LoadingButton>
      </div>
    );
  }

  return (
    <div className="p-3 text-sm rounded-md border text-muted-foreground">
      ✓{" "}
      {t("createProfile.version.available", {
        browser: engineLabel,
        version: bestVersion,
      })}
    </div>
  );
}
