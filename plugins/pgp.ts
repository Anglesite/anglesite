import * as fs from 'fs';
import * as path from 'path';
import type { EleventyConfig } from '@11ty/eleventy';
import { AnglesiteWebsiteConfiguration } from '../types/website.js';

interface EleventyData {
  website: AnglesiteWebsiteConfiguration;
}

/**
 * Reads PGP public key from various sources.
 * Priority order:
 * 1. ANGLESITE_PGP_PUBLIC_KEY environment variable (raw key content) - for override
 * 2. Website configuration (website.security.pgp_key)
 * 3. ANGLESITE_PGP_PUBLIC_KEY_FILE environment variable (path to key file)
 * 4. .well-known/pgp-key.txt file in project root
 * @param websiteConfig Optional website configuration object
 * @returns The PGP public key content or null if not found
 */
function readPgpPublicKey(websiteConfig?: AnglesiteWebsiteConfiguration): string | null {
  // 1. Try environment variable with raw key content first (for override)
  const envKey = process.env.ANGLESITE_PGP_PUBLIC_KEY;
  if (envKey) {
    return envKey.trim();
  }

  // 2. Try website configuration
  if (websiteConfig?.security?.pgp_key) {
    return websiteConfig.security.pgp_key.trim();
  }

  // 3. Try environment variable with file path
  const envKeyFile = process.env.ANGLESITE_PGP_PUBLIC_KEY_FILE;
  if (envKeyFile) {
    try {
      if (fs.existsSync(envKeyFile)) {
        return fs.readFileSync(envKeyFile, 'utf-8').trim();
      }
    } catch (error) {
      console.warn(
        `[@dwk/anglesite-11ty] PGP plugin: Could not read key file from ${envKeyFile}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // 4. Try default file location (with path traversal protection)
  const defaultKeyPath = path.resolve('.well-known', 'pgp-key.txt');
  const normalizedPath = path.normalize(defaultKeyPath);

  // Ensure path is within expected directory
  if (!normalizedPath.startsWith(path.resolve('.well-known'))) {
    console.warn('[@dwk/anglesite-11ty] PGP plugin: Invalid default key path detected');
    return null;
  }

  if (fs.existsSync(normalizedPath)) {
    try {
      return fs.readFileSync(normalizedPath, 'utf-8').trim();
    } catch {
      console.warn('[@dwk/anglesite-11ty] PGP plugin: Could not read default key file');
    }
  }

  return null;
}

/**
 * Validates that the content appears to be a PGP public key.
 * @param content The content to validate
 * @returns True if it looks like a PGP public key
 */
function validatePgpKey(content: string): boolean {
  const trimmed = content.trim();

  // Check for proper PGP structure with strict matching
  const beginMatch = trimmed.match(/^-----BEGIN PGP PUBLIC KEY BLOCK-----\s*$/m);
  const endMatch = trimmed.match(/^-----END PGP PUBLIC KEY BLOCK-----\s*$/m);

  if (!beginMatch || !endMatch) {
    return false;
  }

  // Ensure proper ordering
  const beginIndex = trimmed.indexOf(beginMatch[0]);
  const endIndex = trimmed.indexOf(endMatch[0]);
  if (beginIndex >= endIndex) {
    return false;
  }

  // Get key body and validate structure
  const keyBody = trimmed.substring(beginIndex + beginMatch[0].length, endIndex);
  const lines = keyBody.split('\n').filter((line) => line.trim());

  // Check for suspicious content
  const dangerousPatterns = [/<script/i, /javascript:/i, /<iframe/i, /eval\(/i, /document\./i, /window\./i];

  for (const line of lines) {
    if (dangerousPatterns.some((pattern) => pattern.test(line))) {
      console.warn('[@dwk/anglesite-11ty] PGP plugin: Suspicious content detected in key');
      return false;
    }
  }

  // Validate that there's actual key content (base64-like)
  const hasValidContent = lines.some((line) => {
    const cleaned = line.trim();
    return cleaned.length > 0 && /^[A-Za-z0-9+/=]+$/.test(cleaned);
  });

  // Check reasonable size limits
  if (trimmed.length > 65536) {
    // 64KB limit
    console.warn('[@dwk/anglesite-11ty] PGP plugin: PGP key too large');
    return false;
  }

  return hasValidContent;
}

/**
 * Adds a plugin for generating a .well-known/pgp-key.txt file.
 * Reads PGP public key from website configuration, environment variables, or files and outputs to build directory.
 * @param eleventyConfig The Eleventy configuration object.
 */
export default function addPgpKey(eleventyConfig: EleventyConfig): void {
  // Create .well-known/pgp-key.txt file during the build process
  eleventyConfig.on('eleventy.after', async ({ dir, results }) => {
    // Try to get website configuration from page data first (for tests)
    // Then fallback to reading from filesystem (for real builds)
    let websiteConfig: AnglesiteWebsiteConfiguration | undefined;

    if (results && results.length > 0) {
      // Check if the first result has data property (test scenario)
      const firstResult = results[0] as { data?: EleventyData };
      if (firstResult?.data) {
        websiteConfig = firstResult.data.website;
      } else {
        // Real Eleventy build scenario - read from filesystem
        try {
          const websiteDataPath = path.resolve('src', '_data', 'website.json');
          const websiteData = await fs.promises.readFile(websiteDataPath, 'utf-8');
          websiteConfig = JSON.parse(websiteData) as AnglesiteWebsiteConfiguration;
        } catch {
          // Website config not found, will fall back to environment variables
        }
      }
    }

    const pgpKey = readPgpPublicKey(websiteConfig);

    if (!pgpKey) {
      // PGP key is optional, so we don't warn if it's not configured
      return;
    }

    if (!validatePgpKey(pgpKey)) {
      console.warn('[@dwk/anglesite-11ty] PGP plugin: Content does not appear to be a valid PGP public key block');
      return;
    }

    const wellKnownDir = path.join(dir.output, '.well-known');
    const outputPath = path.join(wellKnownDir, 'pgp-key.txt');

    try {
      // Ensure .well-known directory exists
      fs.mkdirSync(wellKnownDir, { recursive: true });
      fs.writeFileSync(outputPath, pgpKey);
      console.log(`[@dwk/anglesite-11ty] Wrote ${outputPath}`);
    } catch (error) {
      console.error(
        `[@dwk/anglesite-11ty] Failed to write .well-known/pgp-key.txt: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}
