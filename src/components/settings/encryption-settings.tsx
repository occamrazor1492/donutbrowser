"use client";

import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadingButton } from "@/components/loading-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";

interface EncryptionSettingsProps {
  hasE2ePassword: boolean;
  onHasE2ePasswordChange: (next: boolean) => void;
}

/**
 * Sync end-to-end encryption controls — set a new password, change it, or
 * remove it. Owns its own draft password / confirm / error / saving state;
 * notifies the parent only when the persisted flag flips.
 */
export function EncryptionSettings({
  hasE2ePassword,
  onHasE2ePasswordChange,
}: EncryptionSettingsProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSetPassword = async () => {
    if (password.length < 8) {
      setError(t("settings.encryption.passwordTooShort"));
      return;
    }
    if (password !== passwordConfirm) {
      setError(t("settings.encryption.passwordMismatch"));
      return;
    }
    setIsSaving(true);
    try {
      await invoke("set_e2e_password", { password });
      onHasE2ePasswordChange(true);
      setPassword("");
      setPasswordConfirm("");
      showSuccessToast(t("settings.encryption.passwordSaved"));
    } catch (err) {
      showErrorToast(String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = () => {
    onHasE2ePasswordChange(false);
    setPassword("");
    setPasswordConfirm("");
    setError("");
  };

  const handleRemovePassword = async () => {
    try {
      await invoke("delete_e2e_password");
      onHasE2ePasswordChange(false);
      showSuccessToast(t("settings.encryption.removed"));
    } catch (err) {
      showErrorToast(String(err));
    }
  };

  return (
    <div className="space-y-4">
      <Label className="text-base font-medium">
        {t("settings.encryption.title")}
      </Label>
      <p className="text-xs text-muted-foreground">
        {t("settings.encryption.description")}
      </p>

      {hasE2ePassword ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="default">
              {t("settings.encryption.passwordSet")}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {t("settings.encryption.passwordSetDescription")}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleChangePassword}>
              {t("settings.encryption.changePassword")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                void handleRemovePassword();
              }}
            >
              {t("settings.encryption.removePassword")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Input
            type="password"
            placeholder={t("settings.encryption.passwordPlaceholder")}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
          />
          <Input
            type="password"
            placeholder={t("settings.encryption.confirmPlaceholder")}
            value={passwordConfirm}
            onChange={(e) => {
              setPasswordConfirm(e.target.value);
              setError("");
            }}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <LoadingButton
            variant="default"
            size="sm"
            isLoading={isSaving}
            onClick={() => {
              void handleSetPassword();
            }}
          >
            {t("settings.encryption.setPassword")}
          </LoadingButton>
        </div>
      )}
    </div>
  );
}
