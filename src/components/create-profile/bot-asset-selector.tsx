"use client";

import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SelfHostedAuthState, TeamBotProfileAsset } from "@/types";

interface BotAssetSelectorProps {
  selfHostedUser: SelfHostedAuthState["user"] | null;
  botProfileAssets: TeamBotProfileAsset[];
  selectedBotProfileAssetId: string;
  onSelectedBotProfileAssetIdChange: (value: string) => void;
  botProfilePath: string;
  onBotProfilePathChange: (value: string) => void;
  botExecutablePath: string;
  onBotExecutablePathChange: (value: string) => void;
}

/**
 * BotBrowser engine configuration block: shared team .enc template picker,
 * local override path, and optional executable path. Shown when the user picks
 * the BotBrowser engine in the create-profile dialog.
 */
export function BotAssetSelector({
  selfHostedUser,
  botProfileAssets,
  selectedBotProfileAssetId,
  onSelectedBotProfileAssetIdChange,
  botProfilePath,
  onBotProfilePathChange,
  botExecutablePath,
  onBotExecutablePathChange,
}: BotAssetSelectorProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {!selfHostedUser && (
        <Alert className="border-warning/50 bg-warning/10">
          <AlertDescription className="text-sm">
            {t("createProfile.botbrowser.loginRequired")}
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label>{t("createProfile.botbrowser.template")}</Label>
        <Select
          value={selectedBotProfileAssetId}
          onValueChange={onSelectedBotProfileAssetIdChange}
          disabled={!selfHostedUser}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={t("createProfile.botbrowser.templatePlaceholder")}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">
              {t("profileInfo.values.none")}
            </SelectItem>
            {botProfileAssets.map((asset) => (
              <SelectItem key={asset.id} value={asset.id}>
                {asset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t("createProfile.botbrowser.templateHint")}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="bot-profile-path">
          {t("createProfile.botbrowser.localEncPath")}
        </Label>
        <Input
          id="bot-profile-path"
          value={botProfilePath}
          onChange={(event) => {
            onBotProfilePathChange(event.target.value);
          }}
          placeholder={t("createProfile.botbrowser.localEncPathPlaceholder")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="bot-executable-path">
          {t("createProfile.botbrowser.executablePath")}
        </Label>
        <Input
          id="bot-executable-path"
          value={botExecutablePath}
          onChange={(event) => {
            onBotExecutablePathChange(event.target.value);
          }}
          placeholder={t("createProfile.botbrowser.executablePathPlaceholder")}
        />
      </div>
    </div>
  );
}
