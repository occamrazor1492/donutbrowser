"use client";

import { useTranslation } from "react-i18next";
import { LuBookmark, LuSave, LuX } from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type SavedView, useSavedViews } from "@/hooks/use-saved-views";

interface SavedViewsBarProps {
  searchQuery: string;
  selectedGroupId: string | null;
  onApply: (view: SavedView) => void;
}

/**
 * Thin strip above the profile table that shows persisted "saved views"
 * (named pairs of search query + group selector) and a "Save current as
 * view…" button. Renders nothing when neither saved views exist nor the
 * current filter is interesting enough to save — staying out of the
 * way until a user opts in.
 */
export function SavedViewsBar({
  searchQuery,
  selectedGroupId,
  onApply,
}: SavedViewsBarProps) {
  const { t } = useTranslation();
  const { views, save, remove } = useSavedViews();

  const hasActiveFilter =
    searchQuery.trim().length > 0 || selectedGroupId !== "default";

  if (views.length === 0 && !hasActiveFilter) {
    return null;
  }

  const handleSaveCurrent = () => {
    const name = window.prompt(t("savedViews.promptName"));
    if (name == null) return;
    save(name, { searchQuery, selectedGroupId });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-xs">
      <LuBookmark className="w-3.5 h-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">{t("savedViews.label")}:</span>
      {views.map((view) => (
        <Badge
          key={view.id}
          variant="secondary"
          className="gap-1 cursor-pointer hover:bg-secondary/70"
        >
          <button
            type="button"
            className="text-xs"
            onClick={() => onApply(view)}
          >
            {view.name}
          </button>
          <button
            type="button"
            className="ml-0.5 opacity-60 hover:opacity-100"
            aria-label={t("savedViews.deleteAria", { name: view.name })}
            onClick={(e) => {
              e.stopPropagation();
              if (
                window.confirm(
                  t("savedViews.confirmDelete", { name: view.name }),
                )
              ) {
                remove(view.id);
              }
            }}
          >
            <LuX className="w-3 h-3" />
          </button>
        </Badge>
      ))}
      {hasActiveFilter && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 text-xs"
          onClick={handleSaveCurrent}
        >
          <LuSave className="w-3 h-3" />
          {t("savedViews.saveCurrent")}
        </Button>
      )}
    </div>
  );
}
