/**
 * @file First launch setup flow utilities
 */
import { app, dialog } from 'electron';
import { IStore } from '../core/interfaces';
import { isCAInstalledInSystem, installCAInSystem } from '../certificates';
import { showFirstLaunchAssistant } from '../ui/window-manager';

/**
 * Handle first launch setup flow.
 * Checks if CA is already installed, otherwise shows setup assistant.
 * Handles HTTPS mode setup including CA certificate installation.
 * Falls back to HTTP mode if CA installation fails or user chooses HTTP.
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

  // Show first launch assistant
  const userChoice = await showFirstLaunchAssistant();

  if (!userChoice) {
    // User cancelled, exit the app
    app.quit();
    return;
  }

  if (userChoice === 'https') {
    try {
      const installed = await installCAInSystem();

      if (installed) {
        store.set('httpsMode', 'https');
      } else {
        // Installation failed, fall back to HTTP
        store.set('httpsMode', 'http');

        // Show error message
        dialog.showMessageBoxSync({
          type: 'warning',
          title: 'Certificate Installation Failed',
          message: 'Failed to install the security certificate.',
          detail: 'Anglesite will continue in HTTP mode. You can retry HTTPS setup in the settings.',
          buttons: ['Continue'],
        });
      }
    } catch (error) {
      console.error('Error during CA installation:', error);
      store.set('httpsMode', 'http');

      dialog.showMessageBoxSync({
        type: 'error',
        title: 'Setup Error',
        message: 'An error occurred during setup.',
        detail: 'Anglesite will continue in HTTP mode.',
        buttons: ['Continue'],
      });
    }
  } else {
    // User chose HTTP mode
    store.set('httpsMode', 'http');
  }

  // Mark first launch as completed
  store.set('firstLaunchCompleted', true);
}
