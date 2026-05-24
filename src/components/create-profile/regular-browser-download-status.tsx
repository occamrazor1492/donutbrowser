"use client";

import { useTranslation } from "react-i18next";
import { LoadingButton } from "@/components/loading-button";
import { RippleButton } from "@/components/ui/ripple";

interface RegularBrowserDownloadStatusProps {
  bestVersion: string | undefined;
  isLoadingReleaseTypes: boolean;
  releaseTypesError: string | null;
  isDownloading: boolean;
  isVersionAvailable: boolean;
  /**
   * Loading-message label. Intentionally a prop (not a constant) because the
   * two call sites in the create-profile dialog historically render it
   * differently — one via i18n, one as raw English. Preserved verbatim to
   * avoid silently changing user-visible text.
   */
  fetchingLabel: string;
  /** Same caveat as `fetchingLabel` — preserved per call site. */
  retryLabel: string;
  onRetry: () => void;
  onDownload: () => void;
}

/**
 * Generic per-engine download status block used for non-anti-detect ("regular")
 * browsers. Renders the same loading/error/needs-download/available/downloading
 * states as `BrowserDownloadStatus` but uses the `version.latest*` i18n keys
 * which omit the engine name from the rendered message.
 */
export function RegularBrowserDownloadStatus({
  bestVersion,
  isLoadingReleaseTypes,
  releaseTypesError,
  isDownloading,
  isVersionAvailable,
  fetchingLabel,
  retryLabel,
  onRetry,
  onDownload,
}: RegularBrowserDownloadStatusProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      {isLoadingReleaseTypes && (
        <div className="flex gap-3 items-center">
          <div className="w-4 h-4 rounded-full border-2 animate-spin border-muted/40 border-t-primary" />
          <p className="text-sm text-muted-foreground">{fetchingLabel}</p>
        </div>
      )}
      {!isLoadingReleaseTypes && releaseTypesError && (
        <div className="flex gap-3 items-center p-3 rounded-md border border-destructive/50 bg-destructive/10">
          <p className="flex-1 text-sm text-destructive">{releaseTypesError}</p>
          <RippleButton onClick={onRetry} size="sm" variant="outline">
            {retryLabel}
          </RippleButton>
        </div>
      )}
      {!isLoadingReleaseTypes &&
        !releaseTypesError &&
        !isDownloading &&
        !isVersionAvailable &&
        bestVersion && (
          <div className="flex gap-3 items-center">
            <p className="text-sm text-muted-foreground">
              {t("createProfile.version.latestNeedsDownload", {
                version: bestVersion,
              })}
            </p>
            <LoadingButton
              onClick={onDownload}
              isLoading={false}
              className="ml-auto"
              size="sm"
              disabled={false}
            >
              {t("common.buttons.download")}
            </LoadingButton>
          </div>
        )}
      {!isLoadingReleaseTypes &&
        !releaseTypesError &&
        !isDownloading &&
        isVersionAvailable && (
          <div className="text-sm text-muted-foreground">
            ✓{" "}
            {t("createProfile.version.latestAvailable", {
              version: bestVersion,
            })}
          </div>
        )}
      {isDownloading && (
        <div className="text-sm text-muted-foreground">
          {t("createProfile.version.latestDownloading", {
            version: bestVersion,
          })}
        </div>
      )}
    </div>
  );
}
