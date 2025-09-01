/**
 * @file Certificate Authority and SSL certificate management for Anglesite
 *
 * This module handles:
 * - Creating and managing a local Certificate Authority (CA)
 * - Generating SSL certificates for .test domains
 * - Installing CA certificates in the system keychain
 * - Checking certificate installation status
 */
import { createCA, createCert } from 'mkcert';
import * as fs from 'fs';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const unlink = promisify(fs.unlink);

// Helper to check if file exists using fs.stat
async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Certificate cache to avoid regenerating certificates for the same domains
 */
const certificateCache = new Map<string, { cert: string; key: string }>();

/**
 * Get or create Certificate Authority for Anglesite.
 * Creates a new CA if one doesn't exist, otherwise loads existing CA from disk.
 * @returns Promise resolving to CA certificate and private key.
 */
async function getOrCreateCA(): Promise<{ cert: string; key: string }> {
  const appDataPath =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'Anglesite')
      : process.platform === 'win32'
        ? path.join(process.env.APPDATA || '', 'Anglesite')
        : path.join(os.homedir(), '.config', 'anglesite');

  const caPath = path.join(appDataPath, 'ca');
  const caCertPath = path.join(caPath, 'ca.crt');
  const caKeyPath = path.join(caPath, 'ca.key');

  // Check if CA already exists
  if ((await exists(caCertPath)) && (await exists(caKeyPath))) {
    return {
      cert: await readFile(caCertPath, 'utf8'),
      key: await readFile(caKeyPath, 'utf8'),
    };
  }

  // Create new CA
  const ca = await createCA({
    organization: 'Anglesite Development',
    countryCode: 'US',
    state: 'Development',
    locality: 'Local',
    validity: 825, // ~2.25 years
  });

  // Save CA to disk
  await mkdir(caPath, { recursive: true });
  await writeFile(caCertPath, ca.cert);
  await writeFile(caKeyPath, ca.key);

  return ca;
}

/**
 * Generate SSL certificate for specific domains using the Anglesite CA.
 * Includes caching to avoid regenerating certificates for the same domain set.
 * @param domains Array of domain names to include in the certificate.
 * @returns Promise resolving to certificate and private key.
 */
export async function generateCertificate(domains: string[]): Promise<{ cert: string; key: string }> {
  // Check cache first
  const cacheKey = domains.sort().join(',');
  if (certificateCache.has(cacheKey)) {
    return certificateCache.get(cacheKey)!;
  }

  try {
    // Get or create CA
    const ca = await getOrCreateCA();

    // Always include localhost and common variations
    const allDomains = Array.from(new Set([...domains, 'localhost', '127.0.0.1', '::1']));

    // Create certificate
    const cert = await createCert({
      ca: { key: ca.key, cert: ca.cert },
      domains: allDomains,
      validity: 365,
    });

    // Cache the certificate
    certificateCache.set(cacheKey, cert);

    return cert;
  } catch (error) {
    console.error('Failed to generate certificate:', error);
    throw new Error(`Certificate generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Check if Anglesite CA is installed and trusted in the system keychain
 * 
 * Uses the macOS security command to verify if the certificate is present
 * and trusted in the user keychain. This is the definitive test for SSL trust.
 * 
 * @example
 * ```typescript
 * const isInstalled = await isCAInstalledInSystem();
 * if (!isInstalled) {
 *   await installCAInSystem();
 * }
 * ```
 * 
 * @returns Promise resolving to true if CA is installed and trusted, false otherwise
 */
export async function isCAInstalledInSystem(): Promise<boolean> {
  try {
    // Check if certificate is installed in the system keychain by name
    // This is the definitive test for whether the CA is trusted by the system
    execFileSync('security', ['find-certificate', '-c', 'Anglesite Development'], { stdio: 'pipe' });
    
    // If we get here, certificate exists in keychain and is trusted
    return true;
  } catch {
    // Certificate not found in keychain - not installed
    return false;
  }
}

/**
 * Install Anglesite CA into user keychain as a trusted root certificate.
 * This enables SSL certificates signed by the Anglesite CA to be trusted by browsers.
 * Installs in user keychain to avoid requiring administrator privileges.
 * @returns Promise resolving to true if installation succeeded, false if failed.
 */
export async function installCAInSystem(): Promise<boolean> {
  try {
    const ca = await getOrCreateCA();

    // Write CA cert to temporary file
    const tempCertPath = path.join(os.tmpdir(), 'anglesite-ca.crt');
    await writeFile(tempCertPath, ca.cert);

    // Install certificate in user keychain (no admin privileges required)
    execFileSync('security', ['add-trusted-cert', '-d', '-r', 'trustRoot', tempCertPath], {
      stdio: 'pipe',
    });

    // Clean up temporary file
    await unlink(tempCertPath);

    return true;
  } catch (error) {
    console.error('Failed to install CA in keychain:', error);
    return false;
  }
}

/**
 * Get the file system path to the Anglesite CA certificate.
 * Useful for manual installation or external certificate management.
 * @returns Absolute path to the ca.crt file.
 */
export function getCAPath(): string {
  const appDataPath =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'Anglesite')
      : process.platform === 'win32'
        ? path.join(process.env.APPDATA || '', 'Anglesite')
        : path.join(os.homedir(), '.config', 'anglesite');

  return path.join(appDataPath, 'ca', 'ca.crt');
}

/**
 * Load or generate SSL certificates for HTTPS server with specific domains.
 * Main entry point for getting certificates for the HTTPS proxy server.
 * @param domains Array of domain names, defaults to ["anglesite.test"].
 * @returns Promise resolving to certificate and private key for HTTPS server.
 */
export async function loadCertificates(domains: string[] = ['anglesite.test']): Promise<{
  cert: string;
  key: string;
}> {
  // Generate certificate for specific domains only
  return generateCertificate(domains);
}
