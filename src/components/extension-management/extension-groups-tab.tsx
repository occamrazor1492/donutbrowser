"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GoPlus } from "react-icons/go";
import { LuPencil, LuTrash2 } from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Extension, ExtensionGroup } from "@/types";
import { RippleButton } from "../ui/ripple";
import { CompatIcons, ExtensionIcon } from "./extension-icon";
import { getSyncStatusDot, type SyncStatus } from "./sync-status";

const MAX_VISIBLE_ICONS = 3;

interface ExtensionGroupsTabProps {
  extensions: Extension[];
  extensionGroups: ExtensionGroup[];
  extensionIcons: Record<string, string>;
  extSyncStatus: Record<string, SyncStatus>;
  isTogglingGroupSync: Record<string, boolean>;
  /** Backend op: create a new group. Should call invoke() + refresh data. */
  onCreateGroup: (name: string) => Promise<void>;
  /** Backend op: save name + member-id changes to an existing group. */
  onSaveGroupEdits: (
    group: ExtensionGroup,
    name: string,
    extensionIds: string[],
  ) => Promise<void>;
  onToggleGroupSync: (group: ExtensionGroup) => void;
  onDeleteGroup: (group: ExtensionGroup) => void;
}

/**
 * Groups tab body + edit-group dialog.
 *
 * The create-group form state (whether the inline create row is open,
 * the in-progress name) and the edit-group dialog state (open group,
 * draft name, draft member list) used to live in the parent
 * `ExtensionManagementDialog` and flow back in through 14 props. That
 * was the largest single contributor to the parent's bloat — none of
 * that state ever escapes this tab. It's all owned locally here now;
 * the parent only provides the two backend operations
 * (`onCreateGroup`, `onSaveGroupEdits`) which still need to live there
 * because they call `invoke()` and re-fetch the canonical data.
 *
 * Net: 22 props → 9.
 */
