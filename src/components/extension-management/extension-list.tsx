"use client";

import { useTranslation } from "react-i18next";
import { LuPencil, LuTrash2, LuUpload } from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Extension } from "@/types";
import { RippleButton } from "../ui/ripple";
import { CompatIcons, ExtensionIcon } from "./extension-icon";
import { getSyncStatusDot, type SyncStatus } from "./sync-status";

interface PendingFile {
  name: string;
  data: number[];
}

interface ExtensionListProps {
  extensions: Extension[];
  isLoading: boolean;
  extensionIcons: Record<string, string>;
  extSyncStatus: Record<string, SyncStatus>;
  isTogglingExtSync: Record<string, boolean>;
  showUploadForm: boolean;
  pendingFile: PendingFile | null;
  extensionName: string;
  isUploading: boolean;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onExtensionNameChange: (name: string) => void;
  onUpload: () => void;
  onCancelUpload: () => void;
  onToggleSync: (ext: Extension) => void;
  onEdit: (ext: Extension) => void;
  onDelete: (ext: Extension) => void;
}

export function ExtensionList({
  extensions,
  isLoading,
  extensionIcons,
  extSyncStatus,
  isTogglingExtSync,
  showUploadForm,
  pendingFile,
  extensionName,
  isUploading,
  onFileSelect,
  onExtensionNameChange,
  onUpload,
  onCancelUpload,
  onToggleSync,
  onEdit,
  onDelete,
}: ExtensionListProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <Label>{t("extensions.extensionsTab")}</Label>
        <div>
          <label htmlFor="ext-file-input">
            <RippleButton
              size="sm"
              className="flex gap-2 items-center"
              onClick={() => document.getElementById("ext-file-input")?.click()}
            >
              <LuUpload className="w-4 h-4" />
              {t("extensions.upload")}
            </RippleButton>
          </label>
          <input
            id="ext-file-input"
            type="file"
            accept=".xpi,.crx,.zip"
            className="hidden"
            onChange={onFileSelect}
          />
        </div>
      </div>

      {/* Upload form */}
      {showUploadForm && pendingFile && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="text-sm text-muted-foreground">
            {t("extensions.selectedFile")}:{" "}
            <span className="font-medium text-foreground">
              {pendingFile.name}
            </span>
          </div>
          <div className="flex gap-2">
            <Input
              value={extensionName}
              onChange={(e) => {
                onExtensionNameChange(e.target.value);
              }}
              placeholder={t("extensions.namePlaceholder")}
              className="flex-1"
            />
            <RippleButton
              size="sm"
              onClick={() => onUpload()}
              disabled={isUploading || !extensionName.trim()}
            >
              {isUploading
                ? t("common.buttons.loading")
                : t("common.buttons.add")}
            </RippleButton>
            <Button size="sm" variant="outline" onClick={onCancelUpload}>
              {t("common.buttons.cancel")}
            </Button>
          </div>
        </div>
      )}

      {/* Extensions list */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground">
          {t("common.buttons.loading")}
        </div>
      ) : extensions.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          {t("extensions.empty")}
        </div>
      ) : (
        <div className="border rounded-md max-h-[300px] overflow-y-auto">
          {extensions.map((ext) => {
            const syncDot = getSyncStatusDot(ext, extSyncStatus[ext.id], t);
            return (
              <div
                key={ext.id}
                className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0"
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={`w-2 h-2 rounded-full shrink-0 ${syncDot.color} ${
                        syncDot.animate ? "animate-pulse" : ""
                      }`}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{syncDot.tooltip}</p>
                  </TooltipContent>
                </Tooltip>
                <ExtensionIcon iconDataUri={extensionIcons[ext.id]} size="sm" />
                <span className="text-sm font-medium truncate min-w-0 flex-1 max-w-[180px]">
                  {ext.name}
                </span>
                <Badge variant="outline" className="shrink-0 text-xs">
                  .{ext.file_type}
                </Badge>
                <CompatIcons compatibility={ext.browser_compatibility} />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center shrink-0">
                      <Checkbox
                        checked={ext.sync_enabled}
                        onCheckedChange={() => onToggleSync(ext)}
                        disabled={isTogglingExtSync[ext.id]}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {ext.sync_enabled
                        ? t("extensions.syncDisableTooltip")
                        : t("extensions.syncEnableTooltip")}
                    </p>
                  </TooltipContent>
                </Tooltip>
                <div className="flex gap-0.5 ml-auto shrink-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => {
                          onEdit(ext);
                        }}
                      >
                        <LuPencil className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("extensions.editExtension")}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => {
                          onDelete(ext);
                        }}
                      >
                        <LuTrash2 className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("extensions.delete")}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
