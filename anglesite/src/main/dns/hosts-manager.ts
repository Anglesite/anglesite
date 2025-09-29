/**
 * @file DNS and hosts file management for Anglesite development domains.
 *
 * This module handles:
 * - Adding .test domains to /etc/hosts for local DNS resolution
 * - Managing the Anglesite section in the hosts file
 * - Cleaning up orphaned domain entries
 * - Cross-platform hosts file modifications using hostile library.
 */
import { dialog } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
// Import for DI access
import { getGlobalContext } from '../core/service-registry';
import { ServiceKeys } from '../core/container';
import { IWebsiteManager } from '../core/interfaces';
import { createServiceErrorReporter } from '../utils/error-handler-integration';
import * as hostile from 'hostile';

import sudoPrompt from 'sudo-prompt';
import isElevated from 'native-is-elevated';
import { logger } from '../utils/logging';

const execFileAsync = promisify(execFile);

/**
 * Get error reporter for DNS/hosts operations
 */
function getErrorReporter() {
  try {
    const context = getGlobalContext();
    return createServiceErrorReporter(context, 'HostsManager');
  } catch {
    return null; // Graceful degradation when DI not available
  }
}

/**
 * Add local DNS resolution for a hostname with biometric authentication.
 *
 * Automatically configures /etc/hosts to resolve the specified hostname to 127.0.0.1
 * for local development. Uses Touch ID when available for secure privilege escalation.
 *
 * Features:
 * - First-time setup creates Anglesite section with user confirmation dialog
 * - Subsequent additions are silent and automatic
 * - Touch ID biometric authentication when available
 * - Fallback to password authentication
 * - Comprehensive error handling with user feedback.
 * @param hostname The .test hostname to add (e.g., "mysite.test").
 * @returns Promise that resolves when DNS resolution is configured.
 * @example
 * ```typescript
 * await addLocalDnsResolution('my-website.test');
 * // Now https://my-website.test:8080 resolves to localhost
 * ```
 */
export async function addLocalDnsResolution(hostname: string): Promise<void> {
  // Check if auto-configuration is enabled
  const autoConfigEnabled = true; // TODO: Get from settings

  if (autoConfigEnabled) {
    // Check if Anglesite section exists
    const anglesiteSectionExists = await checkAnglesiteSection();

    if (!anglesiteSectionExists) {
      // Set up the wildcard section for the first time
      const success = await setupAnglesiteWildcardSection();
      if (success) {
        dialog.showMessageBox({
          type: 'info',
          title: 'DNS Configuration Complete',
          message: 'Development domains configured successfully!',
          detail: `Your site is now available at:

• https://${hostname}:8080
• https://localhost:8080

All future websites will automatically work at:
• https://[website-name].test:8080`,
          buttons: ['OK'],
        });
        return;
      } else {
        dialog.showMessageBox({
          type: 'warning',
          title: 'Setup Failed',
          message: 'Could not enable automatic domain configuration',
          detail: `To access your site at https://${hostname}:8080, please add this line to /etc/hosts:\n\n127.0.0.1\t${hostname}`,
          buttons: ['OK'],
        });
      }
    } else {
      // Anglesite section exists - add domain silently
      console.log(`Adding ${hostname} to existing Anglesite section…`);
      const success = await addToAnglesiteSection(hostname);
      if (success) {
        console.log(`✅ DNS resolution for ${hostname} configured automatically`);
      } else {
        const errorReporter = getErrorReporter();
        const error = new Error(`Failed to add ${hostname} to hosts file`);
        if (errorReporter) {
          errorReporter('addToAnglesiteSection', error, { hostname, autoConfig: true }).catch(() => {});
        } else {
          console.error(`❌ Failed to add ${hostname} to hosts file`);
        }
      }
    }
    return;
  }

  try {
    // This section is handled by the auto-configuration above
    // No need to check for wildcard entries with hostile

    // Inform user about DNS setup
    console.log(`\n========================================`);
    console.log(`📌 Development Server Access:`);
    console.log(`========================================`);
    console.log(`✅ Available at: https://localhost:8080`);
    console.log(`✨ Custom domain: https://${hostname}:8080`);
    console.log(`1. Enable auto-configuration in Settings`);
    console.log(`2. Or manually add: 127.0.0.1\t*.test to /etc/hosts`);
    console.log(`========================================\n`);
  } catch (error) {
    const errorReporter = getErrorReporter();
    if (errorReporter) {
      errorReporter('checkDnsResolution', error, { hostname }).catch(() => {});
    } else {
      console.warn('Could not check DNS resolution:', error);
    }
    console.log(`\nAccess your site at: https://localhost:8080`);
    console.log(`Or set up custom domain in Settings`);
  }
}

