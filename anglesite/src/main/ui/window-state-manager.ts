/**
 * @file Robust Window State Management with Persistence and Recovery
 *
 * Provides comprehensive window state management with atomic persistence,
 * validation, recovery mechanisms, and protection against corruption.
 */

import { BrowserWindow, screen } from 'electron';
import { EventEmitter } from 'events';
import { ILogger, IFileSystem, IStore } from '../core/interfaces';

/**
 * Window state data structure.
 */
export interface WindowState {
  websiteName: string;
  websitePath?: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isMaximized: boolean;
  isMinimized: boolean;
  displayId?: number; // Which display the window was on
  windowType: 'editor' | 'preview' | 'start-screen';
  lastAccessed: number; // Timestamp for LRU management
  version: number; // Schema version for migration
}

/**
 * Window state validation schema.
 */
interface WindowStateValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Recovery options for corrupted window states.
 */
export interface RecoveryOptions {
  dropCorrupted: boolean; // Drop corrupted states instead of trying to fix
  useDefaultBounds: boolean; // Use default bounds for invalid bounds
  validateDisplays: boolean; // Check if displays still exist
  maxRecoveryAttempts: number; // Maximum attempts to recover a state
}

/**
 * Default recovery options.
 */
export const DEFAULT_RECOVERY_OPTIONS: RecoveryOptions = {
  dropCorrupted: false,
  useDefaultBounds: true,
  validateDisplays: true,
  maxRecoveryAttempts: 3,
};

/**
 * Default window bounds.
 */
export const DEFAULT_WINDOW_BOUNDS = {
  width: 1200,
  height: 800,
  x: 100,
  y: 100,
};

/**
 * Current window state schema version.
 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Robust window state manager with comprehensive error handling.
 */
export class WindowStateManager extends EventEmitter {
  private states = new Map<string, WindowState>();
  private windowInstances = new Map<string, BrowserWindow>();
  private persistenceTimer: ReturnType<typeof setInterval> | null = null;
  private isInitialized = false;
  private recoveryAttempts = new Map<string, number>();

  constructor(
    private store: IStore,
    private fileSystem: IFileSystem,
    private logger: ILogger,
    private recoveryOptions: RecoveryOptions = DEFAULT_RECOVERY_OPTIONS
  ) {
    super();
    this.logger = logger.child({ component: 'WindowStateManager' });
  }

  /**
   * Initialize the window state manager and load persisted window states.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.loadPersistedStates();
      this.setupPeriodicPersistence();
      this.isInitialized = true;
      this.logger.info('Window state manager initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize window state manager', error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Register a window with state management and setup event listeners.
   */
  registerWindow(
    websiteName: string,
    window: BrowserWindow,
    windowType: WindowState['windowType'] = 'editor',
    websitePath?: string
  ): void {
    this.logger.info(`Registering window for ${websiteName}`, { windowType });

    // Store window instance
    this.windowInstances.set(websiteName, window);

    // Get current window bounds
    const bounds = window.getBounds();
    const isMaximized = window.isMaximized();
    const isMinimized = window.isMinimized();

    // Get display info
    const display = screen.getDisplayMatching(bounds);

    // Create or update state
    const state: WindowState = {
      websiteName,
      websitePath,
      bounds,
      isMaximized,
      isMinimized,
      displayId: display.id,
      windowType,
      lastAccessed: Date.now(),
      version: CURRENT_SCHEMA_VERSION,
    };

    this.states.set(websiteName, state);

    // Set up window event listeners for state tracking
    this.setupWindowListeners(websiteName, window);

    this.emit('windowRegistered', websiteName, state);
  }

  /**
   * Unregister a window from state management while preserving state for restoration.
   */
  unregisterWindow(websiteName: string): void {
    this.logger.info(`Unregistering window for ${websiteName}`);

    const window = this.windowInstances.get(websiteName);
    if (window && !window.isDestroyed()) {
      // Update final state before unregistering
      this.updateWindowState(websiteName);
    }

    this.windowInstances.delete(websiteName);
    // Note: We keep the state for restoration, only remove window instance

    this.emit('windowUnregistered', websiteName);
  }

