"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BrowserProfile } from "@/types";

/**
 * Profile diff tool — pick two profiles and render their differing fields
 * side-by-side. Intentionally read-only: a "set A's value to B's" edit
 * action would need to know which fields are safe to copy across engines,
 * which is a much bigger design discussion. The audience here is
 * fingerprint-tuning users debugging "why does profile A work and B
 * doesn't" — they just need the differences laid out.
 *
 * The comparator is pure (`diffProfileFields`) so it's testable from Node
 * without a DOM, and so anyone reading the file can audit which fields
 * count as "identity" (skipped) vs "user-configurable" (diffed).
 */
export interface FieldDiff {
  key: string;
  /** Display label key in i18n; `null` means use the raw key as label. */
  label: string;
  left: string;
  right: string;
}

// Identity-y / runtime fields that we never report as a diff — comparing
// process_id or last_launch between two profiles is noise, not signal.
const IGNORED_KEYS = new Set<string>([
  "id",
  "name",
  "process_id",
  "last_launch",
  "last_sync",
  "created_by_id",
  "created_by_email",
  "encryption_salt",
  "group_id",
]);

function fieldToString(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value
      .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
      .join(", ");
  }
  return JSON.stringify(value, null, 2);
}

/**
 * Compute the diff between two profiles. Walks the union of their keys
 * (so a field present on only one side still surfaces) and skips
 * `IGNORED_KEYS`. Sorted by key for stable rendering.
 *
 * Pure: no React, no DOM. Tested via the React component's behaviour for
 * now; promote to a vitest spec once the project has a frontend test
 * harness.
 */
export function diffProfileFields(
  a: BrowserProfile,
  b: BrowserProfile,
): FieldDiff[] {
  const aRecord = a as unknown as Record<string, unknown>;
  const bRecord = b as unknown as Record<string, unknown>;
  const keys = new Set<string>([
    ...Object.keys(aRecord),
    ...Object.keys(bRecord),
  ]);
  const diffs: FieldDiff[] = [];
  for (const key of Array.from(keys).sort()) {
    if (IGNORED_KEYS.has(key)) continue;
    const left = aRecord[key];
    const right = bRecord[key];
    const ls = fieldToString(left);
    const rs = fieldToString(right);
    if (ls !== rs) {
      diffs.push({ key, label: key, left: ls, right: rs });
    }
  }
  return diffs;
}

interface ProfileCompareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  profiles: BrowserProfile[];
  /** Optional pre-selected ids to skip the picker step. */
  initialLeftId?: string | null;
  initialRightId?: string | null;
}

export function ProfileCompareDialog({
  isOpen,
  onClose,
  profiles,
  initialLeftId,
  initialRightId,
}: ProfileCompareDialogProps) {
  const { t } = useTranslation();
  const [leftId, setLeftId] = React.useState<string | null>(
    initialLeftId ?? null,
  );
  const [rightId, setRightId] = React.useState<string | null>(
    initialRightId ?? null,
  );

  React.useEffect(() => {
    if (!isOpen) return;
    setLeftId(initialLeftId ?? null);
    setRightId(initialRightId ?? null);
  }, [isOpen, initialLeftId, initialRightId]);

  const left = profiles.find((p) => p.id === leftId);
  const right = profiles.find((p) => p.id === rightId);
  const diffs = React.useMemo(() => {
    if (!left || !right || left.id === right.id) return [];
    return diffProfileFields(left, right);
  }, [left, right]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("profileCompare.title")}</DialogTitle>
          <DialogDescription>
            {t("profileCompare.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1 block">
              {t("profileCompare.profileA")}
            </p>
            <Select value={leftId ?? undefined} onValueChange={setLeftId}>
              <SelectTrigger>
                <SelectValue placeholder={t("profileCompare.pickProfile")} />
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
            <p className="text-xs text-muted-foreground mb-1 block">
              {t("profileCompare.profileB")}
            </p>
            <Select value={rightId ?? undefined} onValueChange={setRightId}>
              <SelectTrigger>
                <SelectValue placeholder={t("profileCompare.pickProfile")} />
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
        </div>

        <div className="border rounded-md max-h-[55vh] overflow-y-auto">
          {(!left || !right) && (
            <p className="text-sm text-muted-foreground text-center py-8">
              {t("profileCompare.pickBoth")}
            </p>
          )}
          {left && right && left.id === right.id && (
            <p className="text-sm text-muted-foreground text-center py-8">
              {t("profileCompare.sameProfile")}
            </p>
          )}
          {left && right && left.id !== right.id && diffs.length === 0 && (
            <p className="text-sm text-success text-center py-8">
              {t("profileCompare.identical")}
            </p>
          )}
          {left && right && left.id !== right.id && diffs.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium w-1/4">
                    {t("profileCompare.field")}
                  </th>
                  <th className="px-3 py-2 text-left font-medium w-3/8">
                    {left.name}
                  </th>
                  <th className="px-3 py-2 text-left font-medium w-3/8">
                    {right.name}
                  </th>
                </tr>
              </thead>
              <tbody>
                {diffs.map((d) => (
                  <tr key={d.key} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs align-top">
                      {d.label}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <pre className="text-xs whitespace-pre-wrap break-words">
                        {d.left}
                      </pre>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <pre className="text-xs whitespace-pre-wrap break-words">
                        {d.right}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {left && right && left.id !== right.id && diffs.length > 0 && (
          <div className="flex justify-end">
            <Badge variant="secondary" className="text-xs">
              {t("profileCompare.diffCount", { count: diffs.length })}
            </Badge>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
