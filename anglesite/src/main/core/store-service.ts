/**
 * @file DI-compatible Store Service
 *
 * Refactored version of the Store class that implements IStore interface.
 * and uses dependency injection for better testability and maintainability.
 */

import { app } from 'electron';
import * as path from 'path';
import { IStore, ILogger, IFileSystem, IAtomicOperations } from './interfaces';
import { WindowState, AppSettings } from './types';
/// <reference types="node" />

// Remove unused promisify - we use the injected file system service instead
// const writeFile = promisify(require('fs').writeFile);

/**
 * Store service implementation with dependency injection support.
 */
export class StoreService implements IStore {
  private path: string;
  private data: AppSettings;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private logger: ILogger,
    private fileSystem: IFileSystem,
    private atomicOperations?: IAtomicOperations, // Optional for now
    private userDataPath?: string
  ) {
    // Use provided path or default to app userData (with fallback for tests)
    let dataPath: string;
    if (userDataPath) {
      dataPath = userDataPath;
    } else {
      try {
        dataPath = app.getPath('userData');
      } catch {
        // Fallback for test environments where app may not be available
        dataPath = process.env.ANGLESITE_TEST_DATA || '/tmp/anglesite-test';
      }
    }

    // Ensure dataPath is not undefined
    if (!dataPath) {
      dataPath = '/tmp/anglesite-test';
    }

    this.path = path.join(dataPath, 'settings.json');

    this.logger = logger.child({ service: 'StoreService' });

    // Initialize with default data
    this.data = this.getDefaultSettings();

    // Load existing settings asynchronously
    this.initializeAsync().catch((error) => {
      this.logger.error('Failed to initialize store', error);
    });
  }

  /**
   * Static factory method for DI container.
   */
  static create(
    logger: ILogger,
    fileSystem: IFileSystem,
    atomicOperations?: IAtomicOperations,
    userDataPath?: string
  ): StoreService {
    return new StoreService(logger, fileSystem, atomicOperations, userDataPath);
  }

  /**
   * Get a setting value by key.
   */
  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.data[key];
  }

  /**
   * Set a setting value and persist to disk with validation.
   */
  set<K extends keyof AppSettings>(key: K, val: AppSettings[K]): void {
    this.logger.debug(`Setting ${String(key)}`, { newValue: val });

    // Validate the individual setting
    const validationResult = this.validateSetting(key, val);
    if (!validationResult.valid) {
      const error = new Error(`Invalid value for setting '${String(key)}': ${validationResult.error}`);
      this.logger.error('Setting validation failed', error, { key, value: val });
      throw error;
    }

    // Store the old value for potential rollback
    const oldValue = this.data[key];

    try {
      this.data[key] = val;
      this.saveDataDebounced();
      this.logger.debug(`Setting ${String(key)} updated successfully`);
    } catch (error) {
      // Rollback the change on error
      this.data[key] = oldValue;
      this.logger.error('Failed to set setting, rolled back', error as Error, { key });
      throw error;
    }
  }

  /**
   * Get all current settings.
   */
  getAll(): AppSettings {
    return { ...this.data }; // Return copy to prevent mutations
  }

  /**
   * Set multiple settings at once with atomic validation.
   */
  setAll(settings: Partial<AppSettings>): void {
    this.logger.debug('Setting multiple settings', { settingsKeys: Object.keys(settings) });

    // Validate all settings before applying any changes
    const validatedSettings = this.validateSettings(settings);
    if (!validatedSettings.valid) {
      const error = new Error(`Invalid settings provided: ${validatedSettings.errors.join(', ')}`);
      this.logger.error('Multi-setting validation failed', error, { settings });
      throw error;
    }

    // Apply all changes atomically (in memory)
    const oldData = { ...this.data };
    try {
      this.data = { ...this.data, ...settings };
      this.saveDataDebounced();
      this.logger.debug('Multiple settings updated successfully');
    } catch (error) {
      // Rollback changes on error
      this.data = oldData;
      this.logger.error('Failed to set multiple settings, rolled back', error as Error);
      throw error;
    }
  }

  /**
   * Save current window states.
   */
  saveWindowStates(windowStates: WindowState[]): void {
    this.logger.debug('Saving window states', { count: windowStates.length });
    this.set('openWebsiteWindows', windowStates);
  }

  /**
   * Get saved window states.
   */
  getWindowStates(): WindowState[] {
    return this.get('openWebsiteWindows');
  }

  /**
   * Clear saved window states.
   */
  clearWindowStates(): void {
    this.logger.debug('Clearing window states');
    this.set('openWebsiteWindows', []);
  }

  /**
   * Add a website to the recent websites list.
   */
  addRecentWebsite(websiteName: string): void {
    this.logger.debug('Adding recent website', { websiteName });

    const recentWebsites = this.get('recentWebsites').slice(); // Create a copy

    // Remove existing occurrence if present
    const existingIndex = recentWebsites.indexOf(websiteName);
    if (existingIndex !== -1) {
      recentWebsites.splice(existingIndex, 1);
    }

    // Add to beginning
    recentWebsites.unshift(websiteName);

    // Keep only the 10 most recent
    const limitedRecent = recentWebsites.slice(0, 10);

    this.set('recentWebsites', limitedRecent);
  }

  /**
   * Get the list of recent websites.
   */
  getRecentWebsites(): string[] {
    return this.get('recentWebsites');
  }

  /**
   * Clear the recent websites list.
   */
  clearRecentWebsites(): void {
    this.logger.debug('Clearing recent websites');
    this.set('recentWebsites', []);
  }

  /**
   * Remove a specific website from the recent websites list.
   */
  removeRecentWebsite(websiteName: string): void {
    this.logger.debug('Removing recent website', { websiteName });

    const recentWebsites = this.get('recentWebsites').slice();
    const index = recentWebsites.indexOf(websiteName);
    if (index !== -1) {
      recentWebsites.splice(index, 1);
      this.set('recentWebsites', recentWebsites);
    }
  }

  /**
   * Force immediate save (for shutdown scenarios).
   */
  async forceSave(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    try {
      await this.saveDataAsync();
      this.logger.debug('Force save completed successfully');
    } catch (error) {
      this.logger.error('Critical: Failed to force save settings during shutdown', error as Error);

      // For shutdown scenarios, also try a fallback direct write using the file system service
      try {
        const emergencyPath = this.path + '.emergency';
        await this.fileSystem.writeFile(emergencyPath, JSON.stringify(this.data, null, 2), 'utf-8');
        this.logger.warn('Settings saved to emergency backup file', { path: emergencyPath });
      } catch (emergencyError) {
        this.logger.error('Emergency settings save also failed', emergencyError as Error);
        throw emergencyError;
      }
    }
  }

  /**
   * Clean up store service resources and save any pending data to disk.
   */
  async dispose(): Promise<void> {
    this.logger.debug('Disposing store service');

    try {
      // Save any pending changes
      await this.forceSave();

      // Clear timeout
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
      }

      this.logger.debug('Store service disposed successfully');
    } catch (error) {
      this.logger.error('Error disposing store service', error as Error);
      throw error;
    }
  }

  /**
   * Initialize the store asynchronously.
   */
  private async initializeAsync(): Promise<void> {
    try {
      this.logger.debug('Initializing store from file', { path: this.path });

      const fileExists = await this.fileSystem.exists(this.path);
      if (!fileExists) {
        this.logger.info('Settings file does not exist, creating with defaults');
        await this.saveDataAsync();
        return;
      }

      const fileContent = (await this.fileSystem.readFile(this.path, 'utf-8')) as string;
      if (!fileContent.trim() || fileContent.trim() === '{}') {
        this.logger.warn('Settings file is empty or corrupted, recreating with defaults');
        await this.saveDataAsync();
        return;
      }

      try {
        const loadedData = JSON.parse(fileContent);
        this.data = { ...this.getDefaultSettings(), ...loadedData };
        this.logger.debug('Settings loaded successfully');
      } catch (parseError) {
        this.logger.error('JSON parse error in settings file', parseError as Error);

        // Backup the corrupted file
        const backupPath = `${this.path}.backup.${Date.now()}`;
        await this.fileSystem.writeFile(backupPath, fileContent, 'utf-8');
        this.logger.warn('Settings file corrupted, backed up and recreating with defaults', { backupPath });

        // Recreate settings file with defaults
        await this.saveDataAsync();
      }
    } catch (error) {
      this.logger.error('Error initializing settings from file', error as Error);
      // Continue with defaults
    }
  }

  /**
   * Generate initial application settings with sensible defaults for first-time users.
   */
  private getDefaultSettings(): AppSettings {
    return {
      autoDnsEnabled: false,
      httpsMode: null,
      firstLaunchCompleted: false,
      theme: 'system',
      openWebsiteWindows: [],
      recentWebsites: [],
    };
  }

  /**
   * Save data to file with debouncing.
   */
  private saveDataDebounced(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveDataAsync().catch((error) => {
        this.logger.error('Debounced save failed', error);
      });
    }, 100); // 100ms debounce
  }

  /**
   * Save data to file asynchronously using atomic operations.
   */
  private async saveDataAsync(): Promise<void> {
    try {
      const settingsJson = JSON.stringify(this.data, null, 2);

      // Ensure directory exists
      const dir = path.dirname(this.path);
      if (!(await this.fileSystem.exists(dir))) {
        await this.fileSystem.mkdir(dir, { recursive: true });
      }

      if (this.atomicOperations) {
        // Use atomic operations if available
        const result = await this.atomicOperations.writeFileAtomic(this.path, settingsJson, {
          backup: true,
          validate: (content: string) => {
            try {
              const parsed = JSON.parse(content);
              return (
                typeof parsed === 'object' &&
                parsed !== null &&
                'autoDnsEnabled' in parsed &&
                'httpsMode' in parsed &&
                'firstLaunchCompleted' in parsed &&
                'theme' in parsed &&
                'openWebsiteWindows' in parsed &&
                'recentWebsites' in parsed &&
                Array.isArray(parsed.openWebsiteWindows) &&
                Array.isArray(parsed.recentWebsites)
              );
            } catch {
              return false;
            }
          },
          maxRetries: 3,
        });

        if (!result.success) {
          this.logger.error('Failed to save settings atomically', result.error);
          throw result.error || new Error('Atomic settings save failed');
        }
      } else {
        // Fallback to regular file write
        await this.fileSystem.writeFile(this.path, settingsJson, 'utf-8');
      }

      this.logger.debug('Settings saved successfully');
    } catch (error) {
      this.logger.error('Error saving settings', error as Error);
      // Don't throw to prevent breaking the application
      // but the error is logged for debugging
    }
  }

  /**
   * Validate a single setting value.
   */
  private validateSetting<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ): { valid: boolean; error?: string } {
    switch (key) {
      case 'autoDnsEnabled':
      case 'firstLaunchCompleted':
        if (typeof value !== 'boolean') {
          return { valid: false, error: `${String(key)} must be a boolean` };
        }
        break;

      case 'httpsMode':
        if (value !== null && value !== 'https' && value !== 'http') {
          return { valid: false, error: 'httpsMode must be null, "https", or "http"' };
        }
        break;

      case 'theme':
        if (!['system', 'light', 'dark'].includes(value as string)) {
          return { valid: false, error: 'theme must be "system", "light", or "dark"' };
        }
        break;

      case 'openWebsiteWindows':
        if (!Array.isArray(value)) {
          return { valid: false, error: 'openWebsiteWindows must be an array' };
        }
        for (const window of value as WindowState[]) {
          if (!window.websiteName || typeof window.websiteName !== 'string') {
            return { valid: false, error: 'Each window state must have a valid websiteName' };
          }
        }
        break;

      case 'recentWebsites':
        if (!Array.isArray(value)) {
          return { valid: false, error: 'recentWebsites must be an array' };
        }
        if ((value as string[]).some((name) => typeof name !== 'string' || name.trim() === '')) {
          return { valid: false, error: 'All recent websites must be non-empty strings' };
        }
        if ((value as string[]).length > 10) {
          return { valid: false, error: 'recentWebsites cannot exceed 10 entries' };
        }
        break;
    }

    return { valid: true };
  }

  /**
   * Validate multiple settings.
   */
  private validateSettings(settings: Partial<AppSettings>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const [key, value] of Object.entries(settings)) {
      const result = this.validateSetting(key as keyof AppSettings, value);
      if (!result.valid) {
        errors.push(result.error || `Invalid value for ${key}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * Factory function for creating StoreService with proper dependencies.
 */
export function createStoreService(
  logger: ILogger,
  fileSystem: IFileSystem,
  atomicOperations?: IAtomicOperations,
  userDataPath?: string
): IStore {
  return StoreService.create(logger, fileSystem, atomicOperations, userDataPath);
}

/**
 * Type guard to check if an object is a store service.
 */
export function isStoreService(obj: unknown): obj is StoreService {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof (obj as StoreService).get === 'function' &&
    typeof (obj as StoreService).set === 'function' &&
    typeof (obj as StoreService).dispose === 'function'
  );
}
