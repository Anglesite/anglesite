import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function readConfigFromString(content: string, key: string): string | undefined {
  const safeKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content.match(new RegExp(`^${safeKey}=(.+)$`, "m"))?.[1]?.trim();
}

const _defaultConfigPath = resolve(process.cwd(), ".site-config");
let _cache: Record<string, string> | null = null;

function loadDefaultConfig(): Record<string, string> {
  if (_cache !== null) return _cache;
  const result: Record<string, string> = {};
  if (existsSync(_defaultConfigPath)) {
    const content = readFileSync(_defaultConfigPath, "utf-8");
    for (const line of content.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) {
        const k = line.slice(0, eq).trim();
        const v = line.slice(eq + 1).trim();
        if (k) result[k] = v;
      }
    }
  }
  _cache = result;
  return _cache;
}

export function readConfig(
  key: string,
  configPath?: string,
): string | undefined {
  if (configPath !== undefined && configPath !== _defaultConfigPath) {
    if (!existsSync(configPath)) return undefined;
    return readConfigFromString(readFileSync(configPath, "utf-8"), key);
  }
  return loadDefaultConfig()[key];
}

/** Applies the "en" fallback used by {@link siteLang}; split out so the default is unit-testable
 * without touching disk. */
export function resolveLang(value: string | undefined): string {
  return value?.trim() || "en";
}

/**
 * The site's BCP 47 language tag for `<html lang>` (WCAG 2.2 SC 3.1.1). Falls back to "en" for a
 * site scaffolded before this key existed, or with `LANG` cleared by hand.
 */
export function siteLang(): string {
  return resolveLang(readConfig("LANG"));
}

// Config values are free-form strings, but the booking/donation widgets accept a
// closed set of provider literals. These narrow at runtime so an unrecognized
// `.site-config` value (e.g. a typo) becomes `undefined` — which the widgets
// render as "nothing" — instead of being cast straight through and silently
// mismatching the widget's expected provider.

export type BookingProvider = "cal" | "calendly";
export type DonationsProvider = "stripe" | "liberapay" | "github-sponsors";
export type ContactProvider = "formspree" | "mailto";
export type TrackingProvider = "plausible" | "fathom" | "ga4";
export type PodcastProvider = "spotify" | "transistor";
export type BuyButtonProvider = "stripe" | "polar";

export function asBookingProvider(
  value: string | undefined,
): BookingProvider | undefined {
  return value === "cal" || value === "calendly" ? value : undefined;
}

export function asDonationsProvider(
  value: string | undefined,
): DonationsProvider | undefined {
  return value === "stripe" || value === "liberapay" || value === "github-sponsors"
    ? value
    : undefined;
}

export function asContactProvider(
  value: string | undefined,
): ContactProvider | undefined {
  return value === "formspree" || value === "mailto" ? value : undefined;
}

export function asTrackingProvider(
  value: string | undefined,
): TrackingProvider | undefined {
  return value === "plausible" || value === "fathom" || value === "ga4" ? value : undefined;
}

export function asPodcastProvider(
  value: string | undefined,
): PodcastProvider | undefined {
  return value === "spotify" || value === "transistor" ? value : undefined;
}

export function asBuyButtonProvider(
  value: string | undefined,
): BuyButtonProvider | undefined {
  return value === "stripe" || value === "polar" ? value : undefined;
}