  /**
   * Restore windows from persisted state with validation and recovery mechanisms.
   */
  async restoreWindows(createWindowCallback: (state: WindowState) => Promise<BrowserWindow>): Promise<WindowState[]> {
    const restoredStates: WindowState[] = [];

    this.logger.info(`Attempting to restore ${this.states.size} windows`);

    for (const [websiteName, state] of this.states) {
      try {
        // Validate state before restoration
        const validation = this.validateWindowState(state);
        if (!validation.isValid) {
          this.logger.warn(`Invalid window state for ${websiteName}`, {
            validationErrors: validation.errors,
          });

          // Attempt recovery
          const recoveredState = this.recoverWindowState(state, validation);
          if (!recoveredState) {
            this.logger.error(`Failed to recover window state for ${websiteName}`);
            continue;
          }

          this.states.set(websiteName, recoveredState);
        }

        // Create window
        const window = await createWindowCallback(state);

        // Apply state to window
        this.applyStateToWindow(window, state);

        // Register the restored window
        this.registerWindow(websiteName, window, state.windowType, state.websitePath);

        restoredStates.push(state);
        this.logger.info(`Successfully restored window for ${websiteName}`);
      } catch (error) {
        this.logger.error(`Failed to restore window for ${websiteName}`, error instanceof Error ? error : undefined);
        // Continue with other windows
      }
    }

    this.logger.info(`Restored ${restoredStates.length} windows successfully`);
    return restoredStates;
  }

