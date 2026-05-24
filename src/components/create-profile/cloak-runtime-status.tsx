"use client";

import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface CloakRuntimeStatusValue {
  available: boolean;
  executablePath?: string | null;
  platform: string;
  version?: string | null;
  message: string;
}

export interface CloakConfigFields {
  executablePath: string;
  fingerprintSeed: string;
  locale: string;
  timezone: string;
  languages: string;
  extraArgs: string;
}

interface CloakRuntimeStatusProps {
  runtime: CloakRuntimeStatusValue | null;
  isLoadingRuntime: boolean;
  fields: CloakConfigFields;
  onFieldChange: (field: keyof CloakConfigFields, value: string) => void;
}

/**
 * Cloak (Chromium) engine configuration block: runtime availability prompt
 * (checking / available / missing / unknown) plus the Cloak-specific overrides
 * (executable path, fingerprint seed, locale, timezone, languages, extra args).
 *
 * Lifted verbatim from the inline JSX inside CreateProfileDialog — no behavior
 * changes, callers manage state via `fields` + `onFieldChange`.
 */
export function CloakRuntimeStatus({
  runtime,
  isLoadingRuntime,
  fields,
  onFieldChange,
}: CloakRuntimeStatusProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <Alert>
        <AlertDescription className="text-sm">
          {t("createProfile.cloak.runtimeHint")}
        </AlertDescription>
      </Alert>

      <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
        {isLoadingRuntime
          ? t("createProfile.cloak.runtimeChecking")
          : runtime?.available
            ? t("createProfile.cloak.runtimeAvailable", {
                platform: runtime.platform,
              })
            : runtime
              ? t("createProfile.cloak.runtimeMissing", {
                  platform: runtime.platform,
                })
              : t("createProfile.cloak.runtimeUnknown")}
        {runtime?.executablePath && (
          <div className="mt-1 break-all font-mono text-xs">
            {runtime.executablePath}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="cloak-executable-path">
          {t("createProfile.cloak.executablePath")}
        </Label>
        <Input
          id="cloak-executable-path"
          value={fields.executablePath}
          onChange={(event) => {
            onFieldChange("executablePath", event.target.value);
          }}
          placeholder={t("createProfile.cloak.executablePathPlaceholder")}
        />
        <p className="text-xs text-muted-foreground">
          {t("createProfile.cloak.executablePathHint")}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="cloak-fingerprint-seed">
            {t("createProfile.cloak.fingerprintSeed")}
          </Label>
          <Input
            id="cloak-fingerprint-seed"
            inputMode="numeric"
            value={fields.fingerprintSeed}
            onChange={(event) => {
              onFieldChange("fingerprintSeed", event.target.value);
            }}
            placeholder={t("createProfile.cloak.fingerprintSeedPlaceholder")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cloak-locale">
            {t("createProfile.cloak.locale")}
          </Label>
          <Input
            id="cloak-locale"
            value={fields.locale}
            onChange={(event) => {
              onFieldChange("locale", event.target.value);
            }}
            placeholder={t("createProfile.cloak.localePlaceholder")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cloak-timezone">
            {t("createProfile.cloak.timezone")}
          </Label>
          <Input
            id="cloak-timezone"
            value={fields.timezone}
            onChange={(event) => {
              onFieldChange("timezone", event.target.value);
            }}
            placeholder={t("createProfile.cloak.timezonePlaceholder")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cloak-languages">
            {t("createProfile.cloak.languages")}
          </Label>
          <Input
            id="cloak-languages"
            value={fields.languages}
            onChange={(event) => {
              onFieldChange("languages", event.target.value);
            }}
            placeholder={t("createProfile.cloak.languagesPlaceholder")}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="cloak-extra-args">
          {t("createProfile.cloak.extraArgs")}
        </Label>
        <Input
          id="cloak-extra-args"
          value={fields.extraArgs}
          onChange={(event) => {
            onFieldChange("extraArgs", event.target.value);
          }}
          placeholder={t("createProfile.cloak.extraArgsPlaceholder")}
        />
      </div>
    </div>
  );
}
