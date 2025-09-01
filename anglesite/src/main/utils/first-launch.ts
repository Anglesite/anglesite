/**
 * @file First launch setup flow utilities
 */
import { IStore } from '../core/interfaces';
import { isCAInstalledInSystem, installCAInSystem } from '../certificates';

/**
 * Handle first launch setup flow.
 * Automatically sets up HTTPS mode with certificate installation.
 * Since certificate installation only requires user keychain access (no admin privileges),
 * we can set up HTTPS automatically without user prompts.
 * Falls back to HTTP mode only if certificate installation fails.
 * @param store Application settings store
 */
export async function handleFirstLaunch(store: IStore): Promise<void> {
  // Check if CA is already installed
  const caInstalled = await isCAInstalledInSystem();

  if (caInstalled) {
    // CA is already installed, default to HTTPS mode
    store.set('httpsMode', 'https');
    store.set('firstLaunchCompleted', true);
    return;
  }

  // Automatically install CA certificate (no admin privileges required)
  try {
    const installed = await installCAInSystem();

    if (installed) {
      console.log('Certificate installed successfully to user keychain');
      store.set('httpsMode', 'https');
    } else {
      // Installation failed, fall back to HTTP
      console.warn('Certificate installation failed, falling back to HTTP mode');
      store.set('httpsMode', 'http');
    }
  } catch (error) {
    console.error('Error during CA installation:', error);
    console.warn('Falling back to HTTP mode due to certificate installation error');
    store.set('httpsMode', 'http');
  }

  // Mark first launch as completed
  store.set('firstLaunchCompleted', true);
}