  /**
   * Save current window states to persistent storage with validation.
   */
  async saveStates(): Promise<void> {
    try {
      // Update all active window states
      for (const websiteName of this.windowInstances.keys()) {
        this.updateWindowState(websiteName);
      }

      // Convert states to serializable format
      const stateArray = Array.from(this.states.values());

      // Validate states before saving
      const validStates = stateArray.filter((state) => {
        const validation = this.validateWindowState(state);
        if (!validation.isValid) {
          this.logger.warn(`Skipping invalid state for ${state.websiteName}`, {
            validationErrors: validation.errors,
          });
          return false;
        }
        return true;
      });

      // Convert to store-compatible format
      const storeStates = validStates.map((state) => ({
        websiteName: state.websiteName,
        websitePath: state.websitePath,
        bounds: state.bounds,
        isMaximized: state.isMaximized,
        windowType: state.windowType === 'start-screen' ? 'editor' : (state.windowType as 'preview' | 'editor'),
      }));

      // Save to store
      this.store.saveWindowStates(storeStates);

      this.logger.info(`Saved ${validStates.length} window states`);
      this.emit('statesSaved', validStates);
    } catch (error) {
      this.logger.error('Failed to save window states', error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Load persisted states from storage with corruption detection and recovery.
   */
  private async loadPersistedStates(): Promise<void> {
    try {
      const savedStates = this.store.getWindowStates();
      this.logger.info(`Loading ${savedStates.length} persisted window states`);

      let validCount = 0;
      let recoveredCount = 0;
      let droppedCount = 0;

      for (const storeState of savedStates) {
        // Convert store state to local state format
        const localState: WindowState = {
          websiteName: storeState.websiteName,
          websitePath: storeState.websitePath,
          bounds: storeState.bounds || { x: 100, y: 100, width: 1200, height: 800 },
          isMaximized: storeState.isMaximized || false,
          isMinimized: false,
          windowType: (storeState.windowType as 'editor' | 'preview' | 'start-screen') || 'editor',
          lastAccessed: Date.now(),
          version: CURRENT_SCHEMA_VERSION,
        };

        const validation = this.validateWindowState(localState);

        if (validation.isValid) {
          this.states.set(localState.websiteName, localState);
          validCount++;
        } else {
          // Attempt recovery
          const recoveredState = this.recoverWindowState(localState, validation);
          if (recoveredState) {
            this.states.set(localState.websiteName, recoveredState);
            recoveredCount++;
          } else {
            this.logger.error(`Dropping corrupted window state for ${localState.websiteName}`, undefined, {
              validationErrors: validation.errors,
            });
            droppedCount++;
          }
        }
      }

      this.logger.info('Window state loading completed', {
        total: savedStates.length,
        valid: validCount,
        recovered: recoveredCount,
        dropped: droppedCount,
      });
    } catch (error) {
      this.logger.error('Failed to load persisted window states', error instanceof Error ? error : undefined);

      // Don't throw here - we can continue with empty state
      this.logger.warn('Starting with empty window state');
    }
  }

  /**
   * Validate a window state structure and content for correctness and safety.
   */
  private validateWindowState(state: WindowState): WindowStateValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!state.websiteName || typeof state.websiteName !== 'string') {
      errors.push('websiteName is required and must be a string');
    }

    if (!state.bounds || typeof state.bounds !== 'object') {
      errors.push('bounds is required and must be an object');
    } else {
      if (typeof state.bounds.x !== 'number' || typeof state.bounds.y !== 'number') {
        errors.push('bounds.x and bounds.y must be numbers');
      }
      if (typeof state.bounds.width !== 'number' || typeof state.bounds.height !== 'number') {
        errors.push('bounds.width and bounds.height must be numbers');
      }
      if (state.bounds.width <= 0 || state.bounds.height <= 0) {
        errors.push('bounds.width and bounds.height must be positive');
      }
    }

    if (typeof state.isMaximized !== 'boolean') {
      errors.push('isMaximized must be a boolean');
    }

    if (typeof state.windowType !== 'string' || !['editor', 'preview', 'start-screen'].includes(state.windowType)) {
      errors.push('windowType must be a valid string');
    }

    // Display validation
    if (this.recoveryOptions.validateDisplays && state.displayId) {
      const displays = screen.getAllDisplays();
      const displayExists = displays.some((display) => display.id === state.displayId);
      if (!displayExists) {
        warnings.push(`Display ${state.displayId} no longer exists`);
      }
    }

    // Bounds validation (check if window would be visible)
    if (state.bounds) {
      const displays = screen.getAllDisplays();
      const isVisible = displays.some((display) => {
        const workArea = display.workArea;
        return (
          state.bounds.x >= workArea.x - 100 && // Allow some off-screen
          state.bounds.y >= workArea.y - 100 &&
          state.bounds.x < workArea.x + workArea.width &&
          state.bounds.y < workArea.y + workArea.height
        );
      });

      if (!isVisible) {
        warnings.push('Window bounds are outside visible displays');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Attempt to recover a corrupted window state using configured recovery options.
   */
  private recoverWindowState(state: WindowState, validation: WindowStateValidation): WindowState | null {
    if (this.recoveryOptions.dropCorrupted) {
      return null;
    }

    const recoveryKey = state.websiteName;
    const attempts = this.recoveryAttempts.get(recoveryKey) || 0;

    if (attempts >= this.recoveryOptions.maxRecoveryAttempts) {
      this.logger.error(`Max recovery attempts reached for ${recoveryKey}`);
      return null;
    }

    this.recoveryAttempts.set(recoveryKey, attempts + 1);

    try {
      const recoveredState = { ...state };

      // Fix bounds issues
      if (validation.errors.some((error) => error.includes('bounds'))) {
        if (this.recoveryOptions.useDefaultBounds) {
          recoveredState.bounds = { ...DEFAULT_WINDOW_BOUNDS };
          this.logger.info(`Applied default bounds to ${state.websiteName}`);
        } else {
          return null;
        }
      }

      // Fix missing required fields
      if (!recoveredState.websiteName) {
        recoveredState.websiteName = `recovered-${Date.now()}`;
      }

      if (typeof recoveredState.isMaximized !== 'boolean') {
        recoveredState.isMaximized = false;
      }

      if (typeof recoveredState.isMinimized !== 'boolean') {
        recoveredState.isMinimized = false;
      }

      if (!recoveredState.windowType || !['editor', 'preview', 'start-screen'].includes(recoveredState.windowType)) {
        recoveredState.windowType = 'editor';
      }

      // Update metadata
      recoveredState.lastAccessed = Date.now();
      recoveredState.version = CURRENT_SCHEMA_VERSION;

      // Validate recovery
      const revalidation = this.validateWindowState(recoveredState);
      if (revalidation.isValid) {
        this.logger.info(`Successfully recovered window state for ${state.websiteName}`);
        return recoveredState;
      } else {
        this.logger.warn(`Recovery failed for ${state.websiteName}`, {
          errors: revalidation.errors,
        });
        return null;
      }
    } catch (error) {
      this.logger.error(
        `Error during window state recovery for ${state.websiteName}`,
        error instanceof Error ? error : undefined
      );
      return null;
    }
  }

  /**
   * Apply window state to a BrowserWindow instance with error handling.
   */
  private applyStateToWindow(window: BrowserWindow, state: WindowState): void {
    try {
      // Apply bounds
      window.setBounds(state.bounds);

      // Apply maximized/minimized state
      if (state.isMaximized) {
        window.maximize();
      } else if (state.isMinimized) {
        window.minimize();
      }

      this.logger.debug(`Applied state to window for ${state.websiteName}`, {
        bounds: state.bounds,
        isMaximized: state.isMaximized,
        isMinimized: state.isMinimized,
      });
    } catch (error) {
      this.logger.warn(`Failed to apply some window state for ${state.websiteName}`, {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - partial state application is acceptable
    }
  }

  /**
   * Set up window event listeners for automatic state tracking and updates.
   */
  private setupWindowListeners(websiteName: string, window: BrowserWindow): void {
    // Track window moves and resizes
    const updateState = () => {
      if (!window.isDestroyed()) {
        this.updateWindowState(websiteName);
      }
    };

    window.on('moved', updateState);
    window.on('resized', updateState);
    window.on('maximize', updateState);
    window.on('unmaximize', updateState);
    window.on('minimize', updateState);
    window.on('restore', updateState);

    // Clean up on window close
    window.on('closed', () => {
      this.unregisterWindow(websiteName);
    });
  }

  /**
   * Update window state from current window properties and display information.
   */
  private updateWindowState(websiteName: string): void {
    const window = this.windowInstances.get(websiteName);
    const currentState = this.states.get(websiteName);

    if (!window || window.isDestroyed() || !currentState) {
      return;
    }

    try {
      const bounds = window.getBounds();
      const isMaximized = window.isMaximized();
      const isMinimized = window.isMinimized();

      // Get current display
      const display = screen.getDisplayMatching(bounds);

      // Update state
      currentState.bounds = bounds;
      currentState.isMaximized = isMaximized;
      currentState.isMinimized = isMinimized;
      currentState.displayId = display.id;
      currentState.lastAccessed = Date.now();

      this.states.set(websiteName, currentState);
    } catch (error) {
      this.logger.warn(`Failed to update window state for ${websiteName}`, {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Set up periodic persistence of window states with error handling.
   */
  private setupPeriodicPersistence(): void {
    // Save states every 30 seconds
    this.persistenceTimer = setInterval(() => {
      this.saveStates().catch((error) => {
        this.logger.error('Periodic state save failed', error instanceof Error ? error : undefined);
      });
    }, 30000);
  }

  /**
   * Get a copy of current window states map for external access.
   */
  getStates(): Map<string, WindowState> {
    return new Map(this.states);
  }

  /**
   * Get window state for a specific website by name.
   */
  getState(websiteName: string): WindowState | undefined {
    return this.states.get(websiteName);
  }

  /**
   * Remove window state and cleanup recovery tracking for a specific website.
   */
  removeState(websiteName: string): void {
    this.states.delete(websiteName);
    this.recoveryAttempts.delete(websiteName);
    this.emit('stateRemoved', websiteName);
  }

  /**
   * Clear all window states and persistent storage.
   */
  clearStates(): void {
    this.states.clear();
    this.recoveryAttempts.clear();
    this.store.clearWindowStates();
    this.emit('statesCleared');
  }

  /**
   * Get comprehensive manager metrics for monitoring and debugging.
   */
  getMetrics(): {
    totalStates: number;
    activeWindows: number;
    recoveryAttempts: number;
    lastSave: string;
  } {
    return {
      totalStates: this.states.size,
      activeWindows: this.windowInstances.size,
      recoveryAttempts: Array.from(this.recoveryAttempts.values()).reduce((sum, attempts) => sum + attempts, 0),
      lastSave: new Date().toISOString(),
    };
  }

  /**
   * Cleanup resources and shutdown manager with final state persistence.
   */
  async dispose(): Promise<void> {
    this.logger.info('Disposing window state manager');

    // Clear periodic timer
    if (this.persistenceTimer) {
      clearInterval(this.persistenceTimer);
      this.persistenceTimer = null;
    }

    // Save final state
    try {
      await this.saveStates();
    } catch (error) {
      this.logger.error('Failed to save states during dispose', error instanceof Error ? error : undefined);
    }

    // Clear all data
    this.windowInstances.clear();
    this.states.clear();
    this.recoveryAttempts.clear();

    this.isInitialized = false;
    this.emit('disposed');
  }
}
