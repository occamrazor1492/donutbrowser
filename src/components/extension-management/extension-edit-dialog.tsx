"use client";

import { useTranslation } from "react-i18next";
import { LuExternalLink, LuUpload } from "react-icons/lu";
import { Button } from "@/components/ui/button";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Extension } from "@/types";
import { RippleButton } from "../ui/ripple";
import { CompatIcons } from "./extension-icon";

interface PendingFile {
  name: string;
  data: number[];
}

interface ExtensionEditDialogProps {
  extension: Extension | null;
  editName: string;
  pendingUpdateFile: PendingFile | null;
  onEditNameChange: (name: string) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
  onClose: () => void;
}

export function ExtensionEditDialog({
  extension,
  editName,
  pendingUpdateFile,
  onEditNameChange,
  onFileSelect,
  onSave,
  onClose,
}: ExtensionEditDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={extension !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("extensions.editExtension")}</DialogTitle>
          <DialogDescription>
            {t("extensions.editExtensionDescription")}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="overflow-y-auto flex-1 -mx-6 px-6">
          {extension && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("common.labels.name")}</Label>
                <Input
                  value={editName}
                  onChange={(e) => {
                    onEditNameChange(e.target.value);
                  }}
                  placeholder={t("extensions.namePlaceholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSave();
                  }}
                />
              </div>

              {/* Metadata from manifest.json */}
              <div className="rounded-md border p-3 space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                  {t("extensions.metadata")}
                </Label>
                <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-sm">
                  {extension.version && (
                    <>
                      <span className="text-muted-foreground">
                        {t("extensions.version")}
                      </span>
                      <span>{extension.version}</span>
                    </>
                  )}
                  {extension.author && (
                    <>
                      <span className="text-muted-foreground">
                        {t("extensions.author")}
                      </span>
                      <span>{extension.author}</span>
                    </>
                  )}
                  {extension.description && (
                    <>
                      <span className="text-muted-foreground">
                        {t("common.labels.description")}
                      </span>
                      <span className="line-clamp-3">
                        {extension.description}
                      </span>
                    </>
                  )}
                  <span className="text-muted-foreground">
                    {t("extensions.compatibility.label")}
                  </span>
                  <div className="flex items-center gap-1">
                    <CompatIcons
                      compatibility={extension.browser_compatibility}
                    />
                  </div>
                  <span className="text-muted-foreground">
                    {t("common.labels.type")}
                  </span>
                  <span>.{extension.file_type}</span>
                  {extension.homepage_url && (
                    <>
                      <span className="text-muted-foreground">
                        {t("extensions.homepage")}
                      </span>
                      <a
                        href={extension.homepage_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline flex items-center gap-1 truncate"
                      >
                        <span className="truncate">
                          {extension.homepage_url}
                        </span>
                        <LuExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    </>
                  )}
                  {!extension.version &&
                    !extension.author &&
                    !extension.description &&
                    !extension.homepage_url && (
                      <span className="col-span-2 text-muted-foreground text-xs">
                        {t("extensions.noMetadata")}
                      </span>
                    )}
                </div>
              </div>

              {/* Re-upload */}
              <div className="space-y-2">
                <Label>{t("extensions.reupload")}</Label>
                <div className="flex gap-2 items-center">
                  <RippleButton
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      document.getElementById("ext-edit-file-input")?.click()
                    }
                  >
                    <LuUpload className="w-3 h-3 mr-1" />
                    {t("extensions.selectFile")}
                  </RippleButton>
                  <input
                    id="ext-edit-file-input"
                    type="file"
                    accept=".xpi,.crx,.zip"
                    className="hidden"
                    onChange={onFileSelect}
                  />
                  {pendingUpdateFile && (
                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                      {pendingUpdateFile.name}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.buttons.cancel")}
          </Button>
          <RippleButton onClick={() => onSave()} disabled={!editName.trim()}>
            {t("common.buttons.save")}
          </RippleButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
