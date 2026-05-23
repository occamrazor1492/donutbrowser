"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { LuPlus, LuSearch } from "react-icons/lu";
import { Button } from "@/components/ui/button";

export interface EmptyProfilesStateProps {
  /** True when no profiles exist anywhere — show full onboarding card. */
  isFreshInstall: boolean;
  /** True when profiles exist but a filter / search query reduced them to 0. */
  hasActiveFilter: boolean;
  /** Called when the user clicks the "Create profile" CTA. */
  onCreateProfile?: () => void;
  /** Called when the user clicks "Clear filters" in the no-match state. */
  onClearFilters?: () => void;
}

/**
 * The cell shown inside the profiles table body when there are no rows. Two
 * distinct messages because the user intent differs:
 *
 *   - fresh install / true empty → onboarding ("create your first profile")
 *   - filtered down to 0 → "no match, clear filters"
 *
 * Replaces the single-line "No profiles found." cell that was the only thing
 * a new user saw on first launch (UX audit pass, 2026-05).
 */
export function EmptyProfilesState({
  isFreshInstall,
  hasActiveFilter,
  onCreateProfile,
  onClearFilters,
}: EmptyProfilesStateProps): React.ReactElement {
  const { t } = useTranslation();

  if (isFreshInstall) {
    return (
      <div className="flex flex-col items-center gap-5 py-12 text-center">
        <div className="flex justify-center items-center w-14 h-14 rounded-full bg-primary/10">
          <LuPlus className="w-7 h-7 text-primary" />
        </div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-foreground">
            {t("profiles.emptyOnboarding.title")}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {t("profiles.emptyOnboarding.description")}
          </p>
        </div>
        {onCreateProfile && (
          <Button
            type="button"
            onClick={onCreateProfile}
            className="gap-2"
            size="lg"
          >
            <LuPlus className="w-4 h-4" />
            {t("profiles.emptyOnboarding.cta")}
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          {t("profiles.emptyOnboarding.shortcutHint")}
        </p>
      </div>
    );
  }

  if (hasActiveFilter) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex justify-center items-center w-10 h-10 rounded-full bg-muted">
          <LuSearch className="w-5 h-5 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          {t("profiles.emptyNoMatch.title")}
        </p>
        {onClearFilters && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClearFilters}
          >
            {t("profiles.emptyNoMatch.clearFilters")}
          </Button>
        )}
      </div>
    );
  }

  // Fallback (shouldn't happen given the two flags cover the space, but keep
  // the original copy for safety so we never render nothing).
  return (
    <div className="py-10 text-sm text-center text-muted-foreground">
      {t("profiles.table.empty")}
    </div>
  );
}