/**
 * Check if anglesite.test domain exists in hosts file.
 */
async function checkAnglesiteSection(): Promise<boolean> {
  try {
    return await hostEntryExists('anglesite.test');
  } catch (error) {
    const errorReporter = getErrorReporter();
    if (errorReporter) {
      errorReporter('checkAnglesiteSection', error, {}).catch(() => {});
    } else {
      console.error('Error checking hosts file:', error);
    }
    return false;
  }
}

/**
 * Check if Touch ID is available and configured for sudo on macOS.
 */
async function isTouchIdAvailable(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false;
  }

  try {
    // Check if pam_tid.so is configured in sudo PAM configuration
    let touchIdConfigured = false;
    try {
      const { stdout } = await execFileAsync('grep', ['-c', 'pam_tid.so', '/etc/pam.d/sudo']);
      touchIdConfigured = parseInt(stdout.trim()) > 0;
    } catch {
      // File not found or no matches - Touch ID not configured
      touchIdConfigured = false;
    }

    // Check if Touch ID hardware is available
    let touchIdHardware = false;
    try {
      const { stdout: biometryCheck } = await execFileAsync('bioutil', ['-r']);
      touchIdHardware = biometryCheck.includes('Touch ID');
    } catch {
      // bioutil not available or no Touch ID hardware
      touchIdHardware = false;
    }

    return touchIdConfigured && touchIdHardware;
  } catch (error) {
    console.debug('Could not check Touch ID availability:', error);
    return false;
  }
}

/**
 * Check if Touch ID hardware is available but not configured for sudo.
 */
async function canEnableTouchId(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false;
  }

  try {
    // Check if Touch ID hardware is available
    let touchIdHardware = false;
    try {
      const { stdout: biometryCheck } = await execFileAsync('bioutil', ['-r']);
      touchIdHardware = biometryCheck.includes('Touch ID');
    } catch {
      // bioutil not available or no Touch ID hardware
      touchIdHardware = false;
    }

    // Check if pam_tid.so is NOT configured in sudo PAM configuration
    let touchIdConfigured = false;
    try {
      const { stdout } = await execFileAsync('grep', ['-c', 'pam_tid.so', '/etc/pam.d/sudo']);
      touchIdConfigured = parseInt(stdout.trim()) > 0;
    } catch {
      // File not found or no matches - Touch ID not configured
      touchIdConfigured = false;
    }

    return touchIdHardware && !touchIdConfigured;
  } catch (error) {
    console.debug('Could not check Touch ID configuration possibility:', error);
    return false;
  }
}

/**
 * Show Touch ID setup information to user if available but not configured.
 */
export async function checkAndSuggestTouchIdSetup(): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }

  const touchIdAvailable = await isTouchIdAvailable();
  const canEnable = await canEnableTouchId();

  if (touchIdAvailable) {
    logger.debug('Biometric authentication configured for system operations');
  } else if (canEnable) {
    logger.debug('Biometric authentication available but not configured for system operations');
  }
}

/**
 * Execute a command with elevated privileges using sudo-prompt with Touch ID support.
 */
