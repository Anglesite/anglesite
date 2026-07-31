import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface AnglesiteDomainConfig {
  hostname?: string;
  choice?: string;
  attach?: boolean;
}

export interface AnglesiteDNSRecord {
  type: string;
  name: string;
  content: string;
  priority?: number;
  purpose?: string;
}

export interface AnglesiteDNSConfig {
  managedRecords?: AnglesiteDNSRecord[];
}

export interface AnglesiteHSTSConfig {
  maxAge?: number;
  includeSubdomains?: boolean;
  preload?: boolean;
}

export interface AnglesiteWAFRule {
  description: string;
  expression: string;
  action: string;
}

export interface AnglesiteCloudflareEdgeConfig {
  botFightMode?: boolean;
  wafRules?: AnglesiteWAFRule[];
}

export interface AnglesiteEdgeConfig {
  dnssec?: boolean;
  alwaysUseHTTPS?: boolean;
  hsts?: AnglesiteHSTSConfig;
  cloudflare?: AnglesiteCloudflareEdgeConfig;
}

export interface AnglesiteEmailConfig {
  provider?: string;
  dmarcReportEmail?: string;
}

export interface AnglesiteWorkersConfig {
  active?: string[];
}

/// The `Source/anglesite.json` shape this reader hands back. Mirrors the Swift `DomainConfig`
/// model (`Sources/AnglesiteCore/DomainConfig.swift`) field-for-field; kept as a hand-written
/// parallel type rather than a generated one, matching how `RedirectEntry` in `redirects.ts`
/// mirrors its Swift counterpart.
export interface AnglesiteConfig {
  version: number;
  domain?: AnglesiteDomainConfig;
  dns?: AnglesiteDNSConfig;
  edge?: AnglesiteEdgeConfig;
  email?: AnglesiteEmailConfig;
  workers?: AnglesiteWorkersConfig;
}

const DEFAULT_CONFIG: AnglesiteConfig = { version: 1 };

/// Reads `anglesite.json` from the site root. Returns the default (`{ version: 1 }`, no
/// sections) when the file is missing — the normal case for a site with no declarations yet —
/// or when it exists but fails to parse or isn't a JSON object, warning via `console.warn` in
/// the latter two cases so the site owner notices without ever failing the build. This slice
/// ships inert: no template code consumes the returned sections yet, so this function only
/// validates the document's outer shape, not each section's individual fields — the same
/// tolerance `readRedirects` applies to individually malformed entries, one level up.
export function readAnglesiteConfig(siteRoot: string): AnglesiteConfig {
  const path = resolve(siteRoot, "anglesite.json");
  if (!existsSync(path)) return DEFAULT_CONFIG;

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return DEFAULT_CONFIG;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[anglesite-config] anglesite.json exists but is not valid JSON: ${err}`);
    return DEFAULT_CONFIG;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.warn("[anglesite-config] anglesite.json must contain a JSON object; ignoring its contents.");
    return DEFAULT_CONFIG;
  }

  const config = parsed as Partial<AnglesiteConfig>;
  return {
    ...config,
    version: typeof config.version === "number" ? config.version : 1,
  };
}
