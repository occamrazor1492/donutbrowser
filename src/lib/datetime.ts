"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";

/**
 * Locale-aware datetime formatting.
 *
 * Previously the app called `new Date(...).toLocaleString()` without passing
 * the locale, which means dates were rendered in the OS locale regardless
 * of which language the user picked inside the app. A French user on an
 * English macOS would see "5/24/2026, 1:14 PM" instead of "24/05/2026 13:14"
 * — surprising, hard to scan, and inconsistent with every other piece of
 * UI in the same dialog.
 *
 * `formatDateTime` is the pure helper (testable, no React) and
 * `useFormatDateTime` is the bound hook that pulls the language from
 * i18next so callers don't have to wire it through.
 *
 * Locale mapping: we only ship 7 languages and i18next uses ISO 639-1 codes
 * for them. `Intl.DateTimeFormat` accepts BCP-47, which is the same for
 * single-tag codes — so we can pass the i18next `language` straight through.
 * For an unknown / "system" value we fall back to `undefined` which makes
 * `Intl` use the browser default (same as the old behaviour).
 */
export type DateInput = Date | number | string;

export interface DateTimeFormatOptions {
  dateStyle?: Intl.DateTimeFormatOptions["dateStyle"];
  timeStyle?: Intl.DateTimeFormatOptions["timeStyle"];
}

function normaliseLanguage(lang: string | undefined): string | undefined {
  if (!lang || lang === "system") return undefined;
  // Strip region subtag we don't ship (e.g. "en-US" → "en") so a stray region
  // tag doesn't fall back to a less-specific Intl bundle.
  return lang.split("-")[0];
}

function toDate(input: DateInput): Date {
  if (input instanceof Date) return input;
  return new Date(input);
}

export function formatDateTime(
  input: DateInput,
  language: string | undefined,
  options: DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" },
): string {
  const date = toDate(input);
  if (Number.isNaN(date.getTime())) {
    // Preserve the old behaviour: invalid dates render as a literal empty
    // string rather than throwing or showing "Invalid Date".
    return "";
  }
  try {
    return new Intl.DateTimeFormat(normaliseLanguage(language), options).format(
      date,
    );
  } catch {
    // Intl can throw on truly garbage input (e.g. malformed locale). Fall
    // back to the platform default rather than letting the UI crash.
    return date.toLocaleString();
  }
}

/**
 * React hook: returns a stable `format(date, options?)` callback bound to
 * the current i18next language. Re-renders automatically when the user
 * changes the in-app language.
 */
export function useFormatDateTime(): (
  input: DateInput,
  options?: DateTimeFormatOptions,
) => string {
  const { i18n } = useTranslation();
  return useCallback(
    (input, options) => formatDateTime(input, i18n.language, options),
    [i18n.language],
  );
}
