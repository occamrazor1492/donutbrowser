"use client";

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { getBrowserIcon } from "@/lib/browser-utils";
import type { BrowserTypeString } from "@/types";

interface BrowserOption {
  value: BrowserTypeString;
  labelKey: string;
}

interface BrowserSelectionStepProps {
  regularBrowsers: BrowserOption[];
  onSelect: (browser: BrowserTypeString) => void;
}

interface EngineCardProps {
  iconKey: BrowserTypeString;
  title: string;
  subtitle: string;
  caption: string;
  onClick: () => void;
}

function EngineCard({
  iconKey,
  title,
  subtitle,
  caption,
  onClick,
}: EngineCardProps) {
  const IconComponent = getBrowserIcon(iconKey);
  return (
    <Button
      onClick={onClick}
      className="flex min-h-20 w-full items-start justify-start gap-3 border-2 p-4 text-left transition-colors hover:border-primary/50"
      variant="outline"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center">
        {IconComponent ? <IconComponent className="w-6 h-6" /> : null}
      </div>
      <div className="space-y-1">
        <div className="font-medium">{title}</div>
        <div className="text-sm text-muted-foreground">{subtitle}</div>
        <div className="text-xs text-muted-foreground">{caption}</div>
      </div>
    </Button>
  );
}

/**
 * First step of the create-profile dialog: pick an engine. Renders two tab
 * panels (anti-detect engines and regular browsers); the parent owns which
 * tab is active.
 */
export function BrowserSelectionStep({
  regularBrowsers,
  onSelect,
}: BrowserSelectionStepProps) {
  const { t } = useTranslation();

  return (
    <>
      <TabsContent value="anti-detect" className="mt-0 space-y-6">
        <div className="space-y-3 pt-8">
          <EngineCard
            iconKey="wayfern"
            title={t("createProfile.chromiumLabel")}
            subtitle={t("createProfile.chromiumSubtitle")}
            caption={t("createProfile.chromiumTeamSharing")}
            onClick={() => {
              onSelect("wayfern");
            }}
          />
          <EngineCard
            iconKey="wayfern"
            title={t("createProfile.cloak.label")}
            subtitle={t("createProfile.cloak.subtitle")}
            caption={t("createProfile.cloak.teamSharing")}
            onClick={() => {
              onSelect("cloak");
            }}
          />
          <EngineCard
            iconKey="camoufox"
            title={t("createProfile.firefoxLabel")}
            subtitle={t("createProfile.firefoxSubtitle")}
            caption={t("createProfile.firefoxTeamSharingUnavailable")}
            onClick={() => {
              onSelect("camoufox");
            }}
          />
        </div>
      </TabsContent>

      <TabsContent value="regular" className="mt-0 space-y-6">
        <div className="space-y-6">
          <div className="text-center">
            <h3 className="text-lg font-medium">
              {t("createProfile.regular.title")}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("createProfile.regular.description")}
            </p>
          </div>

          <div className="space-y-3">
            {regularBrowsers.map((browser) => {
              // Skip camoufox as it's handled in anti-detect tab
              if (browser.value === "camoufox") return null;
              const IconComponent = getBrowserIcon(browser.value);
              return (
                <Button
                  key={browser.value}
                  onClick={() => {
                    onSelect(browser.value);
                  }}
                  className="flex gap-3 justify-start items-center p-4 w-full h-16 border-2 transition-colors hover:border-primary/50"
                  variant="outline"
                >
                  <div className="flex justify-center items-center w-8 h-8">
                    {IconComponent && <IconComponent className="w-6 h-6" />}
                  </div>
                  <div className="text-left">
                    <div className="font-medium">{t(browser.labelKey)}</div>
                    <div className="text-sm text-muted-foreground">
                      {t("createProfile.regular.badge")}
                    </div>
                  </div>
                </Button>
              );
            })}
          </div>
        </div>
      </TabsContent>
    </>
  );
}