async function executeWithElevatedPrivileges(
  command: string,
  args: string[]
): Promise<{ success: boolean; output?: string }> {
  try {
    // Check if we already have elevated privileges
    const alreadyElevated = await isElevated();

    if (alreadyElevated) {
      // We already have elevated privileges, run directly using secure execFile
      const { stdout } = await execFileAsync(command, args);
      return { success: true, output: stdout };
    } else {
      // Check if Touch ID is available for secure logging context
      await isTouchIdAvailable();

      // Need to request elevated privileges
      const options = {
        name: 'Anglesite DNS',
        icns: process.platform === 'darwin' ? undefined : undefined, // Can be set to app icon path
      };

      // Log authentication request for debugging (no sensitive method details)
      logger.debug('Requesting elevated privileges for DNS operations');

      // Create a secure command string for sudo-prompt
      // Unfortunately, sudo-prompt requires a string, but we can at least properly escape it
      const escapedArgs = args.map((arg) => `'${arg.replace(/'/g, "'\"'\"'")}'`);
      const fullCommand = `${command} ${escapedArgs.join(' ')}`;

      return new Promise((resolve) => {
        sudoPrompt.exec(fullCommand, options, (error?: Error, stdout?: string | Buffer) => {
          if (error) {
            // Check for user cancellation without exposing authentication method
            if (error.message.includes('User cancelled') || (error as Error & { code?: number }).code === -128) {
              logger.debug('Authentication cancelled by user');
            } else {
              logger.debug('Authentication failed, operation cancelled');
            }
            logger.error('Failed to execute with elevated privileges', { error: error.message });
            resolve({ success: false });
          } else {
            logger.debug('Authentication successful, operation completed');
            resolve({ success: true, output: stdout?.toString() });
          }
        });
      });
    }
  } catch (error: unknown) {
    const errorReporter = getErrorReporter();
    if (errorReporter) {
      errorReporter('executeWithElevatedPrivileges', error, { command, args }).catch(() => {});
    } else {
      console.error(
        'Failed to execute with elevated privileges:',
        error instanceof Error ? error.message : String(error)
      );
    }
    return { success: false };
  }
}

/**
 * Add a host entry using hostile with native system authentication.
 */
async function addHostEntry(hostname: string, ipAddress: string = '127.0.0.1'): Promise<boolean> {
  try {
    const result = await executeWithElevatedPrivileges('npx', ['hostile', 'set', ipAddress, hostname]);

    if (result.success) {
      console.log(`✅ Added ${hostname} to hosts file`);
      return true;
    } else {
      const errorReporter = getErrorReporter();
      const err = new Error(`Failed to add ${hostname} to hosts file`);
      if (errorReporter) {
        errorReporter('addToAnglesiteSection', err, { hostname }).catch(() => {});
      } else {
        console.error(`Failed to add ${hostname} to hosts file`);
      }
      return false;
    }
  } catch (error) {
    const errorReporter = getErrorReporter();
    if (errorReporter) {
      errorReporter('addToAnglesiteSection', error, { hostname }).catch(() => {});
    } else {
      console.error(`Failed to add ${hostname} to hosts file:`, error);
    }
    return false;
  }
}

/**
 * Remove a host entry using hostile with native system authentication.
 */
async function removeHostEntry(hostname: string): Promise<boolean> {
  try {
    const result = await executeWithElevatedPrivileges('npx', ['hostile', 'remove', hostname]);

    if (result.success) {
      console.log(`✅ Removed ${hostname} from hosts file`);
      return true;
    } else {
      const errorReporter = getErrorReporter();
      const err = new Error(`Failed to remove ${hostname} from hosts file`);
      if (errorReporter) {
        errorReporter('removeFromAnglesiteSection', err, { hostname }).catch(() => {});
      } else {
        console.error(`Failed to remove ${hostname} from hosts file`);
      }
      return false;
    }
  } catch (error) {
    const errorReporter = getErrorReporter();
    if (errorReporter) {
      errorReporter('removeFromAnglesiteSection', error, { hostname }).catch(() => {});
    } else {
      console.error(`Failed to remove ${hostname} from hosts file:`, error);
    }
    return false;
  }
}

/**
 * Check if a host entry exists using hostile library.
 */
async function hostEntryExists(hostname: string): Promise<boolean> {
  return new Promise((resolve) => {
    hostile.get(false, (err: Error | null, lines: unknown) => {
      if (err) {
        const errorReporter = getErrorReporter();
        if (errorReporter) {
          errorReporter('checkHostEntry', err, { hostname }).catch(() => {});
        } else {
          console.error(`Failed to check hosts file for ${hostname}:`, err);
        }
        resolve(false);
        return;
      }

      // hostile.get returns array of [ip, hostname] tuples
      const exists = (lines as Array<[string, string]>).some(([, host]) => {
        return host === hostname;
      });
      resolve(exists);
    });
  });
}

