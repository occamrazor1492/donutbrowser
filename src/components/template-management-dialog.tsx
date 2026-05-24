"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuPlus, LuTrash2 } from "react-icons/lu";
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
import { useFormatDateTime } from "@/lib/datetime";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";

/**
 * A profile template captures the re-usable parts of a profile (engine,
 * fingerprint, proxy / VPN refs, tags…) so users don't refill the wizard
 * each time they spin up a new profile of the same shape.
 *
 * This dialog is the user-facing surface for the new `template_manager`
 * Tauri commands. It intentionally stays minimal — list / preview / delete
 * plus a "Create empty template" button. The Create Profile wizard hooks
 * into the same backend separately to read & apply a chosen template.
 */
export interface ProfileTemplateContent {
  browser: string;
  engine?: string | null;
  release_type: string;
  tags?: string[];
  note?: string | null;
  sync_mode?: string;
  proxy_id?: string | null;
  vpn_id?: string | null;
  extension_group_id?: string | null;
}

export interface ProfileTemplate {
  id: string;
  name: string;
  description?: string | null;
  created_at: number;
  updated_at: number;
  content: ProfileTemplateContent;
}

interface TemplateManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Called when the user clicks "Use" on a template. The parent should open
   * the Create Profile wizard pre-filled with this template's content.
   */
  onApplyTemplate?: (template: ProfileTemplate) => void;
}

export function TemplateManagementDialog({
  isOpen,
  onClose,
  onApplyTemplate,
}: TemplateManagementDialogProps) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const [templates, setTemplates] = useState<ProfileTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBrowser, setNewBrowser] = useState<string>("wayfern");

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const items = await invoke<ProfileTemplate[]>("list_profile_templates");
      setTemplates(items);
    } catch (err) {
      console.error("Failed to list templates:", err);
      showErrorToast(
        t("templates.errors.listFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (isOpen) void reload();
  }, [isOpen, reload]);

  const handleCreateBlank = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      await invoke<ProfileTemplate>("create_profile_template", {
        name: trimmed,
        description: null,
        content: {
          browser: newBrowser,
          release_type: "stable",
        },
      });
      setNewName("");
      showSuccessToast(t("templates.created"));
      await reload();
    } catch (err) {
      showErrorToast(
        t("templates.errors.createFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }, [newName, newBrowser, reload, t]);

  const handleDelete = useCallback(
    async (template: ProfileTemplate) => {
      if (
        !window.confirm(t("templates.confirmDelete", { name: template.name }))
      ) {
        return;
      }
      try {
        await invoke<boolean>("delete_profile_template", {
          templateId: template.id,
        });
        showSuccessToast(t("templates.deleted"));
        await reload();
      } catch (err) {
        showErrorToast(
          t("templates.errors.deleteFailed", {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    },
    [reload, t],
  );

  const handleApply = useCallback(
    async (template: ProfileTemplate) => {
      // Re-fetch the full record via get_profile_template so we always pass
      // the parent the latest content (the cached list may be stale if the
      // backend was modified by a sync engine between list & click).
      try {
        const fresh = await invoke<ProfileTemplate | null>(
          "get_profile_template",
          { templateId: template.id },
        );
        const target = fresh ?? template;
        onApplyTemplate?.(target);
        onClose();
      } catch (err) {
        showErrorToast(
          t("templates.errors.applyFailed", {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    },
    [onApplyTemplate, onClose, t],
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("templates.title")}</DialogTitle>
          <DialogDescription>{t("templates.description")}</DialogDescription>
        </DialogHeader>

        <div className="rounded-md border p-3 space-y-2">
          <Label className="text-sm font-medium">
            {t("templates.createBlank")}
          </Label>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Input
                placeholder={t("templates.namePlaceholder")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <select
              value={newBrowser}
              onChange={(e) => setNewBrowser(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="wayfern">Wayfern</option>
              <option value="camoufox">Camoufox</option>
              <option value="cloak">Cloak</option>
              <option value="botbrowser">BotBrowser</option>
            </select>
            <Button
              type="button"
              onClick={handleCreateBlank}
              disabled={!newName.trim()}
              className="gap-1"
            >
              <LuPlus className="w-4 h-4" />
              {t("templates.create")}
            </Button>
          </div>
        </div>

        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {isLoading && (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("common.labels.loading")}
            </p>
          )}
          {!isLoading && templates.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("templates.empty")}
            </p>
          )}
          {!isLoading &&
            templates.map((template) => (
              <div
                key={template.id}
                className="flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">
                      {template.name}
                    </p>
                    <Badge variant="secondary" className="text-[10px]">
                      {template.content.browser}
                    </Badge>
                  </div>
                  {template.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {template.description}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("templates.createdAt", {
                      time: formatDateTime(template.created_at * 1000),
                    })}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  {onApplyTemplate && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleApply(template)}
                    >
                      {t("templates.use")}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => void handleDelete(template)}
                    aria-label={t("templates.deleteAria", {
                      name: template.name,
                    })}
                  >
                    <LuTrash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
