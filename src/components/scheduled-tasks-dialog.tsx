"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuPlus, LuTrash2 } from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useFormatDateTime } from "@/lib/datetime";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import type { BrowserProfile } from "@/types";

/**
 * Minimal scheduled-tasks UI. Lets the user say "every N minutes,
 * (launch | sync | snapshot cookies) profile X". Designed as a thin
 * list-create-toggle-delete shell over the four task_scheduler Tauri
 * commands; firing logic lives on the Rust side and is intentionally
 * out of scope here.
 */
type ScheduledAction = "launch_profile" | "sync_profile" | "snapshot_cookies";

interface ScheduledTask {
  id: string;
  name: string;
  action: ScheduledAction;
  target_id: string;
  interval_minutes: number;
  enabled: boolean;
  last_run?: number | null;
  created_at: number;
}

interface ScheduledTasksDialogProps {
  isOpen: boolean;
  onClose: () => void;
  profiles: BrowserProfile[];
}

export function ScheduledTasksDialog({
  isOpen,
  onClose,
  profiles,
}: ScheduledTasksDialogProps) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [name, setName] = useState("");
  const [action, setAction] = useState<ScheduledAction>("sync_profile");
  const [targetId, setTargetId] = useState<string>("");
  const [intervalMinutes, setIntervalMinutes] = useState<number>(60);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const items = await invoke<ScheduledTask[]>("list_scheduled_tasks");
      setTasks(items);
    } catch (err) {
      showErrorToast(
        t("scheduledTasks.errors.listFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!isOpen) return;
    void reload();
    if (profiles.length > 0 && !targetId) {
      setTargetId(profiles[0].id);
    }
  }, [isOpen, reload, profiles, targetId]);

  const handleCreate = useCallback(async () => {
    if (!name.trim() || !targetId) return;
    try {
      await invoke<ScheduledTask>("create_scheduled_task", {
        name: name.trim(),
        action,
        targetId,
        intervalMinutes,
      });
      setName("");
      showSuccessToast(t("scheduledTasks.created"));
      await reload();
    } catch (err) {
      showErrorToast(
        t("scheduledTasks.errors.createFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }, [name, action, targetId, intervalMinutes, reload, t]);

  const handleDelete = useCallback(
    async (taskId: string) => {
      if (!window.confirm(t("scheduledTasks.confirmDelete"))) return;
      try {
        await invoke<boolean>("delete_scheduled_task", { taskId });
        await reload();
      } catch (err) {
        showErrorToast(
          t("scheduledTasks.errors.deleteFailed", {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    },
    [reload, t],
  );

  const handleToggle = useCallback(
    async (taskId: string, enabled: boolean) => {
      try {
        await invoke<boolean>("set_scheduled_task_enabled", {
          taskId,
          enabled,
        });
        await reload();
      } catch (err) {
        showErrorToast(
          t("scheduledTasks.errors.toggleFailed", {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    },
    [reload, t],
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("scheduledTasks.title")}</DialogTitle>
          <DialogDescription>
            {t("scheduledTasks.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">{t("scheduledTasks.createNew")}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <Label className="text-xs">{t("scheduledTasks.name")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("scheduledTasks.namePlaceholder")}
              />
            </div>
            <div>
              <Label className="text-xs">{t("scheduledTasks.profile")}</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("scheduledTasks.pickProfile")} />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("scheduledTasks.action")}</Label>
              <Select
                value={action}
                onValueChange={(v) => setAction(v as ScheduledAction)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sync_profile">
                    {t("scheduledTasks.actions.syncProfile")}
                  </SelectItem>
                  <SelectItem value="launch_profile">
                    {t("scheduledTasks.actions.launchProfile")}
                  </SelectItem>
                  <SelectItem value="snapshot_cookies">
                    {t("scheduledTasks.actions.snapshotCookies")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">
                {t("scheduledTasks.intervalMinutes")}
              </Label>
              <Input
                type="number"
                min={1}
                max={10080}
                value={intervalMinutes}
                onChange={(e) =>
                  setIntervalMinutes(Math.max(1, Number(e.target.value) || 1))
                }
              />
            </div>
            <div className="col-span-2">
              <Button
                type="button"
                onClick={() => void handleCreate()}
                disabled={!name.trim() || !targetId}
                className="gap-1 w-full"
              >
                <LuPlus className="w-4 h-4" />
                {t("scheduledTasks.create")}
              </Button>
            </div>
          </div>
        </div>

        <div className="border rounded-md max-h-[40vh] overflow-y-auto">
          {isLoading && (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("common.labels.loading")}
            </p>
          )}
          {!isLoading && tasks.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("scheduledTasks.empty")}
            </p>
          )}
          {!isLoading &&
            tasks.map((task) => {
              const profileName =
                profiles.find((p) => p.id === task.target_id)?.name ??
                task.target_id;
              return (
                <div
                  key={task.id}
                  className="flex items-center justify-between gap-2 border-b p-2 last:border-b-0"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Checkbox
                      checked={task.enabled}
                      onCheckedChange={(c) => void handleToggle(task.id, !!c)}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {task.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        <Badge variant="secondary" className="mr-1 text-[10px]">
                          {task.action}
                        </Badge>
                        {profileName} ·{" "}
                        {t("scheduledTasks.everyN", {
                          minutes: task.interval_minutes,
                        })}
                        {task.last_run
                          ? ` · ${t("scheduledTasks.lastRun", {
                              time: formatDateTime(task.last_run * 1000),
                            })}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => void handleDelete(task.id)}
                    aria-label={t("scheduledTasks.deleteAria")}
                  >
                    <LuTrash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              );
            })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