/**
 * Set up initial Anglesite domain using hostile library.
 */
async function setupAnglesiteWildcardSection(): Promise<boolean> {
  try {
    // Add the main anglesite.test domain
    const success = await addHostEntry('anglesite.test', '127.0.0.1');
    if (success) {
      console.log('Anglesite domain configured successfully');
    }
    return success;
  } catch (error) {
    const errorReporter = getErrorReporter();
    if (errorReporter) {
      errorReporter('setupAnglesiteWildcardSection', error, {}).catch(() => {});
    } else {
      console.error('Failed to setup Anglesite domain:', error);
    }
    return false;
  }
}

/**
 * Add hostname to hosts file using hostile library.
 */
async function addToAnglesiteSection(hostname: string, ipAddress: string = '127.0.0.1'): Promise<boolean> {
  try {
    // Check if entry already exists
    const exists = await hostEntryExists(hostname);
    if (exists) {
      console.log(`${hostname} already exists in hosts file`);
      return true;
    }

    // Add the host entry
    return await addHostEntry(hostname, ipAddress);
  } catch (error) {
    const errorReporter = getErrorReporter();
    if (errorReporter) {
      errorReporter('addHostEntry', error, { hostname, ipAddress }).catch(() => {});
    } else {
      console.error('Failed to add to hosts file:', error);
    }
    return false;
  }
}

/**
 * Update hosts file with new entries.
 */
export async function updateHostsFile(hostname: string, ipAddress: string = '127.0.0.1'): Promise<boolean> {
  return addToAnglesiteSection(hostname, ipAddress);
}

/**
 * Clean up orphaned .test domain entries using hostile library
 * Removes domains that no longer have corresponding website folders.
 * @returns Promise resolving to true if cleanup succeeded or no changes needed, false if failed.
 */
export async function cleanupHostsFile(): Promise<boolean> {
  try {
    // Get list of actual website directories
    let existingWebsites: string[];
    try {
      // Use DI-based website manager
      const appContext = getGlobalContext();
      const websiteManager = appContext.getService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);
      existingWebsites = await websiteManager.listWebsites();
    } catch (diError) {
      const errorReporter = getErrorReporter();
      if (errorReporter) {
        errorReporter('listWebsitesViaDI', diError, {}).catch(() => {});
      } else {
        console.warn('Failed to list websites via DI, falling back to legacy method:', diError);
      }
      // Fallback to legacy method if DI fails (for when DI is not initialized yet)
      const { listWebsites } = await import('../utils/website-manager');
      existingWebsites = await listWebsites();
    }
    console.log('Existing websites:', existingWebsites);

    // Always include anglesite.test for the main docs
    const websiteNames = Array.isArray(existingWebsites) ? existingWebsites : [];
    const validDomains = new Set(['anglesite.test', ...websiteNames.map((name: string) => `${name}.test`)]);

    // Get current hosts file entries
    const hostEntries = await new Promise<Array<[string, string]>>((resolve, reject) => {
      hostile.get(false, (err: Error | null, lines: unknown) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(lines as Array<[string, string]>);
      });
    });

    // Find orphaned .test domains
    const orphanedDomains: string[] = [];
    for (const [ip, line] of hostEntries) {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const hostname = parts[1];
        if (hostname.endsWith('.test') && ip === '127.0.0.1') {
          if (!validDomains.has(hostname)) {
            orphanedDomains.push(hostname);
          }
        }
      }
    }

    // Remove orphaned domains
    let allSucceeded = true;
    for (const domain of orphanedDomains) {
      console.log(`Removing orphaned domain: ${domain}`);
      const success = await removeHostEntry(domain);
      if (!success) {
        allSucceeded = false;
      }
    }

    if (orphanedDomains.length === 0) {
      console.log('Hosts file is already clean, no changes needed');
    } else {
      console.log(`Cleaned up ${orphanedDomains.length} orphaned domain(s)`);
    }

    return allSucceeded;
  } catch (error) {
    const errorReporter = getErrorReporter();
    if (errorReporter) {
      errorReporter('cleanupHostsFile', error, {}).catch(() => {});
    } else {
      console.error('Failed to clean up hosts file:', error);
    }
    return false;
  }
}
