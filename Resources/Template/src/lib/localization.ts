// Resources/Template/src/lib/localization.ts
import { readConfig, readConfigFromString } from "../../scripts/config.ts";

/** Pure parse used by tests and `siteLang()` alike — no filesystem access. */
export function siteLangFromConfig(config: string): string {
  return readConfigFromString(config, "SITE_LANG") || "en";
}

/** The site's default BCP-47 language tag, read from `.site-config`'s `SITE_LANG` key. Falls
 * back to `"en"` when absent — the same value the hardcoded `<html lang="en">` always produced,
 * so a site with no `SITE_LANG` key (every site scaffolded before this feature) renders
 * identically to before. */
export function siteLang(): string {
  return readConfig("SITE_LANG") || "en";
}
