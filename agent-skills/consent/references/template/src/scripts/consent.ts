// Privacy / cookie consent runtime.
// See `docs/workflows/consent.md` and the `/anglesite:consent` skill for setup.
//
// Categories: necessary (always on), analytics, embeds, ads.
// Cookie shape: { v: <version>, c: { analytics: true, ... }, t: <ms> }
// Re-prompts when the stored version differs from the current site version.

export type ConsentCategory = "necessary" | "analytics" | "embeds" | "ads";
export type ConsentChoices = Partial<Record<ConsentCategory, boolean>>;

export interface StoredConsent {
  v: number;
  c: ConsentChoices;
  t: number;
}

const COOKIE_NAME = "consent";
const COOKIE_MAX_AGE_DAYS = 180;

// EEA + UK + EFTA. The runtime treats these as default-deny under the geo policy.
// PECR/UK GDPR for GB; GDPR for EEA; FADP for CH.
const REGULATED_COUNTRIES: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE", "GB", "UK", "IS", "LI", "NO", "CH",
]);

function readCookie(name: string): string | null {
  const target = name + "=";
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(target)) return trimmed.slice(target.length);
  }
  return null;
}

function writeCookie(name: string, value: string, maxAgeSec: number): void {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${value}; Max-Age=${maxAgeSec}; Path=/; SameSite=Lax${secure}`;
}

export function readStoredConsent(version: number): StoredConsent | null {
  const raw = readCookie(COOKIE_NAME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as StoredConsent;
    if (typeof parsed.v !== "number" || parsed.v !== version) return null;
    if (!parsed.c || typeof parsed.c !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredConsent(version: number, choices: ConsentChoices): void {
  const data: StoredConsent = { v: version, c: { ...choices, necessary: true }, t: Date.now() };
  writeCookie(COOKIE_NAME, encodeURIComponent(JSON.stringify(data)), COOKIE_MAX_AGE_DAYS * 86400);
}

export function clearStoredConsent(): void {
  writeCookie(COOKIE_NAME, "", 0);
}

export function detectCountry(): string | null {
  const meta = document.querySelector('meta[name="cf-country"]');
  const value = meta?.getAttribute("content")?.trim().toUpperCase() ?? "";
  // Cloudflare uses "T1" for Tor and "XX" for unknown — treat both as unknown.
  if (!value || value === "T1" || value === "XX") return null;
  return value;
}

export function isRegulatedRegion(country: string | null): boolean {
  // Unknown country → treat as regulated. Safer default.
  if (!country) return true;
  return REGULATED_COUNTRIES.has(country);
}

export function defaultChoices(
  enabledCategories: ConsentCategory[],
  policy: "geo" | "strict",
  country: string | null,
): ConsentChoices {
  const out: ConsentChoices = { necessary: true };
  const denyDefault = policy === "strict" || isRegulatedRegion(country);
  for (const cat of enabledCategories) {
    if (cat === "necessary") continue;
    out[cat] = !denyDefault;
  }
  return out;
}

function copyAttributes(from: Element, to: Element, skip: Set<string>): void {
  for (const attr of Array.from(from.attributes)) {
    if (skip.has(attr.name)) continue;
    to.setAttribute(attr.name, attr.value);
  }
}

// Swaps gated <script>/<iframe> elements into live ones for granted categories.
// Runs only forward — once a node has been activated it's replaced and won't match again.
export function applyConsent(choices: ConsentChoices): void {
  for (const [category, granted] of Object.entries(choices) as [ConsentCategory, boolean][]) {
    if (!granted) continue;

    // Inline scripts: <script type="text/plain" data-consent="analytics">...</script>
    document
      .querySelectorAll<HTMLScriptElement>(`script[type="text/plain"][data-consent="${category}"]`)
      .forEach((el) => {
        const next = document.createElement("script");
        copyAttributes(el, next, new Set(["type", "data-consent"]));
        if (el.dataset.src) next.src = el.dataset.src;
        next.text = el.textContent ?? "";
        el.replaceWith(next);
      });

    // External scripts: <script data-src="..." data-consent="analytics">
    document
      .querySelectorAll<HTMLScriptElement>(`script[data-src][data-consent="${category}"]`)
      .forEach((el) => {
        const next = document.createElement("script");
        copyAttributes(el, next, new Set(["data-src", "data-consent"]));
        next.src = el.dataset.src!;
        el.replaceWith(next);
      });

    // Iframes: <iframe data-src="..." data-consent="embeds">
    document
      .querySelectorAll<HTMLIFrameElement>(`iframe[data-src][data-consent="${category}"]`)
      .forEach((el) => {
        el.src = el.dataset.src!;
        el.removeAttribute("data-src");
      });
  }
}

export function dispatchConsent(choices: ConsentChoices): void {
  document.dispatchEvent(new CustomEvent("consentchange", { detail: choices }));
}