export function ExtensionGroupsTab({
  extensions,
  extensionGroups,
  extensionIcons,
  extSyncStatus,
  isTogglingGroupSync,
  onCreateGroup,
  onSaveGroupEdits,
  onToggleGroupSync,
  onDeleteGroup,
}: ExtensionGroupsTabProps) {
  const { t } = useTranslation();
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroup, setEditingGroup] = useState<ExtensionGroup | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [editGroupExtensionIds, setEditGroupExtensionIds] = useState<string[]>(
    [],
  );

  const submitCreate = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    await onCreateGroup(name);
    setNewGroupName("");
    setShowCreateGroup(false);
  };

  const openEdit = (group: ExtensionGroup) => {
    setEditingGroup(group);
    setEditGroupName(group.name);
    setEditGroupExtensionIds([...group.extension_ids]);
  };

  const closeEdit = () => {
    setEditingGroup(null);
    setEditGroupName("");
    setEditGroupExtensionIds([]);
  };

  const submitEdit = async () => {
    if (!editingGroup) return;
    const name = editGroupName.trim();
    if (!name) return;
    await onSaveGroupEdits(editingGroup, name, editGroupExtensionIds);
    closeEdit();
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <Label>{t("extensions.groupsTab")}</Label>
          <RippleButton
            size="sm"
            onClick={() => {
              setShowCreateGroup(true);
            }}
            className="flex gap-2 items-center"
          >
            <GoPlus className="w-4 h-4" />
            {t("extensions.createGroup")}
          </RippleButton>
        </div>

        {/* Create group form */}
        {showCreateGroup && (
          <div className="flex gap-2 items-center">
            <Input
              value={newGroupName}
              onChange={(e) => {
                setNewGroupName(e.target.value);
              }}
              placeholder={t("extensions.groupNamePlaceholder")}
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitCreate();
              }}
            />
            <RippleButton
              size="sm"
              onClick={() => void submitCreate()}
              disabled={!newGroupName.trim()}
            >
              {t("common.buttons.create")}
            </RippleButton>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowCreateGroup(false);
                setNewGroupName("");
              }}
            >
              {t("common.buttons.cancel")}
            </Button>
          </div>
        )}

        {/* Groups list */}
        {extensionGroups.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t("extensions.noGroups")}
          </div>
        ) : (
          <div className="space-y-2">
            {extensionGroups.map((group) => {
              const groupExts = group.extension_ids
                .map((id) => extensions.find((e) => e.id === id))
                .filter(Boolean) as Extension[];
              const visibleExts = groupExts.slice(0, MAX_VISIBLE_ICONS);
              const overflowCount = groupExts.length - MAX_VISIBLE_ICONS;
              const groupSyncDot = getSyncStatusDot(
                group,
                extSyncStatus[group.id],
                t,
              );

              return (
                <div
                  key={group.id}
                  className="flex items-center gap-3 rounded-md border px-3 py-2"
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className={`w-2 h-2 rounded-full shrink-0 ${groupSyncDot.color} ${
                          groupSyncDot.animate ? "animate-pulse" : ""
                        }`}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{groupSyncDot.tooltip}</p>
                    </TooltipContent>
                  </Tooltip>
                  <span className="font-medium text-sm truncate min-w-0">
                    {group.name}
                  </span>

                  <div className="flex items-center gap-1 shrink-0">
                    {visibleExts.map((ext) => (
                      <Tooltip key={ext.id}>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <ExtensionIcon
                              iconDataUri={extensionIcons[ext.id]}
                              size="sm"
                            />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{ext.name}</TooltipContent>
                      </Tooltip>
                    ))}
                    {overflowCount > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="secondary"
                            className="text-xs h-5 px-1.5 shrink-0"
                          >
                            +{overflowCount}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="space-y-0.5">
                            {groupExts.slice(MAX_VISIBLE_ICONS).map((ext) => (
                              <p key={ext.id} className="text-xs">
                                {ext.name}
                              </p>
                            ))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {groupExts.length === 0 && (
                      <span className="text-xs text-muted-foreground">
                        {t("extensions.noExtensionsInGroup")}
                      </span>
                    )}
                  </div>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center shrink-0">
                        <Checkbox
                          checked={group.sync_enabled}
                          onCheckedChange={() => onToggleGroupSync(group)}
                          disabled={isTogglingGroupSync[group.id]}
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        {group.sync_enabled
                          ? t("extensions.syncDisableTooltip")
                          : t("extensions.syncEnableTooltip")}
                      </p>
                    </TooltipContent>
                  </Tooltip>

                  <div className="flex gap-1 ml-auto shrink-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            openEdit(group);
                          }}
                        >
                          <LuPencil className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("common.buttons.edit")}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            onDeleteGroup(group);
                          }}
                        >
                          <LuTrash2 className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("extensions.deleteGroup")}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Group editing dialog */}
      <Dialog
        open={editingGroup !== null}
        onOpenChange={(open) => {
          if (!open) closeEdit();
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t("extensions.editGroup")}</DialogTitle>
            <DialogDescription>
              {t("extensions.editGroupDescription")}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="overflow-y-auto flex-1 -mx-6 px-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("common.labels.name")}</Label>
                <Input
                  value={editGroupName}
                  onChange={(e) => {
                    setEditGroupName(e.target.value);
                  }}
                  placeholder={t("extensions.groupNamePlaceholder")}
                />
              </div>

              {extensions.filter((e) => !editGroupExtensionIds.includes(e.id))
                .length > 0 && (
                <div className="space-y-2">
                  <Label>{t("extensions.addToGroup")}</Label>
                  <Select
                    value=""
                    onValueChange={(extId) => {
                      setEditGroupExtensionIds((prev) => [...prev, extId]);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("extensions.addToGroup")} />
                    </SelectTrigger>
                    <SelectContent>
                      {extensions
                        .filter((e) => !editGroupExtensionIds.includes(e.id))
                        .map((ext) => (
                          <SelectItem key={ext.id} value={ext.id}>
                            <div className="flex items-center gap-2">
                              <ExtensionIcon
                                iconDataUri={extensionIcons[ext.id]}
                                size="sm"
                              />
                              {ext.name}
                            </div>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label>{t("extensions.groupExtensions")}</Label>
                {editGroupExtensionIds.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-2">
                    {t("extensions.noExtensionsInGroup")}
                  </div>
                ) : (
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {editGroupExtensionIds.map((extId) => {
                      const ext = extensions.find((e) => e.id === extId);
                      if (!ext) return null;
                      return (
                        <div
                          key={extId}
                          className="flex items-center gap-2 rounded-md border px-2 py-1.5"
                        >
                          <ExtensionIcon
                            iconDataUri={extensionIcons[ext.id]}
                            size="sm"
                          />
                          <span className="text-sm flex-1 truncate min-w-0">
                            {ext.name}
                          </span>
                          <CompatIcons
                            compatibility={ext.browser_compatibility}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 shrink-0"
                            onClick={() => {
                              setEditGroupExtensionIds((prev) =>
                                prev.filter((id) => id !== extId),
                              );
                            }}
                          >
                            <LuTrash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={closeEdit}>
              {t("common.buttons.cancel")}
            </Button>
            <RippleButton
              onClick={() => void submitEdit()}
              disabled={!editGroupName.trim()}
            >
              {t("common.buttons.save")}
            </RippleButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
