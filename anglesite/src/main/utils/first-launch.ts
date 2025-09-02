/**
 * @file First launch setup flow utilities
 */
import { IStore } from '../core/interfaces';
import { isCAInstalledInSystem, installCAInSystem } from '../certificates';

/**
 * Handle first launch setup flow.
 * Sets up default mode without prompting for permissions.
 * Certificate installation moved to manual option in settings to avoid permission dialogs on launch.
 * @param store Application settings store
 */
export async function handleFirstLaunch(store: IStore): Promise<void> {
  // Check if CA is already installed
  const caInstalled = await isCAInstalledInSystem();

  if (caInstalled) {
    // CA is already installed, use HTTPS mode
    store.set('httpsMode', 'https');
  } else {
    // Default to HTTPS mode, user can install certificate manually in settings if needed
    console.log('Defaulting to HTTPS mode. Install certificate in settings for full trust.');
    store.set('httpsMode', 'https');
  }

  // Mark first launch as completed
  store.set('firstLaunchCompleted', true);
}
