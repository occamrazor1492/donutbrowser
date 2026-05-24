"use client";

import Color from "color";
import { useTranslation } from "react-i18next";
import {
  ColorPicker,
  ColorPickerAlpha,
  ColorPickerEyeDropper,
  ColorPickerFormat,
  ColorPickerHue,
  ColorPickerOutput,
  ColorPickerSelection,
} from "@/components/ui/color-picker";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getThemeByColors,
  getThemeById,
  THEME_VARIABLES,
  THEMES,
} from "@/lib/themes";

export interface CustomThemeState {
  selectedThemeId: string | null;
  colors: Record<string, string>;
}

interface SupportedLanguage {
  code: string;
  name: string;
  nativeName: string;
}

interface AppearanceSettingsProps {
  theme: string;
  onThemeChange: (theme: string) => void;
  customThemeState: CustomThemeState;
  onCustomThemeStateChange: (next: CustomThemeState) => void;
  selectedLanguage: string | null;
  onSelectedLanguageChange: (language: string) => void;
  supportedLanguages: readonly SupportedLanguage[];
  isLanguageLoading: boolean;
}

/**
 * Visual settings group — theme picker (with custom color editor) and
 * interface language. All state is owned by the parent dialog; this component
 * is presentational.
 */
export function AppearanceSettings({
  theme,
  onThemeChange,
  customThemeState,
  onCustomThemeStateChange,
  selectedLanguage,
  onSelectedLanguageChange,
  supportedLanguages,
  isLanguageLoading,
}: AppearanceSettingsProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="space-y-4">
        <Label className="text-base font-medium">
          {t("settings.appearance.title")}
        </Label>

        <div className="grid gap-2">
          <Label htmlFor="theme-select" className="text-sm">
            {t("settings.appearance.theme")}
          </Label>
          <Select
            value={theme}
            onValueChange={(value) => {
              onThemeChange(value);
              if (value === "custom") {
                const tokyoNightTheme = getThemeById("tokyo-night");
                if (tokyoNightTheme) {
                  onCustomThemeStateChange({
                    selectedThemeId: "tokyo-night",
                    colors: tokyoNightTheme.colors,
                  });
                }
              }
            }}
          >
            <SelectTrigger id="theme-select">
              <SelectValue placeholder={t("settings.appearance.selectTheme")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">
                {t("settings.appearance.light")}
              </SelectItem>
              <SelectItem value="dark">
                {t("settings.appearance.dark")}
              </SelectItem>
              <SelectItem value="system">
                {t("settings.appearance.system")}
              </SelectItem>
              <SelectItem value="custom">
                {t("common.labels.custom")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <p className="text-xs text-muted-foreground">
          {t("settings.appearance.themeDescription")}
        </p>

        {theme === "custom" && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label
                htmlFor="theme-preset-select"
                className="text-sm font-medium"
              >
                {t("settings.appearance.themePreset")}
              </Label>
              <Select
                value={customThemeState.selectedThemeId ?? "custom"}
                onValueChange={(value) => {
                  if (value === "custom") {
                    onCustomThemeStateChange({
                      ...customThemeState,
                      selectedThemeId: null,
                    });
                  } else {
                    const preset = getThemeById(value);
                    if (preset) {
                      onCustomThemeStateChange({
                        selectedThemeId: value,
                        colors: preset.colors,
                      });
                    }
                  }
                }}
              >
                <SelectTrigger id="theme-preset-select">
                  <SelectValue
                    placeholder={t("settings.appearance.selectThemePreset")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {THEMES.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">
                    {t("settings.appearance.yourOwn")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="text-sm font-medium">
              {t("settings.appearance.customColors")}
            </div>
            <div className="grid grid-cols-4 gap-3">
              {THEME_VARIABLES.map(({ key, label }) => {
                const colorValue = customThemeState.colors[key] ?? "#000000";
                return (
                  <div key={key} className="flex flex-col gap-1 items-center">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label={label}
                          className="w-8 h-8 rounded-md border shadow-sm cursor-pointer"
                          style={{ backgroundColor: colorValue }}
                        />
                      </PopoverTrigger>
                      <PopoverContent className="w-[320px] p-3" sideOffset={6}>
                        <ColorPicker
                          className="p-3 rounded-md border shadow-sm bg-background"
                          value={colorValue}
                          onColorChange={([r, g, b, a]) => {
                            const next = Color({ r, g, b }).alpha(a);
                            const nextStr = next.hexa();
                            const newColors = {
                              ...customThemeState.colors,
                              [key]: nextStr,
                            };

                            const matchingTheme = getThemeByColors(newColors);

                            onCustomThemeStateChange({
                              selectedThemeId: matchingTheme?.id ?? null,
                              colors: newColors,
                            });
                          }}
                        >
                          <ColorPickerSelection className="h-36 rounded" />
                          <div className="flex gap-3 items-center mt-3">
                            <ColorPickerEyeDropper />
                            <div className="grid gap-1 w-full">
                              <ColorPickerHue />
                              <ColorPickerAlpha />
                            </div>
                          </div>
                          <div className="flex gap-2 items-center mt-3">
                            <ColorPickerOutput />
                            <ColorPickerFormat />
                          </div>
                        </ColorPicker>
                      </PopoverContent>
                    </Popover>
                    <div className="text-[10px] text-muted-foreground text-center leading-tight">
                      {label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <Label className="text-base font-medium">
          {t("settings.language.title")}
        </Label>

        <div className="grid gap-2">
          <Label htmlFor="language-select" className="text-sm">
            {t("settings.language.interface")}
          </Label>
          <Select
            value={selectedLanguage ?? "system"}
            onValueChange={(value) => {
              onSelectedLanguageChange(value);
            }}
            disabled={isLanguageLoading}
          >
            <SelectTrigger id="language-select">
              <SelectValue
                placeholder={t("settings.language.selectLanguage")}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">
                {t("settings.language.systemDefault")}
              </SelectItem>
              {supportedLanguages.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  {lang.nativeName} ({lang.name})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="text-xs text-muted-foreground">
          {t("settings.language.description")}
        </p>
      </div>
    </>
  );
}
