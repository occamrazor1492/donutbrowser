"use client";

import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { RippleButton } from "@/components/ui/ripple";

interface DnsBlocklistSettingsProps {
  onManage: () => void;
}

/**
 * Entry-point row for the DNS blocklist management dialog. The dialog itself
 * is rendered by the parent so it can be opened from elsewhere too.
 */
export function DnsBlocklistSettings({ onManage }: DnsBlocklistSettingsProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <Label className="text-base font-medium">{t("dnsBlocklist.title")}</Label>
      <p className="text-xs text-muted-foreground">
        {t("dnsBlocklist.settingsDescription")}
      </p>
      <RippleButton variant="outline" className="w-full" onClick={onManage}>
        {t("dnsBlocklist.manageLists")}
      </RippleButton>
    </div>
  );
}
