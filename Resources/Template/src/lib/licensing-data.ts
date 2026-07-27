/**
 * Loads `src/data/licensing.json` for the Astro layouts, mirroring `profile.ts`. The glob
 * returns `{}` when the file is absent, so a site with no policy simply asserts nothing.
 *
 * Split from `licensing.ts` because `import.meta.glob` is a Vite construct that is
 * unavailable under plain `node:test` — the pure logic stays importable by the test suite.
 */
import {
  normalizePolicy,
  resolveLicense,
  type LicensableCollection,
  type LicenseRef,
  type LicensingPolicy,
} from "./licensing.ts";

const mods = import.meta.glob<{ default: unknown }>("../data/licensing.json", { eager: true });

export function licensingPolicy(): LicensingPolicy {
  return normalizePolicy(Object.values(mods)[0]?.default);
}

/** The license applying to one collection's entries, or null to assert nothing. */
export function licenseFor(collection: LicensableCollection): LicenseRef | null {
  return resolveLicense(licensingPolicy(), collection);
}

/** The site-wide default, used for pages that aren't a collection entry. */
export function siteLicense(): LicenseRef | null {
  return licensingPolicy().default;
}
