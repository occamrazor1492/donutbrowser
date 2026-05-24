"use client";

import { useTranslation } from "react-i18next";
import { FaChrome, FaFirefox } from "react-icons/fa";
import { LuPuzzle } from "react-icons/lu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type IconSize = "sm" | "md";

interface ExtensionIconProps {
  iconDataUri?: string;
  size?: IconSize;
}

export function ExtensionIcon({
  iconDataUri,
  size = "md",
}: ExtensionIconProps) {
  const sizeClass = size === "sm" ? "w-4 h-4" : "w-5 h-5";
  if (iconDataUri) {
    return (
      // biome-ignore lint/performance/noImgElement: base64 data URI icons cannot use next/image
      <img
        src={iconDataUri}
        alt=""
        className={`${sizeClass} shrink-0 rounded-sm`}
      />
    );
  }
  return <LuPuzzle className={`${sizeClass} shrink-0 text-muted-foreground`} />;
}

interface CompatIconsProps {
  compatibility: string[];
}

export function CompatIcons({ compatibility }: CompatIconsProps) {
  const { t } = useTranslation();
  const hasChromium = compatibility.includes("chromium");
  const hasFirefox = compatibility.includes("firefox");
  if (!hasChromium && !hasFirefox) return null;
  return (
    <div className="flex items-center gap-1 shrink-0">
      {hasChromium && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <FaChrome className="w-3.5 h-3.5 text-muted-foreground" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {t("extensions.compatibility.chromium")}
          </TooltipContent>
        </Tooltip>
      )}
      {hasFirefox && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <FaFirefox className="w-3.5 h-3.5 text-muted-foreground" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {t("extensions.compatibility.firefox")}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
