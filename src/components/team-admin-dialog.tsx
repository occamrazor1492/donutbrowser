"use client";

import { invoke } from "@tauri-apps/api/core";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  LuLockOpen,
  LuPlus,
  LuRefreshCw,
  LuSave,
  LuTrash2,
} from "react-icons/lu";
import { LoadingButton } from "@/components/loading-button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFormatDateTime } from "@/lib/datetime";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import type {
  SelfHostedTeamUser,
  TeamAuditLog,
  TeamProfilePermissionLevel,
  TeamProfileRecord,
} from "@/types";

interface TeamAdminDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ProfileEditState {
  name: string;
}

const ALL_USERS = "__all__";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function TeamAdminDialog({ isOpen, onClose }: TeamAdminDialogProps) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const [activeTab, setActiveTab] = useState("users");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [users, setUsers] = useState<SelfHostedTeamUser[]>([]);
  const [profiles, setProfiles] = useState<TeamProfileRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<TeamAuditLog[]>([]);

  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"member" | "admin">("member");
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>(
    {},
  );

  const [profileName, setProfileName] = useState("");
  const [profileEngine, setProfileEngine] = useState<"wayfern" | "cloak">(
    "wayfern",
  );
  const [profileEdits, setProfileEdits] = useState<
    Record<string, ProfileEditState>
  >({});
  const [permissionUserId, setPermissionUserId] = useState<
    Record<string, string>
  >({});
  const [permissionLevel, setPermissionLevel] = useState<
    Record<string, TeamProfilePermissionLevel>
  >({});

  const [auditAction, setAuditAction] = useState("");
  const [auditTargetType, setAuditTargetType] = useState("");
  const [auditTargetId, setAuditTargetId] = useState("");
  const [auditUserId, setAuditUserId] = useState(ALL_USERS);

  const userOptions = useMemo(
    () => users.filter((user) => !user.disabledAt),
    [users],
  );
  const chromiumProfiles = useMemo(
    () =>
      profiles.filter(
        (profile) => profile.engine === "wayfern" || profile.engine === "cloak",
      ),
    [profiles],
  );

  const loadUsers = useCallback(async () => {
    const result = await invoke<SelfHostedTeamUser[]>("team_list_users");
    setUsers(result);
  }, []);

  const loadProfiles = useCallback(async () => {
    const result = await invoke<TeamProfileRecord[]>("team_list_profiles");
    setProfiles(result);
    setProfileEdits(
      Object.fromEntries(
        result.map((profile) => [
          profile.id,
          {
            name: profile.name,
          },
        ]),
      ),
    );
  }, []);

  const loadAuditLogs = useCallback(async () => {
    const result = await invoke<TeamAuditLog[]>("team_list_audit_logs", {
      limit: 200,
      action: auditAction.trim() || null,
      targetType: auditTargetType.trim() || null,
      targetId: auditTargetId.trim() || null,
      userId: auditUserId !== ALL_USERS ? auditUserId : null,
    });
    setAuditLogs(result);
  }, [auditAction, auditTargetId, auditTargetType, auditUserId]);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      await Promise.all([loadUsers(), loadProfiles()]);
      await loadAuditLogs();
    } catch (error) {
      showErrorToast(errorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [loadAuditLogs, loadProfiles, loadUsers]);

  useEffect(() => {
    if (isOpen) {
      void loadAll();
    }
  }, [isOpen, loadAll]);

  const createUser = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!newUserEmail.trim() || !newUserPassword.trim()) return;
    setIsSaving(true);
    try {
      await invoke("team_create_user", {
        input: {
          email: newUserEmail.trim(),
          password: newUserPassword,
          role: newUserRole,
        },
      });
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserRole("member");
      await loadUsers();
      await loadAuditLogs();
      showSuccessToast(t("sync.teamAdmin.toasts.userCreated"));
    } catch (error) {
      showErrorToast(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const updateUser = async (
    user: SelfHostedTeamUser,
    input: { role?: "admin" | "member"; disabled?: boolean; password?: string },
  ) => {
    setIsSaving(true);
    try {
      await invoke("team_update_user", { userId: user.id, input });
      setResetPasswords((prev) => ({ ...prev, [user.id]: "" }));
      await loadUsers();
      await loadAuditLogs();
      showSuccessToast(t("sync.teamAdmin.toasts.userUpdated"));
    } catch (error) {
      showErrorToast(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const createProfile = async () => {
    if (!profileName.trim()) return;
    setIsSaving(true);
    try {
      await invoke("team_create_profile", {
        input: {
          name: profileName.trim(),
          engine: profileEngine,
          botProfileAssetId: null,
          syncMode: "Regular",
        },
      });
      setProfileName("");
      setProfileEngine("wayfern");
      await loadProfiles();
      await loadAuditLogs();
      showSuccessToast(t("sync.teamAdmin.toasts.profileCreated"));
    } catch (error) {
      showErrorToast(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const saveProfile = async (profile: TeamProfileRecord) => {
    const edit = profileEdits[profile.id];
    if (!edit) return;
    setIsSaving(true);
    try {
      await invoke("team_update_profile", {
        profileId: profile.id,
        input: {
          name: edit.name.trim(),
          engine: profile.engine,
          botProfileAssetId: null,
          syncMode: profile.syncMode,
        },
      });
      await loadProfiles();
      await loadAuditLogs();
      showSuccessToast(t("sync.teamAdmin.toasts.profileUpdated"));
    } catch (error) {
      showErrorToast(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const deleteProfile = async (profile: TeamProfileRecord) => {
    if (!window.confirm(t("sync.teamAdmin.profiles.deleteConfirm"))) return;
    setIsSaving(true);
    try {
      await invoke("team_delete_profile", { profileId: profile.id });
      await loadProfiles();
      await loadAuditLogs();
      showSuccessToast(t("sync.teamAdmin.toasts.profileDeleted"));
    } catch (error) {
      showErrorToast(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const unlockProfile = async (profile: TeamProfileRecord) => {
    setIsSaving(true);
    try {
      await invoke("team_unlock_profile", { profileId: profile.id });
      await loadProfiles();
      await loadAuditLogs();
      showSuccessToast(t("sync.teamAdmin.toasts.profileUnlocked"));
    } catch (error) {
      showErrorToast(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const setPermission = async (profile: TeamProfileRecord) => {
    const userId = permissionUserId[profile.id];
    const permission = permissionLevel[profile.id] ?? "editor";
    if (!userId) return;
    setIsSaving(true);
    try {
      await invoke("team_set_profile_permission", {
        profileId: profile.id,
        input: { userId, permission },
      });
      await loadProfiles();
      await loadAuditLogs();
      showSuccessToast(t("sync.teamAdmin.toasts.permissionSaved"));
    } catch (error) {
      showErrorToast(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const deletePermission = async (
    profile: TeamProfileRecord,
    userId: string,
  ) => {
    setIsSaving(true);
    try {
      await invoke("team_delete_profile_permission", {
        profileId: profile.id,
        userId,
      });
      await loadProfiles();
      await loadAuditLogs();
      showSuccessToast(t("sync.teamAdmin.toasts.permissionDeleted"));
    } catch (error) {
      showErrorToast(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[min(calc(100vw-2rem),1280px)] max-w-[min(calc(100vw-2rem),1280px)] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("sync.teamAdmin.title")}</DialogTitle>
          <DialogDescription>
            {t("sync.teamAdmin.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadAll()}
            disabled={isLoading}
          >
            <LuRefreshCw className="mr-2 h-4 w-4" />
            {t("common.buttons.refresh")}
          </Button>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="grid w-full shrink-0 grid-cols-3">
            <TabsTrigger value="users">
              {t("sync.teamAdmin.tabs.users")}
            </TabsTrigger>
            <TabsTrigger value="profiles">
              {t("sync.teamAdmin.tabs.profiles")}
            </TabsTrigger>
            <TabsTrigger value="audit">
              {t("sync.teamAdmin.tabs.audit")}
            </TabsTrigger>
          </TabsList>

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-3">
            <TabsContent value="users" className="mt-0 space-y-4">
              <form
                className="space-y-4 rounded-md border bg-muted/30 p-4"
                onSubmit={(event) => void createUser(event)}
              >
                <div>
                  <h3 className="text-sm font-medium">
                    {t("sync.teamAdmin.users.createTitle")}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("sync.teamAdmin.users.createDescription")}
                  </p>
                </div>
                <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_140px_auto]">
                  <div className="space-y-2">
                    <Label htmlFor="team-admin-new-user-email">
                      {t("sync.email")}
                    </Label>
                    <Input
                      id="team-admin-new-user-email"
                      value={newUserEmail}
                      onChange={(event) => setNewUserEmail(event.target.value)}
                      placeholder={t("sync.teamAdmin.users.emailPlaceholder")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="team-admin-new-user-password">
                      {t("sync.password")}
                    </Label>
                    <Input
                      id="team-admin-new-user-password"
                      type="password"
                      value={newUserPassword}
                      onChange={(event) =>
                        setNewUserPassword(event.target.value)
                      }
                      placeholder={t(
                        "sync.teamAdmin.users.passwordPlaceholder",
                      )}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("sync.team.role")}</Label>
                    <Select
                      value={newUserRole}
                      onValueChange={(value) =>
                        setNewUserRole(value as "member" | "admin")
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">
                          {t("sync.team.roleMember")}
                        </SelectItem>
                        <SelectItem value="admin">
                          {t("sync.team.roleAdmin")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <LoadingButton
                      type="submit"
                      className="w-full lg:w-auto"
                      isLoading={isSaving}
                      disabled={!newUserEmail.trim() || !newUserPassword.trim()}
                    >
                      <LuPlus className="mr-2 h-4 w-4" />
                      {t("sync.teamAdmin.users.create")}
                    </LoadingButton>
                  </div>
                </div>
              </form>

              <div className="space-y-2">
                <h3 className="text-sm font-medium">
                  {t("sync.teamAdmin.users.listTitle")}
                </h3>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[920px] text-sm">
                    <thead className="bg-muted text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">
                          {t("sync.email")}
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          {t("sync.team.role")}
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          {t("common.labels.status")}
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          {t("sync.teamAdmin.users.resetPassword")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("sync.teamAdmin.actions")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={user.id} className="border-t">
                          <td className="px-3 py-2">{user.email}</td>
                          <td className="px-3 py-2">
                            <Select
                              value={user.role}
                              onValueChange={(role) =>
                                void updateUser(user, {
                                  role: role as "member" | "admin",
                                })
                              }
                            >
                              <SelectTrigger className="w-[130px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="member">
                                  {t("sync.team.roleMember")}
                                </SelectItem>
                                <SelectItem value="admin">
                                  {t("sync.team.roleAdmin")}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-2">
                            <Badge
                              variant={
                                user.disabledAt ? "secondary" : "default"
                              }
                            >
                              {user.disabledAt
                                ? t("sync.teamAdmin.users.disabled")
                                : t("sync.teamAdmin.users.active")}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-2">
                              <Input
                                type="password"
                                value={resetPasswords[user.id] ?? ""}
                                onChange={(event) =>
                                  setResetPasswords((prev) => ({
                                    ...prev,
                                    [user.id]: event.target.value,
                                  }))
                                }
                                placeholder={t(
                                  "sync.teamAdmin.users.newPassword",
                                )}
                              />
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!resetPasswords[user.id]}
                                onClick={() =>
                                  void updateUser(user, {
                                    password: resetPasswords[user.id],
                                  })
                                }
                              >
                                <LuSave className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                void updateUser(user, {
                                  disabled: !user.disabledAt,
                                })
                              }
                            >
                              {user.disabledAt
                                ? t("sync.teamAdmin.users.enable")
                                : t("sync.teamAdmin.users.disable")}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="profiles" className="mt-0 space-y-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_180px_auto]">
                <div className="space-y-2">
                  <Label>{t("sync.teamAdmin.profiles.name")}</Label>
                  <Input
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                    placeholder={t("sync.teamAdmin.profiles.namePlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("sync.teamAdmin.profiles.engine")}</Label>
                  <Select
                    value={profileEngine}
                    onValueChange={(value) =>
                      setProfileEngine(value as "wayfern" | "cloak")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="wayfern">
                        {t("sync.teamAdmin.engines.wayfern")}
                      </SelectItem>
                      <SelectItem value="cloak">
                        {t("sync.teamAdmin.engines.cloak")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <LoadingButton
                    className="w-full lg:w-auto"
                    onClick={() => void createProfile()}
                    isLoading={isSaving}
                    disabled={!profileName.trim()}
                  >
                    <LuPlus className="mr-2 h-4 w-4" />
                    {t("sync.teamAdmin.profiles.create")}
                  </LoadingButton>
                </div>
              </div>

              <div className="space-y-3">
                {chromiumProfiles.map((profile) => {
                  const edit = profileEdits[profile.id] ?? {
                    name: profile.name,
                  };
                  return (
                    <div
                      key={profile.id}
                      className="space-y-3 rounded-md border p-3"
                    >
                      <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_auto_auto_auto]">
                        <Input
                          value={edit.name}
                          onChange={(event) =>
                            setProfileEdits((prev) => ({
                              ...prev,
                              [profile.id]: {
                                ...edit,
                                name: event.target.value,
                              },
                            }))
                          }
                        />
                        <Badge variant="secondary" className="self-center">
                          {t(`sync.teamAdmin.engines.${profile.engine}`)}
                        </Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void saveProfile(profile)}
                        >
                          <LuSave className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void deleteProfile(profile)}
                        >
                          <LuTrash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        {profile.lock && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void unlockProfile(profile)}
                          >
                            <LuLockOpen className="mr-2 h-4 w-4" />
                            {t("sync.teamAdmin.profiles.forceUnlock")}
                          </Button>
                        )}
                        {profile.permissions.map((permission) => (
                          <Badge key={permission.id} variant="secondary">
                            {permission.user?.email ?? permission.userId}
                            {" · "}
                            {t(
                              `sync.teamAdmin.permissions.${permission.permission}`,
                            )}
                            <button
                              type="button"
                              className="ml-2 text-muted-foreground hover:text-foreground"
                              onClick={() =>
                                void deletePermission(
                                  profile,
                                  permission.userId,
                                )
                              }
                              aria-label={t(
                                "sync.teamAdmin.permissions.remove",
                              )}
                            >
                              ×
                            </button>
                          </Badge>
                        ))}
                      </div>

                      <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_160px_auto]">
                        <Select
                          value={permissionUserId[profile.id] ?? ""}
                          onValueChange={(value) =>
                            setPermissionUserId((prev) => ({
                              ...prev,
                              [profile.id]: value,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t("sync.teamAdmin.permissions.user")}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {userOptions.map((user) => (
                              <SelectItem key={user.id} value={user.id}>
                                {user.email}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={permissionLevel[profile.id] ?? "editor"}
                          onValueChange={(value) =>
                            setPermissionLevel((prev) => ({
                              ...prev,
                              [profile.id]: value as TeamProfilePermissionLevel,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="owner">
                              {t("sync.teamAdmin.permissions.owner")}
                            </SelectItem>
                            <SelectItem value="editor">
                              {t("sync.teamAdmin.permissions.editor")}
                            </SelectItem>
                            <SelectItem value="viewer">
                              {t("sync.teamAdmin.permissions.viewer")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          className="w-full lg:w-auto"
                          variant="outline"
                          disabled={!permissionUserId[profile.id]}
                          onClick={() => void setPermission(profile)}
                        >
                          {t("sync.teamAdmin.permissions.save")}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="audit" className="mt-0 space-y-4">
              <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                <Input
                  value={auditAction}
                  onChange={(event) => setAuditAction(event.target.value)}
                  placeholder={t("sync.teamAdmin.audit.action")}
                />
                <Input
                  value={auditTargetType}
                  onChange={(event) => setAuditTargetType(event.target.value)}
                  placeholder={t("sync.teamAdmin.audit.targetType")}
                />
                <Input
                  value={auditTargetId}
                  onChange={(event) => setAuditTargetId(event.target.value)}
                  placeholder={t("sync.teamAdmin.audit.targetId")}
                />
                <Select value={auditUserId} onValueChange={setAuditUserId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_USERS}>
                      {t("sync.teamAdmin.audit.allUsers")}
                    </SelectItem>
                    {users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  className="w-full lg:w-auto"
                  variant="outline"
                  onClick={() => void loadAuditLogs()}
                >
                  {t("common.buttons.search")}
                </Button>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">
                        {t("sync.teamAdmin.audit.time")}
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        {t("sync.teamAdmin.audit.user")}
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        {t("sync.teamAdmin.audit.action")}
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        {t("sync.teamAdmin.audit.target")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="border-t">
                        <td className="px-3 py-2 whitespace-nowrap">
                          {formatDateTime(log.createdAt)}
                        </td>
                        <td className="px-3 py-2">
                          {log.user?.email ?? t("common.labels.none")}
                        </td>
                        <td className="px-3 py-2">{log.action}</td>
                        <td className="px-3 py-2">
                          {log.targetType}
                          {log.targetId ? ` · ${log.targetId}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
