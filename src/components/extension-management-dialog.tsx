"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuPuzzle } from "react-icons/lu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import type { Extension, ExtensionGroup } from "@/types";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";
import { ExtensionEditDialog } from "./extension-management/extension-edit-dialog";
import { ExtensionGroupsTab } from "./extension-management/extension-groups-tab";
import { ExtensionList } from "./extension-management/extension-list";
import { type SyncStatus } from "./extension-management/sync-status";
import { RippleButton } from "./ui/ripple";

interface ExtensionManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExtensionManagementDialog({
  isOpen,
  onClose,
}: ExtensionManagementDialogProps) {
  const { t } = useTranslation();
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [extensionGroups, setExtensionGroups] = useState<ExtensionGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Extension upload state
  const [isUploading, setIsUploading] = useState(false);
  const [extensionName, setExtensionName] = useState("");
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [pendingFile, setPendingFile] = useState<{
    name: string;
    data: number[];
  } | null>(null);

  // Group state
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroup, setEditingGroup] = useState<ExtensionGroup | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [editGroupExtensionIds, setEditGroupExtensionIds] = useState<string[]>(
    [],
  );

  // Delete state
  const [extensionToDelete, setExtensionToDelete] = useState<Extension | null>(
    null,
  );
  const [groupToDelete, setGroupToDelete] = useState<ExtensionGroup | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  // Edit extension state
  const [editingExtension, setEditingExtension] = useState<Extension | null>(
    null,
  );
  const [editExtensionName, setEditExtensionName] = useState("");
  const [pendingUpdateFile, setPendingUpdateFile] = useState<{
    name: string;
    data: number[];
  } | null>(null);

  // Extension icons
  const [extensionIcons, setExtensionIcons] = useState<Record<string, string>>(
    {},
  );

  // Sync state
  const [extSyncStatus, setExtSyncStatus] = useState<
    Record<string, SyncStatus>
  >({});
  const [isTogglingExtSync, setIsTogglingExtSync] = useState<
    Record<string, boolean>
  >({});
  const [isTogglingGroupSync, setIsTogglingGroupSync] = useState<
    Record<string, boolean>
  >({});

  // Tab
  const [activeTab, setActiveTab] = useState<"extensions" | "groups">(
    "extensions",
  );

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [exts, groups] = await Promise.all([
        invoke<Extension[]>("list_extensions"),
        invoke<ExtensionGroup[]>("list_extension_groups"),
      ]);
      setExtensions(exts);
      setExtensionGroups(groups);
    } catch {
      setExtensions([]);
      setExtensionGroups([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadIcons = useCallback(async (exts: Extension[]) => {
    const icons: Record<string, string> = {};
    for (const ext of exts) {
      try {
        const icon = await invoke<string | null>("get_extension_icon", {
          extensionId: ext.id,
        });
        if (icon) {
          icons[ext.id] = icon;
        }
      } catch {
        // Icon not available
      }
    }
    setExtensionIcons(icons);
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadData();
    }
  }, [isOpen, loadData]);

  useEffect(() => {
    if (extensions.length > 0) {
      void loadIcons(extensions);
    }
  }, [extensions, loadIcons]);

  // Listen for extension sync status events
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<{ id: string; status: string }>(
        "extension-sync-status",
        (event) => {
          const { id, status } = event.payload;
          setExtSyncStatus((prev) => ({
            ...prev,
            [id]: status as SyncStatus,
          }));
        },
      );
    };

    void setupListener();
    return () => {
      unlisten?.();
    };
  }, []);

  const handleToggleExtSync = useCallback(
    async (ext: Extension) => {
      setIsTogglingExtSync((prev) => ({ ...prev, [ext.id]: true }));
      try {
        await invoke("set_extension_sync_enabled", {
          extensionId: ext.id,
          enabled: !ext.sync_enabled,
        });
        showSuccessToast(
          ext.sync_enabled
            ? t("extensions.syncDisabled")
            : t("extensions.syncEnabled"),
        );
        void loadData();
      } catch (err) {
        showErrorToast(err instanceof Error ? err.message : String(err));
      } finally {
        setIsTogglingExtSync((prev) => ({ ...prev, [ext.id]: false }));
      }
    },
    [loadData, t],
  );

  const handleToggleGroupSync = useCallback(
    async (group: ExtensionGroup) => {
      setIsTogglingGroupSync((prev) => ({ ...prev, [group.id]: true }));
      try {
        await invoke("set_extension_group_sync_enabled", {
          extensionGroupId: group.id,
          enabled: !group.sync_enabled,
        });
        showSuccessToast(
          group.sync_enabled
            ? t("extensions.syncDisabled")
            : t("extensions.syncEnabled"),
        );
        void loadData();
      } catch (err) {
        showErrorToast(err instanceof Error ? err.message : String(err));
      } finally {
        setIsTogglingGroupSync((prev) => ({ ...prev, [group.id]: false }));
      }
    },
    [loadData, t],
  );

  const handleUpdateExtension = useCallback(async () => {
    if (!editingExtension || !editExtensionName.trim()) return;
    try {
      await invoke("update_extension", {
        extensionId: editingExtension.id,
        name: editExtensionName.trim(),
        fileName: pendingUpdateFile?.name ?? null,
        fileData: pendingUpdateFile?.data ?? null,
      });
      showSuccessToast(t("extensions.updateSuccess"));
      setEditingExtension(null);
      setEditExtensionName("");
      setPendingUpdateFile(null);
      void loadData();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    }
  }, [editingExtension, editExtensionName, pendingUpdateFile, loadData, t]);

  const handleEditFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const validExtensions = [".xpi", ".crx", ".zip"];
      const isValid = validExtensions.some((ext) =>
        file.name.toLowerCase().endsWith(ext),
      );
      if (!isValid) {
        showErrorToast(t("extensions.invalidFileType"));
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const data = Array.from(new Uint8Array(arrayBuffer));
        setPendingUpdateFile({ name: file.name, data });
      };
      reader.readAsArrayBuffer(file);
      e.target.value = "";
    },
    [t],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const validExtensions = [".xpi", ".crx", ".zip"];
      const isValid = validExtensions.some((ext) =>
        file.name.toLowerCase().endsWith(ext),
      );
      if (!isValid) {
        showErrorToast(t("extensions.invalidFileType"));
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const data = Array.from(new Uint8Array(arrayBuffer));
        const baseName = file.name
          .replace(/\.(xpi|crx|zip)$/i, "")
          .replace(/[-_]/g, " ");
        setExtensionName(baseName);
        setPendingFile({ name: file.name, data });
        setShowUploadForm(true);
      };
      reader.onerror = () => {
        showErrorToast(t("extensions.readError"));
      };
      reader.readAsArrayBuffer(file);

      // Reset input
      e.target.value = "";
    },
    [t],
  );

  const handleUpload = useCallback(async () => {
    if (!pendingFile || !extensionName.trim()) return;
    setIsUploading(true);
    try {
      await invoke("add_extension", {
        name: extensionName.trim(),
        fileName: pendingFile.name,
        fileData: pendingFile.data,
      });
      showSuccessToast(t("extensions.uploadSuccess"));
      setShowUploadForm(false);
      setPendingFile(null);
      setExtensionName("");
      void loadData();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
    }
  }, [pendingFile, extensionName, loadData, t]);

  const handleDeleteExtension = useCallback(async () => {
    if (!extensionToDelete) return;
    setIsDeleting(true);
    try {
      await invoke("delete_extension", { extensionId: extensionToDelete.id });
      showSuccessToast(t("extensions.deleteSuccess"));
      setExtensionToDelete(null);
      void loadData();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
    }
  }, [extensionToDelete, loadData, t]);

  const handleCreateGroup = useCallback(async () => {
    if (!newGroupName.trim()) return;
    try {
      await invoke("create_extension_group", { name: newGroupName.trim() });
      showSuccessToast(t("extensions.groupCreateSuccess"));
      setShowCreateGroup(false);
      setNewGroupName("");
      void loadData();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    }
  }, [newGroupName, loadData, t]);

  const handleSaveGroupEdits = useCallback(async () => {
    if (!editingGroup || !editGroupName.trim()) return;
    try {
      // Update group name
      await invoke("update_extension_group", {
        groupId: editingGroup.id,
        name: editGroupName.trim(),
      });

      // Compute diff of extensions
      const originalIds = new Set(editingGroup.extension_ids);
      const newIds = new Set(editGroupExtensionIds);

      // Add new extensions
      for (const extId of editGroupExtensionIds) {
        if (!originalIds.has(extId)) {
          await invoke("add_extension_to_group", {
            groupId: editingGroup.id,
            extensionId: extId,
          });
        }
      }

      // Remove removed extensions
      for (const extId of editingGroup.extension_ids) {
        if (!newIds.has(extId)) {
          await invoke("remove_extension_from_group", {
            groupId: editingGroup.id,
            extensionId: extId,
          });
        }
      }

      showSuccessToast(t("extensions.groupUpdateSuccess"));
      setEditingGroup(null);
      setEditGroupName("");
      setEditGroupExtensionIds([]);
      void loadData();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    }
  }, [editingGroup, editGroupName, editGroupExtensionIds, loadData, t]);

  const handleDeleteGroup = useCallback(async () => {
    if (!groupToDelete) return;
    setIsDeleting(true);
    try {
      await invoke("delete_extension_group", { groupId: groupToDelete.id });
      showSuccessToast(t("extensions.groupDeleteSuccess"));
      setGroupToDelete(null);
      void loadData();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
    }
  }, [groupToDelete, loadData, t]);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LuPuzzle className="w-5 h-5" />
              {t("extensions.title")}
            </DialogTitle>
            <DialogDescription>{t("extensions.description")}</DialogDescription>
          </DialogHeader>

          <ScrollArea className="overflow-y-auto flex-1">
            <div>
              <div className="space-y-4">
                {/* Tab selector */}
                <div className="flex gap-2 border-b">
                  <button
                    type="button"
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === "extensions"
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => {
                      setActiveTab("extensions");
                    }}
                  >
                    {t("extensions.extensionsTab")}
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === "groups"
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => {
                      setActiveTab("groups");
                    }}
                  >
                    {t("extensions.groupsTab")}
                  </button>
                </div>

                {/* Notice */}
                <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                  {t("extensions.managedNotice")}
                </div>

                {activeTab === "extensions" && (
                  <ExtensionList
                    extensions={extensions}
                    isLoading={isLoading}
                    extensionIcons={extensionIcons}
                    extSyncStatus={extSyncStatus}
                    isTogglingExtSync={isTogglingExtSync}
                    showUploadForm={showUploadForm}
                    pendingFile={pendingFile}
                    extensionName={extensionName}
                    isUploading={isUploading}
                    onFileSelect={handleFileSelect}
                    onExtensionNameChange={setExtensionName}
                    onUpload={() => void handleUpload()}
                    onCancelUpload={() => {
                      setShowUploadForm(false);
                      setPendingFile(null);
                      setExtensionName("");
                    }}
                    onToggleSync={(ext) => void handleToggleExtSync(ext)}
                    onEdit={(ext) => {
                      setEditingExtension(ext);
                      setEditExtensionName(ext.name);
                      setPendingUpdateFile(null);
                    }}
                    onDelete={(ext) => {
                      setExtensionToDelete(ext);
                    }}
                  />
                )}

                {activeTab === "groups" && (
                  <ExtensionGroupsTab
                    extensions={extensions}
                    extensionGroups={extensionGroups}
                    extensionIcons={extensionIcons}
                    extSyncStatus={extSyncStatus}
                    isTogglingGroupSync={isTogglingGroupSync}
                    showCreateGroup={showCreateGroup}
                    newGroupName={newGroupName}
                    editingGroup={editingGroup}
                    editGroupName={editGroupName}
                    editGroupExtensionIds={editGroupExtensionIds}
                    onShowCreateGroup={() => {
                      setShowCreateGroup(true);
                    }}
                    onNewGroupNameChange={setNewGroupName}
                    onCreateGroup={() => void handleCreateGroup()}
                    onCancelCreateGroup={() => {
                      setShowCreateGroup(false);
                      setNewGroupName("");
                    }}
                    onEditGroup={(group) => {
                      setEditingGroup(group);
                      setEditGroupName(group.name);
                      setEditGroupExtensionIds([...group.extension_ids]);
                    }}
                    onEditGroupNameChange={setEditGroupName}
                    onEditGroupExtensionIdsChange={setEditGroupExtensionIds}
                    onCloseEditGroup={() => {
                      setEditingGroup(null);
                      setEditGroupName("");
                      setEditGroupExtensionIds([]);
                    }}
                    onSaveGroupEdits={() => void handleSaveGroupEdits()}
                    onToggleGroupSync={(group) =>
                      void handleToggleGroupSync(group)
                    }
                    onDeleteGroup={(group) => {
                      setGroupToDelete(group);
                    }}
                  />
                )}
              </div>
            </div>
          </ScrollArea>

          <DialogFooter>
            <RippleButton variant="outline" onClick={onClose}>
              {t("common.buttons.close")}
            </RippleButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ExtensionEditDialog
        extension={editingExtension}
        editName={editExtensionName}
        pendingUpdateFile={pendingUpdateFile}
        onEditNameChange={setEditExtensionName}
        onFileSelect={handleEditFileSelect}
        onSave={() => void handleUpdateExtension()}
        onClose={() => {
          setEditingExtension(null);
          setEditExtensionName("");
          setPendingUpdateFile(null);
        }}
      />

      {/* Delete extension confirmation */}
      <DeleteConfirmationDialog
        isOpen={extensionToDelete !== null}
        onClose={() => {
          setExtensionToDelete(null);
        }}
        onConfirm={handleDeleteExtension}
        title={t("extensions.deleteConfirmTitle")}
        description={t("extensions.deleteConfirmDescription", {
          name: extensionToDelete?.name ?? "",
        })}
        isLoading={isDeleting}
      />

      {/* Delete group confirmation */}
      <DeleteConfirmationDialog
        isOpen={groupToDelete !== null}
        onClose={() => {
          setGroupToDelete(null);
        }}
        onConfirm={handleDeleteGroup}
        title={t("extensions.deleteGroupConfirmTitle")}
        description={t("extensions.deleteGroupConfirmDescription", {
          name: groupToDelete?.name ?? "",
        })}
        isLoading={isDeleting}
      />
    </>
  );
}
